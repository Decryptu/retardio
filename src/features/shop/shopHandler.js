const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require('discord.js');
const { getMoney, removeMoney, addBoosterToInventory, addCardToUser, hasLimitedCard, loadUserData, getBoosterCompletion } = require('../../services/userManager');
const { loadBirthdays, getParisDayMonth } = require('../birthday/birthdayHandler');
const boosters = require('../../../data/boosters.json');
const cards = require('../../../data/cards.json');
const rarities = require('../../../data/rarities.json');
const path = require('node:path');
const fs = require('node:fs');

const ASSETS_DIR = path.join(__dirname, '../../../assets');
const CURRENCY_SYMBOL = 'Ꝑ';
const ITEMS_PER_PAGE = 25;

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
 * Vérifie que l'utilisateur qui interagit est le propriétaire de l'interaction
 */
async function verifyInteractionOwner(interaction, ownerId) {
  if (interaction.user.id !== ownerId) {
    await interaction.reply({
      content: '❌ Cette interaction ne vous appartient pas. Utilisez `/boutique` pour ouvrir votre propre boutique.',
      ephemeral: true
    });
    return false;
  }
  return true;
}

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
 * Obtient le prix effectif d'une carte pour un utilisateur (vérifie les prix spéciaux)
 */
function getCardPrice(card, userId) {
  if (card.specialPrices && card.specialPrices[userId] !== undefined) {
    return card.specialPrices[userId];
  }
  return card.price;
}

/**
 * Vérifie si un utilisateur a un master set (collection complète) d'au moins un booster
 */
function checkMasterSet(userId) {
  const regularBoosters = Object.values(boosters).filter(b => !b.isPromo);

  for (const booster of regularBoosters) {
    const { owned, total } = getBoosterCompletion(userId, booster.id);
    if (total > 0 && owned === total) {
      return { hasMasterSet: true, completedBoosterName: booster.name };
    }
  }

  return { hasMasterSet: false, completedBoosterName: null };
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
    .setCustomId(`shop_category_select_${userId}`)
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

  const closeButton = new ButtonBuilder()
    .setCustomId(`close_${userId}`)
    .setLabel('X')
    .setStyle(ButtonStyle.Danger);
  const closeRow = new ActionRowBuilder().addComponents(closeButton);

  await interaction.reply({
    embeds: [embed],
    components: [row, closeRow]
  });
}

/**
 * Gère la commande /solde
 */
async function handleBalanceCommand(interaction) {
  const targetUser = interaction.options.getUser('utilisateur') || interaction.user;
  const userMoney = getMoney(targetUser.id);
  const userData = loadUserData(targetUser.id);

  const totalEarned = userData.stats.totalMoneyEarned || 0;
  const totalLost = userData.stats.totalMoneyLost || 0;
  const net = totalEarned - totalLost;

  const embed = new EmbedBuilder()
    .setColor('#FFD700')
    .setTitle(`Solde de ${targetUser.username}`)
    .setDescription(
      `**Solde actuel:** ${userMoney.toLocaleString('fr-FR')} ${CURRENCY_SYMBOL}\n\n` +
      `**Total gagné:** ${totalEarned.toLocaleString('fr-FR')} ${CURRENCY_SYMBOL}\n` +
      `**Total perdu:** ${totalLost.toLocaleString('fr-FR')} ${CURRENCY_SYMBOL}\n` +
      `**Net:** ${net.toLocaleString('fr-FR')} ${CURRENCY_SYMBOL}`
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
 * Affiche les boosters disponibles à l'achat avec pagination
 */
async function showBoostersShop(interaction, ownerId, page = 0) {
  const userMoney = getMoney(ownerId);
  const purchasableBoosters = getPurchasableBoosters();

  if (purchasableBoosters.length === 0) {
    return interaction.update({
      content: 'Aucun booster disponible à l\'achat pour le moment.',
      embeds: [],
      components: []
    });
  }

  const totalPages = Math.ceil(purchasableBoosters.length / ITEMS_PER_PAGE);
  const startIndex = page * ITEMS_PER_PAGE;
  const pageBoosters = purchasableBoosters.slice(startIndex, startIndex + ITEMS_PER_PAGE);

  const embed = new EmbedBuilder()
    .setColor('#3498DB')
    .setTitle('Boutique - Boosters')
    .setDescription(
      `**Votre solde:** ${userMoney.toLocaleString('fr-FR')} ${CURRENCY_SYMBOL}\n\n` +
      `Sélectionnez un booster pour l'acheter.`
    );

  const boosterOptions = pageBoosters.map(booster => {
    const canAfford = userMoney >= booster.price;
    return {
      label: `${booster.name} - ${booster.price.toLocaleString('fr-FR')} ${CURRENCY_SYMBOL}`,
      description: `${booster.totalCards} cartes • ${booster.cardsPerPack} cartes/pack${canAfford ? '' : ' (Fonds insuffisants)'}`,
      value: `buy_booster_${booster.id}`,
      emoji: canAfford ? '📦' : '🔒'
    };
  });

  const placeholder = totalPages > 1
    ? `Choisir un booster (${page + 1}/${totalPages})`
    : 'Choisir un booster à acheter...';

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId(`shop_booster_select_${ownerId}_${page}`)
    .setPlaceholder(placeholder)
    .addOptions(boosterOptions);

  const components = [new ActionRowBuilder().addComponents(selectMenu)];

  // Boutons de navigation
  const navButtons = [];

  if (totalPages > 1) {
    const prevButton = new ButtonBuilder()
      .setCustomId(`shop_booster_page_prev_${ownerId}_${page}`)
      .setLabel('◀')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page === 0);

    const pageIndicator = new ButtonBuilder()
      .setCustomId(`shop_page_indicator_${ownerId}`)
      .setLabel(`${page + 1} / ${totalPages}`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true);

    const nextButton = new ButtonBuilder()
      .setCustomId(`shop_booster_page_next_${ownerId}_${page}`)
      .setLabel('▶')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= totalPages - 1);

    navButtons.push(prevButton, pageIndicator, nextButton);
  }

  const backButton = new ButtonBuilder()
    .setCustomId(`shop_back_main_${ownerId}`)
    .setLabel('Retour')
    .setStyle(ButtonStyle.Secondary)
    .setEmoji('⬅️');

  navButtons.push(backButton);

  const closeButton = new ButtonBuilder()
    .setCustomId(`close_${ownerId}`)
    .setLabel('X')
    .setStyle(ButtonStyle.Danger);
  navButtons.push(closeButton);

  components.push(new ActionRowBuilder().addComponents(navButtons));

  await interaction.update({
    embeds: [embed],
    components
  });
}

/**
 * Affiche les cartes promo disponibles à l'achat avec pagination
 */
async function showCardsShop(interaction, ownerId, page = 0) {
  const userMoney = getMoney(ownerId);
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
  const userBirthday = birthdaysList.find(b => b.userId === ownerId);
  const isBirthday = userBirthday && userBirthday.day === todayDay && userBirthday.month === todayMonth;

  // Vérifier si l'utilisateur a un master set
  const { hasMasterSet, completedBoosterName } = checkMasterSet(ownerId);

  let descriptionExtras = '';
  if (isBirthday) {
    descriptionExtras += '🎂 **C\'est votre anniversaire !** Certaines cartes sont gratuites aujourd\'hui !\n';
  }
  if (hasMasterSet) {
    descriptionExtras += `🏆 **Master Set complété !** (${completedBoosterName}) Vous pouvez réclamer des récompenses exclusives !`;
  }

  const totalPages = Math.ceil(promoCards.length / ITEMS_PER_PAGE);
  const startIndex = page * ITEMS_PER_PAGE;
  const pageCards = promoCards.slice(startIndex, startIndex + ITEMS_PER_PAGE);

  const embed = new EmbedBuilder()
    .setColor('#E91E63')
    .setTitle('Boutique - Cartes Promo')
    .setDescription(
      `**Votre solde:** ${userMoney.toLocaleString('fr-FR')} ${CURRENCY_SYMBOL}\n\n` +
      `Sélectionnez une carte pour l'acheter.\n` +
      descriptionExtras
    );

  const cardOptions = pageCards.map(card => {
    const alreadyOwned = hasLimitedCard(ownerId, card.id);
    const requiresBirthday = card.requiresBirthday;
    const requiresMasterSet = card.requiresMasterSet;
    const price = (requiresBirthday && isBirthday) || requiresMasterSet ? 0 : getCardPrice(card, ownerId);
    const canAfford = userMoney >= price;

    let statusEmoji = '✨';
    let statusText = '';

    if (alreadyOwned) {
      statusEmoji = '✅';
      statusText = ' (Déjà possédée)';
    } else if (requiresBirthday && !isBirthday) {
      statusEmoji = '🎂';
      statusText = ' (Anniversaire requis)';
    } else if (requiresMasterSet && !hasMasterSet) {
      statusEmoji = '🏆';
      statusText = ' (Master Set requis)';
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

  const placeholder = totalPages > 1
    ? `Choisir une carte (${page + 1}/${totalPages})`
    : 'Choisir une carte à acheter...';

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId(`shop_card_select_${ownerId}_${page}`)
    .setPlaceholder(placeholder)
    .addOptions(cardOptions);

  const components = [new ActionRowBuilder().addComponents(selectMenu)];

  // Boutons de navigation
  const navButtons = [];

  if (totalPages > 1) {
    const prevButton = new ButtonBuilder()
      .setCustomId(`shop_card_page_prev_${ownerId}_${page}`)
      .setLabel('◀')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page === 0);

    const pageIndicator = new ButtonBuilder()
      .setCustomId(`shop_page_indicator_${ownerId}`)
      .setLabel(`${page + 1} / ${totalPages}`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true);

    const nextButton = new ButtonBuilder()
      .setCustomId(`shop_card_page_next_${ownerId}_${page}`)
      .setLabel('▶')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= totalPages - 1);

    navButtons.push(prevButton, pageIndicator, nextButton);
  }

  const backButton = new ButtonBuilder()
    .setCustomId(`shop_back_main_${ownerId}`)
    .setLabel('Retour')
    .setStyle(ButtonStyle.Secondary)
    .setEmoji('⬅️');

  navButtons.push(backButton);

  const closeButton2 = new ButtonBuilder()
    .setCustomId(`close_${ownerId}`)
    .setLabel('X')
    .setStyle(ButtonStyle.Danger);
  navButtons.push(closeButton2);

  components.push(new ActionRowBuilder().addComponents(navButtons));

  await interaction.update({
    embeds: [embed],
    components
  });
}

/**
 * Affiche l'aperçu d'un booster avec image et option d'achat
 */
async function showBoosterPurchaseConfirm(interaction, boosterId, ownerId, quantity = 1) {
  const userMoney = getMoney(ownerId);
  const booster = boosters[boosterId];

  if (!booster || booster.isPromo) {
    return interaction.update({
      content: '❌ Ce booster n\'est pas disponible.',
      embeds: [],
      components: []
    });
  }

  const totalPrice = booster.price * quantity;
  const canAfford = userMoney >= totalPrice;
  const maxAffordable = Math.floor(userMoney / booster.price);

  const boosterImagePath = path.join(ASSETS_DIR, 'boosters', `booster_${boosterId}.png`);
  const files = [];

  let statusMessage = '';
  if (!canAfford) {
    statusMessage = `\n\n🔒 **Fonds insuffisants.** (${userMoney.toLocaleString('fr-FR')} / ${totalPrice.toLocaleString('fr-FR')} ${CURRENCY_SYMBOL})`;
  }

  const embed = new EmbedBuilder()
    .setColor('#3498DB')
    .setTitle(`${booster.name}`)
    .setDescription(
      `**Prix unitaire:** ${booster.price.toLocaleString('fr-FR')} ${CURRENCY_SYMBOL}\n` +
      `**Cartes par pack:** ${booster.cardsPerPack}\n` +
      `**Cartes totales:** ${booster.totalCards}\n` +
      `**Garantie:** ${booster.guarantees?.minRarity || 'Aucune'}\n\n` +
      `**Quantité:** ${quantity}\n` +
      `**Total:** ${totalPrice.toLocaleString('fr-FR')} ${CURRENCY_SYMBOL}` +
      (canAfford ? `\n**Solde après achat:** ${(userMoney - totalPrice).toLocaleString('fr-FR')} ${CURRENCY_SYMBOL}` : '') +
      statusMessage
    );

  if (fs.existsSync(boosterImagePath)) {
    const attachment = new AttachmentBuilder(boosterImagePath, { name: 'booster.png' });
    files.push(attachment);
    embed.setImage('attachment://booster.png');
  } else {
    embed.setFooter({ text: 'Image non disponible' });
  }

  // Quantity buttons
  const quantityRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`shop_qty_minus_${boosterId}_${ownerId}_${quantity}`)
      .setLabel('-')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(quantity <= 1),
    new ButtonBuilder()
      .setCustomId(`shop_qty_display_${ownerId}`)
      .setLabel(`${quantity}`)
      .setStyle(ButtonStyle.Primary)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId(`shop_qty_plus_${boosterId}_${ownerId}_${quantity}`)
      .setLabel('+')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(quantity >= maxAffordable || maxAffordable === 0)
  );

  // Action buttons
  const actionRow = new ActionRowBuilder().addComponents(
    (() => {
      const btn = new ButtonBuilder()
        .setCustomId(`shop_confirm_booster_${boosterId}_${ownerId}_${quantity}`)
        .setLabel(quantity > 1 ? `Acheter x${quantity}` : 'Acheter')
        .setStyle(canAfford ? ButtonStyle.Success : ButtonStyle.Secondary)
        .setDisabled(!canAfford);
      if (canAfford) btn.setEmoji('💰');
      return btn;
    })(),
    new ButtonBuilder()
      .setCustomId(`shop_category_boosters_${ownerId}`)
      .setLabel('Retour')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('⬅️'),
    new ButtonBuilder()
      .setCustomId(`close_${ownerId}`)
      .setLabel('X')
      .setStyle(ButtonStyle.Danger)
  );

  await interaction.update({
    embeds: [embed],
    components: [quantityRow, actionRow],
    files: files
  });
}

/**
 * Affiche l'aperçu d'une carte promo avec image et option d'achat
 */
async function showCardPurchaseConfirm(interaction, cardId, ownerId) {
  const userMoney = getMoney(ownerId);
  const card = cards[cardId];

  if (!card || !card.isPromo) {
    return interaction.update({
      content: '❌ Cette carte n\'est pas disponible.',
      embeds: [],
      components: []
    });
  }

  const alreadyOwned = card.limitedPerUser && hasLimitedCard(ownerId, cardId);

  const { day: todayDay, month: todayMonth } = getParisDayMonth();
  const birthdaysList = loadBirthdays();
  const userBirthday = birthdaysList.find(b => b.userId === ownerId);
  const isBirthday = userBirthday && userBirthday.day === todayDay && userBirthday.month === todayMonth;

  const { hasMasterSet, completedBoosterName } = checkMasterSet(ownerId);

  const requiresBirthdayButNotBirthday = card.requiresBirthday && !isBirthday;
  const requiresMasterSetButNoSet = card.requiresMasterSet && !hasMasterSet;

  const price = (card.requiresBirthday && isBirthday) || card.requiresMasterSet ? 0 : getCardPrice(card, ownerId);
  const canAfford = userMoney >= price;

  const canPurchase = !alreadyOwned && !requiresBirthdayButNotBirthday && !requiresMasterSetButNoSet && canAfford;

  const cardImagePath = path.join(ASSETS_DIR, 'cards', `card_${cardId}.png`);
  const files = [];

  const rarityData = rarities[card.rarity];

  let priceText;
  if (card.requiresMasterSet && hasMasterSet) {
    priceText = `**GRATUIT** (Récompense Master Set - ${completedBoosterName})`;
  } else if (card.requiresMasterSet) {
    priceText = '**GRATUIT** (Requiert un Master Set)';
  } else if (card.requiresBirthday && isBirthday) {
    priceText = '**GRATUIT** (Cadeau d\'anniversaire !)';
  } else if (card.requiresBirthday) {
    priceText = '**GRATUIT** (Requiert anniversaire)';
  } else {
    priceText = `${price.toLocaleString('fr-FR')} ${CURRENCY_SYMBOL}`;
  }

  let statusMessage = '';
  if (alreadyOwned) {
    statusMessage = '\n\n✅ **Vous possédez déjà cette carte !**';
  } else if (requiresBirthdayButNotBirthday) {
    statusMessage = '\n\n🎂 **Disponible uniquement le jour de votre anniversaire.**\nAssurez-vous d\'avoir enregistré votre date avec `/anniversaire_ajouter`.';
  } else if (requiresMasterSetButNoSet) {
    statusMessage = '\n\n🏆 **Requiert un Master Set complet.**\nComplétez 100% d\'un booster pour débloquer cette récompense !';
  } else if (!canAfford) {
    statusMessage = `\n\n🔒 **Fonds insuffisants.** (${userMoney.toLocaleString('fr-FR')} / ${price.toLocaleString('fr-FR')} ${CURRENCY_SYMBOL})`;
  }

  const embed = new EmbedBuilder()
    .setColor(rarityData?.color || '#FF69B4')
    .setTitle(`${card.name}`)
    .setDescription(
      `**Rareté:** ${rarityData?.name || card.rarity}\n` +
      `**Prix:** ${priceText}` +
      (canPurchase && price > 0 ? `\n**Solde après achat:** ${(userMoney - price).toLocaleString('fr-FR')} ${CURRENCY_SYMBOL}` : '') +
      statusMessage
    );

  if (fs.existsSync(cardImagePath)) {
    const attachment = new AttachmentBuilder(cardImagePath, { name: 'card.png' });
    files.push(attachment);
    embed.setImage('attachment://card.png');
  } else {
    embed.setFooter({ text: 'Image non disponible' });
  }

  const buttons = [];

  const confirmButton = new ButtonBuilder()
    .setCustomId(`shop_confirm_card_${cardId}_${ownerId}`)
    .setLabel(alreadyOwned ? 'Déjà possédée' : (price === 0 ? 'Réclamer' : 'Acheter'))
    .setStyle(canPurchase ? ButtonStyle.Success : ButtonStyle.Secondary)
    .setDisabled(!canPurchase);

  if (canPurchase) {
    confirmButton.setEmoji(price === 0 ? '🎁' : '💰');
  }

  buttons.push(confirmButton);

  const backButton = new ButtonBuilder()
    .setCustomId(`shop_category_cards_${ownerId}`)
    .setLabel('Retour')
    .setStyle(ButtonStyle.Secondary)
    .setEmoji('⬅️');

  buttons.push(backButton);

  const closeBtn = new ButtonBuilder()
    .setCustomId(`close_${ownerId}`)
    .setLabel('X')
    .setStyle(ButtonStyle.Danger);
  buttons.push(closeBtn);

  const row = new ActionRowBuilder().addComponents(buttons);

  await interaction.update({
    embeds: [embed],
    components: [row],
    files: files
  });
}

/**
 * Effectue l'achat d'un booster
 */
async function purchaseBooster(interaction, boosterId, ownerId, quantity = 1) {
  const userMoney = getMoney(ownerId);
  const booster = boosters[boosterId];

  if (!booster || booster.isPromo) {
    return interaction.update({
      content: '❌ Ce booster n\'est pas disponible à l\'achat.',
      embeds: [],
      components: []
    });
  }

  const totalPrice = booster.price * quantity;

  if (userMoney < totalPrice) {
    return interaction.update({
      content: `❌ Vous n'avez pas assez de Poké Dollars !`,
      embeds: [],
      components: []
    });
  }

  const success = removeMoney(ownerId, totalPrice);
  if (!success) {
    return interaction.update({
      content: '❌ Erreur lors de la transaction.',
      embeds: [],
      components: []
    });
  }

  addBoosterToInventory(ownerId, boosterId, quantity);

  const quantityText = quantity > 1 ? `**${quantity}x** ` : '';
  const boosterWord = quantity > 1 ? 'boosters ont été ajoutés' : 'booster a été ajouté';

  const embed = new EmbedBuilder()
    .setColor('#2ECC71')
    .setTitle('Achat réussi !')
    .setDescription(
      `Vous avez acheté ${quantityText}**${booster.name}** !\n\n` +
      `**Coût:** ${totalPrice.toLocaleString('fr-FR')} ${CURRENCY_SYMBOL}\n` +
      `**Nouveau solde:** ${getMoney(ownerId).toLocaleString('fr-FR')} ${CURRENCY_SYMBOL}\n\n` +
      `Le${quantity > 1 ? 's' : ''} ${boosterWord} à votre inventaire.`
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`booster_confirm_open_${boosterId}_${ownerId}`)
      .setLabel('Ouvrir un booster')
      .setStyle(ButtonStyle.Success)
      .setEmoji('🎴'),
    new ButtonBuilder()
      .setCustomId(`shop_back_main_${ownerId}`)
      .setLabel('Continuer les achats')
      .setStyle(ButtonStyle.Secondary)
  );

  await interaction.update({
    embeds: [embed],
    components: [row],
    files: []
  });
}

/**
 * Effectue l'achat d'une carte promo
 */
async function purchaseCard(interaction, cardId, ownerId) {
  const userMoney = getMoney(ownerId);
  const card = cards[cardId];

  if (!card || !card.isPromo) {
    return interaction.update({
      content: '❌ Cette carte n\'est pas disponible à l\'achat.',
      embeds: [],
      components: []
    });
  }

  if (card.limitedPerUser && hasLimitedCard(ownerId, cardId)) {
    return interaction.update({
      content: '❌ Vous possédez déjà cette carte !',
      embeds: [],
      components: []
    });
  }

  const { day: todayDay, month: todayMonth } = getParisDayMonth();
  const birthdaysList = loadBirthdays();
  const userBirthday = birthdaysList.find(b => b.userId === ownerId);
  const isBirthday = userBirthday && userBirthday.day === todayDay && userBirthday.month === todayMonth;

  if (card.requiresBirthday && !isBirthday) {
    return interaction.update({
      content: '❌ Cette carte ne peut être réclamée que le jour de votre anniversaire !',
      embeds: [],
      components: []
    });
  }

  const { hasMasterSet } = checkMasterSet(ownerId);

  if (card.requiresMasterSet && !hasMasterSet) {
    return interaction.update({
      content: '❌ Cette carte nécessite un Master Set complet !',
      embeds: [],
      components: []
    });
  }

  const price = (card.requiresBirthday && isBirthday) || card.requiresMasterSet ? 0 : getCardPrice(card, ownerId);

  if (userMoney < price) {
    return interaction.update({
      content: '❌ Vous n\'avez pas assez de Poké Dollars !',
      embeds: [],
      components: []
    });
  }

  if (price > 0) {
    const success = removeMoney(ownerId, price);
    if (!success) {
      return interaction.update({
        content: '❌ Erreur lors de la transaction.',
        embeds: [],
        components: []
      });
    }
  }

  addCardToUser(ownerId, cardId);

  const rarityData = rarities[card.rarity];
  let priceText;
  if (card.requiresMasterSet) {
    priceText = 'Récompense Master Set';
  } else if (price === 0) {
    priceText = 'Cadeau d\'anniversaire';
  } else {
    priceText = `${price.toLocaleString('fr-FR')} ${CURRENCY_SYMBOL}`;
  }

  const embed = new EmbedBuilder()
    .setColor(rarityData?.color || '#2ECC71')
    .setTitle(price === 0 ? 'Cadeau réclamé !' : 'Achat réussi !')
    .setDescription(
      `Vous avez obtenu **${card.name}** !\n\n` +
      `**Coût:** ${priceText}\n` +
      `**Nouveau solde:** ${getMoney(ownerId).toLocaleString('fr-FR')} ${CURRENCY_SYMBOL}\n\n` +
      `La carte a été ajoutée à votre collection.\nUtilisez \`/collection\` pour la voir !`
    );

  const continueButton = new ButtonBuilder()
    .setCustomId(`shop_back_main_${ownerId}`)
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
 * Affiche le menu principal de la boutique
 */
async function showMainShop(interaction, ownerId) {
  const userMoney = getMoney(ownerId);

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
    .setCustomId(`shop_category_select_${ownerId}`)
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

  const closeButton = new ButtonBuilder()
    .setCustomId(`close_${ownerId}`)
    .setLabel('X')
    .setStyle(ButtonStyle.Danger);
  const closeRow = new ActionRowBuilder().addComponents(closeButton);

  await interaction.update({
    embeds: [embed],
    components: [row, closeRow],
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
 * Extrait l'ID du propriétaire depuis un customId
 */
function extractOwnerId(customId) {
  const parts = customId.split('_');
  // Pour les customIds avec page/quantity (pagination buttons, select menus avec page, ou qty buttons)
  // L'ownerId est l'avant-dernier element
  // Patterns: shop_booster_page_prev/next_ownerId_page, shop_card_page_prev/next_ownerId_page
  //           shop_booster_select_ownerId_page, shop_card_select_ownerId_page
  //           shop_qty_{action}_{boosterId}_{ownerId}_{qty}
  //           shop_confirm_booster_{boosterId}_{ownerId}_{qty}
  if (customId.includes('_page_') ||
      customId.startsWith('shop_booster_select_') ||
      customId.startsWith('shop_card_select_') ||
      customId.startsWith('shop_qty_') ||
      (customId.includes('_confirm_booster_') && parts.length === 6)) {
    return parts[parts.length - 2];
  }
  return parts[parts.length - 1];
}

/**
 * Gère les interactions shop (menus, boutons)
 */
async function handleShopInteraction(interaction) {
  const customId = interaction.customId;
  const ownerId = extractOwnerId(customId);

  if (!await verifyInteractionOwner(interaction, ownerId)) {
    return;
  }

  if (interaction.isStringSelectMenu()) {
    if (customId.startsWith('shop_category_select_')) {
      const selected = interaction.values[0];
      if (selected === 'boosters') {
        await showBoostersShop(interaction, ownerId, 0);
      } else if (selected === 'cards') {
        await showCardsShop(interaction, ownerId, 0);
      }
    } else if (customId.startsWith('shop_booster_select_')) {
      const boosterId = interaction.values[0].replace('buy_booster_', '');
      await showBoosterPurchaseConfirm(interaction, boosterId, ownerId);
    } else if (customId.startsWith('shop_card_select_')) {
      const cardId = interaction.values[0].replace('buy_card_', '');
      await showCardPurchaseConfirm(interaction, cardId, ownerId);
    }
  } else if (interaction.isButton()) {
    if (customId.startsWith('shop_back_main_')) {
      await showMainShop(interaction, ownerId);
    } else if (customId.startsWith('shop_category_boosters_')) {
      await showBoostersShop(interaction, ownerId, 0);
    } else if (customId.startsWith('shop_category_cards_')) {
      await showCardsShop(interaction, ownerId, 0);
    } else if (customId.startsWith('shop_booster_page_')) {
      // Format: shop_booster_page_prev/next_ownerId_currentPage
      const parts = customId.split('_');
      const direction = parts[3];
      const currentPage = parseInt(parts[5]);
      const newPage = direction === 'next' ? currentPage + 1 : currentPage - 1;
      await showBoostersShop(interaction, ownerId, newPage);
    } else if (customId.startsWith('shop_card_page_')) {
      // Format: shop_card_page_prev/next_ownerId_currentPage
      const parts = customId.split('_');
      const direction = parts[3];
      const currentPage = parseInt(parts[5]);
      const newPage = direction === 'next' ? currentPage + 1 : currentPage - 1;
      await showCardsShop(interaction, ownerId, newPage);
    } else if (customId.startsWith('shop_qty_')) {
      // Format: shop_qty_{action}_{boosterId}_{ownerId}_{currentQty}
      const parts = customId.split('_');
      const action = parts[2];
      const boosterId = parts[3];
      const currentQty = parseInt(parts[5]);
      const newQty = action === 'plus' ? currentQty + 1 : currentQty - 1;
      await showBoosterPurchaseConfirm(interaction, boosterId, ownerId, newQty);
    } else if (customId.includes('_confirm_booster_')) {
      // Format: shop_confirm_booster_{boosterId}_{ownerId}_{quantity}
      const parts = customId.split('_');
      const boosterId = parts[3];
      const quantity = parseInt(parts[5]) || 1;
      await purchaseBooster(interaction, boosterId, ownerId, quantity);
    } else if (customId.includes('_confirm_card_')) {
      const parts = customId.split('_');
      const cardId = parts.slice(3, -1).join('_');
      await purchaseCard(interaction, cardId, ownerId);
    }
  }
}

module.exports = {
  shopCommands,
  handleShopCommands,
  handleShopInteraction,
  CURRENCY_SYMBOL
};
