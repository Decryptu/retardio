const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require('discord.js');
const { drawBoosterPack, getCardInfo, getAllCardsFromBooster } = require('./cardGenerator').default;
const { canOpenBooster, addCardsToUser, loadUserData, removeCardFromUser, saveUserData, getBoosterCompletion, getBoosterInventory, removeBoosterFromInventory, getMoney } = require('./userManager');
const { generateBoosterOpeningImage, generateCollectionImage, generateCardDetailImage } = require('./imageGenerator');
const boosters = require('./data/boosters.json');
const path = require('node:path');
const fs = require('node:fs');

const ASSETS_DIR = path.join(__dirname, 'assets');
const CURRENCY_SYMBOL = 'Ꝑ';

// ⚙️ CONFIGURATION ADMIN - Whitelist des IDs Discord autorisés
// Pour trouver ton ID Discord: active le Mode développeur dans Discord > Clique droit sur ton nom > Copier l'ID
const ADMIN_WHITELIST = [
  '98891713610797056', // ⬅️ Remplacer par ton ID Discord ici
  // Ajoute d'autres IDs admin ici si nécessaire
];

// Commandes slash
const pokemonCommands = [
  new SlashCommandBuilder()
    .setName('booster')
    .setDescription('Ouvrir un booster de cartes Pokémon'),

  new SlashCommandBuilder()
    .setName('collection')
    .setDescription('Consulter une collection de cartes')
    .addUserOption(option =>
      option.setName('utilisateur')
        .setDescription('Utilisateur dont vous voulez voir la collection (par défaut: vous)')
        .setRequired(false)
    )
    .addStringOption(option =>
      option.setName('booster')
        .setDescription('ID du booster à afficher')
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('echange')
    .setDescription('Échanger des cartes avec un autre utilisateur')
    .addUserOption(option =>
      option.setName('utilisateur')
        .setDescription('Utilisateur avec qui échanger')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('giftbooster')
    .setDescription('[ADMIN] Offrir un booster à un utilisateur')
    .addUserOption(option =>
      option.setName('utilisateur')
        .setDescription('Utilisateur à qui offrir un booster')
        .setRequired(true)
    )
];

// Map pour stocker les échanges en cours
const activeTrades = new Map();

/**
 * Obtient les boosters ouvrables (non-promo)
 */
function getOpenableBoosters() {
  return Object.values(boosters).filter(b => !b.isPromo && b.cardsPerPack > 0);
}

/**
 * Vérifie que l'utilisateur qui interagit est le propriétaire
 */
async function verifyOwner(interaction, ownerId) {
  if (interaction.user.id !== ownerId) {
    await interaction.reply({
      content: '❌ Cette interaction ne vous appartient pas.',
      ephemeral: true
    });
    return false;
  }
  return true;
}

/**
 * Gère la commande /booster - Affiche la sélection de boosters
 */
async function handleBoosterCommand(interaction) {
  const userId = interaction.user.id;
  const canOpen = canOpenBooster(userId);
  const inventory = getBoosterInventory(userId);
  const userMoney = getMoney(userId);

  const openableBoosters = getOpenableBoosters();

  // Construire la description
  let description = `**Votre solde:** ${userMoney.toLocaleString('fr-FR')} ${CURRENCY_SYMBOL}\n\n`;

  if (canOpen) {
    description += '🎁 **Booster quotidien disponible !**\nChoisissez un booster à ouvrir gratuitement.\n\n';
  } else {
    description += '⏰ Booster quotidien déjà ouvert aujourd\'hui.\n\n';
  }

  // Afficher l'inventaire si non vide
  const inventoryLines = [];
  for (const [boosterId, quantity] of Object.entries(inventory)) {
    if (quantity > 0 && boosters[boosterId] && !boosters[boosterId].isPromo) {
      inventoryLines.push(`• **${boosters[boosterId].name}** x${quantity}`);
    }
  }

  if (inventoryLines.length > 0) {
    description += `📦 **Boosters en inventaire:**\n${inventoryLines.join('\n')}\n\n`;
  }

  description += 'Sélectionnez un booster ci-dessous pour l\'ouvrir.';

  const embed = new EmbedBuilder()
    .setColor('#FFD700')
    .setTitle('Ouvrir un Booster')
    .setDescription(description);

  // Créer les options du menu
  const boosterOptions = [];

  for (const booster of openableBoosters) {
    const inInventory = inventory[String(booster.id)] || 0;

    const label = booster.name;
    let descText = `${booster.totalCards} cartes`;
    let emoji = '📦';

    if (canOpen) {
      descText += ' • Quotidien gratuit';
      emoji = '🎁';
    } else if (inInventory > 0) {
      descText += ` • ${inInventory} en stock`;
      emoji = '📦';
    } else {
      descText += ' • Aucun disponible';
      emoji = '🔒';
    }

    boosterOptions.push({
      label: label,
      description: descText,
      value: `open_booster_${booster.id}`,
      emoji: emoji
    });
  }

  // Limiter à 25 options maximum pour Discord
  const limitedOptions = boosterOptions.slice(0, 25);

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId(`booster_select_open_${userId}`)
    .setPlaceholder('Choisir un booster à ouvrir...')
    .addOptions(limitedOptions);

  const row = new ActionRowBuilder().addComponents(selectMenu);

  await interaction.reply({
    embeds: [embed],
    components: [row]
  });
}

/**
 * Affiche la prévisualisation d'un booster avant ouverture
 */
async function showBoosterPreview(interaction, boosterId, ownerId) {
  const canOpen = canOpenBooster(ownerId);
  const inventory = getBoosterInventory(ownerId);
  const booster = boosters[boosterId];

  if (!booster || booster.isPromo) {
    return interaction.update({
      content: '❌ Ce booster n\'est pas disponible.',
      embeds: [],
      components: []
    });
  }

  const inInventory = inventory[String(boosterId)] || 0;
  // Removed unused canOpenThis variable
  // Check directly instead
  if (!canOpen && inInventory === 0) {
    return interaction.update({
      content: '❌ Vous n\'avez pas de booster disponible ! Achetez-en dans la `/boutique` ou attendez minuit pour votre booster quotidien.',
      embeds: [],
      components: []
    });
  }

  // Charger l'image du booster
  const boosterImagePath = path.join(ASSETS_DIR, 'boosters', `booster_${boosterId}.png`);
  const files = []; // Changed let to const

  const embed = new EmbedBuilder()
    .setColor('#FFD700')
    .setTitle(booster.name)
    .setDescription(
      `**Cartes par pack:** ${booster.cardsPerPack}\n` +
      `**Total de cartes:** ${booster.totalCards}\n` +
      `**Garantie:** ${booster.guarantees?.minRarity || 'Aucune'}\n\n` +
      (canOpen ? '🎁 Utilise ton **booster quotidien gratuit**' : `📦 Utilise un booster de ton **inventaire** (${inInventory} restant${inInventory > 1 ? 's' : ''})`) +
      '\n\nConfirmer l\'ouverture ?'
    );

  if (fs.existsSync(boosterImagePath)) {
    const attachment = new AttachmentBuilder(boosterImagePath, { name: 'booster.png' });
    files.push(attachment);
    embed.setThumbnail('attachment://booster.png');
  }

  const confirmButton = new ButtonBuilder()
    .setCustomId(`booster_confirm_open_${boosterId}_${ownerId}`)
    .setLabel('Ouvrir le booster !')
    .setStyle(ButtonStyle.Success)
    .setEmoji('🎴');

  const backButton = new ButtonBuilder()
    .setCustomId(`booster_back_select_${ownerId}`)
    .setLabel('Retour')
    .setStyle(ButtonStyle.Secondary);

  const row = new ActionRowBuilder().addComponents(confirmButton, backButton);

  await interaction.update({
    embeds: [embed],
    components: [row],
    files: files
  });
}

/**
 * Ouvre effectivement un booster
 */
async function openBooster(interaction, boosterId, ownerId) {
  const canOpen = canOpenBooster(ownerId);
  const inventory = getBoosterInventory(ownerId);
  const booster = boosters[boosterId];

  if (!booster || booster.isPromo) {
    return interaction.update({
      content: '❌ Ce booster n\'est pas disponible.',
      embeds: [],
      components: []
    });
  }

  const inInventory = inventory[String(boosterId)] || 0;
  const useDaily = canOpen;
  const useInventory = !canOpen && inInventory > 0;

  if (!useDaily && !useInventory) {
    return interaction.update({
      content: '❌ Vous n\'avez pas de booster disponible !',
      embeds: [],
      components: []
    });
  }

  await interaction.deferUpdate();

  try {
    // Consommer le booster
    if (useInventory) {
      const removed = removeBoosterFromInventory(ownerId, boosterId);
      if (!removed) {
        return interaction.editReply({
          content: '❌ Erreur lors de la consommation du booster.',
          embeds: [],
          components: []
        });
      }
    }

    // Tirer les cartes
    const { cards: cardIds, isGodPack } = drawBoosterPack(boosterId);

    // Ajouter les cartes à l'utilisateur (ceci met aussi à jour lastBoosterOpen si c'est le quotidien)
    if (useDaily) {
      addCardsToUser(ownerId, cardIds);
    } else {
      // Pour l'inventaire, on ajoute les cartes sans mettre à jour le cooldown
      const userData = loadUserData(ownerId);
      cardIds.forEach(cardId => {
        const id = String(cardId);
        userData.cards[id] = (userData.cards[id] || 0) + 1;
      });
      userData.stats.totalCards += cardIds.length;
      userData.stats.totalBoosters += 1;
      saveUserData(ownerId, userData);
    }

    // Générer l'image
    const imageBuffer = await generateBoosterOpeningImage(cardIds, isGodPack);
    const attachment = new AttachmentBuilder(imageBuffer, { name: 'booster.png' });

    // Préparer la description des cartes
    const cardDescriptions = cardIds.map(cardId => {
      const cardInfo = getCardInfo(cardId);
      return `**${cardInfo.name}** - ${cardInfo.rarityName}`;
    }).join('\n');

    const sourceText = useDaily ? 'Booster quotidien' : 'Booster de l\'inventaire';

    const embed = new EmbedBuilder()
      .setColor(isGodPack ? '#FF00FF' : '#FFD700')
      .setTitle(isGodPack ? '✨🌟 GOD PACK ! 🌟✨' : `${booster.name} Ouvert !`)
      .setDescription(
        `${isGodPack ? '**INCROYABLE ! Toutes les cartes sont au moins Rare !**\n\n' : ''}` +
        `*${sourceText}*\n\n` +
        `Vous avez reçu les cartes suivantes :\n\n${cardDescriptions}`
      )
      .setImage('attachment://booster.png')
      .setFooter({ text: isGodPack ? 'Félicitations pour ce GOD PACK légendaire !' : (useDaily ? 'Revenez demain pour un nouveau booster gratuit !' : 'Achetez plus de boosters dans la /boutique !') });

    await interaction.editReply({
      embeds: [embed],
      files: [attachment],
      components: []
    });

  } catch (error) {
    console.error('Erreur lors de l\'ouverture du booster:', error);
    await interaction.editReply({
      content: '❌ Une erreur est survenue lors de l\'ouverture du booster.',
      embeds: [],
      components: []
    });
  }
}

/**
 * Gère la commande /collection
 */
async function handleCollectionCommand(interaction) {
  const targetUser = interaction.options.getUser('utilisateur') || interaction.user;
  const boosterIdOption = interaction.options.getString('booster');
  let boosterId = boosterIdOption || '1';
  const userId = targetUser.id;

  // Vérifier que le booster existe
  if (!boosters[boosterId]) {
    // Essayer de trouver un booster par défaut
    boosterId = Object.keys(boosters)[0] || '1';
    if (!boosters[boosterId]) {
      return interaction.reply({
        content: '❌ Aucun booster disponible.',
        ephemeral: true
      });
    }
  }

  await interaction.deferReply();

  try {
    // Générer l'image de la collection
    const imageBuffer = await generateCollectionImage(userId, boosterId);
    const attachment = new AttachmentBuilder(imageBuffer, { name: 'collection.png' });

    // Récupérer les stats
    const { owned, total } = getBoosterCompletion(userId, boosterId);
    const percentage = total > 0 ? Math.round((owned / total) * 100) : 0;

    // Charger l'image du booster pour le thumbnail
    const boosterImagePath = path.join(ASSETS_DIR, 'boosters', `booster_${boosterId}.png`);
    const files = [attachment];

    const embed = new EmbedBuilder()
      .setColor('#0099ff')
      .setTitle(`Collection de ${targetUser.username}`)
      .setDescription(`**${boosters[boosterId].name}**\n${owned}/${total} cartes (${percentage}%)`)
      .setImage('attachment://collection.png');

    // Ajouter l'image du booster en thumbnail si disponible
    if (fs.existsSync(boosterImagePath)) {
      const boosterAttachment = new AttachmentBuilder(boosterImagePath, { name: 'booster_thumb.png' });
      files.push(boosterAttachment);
      embed.setThumbnail('attachment://booster_thumb.png');
    }

    // Créer le menu de sélection de booster (tous les boosters, y compris promo)
    const boosterOptions = Object.values(boosters).map(booster => ({
      label: booster.name,
      description: `${booster.totalCards} cartes${booster.isPromo ? ' (Promo)' : ''}`,
      value: String(booster.id),
      default: String(booster.id) === String(boosterId),
      emoji: booster.isPromo ? '✨' : '📦'
    }));

    // Limiter à 25 options
    const limitedOptions = boosterOptions.slice(0, 25);

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(`collection_select_${targetUser.id}`)
      .setPlaceholder('Changer de booster')
      .addOptions(limitedOptions);

    const row1 = new ActionRowBuilder().addComponents(selectMenu);

    // Créer le menu de sélection de carte possédée
    const userData = loadUserData(userId);
    const allCards = getAllCardsFromBooster(boosterId);
    const ownedCards = allCards.filter(card => userData.cards[String(card.id)] && userData.cards[String(card.id)] > 0);

    const components = [row1];

    if (ownedCards.length > 0) {
      const cardOptions = ownedCards.slice(0, 25).map(card => ({
        label: card.name,
        description: `${card.rarityName} - x${userData.cards[String(card.id)]}`,
        value: `${card.id}_${boosterId}`,
        emoji: '🃏'
      }));

      const cardSelectMenu = new StringSelectMenuBuilder()
        .setCustomId(`collection_card_${targetUser.id}`)
        .setPlaceholder('Voir une carte en détail')
        .addOptions(cardOptions);

      const row2 = new ActionRowBuilder().addComponents(cardSelectMenu);
      components.push(row2);
    }

    await interaction.editReply({
      embeds: [embed],
      files: files,
      components: components
    });

  } catch (error) {
    console.error('Erreur lors de l\'affichage de la collection:', error);
    await interaction.editReply({
      content: '❌ Une erreur est survenue lors de l\'affichage de la collection.'
    });
  }
}

/**
 * Gère la commande /echange
 */
async function handleTradeCommand(interaction) {
  const initiator = interaction.user;
  const target = interaction.options.getUser('utilisateur');

  // Vérifications de base
  if (target.bot) {
    return interaction.reply({
      content: '❌ Vous ne pouvez pas échanger avec un bot.',
      ephemeral: true
    });
  }

  if (target.id === initiator.id) {
    return interaction.reply({
      content: '❌ Vous ne pouvez pas échanger avec vous-même.',
      ephemeral: true
    });
  }

  // Charger les données des utilisateurs
  const initiatorData = loadUserData(initiator.id);
  const targetData = loadUserData(target.id);

  // Vérifier qu'ils ont des cartes
  const initiatorCards = Object.keys(initiatorData.cards).filter(id => initiatorData.cards[id] > 0);
  const targetCards = Object.keys(targetData.cards).filter(id => targetData.cards[id] > 0);

  if (initiatorCards.length === 0) {
    return interaction.reply({
      content: '❌ Vous n\'avez aucune carte à échanger.',
      ephemeral: true
    });
  }

  if (targetCards.length === 0) {
    return interaction.reply({
      content: `❌ ${target.username} n'a aucune carte à échanger.`,
      ephemeral: true
    });
  }

  // Créer les menus de sélection
  const initiatorOptions = initiatorCards.slice(0, 25).map(cardId => {
    const cardInfo = getCardInfo(cardId);
    const quantity = initiatorData.cards[cardId];
    return {
      label: `${cardInfo?.name || `Carte ${cardId}`} (x${quantity})`,
      description: `${cardInfo?.rarityName || 'Inconnue'}`,
      value: cardId
    };
  });

  const targetOptions = targetCards.slice(0, 25).map(cardId => {
    const cardInfo = getCardInfo(cardId);
    const quantity = targetData.cards[cardId];
    return {
      label: `${cardInfo?.name || `Carte ${cardId}`} (x${quantity})`,
      description: `${cardInfo?.rarityName || 'Inconnue'}`,
      value: cardId
    };
  });

  const initiatorSelect = new StringSelectMenuBuilder()
    .setCustomId(`trade_give_${interaction.id}`)
    .setPlaceholder('Choisissez la carte que vous donnez')
    .addOptions(initiatorOptions);

  const targetSelect = new StringSelectMenuBuilder()
    .setCustomId(`trade_receive_${interaction.id}`)
    .setPlaceholder('Choisissez la carte que vous recevez')
    .addOptions(targetOptions);

  const row1 = new ActionRowBuilder().addComponents(initiatorSelect);
  const row2 = new ActionRowBuilder().addComponents(targetSelect);

  // Initialiser l'échange
  activeTrades.set(interaction.id, {
    initiatorId: initiator.id,
    targetId: target.id,
    giveCardId: null,
    receiveCardId: null,
    timestamp: Date.now()
  });

  await interaction.reply({
    content: `📋 **Échange avec ${target}**\n\nÉtape 1: Choisissez la carte que vous donnez\nÉtape 2: Choisissez la carte que vous recevez`,
    components: [row1, row2],
    ephemeral: false
  });
}

/**
 * Gère la commande /giftbooster (ADMIN uniquement)
 */
async function handleGiftBoosterCommand(interaction) {
  const adminId = interaction.user.id;
  const targetUser = interaction.options.getUser('utilisateur');

  // Vérifier si l'utilisateur est admin
  if (!ADMIN_WHITELIST.includes(adminId)) {
    return interaction.reply({
      content: '❌ Vous n\'avez pas la permission d\'utiliser cette commande.',
      ephemeral: true
    });
  }

  // Vérifier que ce n'est pas un bot
  if (targetUser.bot) {
    return interaction.reply({
      content: '❌ Vous ne pouvez pas offrir un booster à un bot.',
      ephemeral: true
    });
  }

  try {
    // Charger les données de l'utilisateur
    const userData = loadUserData(targetUser.id);

    // Reset le cooldown (retirer lastBoosterOpen)
    delete userData.lastBoosterOpen;
    saveUserData(targetUser.id, userData);

    // Envoyer la confirmation
    const embed = new EmbedBuilder()
      .setColor('#FFD700')
      .setTitle('🎁 Booster Offert !')
      .setDescription(
        `${targetUser} a reçu un booster gratuit !\n\n` +
        `Tu peux maintenant utiliser \`/booster\` pour l'ouvrir ! 🎉`
      )
      .setFooter({ text: `Offert par ${interaction.user.username}` });

    await interaction.reply({
      content: `${targetUser}`,
      embeds: [embed]
    });

  } catch (error) {
    console.error('Erreur lors du gift de booster:', error);
    await interaction.reply({
      content: '❌ Une erreur est survenue lors de l\'attribution du booster.',
      ephemeral: true
    });
  }
}

/**
 * Gère les interactions des menus de sélection d'échange
 */
async function handleTradeSelectMenu(interaction) {
  const [, type, tradeId] = interaction.customId.split('_');

  const trade = activeTrades.get(tradeId);
  if (!trade) {
    return interaction.reply({
      content: '❌ Cet échange n\'est plus valide.',
      ephemeral: true
    });
  }

  // Vérifier que c'est l'initiateur qui sélectionne
  if (interaction.user.id !== trade.initiatorId) {
    return interaction.reply({
      content: '❌ Seul l\'initiateur de l\'échange peut sélectionner les cartes.',
      ephemeral: true
    });
  }

  const selectedCardId = interaction.values[0];

  if (type === 'give') {
    trade.giveCardId = selectedCardId;
  } else if (type === 'receive') {
    trade.receiveCardId = selectedCardId;
  }

  // Vérifier si les deux cartes sont sélectionnées
  if (trade.giveCardId && trade.receiveCardId) {
    await showTradeConfirmation(interaction, trade, tradeId);
  } else {
    const giveCardInfo = trade.giveCardId ? getCardInfo(trade.giveCardId) : null;
    const receiveCardInfo = trade.receiveCardId ? getCardInfo(trade.receiveCardId) : null;
    const giveCardName = giveCardInfo?.name || '❓ Non sélectionnée';
    const receiveCardName = receiveCardInfo?.name || '❓ Non sélectionnée';

    await interaction.update({
      content: `📋 **Échange en cours**\n\n` +
        `Vous donnez: ${giveCardName}\n` +
        `Vous recevez: ${receiveCardName}`,
      components: interaction.message.components
    });
  }
}

/**
 * Affiche la confirmation de l'échange
 */
async function showTradeConfirmation(interaction, trade, tradeId) {
  const initiator = await interaction.client.users.fetch(trade.initiatorId);
  const target = await interaction.client.users.fetch(trade.targetId);

  const giveCard = getCardInfo(trade.giveCardId);
  const receiveCard = getCardInfo(trade.receiveCardId);

  const confirmButton = new ButtonBuilder()
    .setCustomId(`trade_confirm_${tradeId}`)
    .setLabel('✅ Accepter')
    .setStyle(ButtonStyle.Success);

  const cancelButton = new ButtonBuilder()
    .setCustomId(`trade_cancel_${tradeId}`)
    .setLabel('❌ Refuser')
    .setStyle(ButtonStyle.Danger);

  const row = new ActionRowBuilder().addComponents(confirmButton, cancelButton);

  const embed = new EmbedBuilder()
    .setColor('#FFA500')
    .setTitle('🔄 Confirmation d\'échange')
    .setDescription(
      `**${initiator.username}** propose un échange à **${target}**\n\n` +
      `${initiator.username} donne: **${giveCard?.name || 'Carte inconnue'}** (${giveCard?.rarityName || 'Inconnue'})\n` +
      `${target.username} donne: **${receiveCard?.name || 'Carte inconnue'}** (${receiveCard?.rarityName || 'Inconnue'})\n\n` +
      `${target}, acceptez-vous cet échange ?`
    )
    .setFooter({ text: 'L\'échange expire dans 5 minutes' });

  await interaction.update({
    content: null,
    embeds: [embed],
    components: [row]
  });

  // Expiration automatique après 5 minutes
  setTimeout(() => {
    if (activeTrades.has(tradeId)) {
      activeTrades.delete(tradeId);
    }
  }, 5 * 60 * 1000);
}

/**
 * Gère les boutons de confirmation d'échange
 */
async function handleTradeButton(interaction) {
  const [, decision, tradeId] = interaction.customId.split('_');

  const trade = activeTrades.get(tradeId);
  if (!trade) {
    return interaction.reply({
      content: '❌ Cet échange n\'est plus valide ou a expiré.',
      ephemeral: true
    });
  }

  // Vérifier que c'est la cible qui répond
  if (interaction.user.id !== trade.targetId) {
    return interaction.reply({
      content: '❌ Seul l\'utilisateur ciblé peut accepter ou refuser l\'échange.',
      ephemeral: true
    });
  }

  if (decision === 'cancel') {
    activeTrades.delete(tradeId);
    await interaction.update({
      content: '❌ Échange refusé.',
      embeds: [],
      components: []
    });
    return;
  }

  // Confirmer l'échange
  try {
    const initiator = await interaction.client.users.fetch(trade.initiatorId);
    const target = await interaction.client.users.fetch(trade.targetId);

    // Retirer les cartes et les ajouter aux autres utilisateurs
    const success1 = removeCardFromUser(trade.initiatorId, trade.giveCardId);
    const success2 = removeCardFromUser(trade.targetId, trade.receiveCardId);

    if (!success1 || !success2) {
      // Rollback si l'un a échoué
      if (success1) addCardsToUser(trade.initiatorId, [trade.giveCardId]);
      if (success2) addCardsToUser(trade.targetId, [trade.receiveCardId]);

      await interaction.update({
        content: '❌ Erreur: Une des parties ne possède plus la carte proposée.',
        embeds: [],
        components: []
      });
      activeTrades.delete(tradeId);
      return;
    }

    // Ajouter les cartes
    addCardsToUser(trade.initiatorId, [trade.receiveCardId]);
    addCardsToUser(trade.targetId, [trade.giveCardId]);

    activeTrades.delete(tradeId);

    const giveCard = getCardInfo(trade.giveCardId);
    const receiveCard = getCardInfo(trade.receiveCardId);

    const embed = new EmbedBuilder()
      .setColor('#00FF00')
      .setTitle('✅ Échange réussi !')
      .setDescription(
        `${initiator} a reçu **${receiveCard?.name || 'Carte'}**\n` +
        `${target} a reçu **${giveCard?.name || 'Carte'}**`
      );

    await interaction.update({
      content: null,
      embeds: [embed],
      components: []
    });

  } catch (error) {
    console.error('Erreur lors de l\'échange:', error);
    await interaction.update({
      content: '❌ Une erreur est survenue lors de l\'échange.',
      embeds: [],
      components: []
    });
    activeTrades.delete(tradeId);
  }
}

/**
 * Gère toutes les commandes Pokémon
 */
async function handlePokemonCommand(interaction) {
  const commandName = interaction.commandName;

  if (commandName === 'booster') {
    await handleBoosterCommand(interaction);
  } else if (commandName === 'collection') {
    await handleCollectionCommand(interaction);
  } else if (commandName === 'echange') {
    await handleTradeCommand(interaction);
  } else if (commandName === 'giftbooster') {
    await handleGiftBoosterCommand(interaction);
  }
}

/**
 * Gère le menu de sélection de booster dans /collection
 */
async function handleCollectionSelectMenu(interaction) {
  const [, , targetUserId] = interaction.customId.split('_');
  const selectedBoosterId = interaction.values[0];

  // Vérifier que le booster existe
  if (!boosters[selectedBoosterId]) {
    return interaction.reply({
      content: '❌ Ce booster n\'existe pas.',
      ephemeral: true
    });
  }

  await interaction.deferUpdate();

  try {
    const targetUser = await interaction.client.users.fetch(targetUserId);

    // Générer l'image de la nouvelle collection
    const imageBuffer = await generateCollectionImage(targetUserId, selectedBoosterId);
    const attachment = new AttachmentBuilder(imageBuffer, { name: 'collection.png' });

    // Récupérer les stats
    const { owned, total } = getBoosterCompletion(targetUserId, selectedBoosterId);
    const percentage = total > 0 ? Math.round((owned / total) * 100) : 0;

    // Charger l'image du booster pour le thumbnail
    const boosterImagePath = path.join(ASSETS_DIR, 'boosters', `booster_${selectedBoosterId}.png`);
    const files = [attachment];

    const embed = new EmbedBuilder()
      .setColor('#0099ff')
      .setTitle(`📚 Collection de ${targetUser.username}`)
      .setDescription(`**${boosters[selectedBoosterId].name}**\n${owned}/${total} cartes (${percentage}%)`)
      .setImage('attachment://collection.png');

    // Ajouter l'image du booster en thumbnail si disponible
    if (fs.existsSync(boosterImagePath)) {
      const boosterAttachment = new AttachmentBuilder(boosterImagePath, { name: 'booster_thumb.png' });
      files.push(boosterAttachment);
      embed.setThumbnail('attachment://booster_thumb.png');
    }

    // Recréer le menu avec la nouvelle sélection
    const boosterOptions = Object.values(boosters).map(booster => ({
      label: booster.name,
      description: `${booster.totalCards} cartes${booster.isPromo ? ' (Promo)' : ''}`,
      value: String(booster.id),
      default: String(booster.id) === String(selectedBoosterId),
      emoji: booster.isPromo ? '✨' : '📦'
    }));

    const limitedOptions = boosterOptions.slice(0, 25);

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(`collection_select_${targetUserId}`)
      .setPlaceholder('Changer de booster')
      .addOptions(limitedOptions);

    const row1 = new ActionRowBuilder().addComponents(selectMenu);

    // Créer le menu de sélection de carte possédée
    const userData = loadUserData(targetUserId);
    const allCards = getAllCardsFromBooster(selectedBoosterId);
    const ownedCards = allCards.filter(card => userData.cards[String(card.id)] && userData.cards[String(card.id)] > 0);

    const components = [row1];

    if (ownedCards.length > 0) {
      const cardOptions = ownedCards.slice(0, 25).map(card => ({
        label: card.name,
        description: `${card.rarityName} - x${userData.cards[String(card.id)]}`,
        value: `${card.id}_${selectedBoosterId}`,
        emoji: '🃏'
      }));

      const cardSelectMenu = new StringSelectMenuBuilder()
        .setCustomId(`collection_card_${targetUserId}`)
        .setPlaceholder('Voir une carte en détail')
        .addOptions(cardOptions);

      const row2 = new ActionRowBuilder().addComponents(cardSelectMenu);
      components.push(row2);
    }

    await interaction.editReply({
      embeds: [embed],
      files: files,
      components: components
    });

  } catch (error) {
    console.error('Erreur lors du changement de booster:', error);
    await interaction.followUp({
      content: '❌ Une erreur est survenue lors du changement de booster.',
      ephemeral: true
    });
  }
}

/**
 * Gère la sélection de carte pour voir en détail
 */
async function handleCardDetailSelectMenu(interaction) {
  const [, , targetUserId] = interaction.customId.split('_');
  const [cardId, boosterId] = interaction.values[0].split('_');

  await interaction.deferUpdate();

  try {
    const userData = loadUserData(targetUserId);
    const quantity = userData.cards[String(cardId)] || 0;
    const cardInfo = getCardInfo(cardId);

    if (!cardInfo) {
      return interaction.followUp({
        content: '❌ Cette carte n\'existe pas.',
        ephemeral: true
      });
    }

    // Générer l'image de détail de la carte
    const imageBuffer = await generateCardDetailImage(cardId, quantity, boosterId);
    const attachment = new AttachmentBuilder(imageBuffer, { name: 'card_detail.png' });

    const embed = new EmbedBuilder()
      .setColor(cardInfo.rarityColor)
      .setTitle(`🃏 ${cardInfo.name}`)
      .setDescription(`**Rareté:** ${cardInfo.rarityName}\n**Quantité:** x${quantity}`)
      .setImage('attachment://card_detail.png');

    // Bouton retour
    const backButton = new ButtonBuilder()
      .setCustomId(`collection_back_${targetUserId}_${boosterId}`)
      .setLabel('Retour à la collection')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('◀️');

    const row = new ActionRowBuilder().addComponents(backButton);

    await interaction.editReply({
      embeds: [embed],
      files: [attachment],
      components: [row]
    });

  } catch (error) {
    console.error('Erreur lors de l\'affichage du détail de carte:', error);
    await interaction.followUp({
      content: '❌ Une erreur est survenue lors de l\'affichage de la carte.',
      ephemeral: true
    });
  }
}

/**
 * Gère le bouton retour vers la collection
 */
async function handleCollectionBackButton(interaction) {
  const parts = interaction.customId.split('_');
  const targetUserId = parts[2];
  const boosterId = parts[3];

  await interaction.deferUpdate();

  try {
    const targetUser = await interaction.client.users.fetch(targetUserId);

    // Générer l'image de la collection
    const imageBuffer = await generateCollectionImage(targetUserId, boosterId);
    const attachment = new AttachmentBuilder(imageBuffer, { name: 'collection.png' });

    // Récupérer les stats
    const { owned, total } = getBoosterCompletion(targetUserId, boosterId);
    const percentage = total > 0 ? Math.round((owned / total) * 100) : 0;

    // Charger l'image du booster pour le thumbnail
    const boosterImagePath = path.join(ASSETS_DIR, 'boosters', `booster_${boosterId}.png`);
    const files = [attachment];

    const embed = new EmbedBuilder()
      .setColor('#0099ff')
      .setTitle(`📚 Collection de ${targetUser.username}`)
      .setDescription(`**${boosters[boosterId].name}**\n${owned}/${total} cartes (${percentage}%)`)
      .setImage('attachment://collection.png');

    if (fs.existsSync(boosterImagePath)) {
      const boosterAttachment = new AttachmentBuilder(boosterImagePath, { name: 'booster_thumb.png' });
      files.push(boosterAttachment);
      embed.setThumbnail('attachment://booster_thumb.png');
    }

    // Recréer les menus
    const boosterOptions = Object.values(boosters).map(booster => ({
      label: booster.name,
      description: `${booster.totalCards} cartes${booster.isPromo ? ' (Promo)' : ''}`,
      value: String(booster.id),
      default: String(booster.id) === String(boosterId),
      emoji: booster.isPromo ? '✨' : '📦'
    }));

    const limitedOptions = boosterOptions.slice(0, 25);

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(`collection_select_${targetUserId}`)
      .setPlaceholder('Changer de booster')
      .addOptions(limitedOptions);

    const row1 = new ActionRowBuilder().addComponents(selectMenu);

    // Créer le menu de sélection de carte possédée
    const userData = loadUserData(targetUserId);
    const allCards = getAllCardsFromBooster(boosterId);
    const ownedCards = allCards.filter(card => userData.cards[String(card.id)] && userData.cards[String(card.id)] > 0);

    const components = [row1];

    if (ownedCards.length > 0) {
      const cardOptions = ownedCards.slice(0, 25).map(card => ({
        label: card.name,
        description: `${card.rarityName} - x${userData.cards[String(card.id)]}`,
        value: `${card.id}_${boosterId}`,
        emoji: '🃏'
      }));

      const cardSelectMenu = new StringSelectMenuBuilder()
        .setCustomId(`collection_card_${targetUserId}`)
        .setPlaceholder('Voir une carte en détail')
        .addOptions(cardOptions);

      const row2 = new ActionRowBuilder().addComponents(cardSelectMenu);
      components.push(row2);
    }

    await interaction.editReply({
      embeds: [embed],
      files: files,
      components: components
    });

  } catch (error) {
    console.error('Erreur lors du retour à la collection:', error);
    await interaction.followUp({
      content: '❌ Une erreur est survenue.',
      ephemeral: true
    });
  }
}

/**
 * Gère la sélection de booster à ouvrir
 */
async function handleBoosterSelectMenu(interaction) {
  const boosterId = interaction.values[0].replace('open_booster_', '');
  // Extraire l'ownerId du customId: booster_select_open_ownerId
  const parts = interaction.customId.split('_');
  const ownerId = parts[parts.length - 1];

  if (!await verifyOwner(interaction, ownerId)) {
    return;
  }

  await showBoosterPreview(interaction, boosterId, ownerId);
}

/**
 * Gère les boutons du booster
 */
async function handleBoosterButton(interaction) {
  const customId = interaction.customId;
  const parts = customId.split('_');
  const ownerId = parts[parts.length - 1];

  if (!await verifyOwner(interaction, ownerId)) {
    return;
  }

  if (customId.includes('_confirm_open_')) {
    // Format: booster_confirm_open_boosterId_ownerId
    const boosterId = parts[3];
    await openBooster(interaction, boosterId, ownerId);
  } else if (customId.startsWith('booster_back_select_')) {
    // Retour à la sélection de booster
    const canOpen = canOpenBooster(ownerId);
    const inventory = getBoosterInventory(ownerId);
    const userMoney = getMoney(ownerId);

    const openableBoosters = getOpenableBoosters();

    let description = `**Votre solde:** ${userMoney.toLocaleString('fr-FR')} ${CURRENCY_SYMBOL}\n\n`;

    if (canOpen) {
      description += '🎁 **Booster quotidien disponible !**\nChoisissez un booster à ouvrir gratuitement.\n\n';
    } else {
      description += '⏰ Booster quotidien déjà ouvert aujourd\'hui.\n\n';
    }

    const inventoryLines = [];
    for (const [boosterId, quantity] of Object.entries(inventory)) {
      if (quantity > 0 && boosters[boosterId] && !boosters[boosterId].isPromo) {
        inventoryLines.push(`• **${boosters[boosterId].name}** x${quantity}`);
      }
    }

    if (inventoryLines.length > 0) {
      description += `📦 **Boosters en inventaire:**\n${inventoryLines.join('\n')}\n\n`;
    }

    description += 'Sélectionnez un booster ci-dessous pour l\'ouvrir.';

    const embed = new EmbedBuilder()
      .setColor('#FFD700')
      .setTitle('Ouvrir un Booster')
      .setDescription(description);

    const boosterOptions = [];

    for (const booster of openableBoosters) {
      const inInventory = inventory[String(booster.id)] || 0;

      let descText = `${booster.totalCards} cartes`;
      let emoji = '📦';

      if (canOpen) {
        descText += ' • Quotidien gratuit';
        emoji = '🎁';
      } else if (inInventory > 0) {
        descText += ` • ${inInventory} en stock`;
        emoji = '📦';
      } else {
        descText += ' • Aucun disponible';
        emoji = '🔒';
      }

      boosterOptions.push({
        label: booster.name,
        description: descText,
        value: `open_booster_${booster.id}`,
        emoji: emoji
      });
    }

    const limitedOptions = boosterOptions.slice(0, 25);

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(`booster_select_open_${ownerId}`)
      .setPlaceholder('Choisir un booster à ouvrir...')
      .addOptions(limitedOptions);

    const row = new ActionRowBuilder().addComponents(selectMenu);

    await interaction.update({
      embeds: [embed],
      components: [row],
      files: []
    });
  }
}

/**
 * Gère les interactions (menus, boutons)
 */
async function handlePokemonInteraction(interaction) {
  if (interaction.isStringSelectMenu()) {
    if (interaction.customId.startsWith('trade_')) {
      await handleTradeSelectMenu(interaction);
    } else if (interaction.customId.startsWith('collection_card_')) {
      await handleCardDetailSelectMenu(interaction);
    } else if (interaction.customId.startsWith('collection_select_')) {
      await handleCollectionSelectMenu(interaction);
    } else if (interaction.customId.startsWith('booster_select_open_')) {
      await handleBoosterSelectMenu(interaction);
    }
  } else if (interaction.isButton()) {
    if (interaction.customId.startsWith('trade_')) {
      await handleTradeButton(interaction);
    } else if (interaction.customId.startsWith('collection_back_')) {
      await handleCollectionBackButton(interaction);
    } else if (interaction.customId.startsWith('booster_')) {
      await handleBoosterButton(interaction);
    }
  }
}

module.exports = {
  pokemonCommands,
  handlePokemonCommand,
  handlePokemonInteraction
};
