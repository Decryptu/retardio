const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require('discord.js');
const { drawBoosterPack, getCardInfo } = require('./cardGenerator');
const { canOpenBooster, addCardsToUser, loadUserData, removeCardFromUser, saveUserData, getBoosterCompletion } = require('./userManager');
const { generateBoosterOpeningImage, generateCollectionImage } = require('./imageGenerator');
const boosters = require('./data/boosters.json');

// Commandes slash
const pokemonCommands = [
  new SlashCommandBuilder()
    .setName('booster')
    .setDescription('Ouvrir votre booster quotidien gratuit'),

  new SlashCommandBuilder()
    .setName('collection')
    .setDescription('Consulter une collection de cartes')
    .addUserOption(option =>
      option.setName('utilisateur')
        .setDescription('Utilisateur dont vous voulez voir la collection (par défaut: vous)')
        .setRequired(false)
    )
    .addIntegerOption(option =>
      option.setName('booster')
        .setDescription('Numéro du booster à afficher (par défaut: 1)')
        .setRequired(false)
        .setMinValue(1)
    ),

  new SlashCommandBuilder()
    .setName('echange')
    .setDescription('Échanger des cartes avec un autre utilisateur')
    .addUserOption(option =>
      option.setName('utilisateur')
        .setDescription('Utilisateur avec qui échanger')
        .setRequired(true)
    )
];

// Map pour stocker les échanges en cours
const activeTrades = new Map();

/**
 * Gère la commande /booster
 */
async function handleBoosterCommand(interaction) {
  const userId = interaction.user.id;

  // Vérifier si l'utilisateur peut ouvrir un booster
  if (!canOpenBooster(userId)) {
    return interaction.reply({
      content: '❌ Vous avez déjà ouvert votre booster aujourd\'hui ! Revenez demain à minuit.',
      ephemeral: true
    });
  }

  await interaction.deferReply();

  try {
    // Tirer 5 cartes du booster 1
    const cardIds = drawBoosterPack(1);

    // Ajouter les cartes à l'utilisateur
    addCardsToUser(userId, cardIds);

    // Générer l'image
    const imageBuffer = await generateBoosterOpeningImage(cardIds);
    const attachment = new AttachmentBuilder(imageBuffer, { name: 'booster.png' });

    // Préparer la description des cartes
    const cardDescriptions = cardIds.map(cardId => {
      const cardInfo = getCardInfo(cardId);
      return `**Carte ${cardId}** - ${cardInfo.rarityName}`;
    }).join('\n');

    const embed = new EmbedBuilder()
      .setColor('#FFD700')
      .setTitle('🎉 Booster Ouvert !')
      .setDescription(`Vous avez reçu les cartes suivantes :\n\n${cardDescriptions}`)
      .setImage('attachment://booster.png')
      .setFooter({ text: 'Revenez demain pour un nouveau booster !' });

    await interaction.editReply({
      embeds: [embed],
      files: [attachment]
    });

  } catch (error) {
    console.error('Erreur lors de l\'ouverture du booster:', error);
    await interaction.editReply({
      content: '❌ Une erreur est survenue lors de l\'ouverture du booster.',
      ephemeral: true
    });
  }
}

/**
 * Gère la commande /collection
 */
async function handleCollectionCommand(interaction) {
  const targetUser = interaction.options.getUser('utilisateur') || interaction.user;
  const boosterId = interaction.options.getInteger('booster') || 1;
  const userId = targetUser.id;

  // Vérifier que le booster existe
  if (!boosters[boosterId]) {
    return interaction.reply({
      content: `❌ Le booster ${boosterId} n'existe pas.`,
      ephemeral: true
    });
  }

  await interaction.deferReply();

  try {
    // Générer l'image de la collection
    const imageBuffer = await generateCollectionImage(userId, boosterId);
    const attachment = new AttachmentBuilder(imageBuffer, { name: 'collection.png' });

    // Récupérer les stats
    const { owned, total } = getBoosterCompletion(userId, boosterId);
    const percentage = total > 0 ? Math.round((owned / total) * 100) : 0;

    const embed = new EmbedBuilder()
      .setColor('#0099ff')
      .setTitle(`📚 Collection de ${targetUser.username}`)
      .setDescription(`**${boosters[boosterId].name}**\n${owned}/${total} cartes (${percentage}%)`)
      .setImage('attachment://collection.png');

    await interaction.editReply({
      embeds: [embed],
      files: [attachment]
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
    const cardInfo = getCardInfo(parseInt(cardId));
    const quantity = initiatorData.cards[cardId];
    return {
      label: `Carte ${cardId} (x${quantity})`,
      description: `${cardInfo.rarityName}`,
      value: cardId
    };
  });

  const targetOptions = targetCards.slice(0, 25).map(cardId => {
    const cardInfo = getCardInfo(parseInt(cardId));
    const quantity = targetData.cards[cardId];
    return {
      label: `Carte ${cardId} (x${quantity})`,
      description: `${cardInfo.rarityName}`,
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
 * Gère les interactions des menus de sélection d'échange
 */
async function handleTradeSelectMenu(interaction) {
  const [action, type, tradeId] = interaction.customId.split('_');

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
    await interaction.update({
      content: `📋 **Échange en cours**\n\n` +
        `Vous donnez: ${trade.giveCardId ? `Carte ${trade.giveCardId}` : '❓ Non sélectionnée'}\n` +
        `Vous recevez: ${trade.receiveCardId ? `Carte ${trade.receiveCardId}` : '❓ Non sélectionnée'}`,
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

  const giveCard = getCardInfo(parseInt(trade.giveCardId));
  const receiveCard = getCardInfo(parseInt(trade.receiveCardId));

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
      `${initiator.username} donne: **Carte ${trade.giveCardId}** (${giveCard.rarityName})\n` +
      `${target.username} donne: **Carte ${trade.receiveCardId}** (${receiveCard.rarityName})\n\n` +
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
  const [action, decision, tradeId] = interaction.customId.split('_');

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
    const success1 = removeCardFromUser(trade.initiatorId, parseInt(trade.giveCardId));
    const success2 = removeCardFromUser(trade.targetId, parseInt(trade.receiveCardId));

    if (!success1 || !success2) {
      // Rollback si l'un a échoué
      if (success1) addCardsToUser(trade.initiatorId, [parseInt(trade.giveCardId)]);
      if (success2) addCardsToUser(trade.targetId, [parseInt(trade.receiveCardId)]);

      await interaction.update({
        content: '❌ Erreur: Une des parties ne possède plus la carte proposée.',
        embeds: [],
        components: []
      });
      activeTrades.delete(tradeId);
      return;
    }

    // Ajouter les cartes
    addCardsToUser(trade.initiatorId, [parseInt(trade.receiveCardId)]);
    addCardsToUser(trade.targetId, [parseInt(trade.giveCardId)]);

    activeTrades.delete(tradeId);

    const embed = new EmbedBuilder()
      .setColor('#00FF00')
      .setTitle('✅ Échange réussi !')
      .setDescription(
        `${initiator} a reçu la **Carte ${trade.receiveCardId}**\n` +
        `${target} a reçu la **Carte ${trade.giveCardId}**`
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
  }
}

/**
 * Gère les interactions (menus, boutons)
 */
async function handlePokemonInteraction(interaction) {
  if (interaction.isStringSelectMenu()) {
    if (interaction.customId.startsWith('trade_')) {
      await handleTradeSelectMenu(interaction);
    }
  } else if (interaction.isButton()) {
    if (interaction.customId.startsWith('trade_')) {
      await handleTradeButton(interaction);
    }
  }
}

module.exports = {
  pokemonCommands,
  handlePokemonCommand,
  handlePokemonInteraction
};
