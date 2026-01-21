const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require('discord.js');
const { getMoney, removeMoney, addBoosterToInventory, addCardToUser, hasLimitedCard, loadUserData } = require('./userManager');
const { loadBirthdays, getParisDayMonth } = require('./birthdayHandler');
const boosters = require('./data/boosters.json');
const cards = require('./data/cards.json');
const rarities = require('./data/rarities.json');
const path = require('path');
const fs = require('fs');

const ASSETS_DIR = path.join(__dirname, 'assets');
const CURRENCY_SYMBOL = 'Ꝑ';

// Commandes slash
const shopCommands = [
  new SlashCommandBuilder()
    .setName('boutique')
    .setDescription('Accéder à la boutique Pokémon'),

  new SlashCommandBuilder()
    .setName('solde')
    .setDescription('Voir votre solde de Poké Dollars')
    .addUserOption(option =>
      option.setName('utilisateur')
        .setDescription('Utilisateur dont vous voulez voir le solde')
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('inventaire')
    .setDescription('Voir votre inventaire de boosters')
];

/**
 * Obtient les boosters achetables (non-promo)
 */
function getPurchasableBoosters() {
  return Object.values(boosters).filter(b => !b.isPromo && b.price);
}

/**
 * Obtient les cartes promo achetables
 */
function getPurchasableCards() {
  return Object.values(cards).filter(c => c.isPromo);
}

/**
 * Gère la commande /boutique
 */
async function handleShopCommand(interaction) {
  const userId = interaction.user.id;
  const userMoney = getMoney(userId);

  const embed = new EmbedBuilder()
    .setColor('#FFD700')
    .setTitle('Boutique Pokémon')
    .setDescription(
      `Bienvenue dans la boutique !\n\n` +
      `**Votre solde:** ${userMoney.toLocaleString('fr-FR')} ${CURRENCY_SYMBOL}\n\n` +
      `Sélectionnez une catégorie ci-dessous pour voir les produits disponibles.`
    )
    .setFooter({ text: 'Gagnez des Poké Dollars en discutant sur le serveur !' });

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('shop_category_select')
    .setPlaceholder('Choisir une catégorie...')
    .addOptions([
      {
        label: 'Boosters',
        description: 'Acheter des packs de boosters',
        value: 'boosters',
        emoji: '📦'
      },
      {
        label: 'Cartes Promo',
        description: 'Acheter des cartes promotionnelles exclusives',
        value: 'cards',
        emoji: '✨'
      }
    ]);

  const row = new ActionRowBuilder().addComponents(selectMenu);

  await interaction.reply({
    embeds: [embed],
    components: [row]
  });
}

/**
 * Gère la commande /solde
 */
async function handleBalanceCommand(interaction) {
  const targetUser = interaction.options.getUser('utilisateur') || interaction.user;
  const userMoney = getMoney(targetUser.id);
  const userData = loadUserData(targetUser.id);

  const embed = new EmbedBuilder()
    .setColor('#FFD700')
    .setTitle(`Solde de ${targetUser.username}`)
    .setDescription(
      `**Solde actuel:** ${userMoney.toLocaleString('fr-FR')} ${CURRENCY_SYMBOL}\n\n` +
      `**Total gagné:** ${(userData.stats.totalMoneyEarned || 0).toLocaleString('fr-FR')} ${CURRENCY_SYMBOL}`
    )
    .setThumbnail(targetUser.displayAvatarURL());

  await interaction.reply({ embeds: [embed] });
}

/**
 * Gère la commande /inventaire
 */
async function handleInventoryCommand(interaction) {
  const userId = interaction.user.id;
  const userData = loadUserData(userId);
  const boosterInventory = userData.inventory?.boosters || {};

  const boosterLines = [];
  for (const [boosterId, quantity] of Object.entries(boosterInventory)) {
    if (quantity > 0 && boosters[boosterId]) {
      boosterLines.push(`**${boosters[boosterId].name}** x${quantity}`);
    }
  }

  const embed = new EmbedBuilder()
    .setColor('#9B59B6')
    .setTitle(`Inventaire de ${interaction.user.username}`)
    .setDescription(
      boosterLines.length > 0
        ? `**Boosters en stock:**\n${boosterLines.join('\n')}\n\nUtilisez \`/booster\` pour ouvrir un booster de votre inventaire !`
        : 'Votre inventaire de boosters est vide.\nAchetez des boosters dans la `/boutique` !'
    )
    .setFooter({ text: `Solde: ${getMoney(userId).toLocaleString('fr-FR')} ${CURRENCY_SYMBOL}` });

  await interaction.reply({ embeds: [embed] });
}

/**
 * Affiche les boosters disponibles à l'achat
 */
async function showBoostersShop(interaction) {
  const userId = interaction.user.id;
  const userMoney = getMoney(userId);
  const purchasableBoosters = getPurchasableBoosters();

  if (purchasableBoosters.length === 0) {
    return interaction.update({
      content: 'Aucun booster disponible à l\'achat pour le moment.',
      embeds: [],
      components: []
    });
  }

  const embed = new EmbedBuilder()
    .setColor('#3498DB')
    .setTitle('Boutique - Boosters')
    .setDescription(
      `**Votre solde:** ${userMoney.toLocaleString('fr-FR')} ${CURRENCY_SYMBOL}\n\n` +
      `Sélectionnez un booster pour l'acheter.`
    );

  const boosterOptions = purchasableBoosters.map(booster => {
    const canAfford = userMoney >= booster.price;
    return {
      label: `${booster.name} - ${booster.price.toLocaleString('fr-FR')} ${CURRENCY_SYMBOL}`,
      description: `${booster.totalCards} cartes • ${booster.cardsPerPack} cartes/pack${canAfford ? '' : ' (Fonds insuffisants)'}`,
      value: `buy_booster_${booster.id}`,
      emoji: canAfford ? '📦' : '🔒'
    };
  });

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('shop_booster_select')
    .setPlaceholder('Choisir un booster à acheter...')
    .addOptions(boosterOptions);

  const backButton = new ButtonBuilder()
    .setCustomId('shop_back_main')
    .setLabel('Retour')
    .setStyle(ButtonStyle.Secondary)
    .setEmoji('⬅️');

  const row1 = new ActionRowBuilder().addComponents(selectMenu);
  const row2 = new ActionRowBuilder().addComponents(backButton);

  await interaction.update({
    embeds: [embed],
    components: [row1, row2]
  });
}

/**
 * Affiche les cartes promo disponibles à l'achat
 */
async function showCardsShop(interaction) {
  const userId = interaction.user.id;
  const userMoney = getMoney(userId);
  const promoCards = getPurchasableCards();

  if (promoCards.length === 0) {
    return interaction.update({
      content: 'Aucune carte promo disponible à l\'achat pour le moment.',
      embeds: [],
      components: []
    });
  }

  // Vérifier si c'est l'anniversaire de l'utilisateur
  const { day: todayDay, month: todayMonth } = getParisDayMonth();
  const birthdaysList = loadBirthdays();
  const userBirthday = birthdaysList.find(b => b.userId === userId);
  const isBirthday = userBirthday && userBirthday.day === todayDay && userBirthday.month === todayMonth;

  const embed = new EmbedBuilder()
    .setColor('#E91E63')
    .setTitle('Boutique - Cartes Promo')
    .setDescription(
      `**Votre solde:** ${userMoney.toLocaleString('fr-FR')} ${CURRENCY_SYMBOL}\n\n` +
      `Sélectionnez une carte pour l'acheter.\n` +
      (isBirthday ? '🎂 **C\'est votre anniversaire !** Certaines cartes sont gratuites aujourd\'hui !' : '')
    );

  const cardOptions = promoCards.map(card => {
    const alreadyOwned = hasLimitedCard(userId, card.id);
    const requiresBirthday = card.requiresBirthday;
    const canClaim = requiresBirthday ? isBirthday : true;
    const price = requiresBirthday && isBirthday ? 0 : card.price;
    const canAfford = userMoney >= price;

    let statusEmoji = '✨';
    let statusText = '';

    if (alreadyOwned) {
      statusEmoji = '✅';
      statusText = ' (Déjà possédée)';
    } else if (requiresBirthday && !isBirthday) {
      statusEmoji = '🎂';
      statusText = ' (Anniversaire requis)';
    } else if (!canAfford) {
      statusEmoji = '🔒';
      statusText = ' (Fonds insuffisants)';
    }

    const priceText = price === 0 ? 'GRATUIT' : `${price.toLocaleString('fr-FR')} ${CURRENCY_SYMBOL}`;
    const rarityData = rarities[card.rarity];

    return {
      label: `${card.name} - ${priceText}`,
      description: `${rarityData?.name || card.rarity}${statusText}`,
      value: `buy_card_${card.id}`,
      emoji: statusEmoji
    };
  });

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('shop_card_select')
    .setPlaceholder('Choisir une carte à acheter...')
    .addOptions(cardOptions);

  const backButton = new ButtonBuilder()
    .setCustomId('shop_back_main')
    .setLabel('Retour')
    .setStyle(ButtonStyle.Secondary)
    .setEmoji('⬅️');

  const row1 = new ActionRowBuilder().addComponents(selectMenu);
  const row2 = new ActionRowBuilder().addComponents(backButton);

  await interaction.update({
    embeds: [embed],
    components: [row1, row2]
  });
}

/**
 * Affiche la confirmation d'achat d'un booster avec image
 */
async function showBoosterPurchaseConfirm(interaction, boosterId) {
  const userId = interaction.user.id;
  const userMoney = getMoney(userId);
  const booster = boosters[boosterId];

  if (!booster || booster.isPromo) {
    return interaction.update({
      content: '❌ Ce booster n\'est pas disponible à l\'achat.',
      embeds: [],
      components: []
    });
  }

  if (userMoney < booster.price) {
    return interaction.update({
      content: `❌ Vous n'avez pas assez de Poké Dollars ! (${userMoney.toLocaleString('fr-FR')} / ${booster.price.toLocaleString('fr-FR')} ${CURRENCY_SYMBOL})`,
      embeds: [],
      components: []
    });
  }

  // Charger l'image du booster
  const boosterImagePath = path.join(ASSETS_DIR, 'boosters', `booster_${boosterId}.png`);
  let files = [];

  const embed = new EmbedBuilder()
    .setColor('#3498DB')
    .setTitle(`Acheter: ${booster.name}`)
    .setDescription(
      `**Prix:** ${booster.price.toLocaleString('fr-FR')} ${CURRENCY_SYMBOL}\n` +
      `**Cartes par pack:** ${booster.cardsPerPack}\n` +
      `**Cartes totales:** ${booster.totalCards}\n\n` +
      `**Votre solde après achat:** ${(userMoney - booster.price).toLocaleString('fr-FR')} ${CURRENCY_SYMBOL}\n\n` +
      `Confirmer l'achat ?`
    );

  if (fs.existsSync(boosterImagePath)) {
    const attachment = new AttachmentBuilder(boosterImagePath, { name: 'booster.png' });
    files.push(attachment);
    embed.setThumbnail('attachment://booster.png');
  }

  const confirmButton = new ButtonBuilder()
    .setCustomId(`shop_confirm_booster_${boosterId}`)
    .setLabel('Acheter')
    .setStyle(ButtonStyle.Success)
    .setEmoji('💰');

  const cancelButton = new ButtonBuilder()
    .setCustomId('shop_category_boosters')
    .setLabel('Annuler')
    .setStyle(ButtonStyle.Secondary);

  const row = new ActionRowBuilder().addComponents(confirmButton, cancelButton);

  await interaction.update({
    embeds: [embed],
    components: [row],
    files: files
  });
}

/**
 * Affiche la confirmation d'achat d'une carte promo avec image
 */
async function showCardPurchaseConfirm(interaction, cardId) {
  const userId = interaction.user.id;
  const userMoney = getMoney(userId);
  const card = cards[cardId];

  if (!card || !card.isPromo) {
    return interaction.update({
      content: '❌ Cette carte n\'est pas disponible à l\'achat.',
      embeds: [],
      components: []
    });
  }

  // Vérifier si déjà possédée
  if (card.limitedPerUser && hasLimitedCard(userId, cardId)) {
    return interaction.update({
      content: '❌ Vous possédez déjà cette carte ! (Limitée à 1 par personne)',
      embeds: [],
      components: []
    });
  }

  // Vérifier l'anniversaire si requis
  const { day: todayDay, month: todayMonth } = getParisDayMonth();
  const birthdaysList = loadBirthdays();
  const userBirthday = birthdaysList.find(b => b.userId === userId);
  const isBirthday = userBirthday && userBirthday.day === todayDay && userBirthday.month === todayMonth;

  if (card.requiresBirthday && !isBirthday) {
    return interaction.update({
      content: '❌ Cette carte ne peut être réclamée que le jour de votre anniversaire ! Assurez-vous d\'avoir enregistré votre date avec `/anniversaire_ajouter`.',
      embeds: [],
      components: []
    });
  }

  const price = card.requiresBirthday && isBirthday ? 0 : card.price;

  if (userMoney < price) {
    return interaction.update({
      content: `❌ Vous n'avez pas assez de Poké Dollars ! (${userMoney.toLocaleString('fr-FR')} / ${price.toLocaleString('fr-FR')} ${CURRENCY_SYMBOL})`,
      embeds: [],
      components: []
    });
  }

  // Charger l'image de la carte
  const cardImagePath = path.join(ASSETS_DIR, 'cards', `card_${cardId}.png`);
  let files = [];

  const rarityData = rarities[card.rarity];
  const priceText = price === 0 ? '**GRATUIT** (Cadeau d\'anniversaire !)' : `${price.toLocaleString('fr-FR')} ${CURRENCY_SYMBOL}`;

  const embed = new EmbedBuilder()
    .setColor(rarityData?.color || '#FF69B4')
    .setTitle(`Acheter: ${card.name}`)
    .setDescription(
      `**Rareté:** ${rarityData?.name || card.rarity}\n` +
      `**Prix:** ${priceText}\n\n` +
      (price > 0 ? `**Votre solde après achat:** ${(userMoney - price).toLocaleString('fr-FR')} ${CURRENCY_SYMBOL}\n\n` : '') +
      `Confirmer l'achat ?`
    );

  if (fs.existsSync(cardImagePath)) {
    const attachment = new AttachmentBuilder(cardImagePath, { name: 'card.png' });
    files.push(attachment);
    embed.setImage('attachment://card.png');
  }

  const confirmButton = new ButtonBuilder()
    .setCustomId(`shop_confirm_card_${cardId}`)
    .setLabel(price === 0 ? 'Réclamer' : 'Acheter')
    .setStyle(ButtonStyle.Success)
    .setEmoji(price === 0 ? '🎁' : '💰');

  const cancelButton = new ButtonBuilder()
    .setCustomId('shop_category_cards')
    .setLabel('Annuler')
    .setStyle(ButtonStyle.Secondary);

  const row = new ActionRowBuilder().addComponents(confirmButton, cancelButton);

  await interaction.update({
    embeds: [embed],
    components: [row],
    files: files
  });
}

/**
 * Effectue l'achat d'un booster
 */
async function purchaseBooster(interaction, boosterId) {
  const userId = interaction.user.id;
  const userMoney = getMoney(userId);
  const booster = boosters[boosterId];

  if (!booster || booster.isPromo) {
    return interaction.update({
      content: '❌ Ce booster n\'est pas disponible à l\'achat.',
      embeds: [],
      components: []
    });
  }

  if (userMoney < booster.price) {
    return interaction.update({
      content: `❌ Vous n'avez pas assez de Poké Dollars !`,
      embeds: [],
      components: []
    });
  }

  // Effectuer la transaction
  const success = removeMoney(userId, booster.price);
  if (!success) {
    return interaction.update({
      content: '❌ Erreur lors de la transaction.',
      embeds: [],
      components: []
    });
  }

  addBoosterToInventory(userId, boosterId);

  const embed = new EmbedBuilder()
    .setColor('#2ECC71')
    .setTitle('Achat réussi !')
    .setDescription(
      `Vous avez acheté **${booster.name}** !\n\n` +
      `**Coût:** ${booster.price.toLocaleString('fr-FR')} ${CURRENCY_SYMBOL}\n` +
      `**Nouveau solde:** ${getMoney(userId).toLocaleString('fr-FR')} ${CURRENCY_SYMBOL}\n\n` +
      `Le booster a été ajouté à votre inventaire.\nUtilisez \`/booster\` pour l'ouvrir !`
    );

  const continueButton = new ButtonBuilder()
    .setCustomId('shop_back_main')
    .setLabel('Continuer les achats')
    .setStyle(ButtonStyle.Primary);

  const row = new ActionRowBuilder().addComponents(continueButton);

  await interaction.update({
    embeds: [embed],
    components: [row],
    files: []
  });
}

/**
 * Effectue l'achat d'une carte promo
 */
async function purchaseCard(interaction, cardId) {
  const userId = interaction.user.id;
  const userMoney = getMoney(userId);
  const card = cards[cardId];

  if (!card || !card.isPromo) {
    return interaction.update({
      content: '❌ Cette carte n\'est pas disponible à l\'achat.',
      embeds: [],
      components: []
    });
  }

  // Re-vérifier toutes les conditions
  if (card.limitedPerUser && hasLimitedCard(userId, cardId)) {
    return interaction.update({
      content: '❌ Vous possédez déjà cette carte !',
      embeds: [],
      components: []
    });
  }

  const { day: todayDay, month: todayMonth } = getParisDayMonth();
  const birthdaysList = loadBirthdays();
  const userBirthday = birthdaysList.find(b => b.userId === userId);
  const isBirthday = userBirthday && userBirthday.day === todayDay && userBirthday.month === todayMonth;

  if (card.requiresBirthday && !isBirthday) {
    return interaction.update({
      content: '❌ Cette carte ne peut être réclamée que le jour de votre anniversaire !',
      embeds: [],
      components: []
    });
  }

  const price = card.requiresBirthday && isBirthday ? 0 : card.price;

  if (userMoney < price) {
    return interaction.update({
      content: '❌ Vous n\'avez pas assez de Poké Dollars !',
      embeds: [],
      components: []
    });
  }

  // Effectuer la transaction
  if (price > 0) {
    const success = removeMoney(userId, price);
    if (!success) {
      return interaction.update({
        content: '❌ Erreur lors de la transaction.',
        embeds: [],
        components: []
      });
    }
  }

  addCardToUser(userId, cardId);

  const rarityData = rarities[card.rarity];
  const priceText = price === 0 ? 'Cadeau d\'anniversaire' : `${price.toLocaleString('fr-FR')} ${CURRENCY_SYMBOL}`;

  const embed = new EmbedBuilder()
    .setColor(rarityData?.color || '#2ECC71')
    .setTitle(price === 0 ? 'Cadeau réclamé !' : 'Achat réussi !')
    .setDescription(
      `Vous avez obtenu **${card.name}** !\n\n` +
      `**Coût:** ${priceText}\n` +
      `**Nouveau solde:** ${getMoney(userId).toLocaleString('fr-FR')} ${CURRENCY_SYMBOL}\n\n` +
      `La carte a été ajoutée à votre collection.\nUtilisez \`/collection\` pour la voir !`
    );

  const continueButton = new ButtonBuilder()
    .setCustomId('shop_back_main')
    .setLabel('Continuer les achats')
    .setStyle(ButtonStyle.Primary);

  const row = new ActionRowBuilder().addComponents(continueButton);

  await interaction.update({
    embeds: [embed],
    components: [row],
    files: []
  });
}

/**
 * Gère toutes les commandes shop
 */
async function handleShopCommands(interaction) {
  const commandName = interaction.commandName;

  if (commandName === 'boutique') {
    await handleShopCommand(interaction);
  } else if (commandName === 'solde') {
    await handleBalanceCommand(interaction);
  } else if (commandName === 'inventaire') {
    await handleInventoryCommand(interaction);
  }
}

/**
 * Gère les interactions shop (menus, boutons)
 */
async function handleShopInteraction(interaction) {
  const customId = interaction.customId;

  if (interaction.isStringSelectMenu()) {
    if (customId === 'shop_category_select') {
      const selected = interaction.values[0];
      if (selected === 'boosters') {
        await showBoostersShop(interaction);
      } else if (selected === 'cards') {
        await showCardsShop(interaction);
      }
    } else if (customId === 'shop_booster_select') {
      const boosterId = interaction.values[0].replace('buy_booster_', '');
      await showBoosterPurchaseConfirm(interaction, boosterId);
    } else if (customId === 'shop_card_select') {
      const cardId = interaction.values[0].replace('buy_card_', '');
      await showCardPurchaseConfirm(interaction, cardId);
    }
  } else if (interaction.isButton()) {
    if (customId === 'shop_back_main') {
      // Retour au menu principal
      const userId = interaction.user.id;
      const userMoney = getMoney(userId);

      const embed = new EmbedBuilder()
        .setColor('#FFD700')
        .setTitle('Boutique Pokémon')
        .setDescription(
          `Bienvenue dans la boutique !\n\n` +
          `**Votre solde:** ${userMoney.toLocaleString('fr-FR')} ${CURRENCY_SYMBOL}\n\n` +
          `Sélectionnez une catégorie ci-dessous pour voir les produits disponibles.`
        )
        .setFooter({ text: 'Gagnez des Poké Dollars en discutant sur le serveur !' });

      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('shop_category_select')
        .setPlaceholder('Choisir une catégorie...')
        .addOptions([
          {
            label: 'Boosters',
            description: 'Acheter des packs de boosters',
            value: 'boosters',
            emoji: '📦'
          },
          {
            label: 'Cartes Promo',
            description: 'Acheter des cartes promotionnelles exclusives',
            value: 'cards',
            emoji: '✨'
          }
        ]);

      const row = new ActionRowBuilder().addComponents(selectMenu);

      await interaction.update({
        embeds: [embed],
        components: [row],
        files: []
      });
    } else if (customId === 'shop_category_boosters') {
      await showBoostersShop(interaction);
    } else if (customId === 'shop_category_cards') {
      await showCardsShop(interaction);
    } else if (customId.startsWith('shop_confirm_booster_')) {
      const boosterId = customId.replace('shop_confirm_booster_', '');
      await purchaseBooster(interaction, boosterId);
    } else if (customId.startsWith('shop_confirm_card_')) {
      const cardId = customId.replace('shop_confirm_card_', '');
      await purchaseCard(interaction, cardId);
    }
  }
}

module.exports = {
  shopCommands,
  handleShopCommands,
  handleShopInteraction,
  CURRENCY_SYMBOL
};
