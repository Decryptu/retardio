const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require('discord.js');
const { getCardInfo, getAllCardsFromBooster } = require('../../services/cardGenerator');
const { loadUserData, removeCardFromUser, addCardsToUser, saveUserData, clearTeamSlotIfNotOwned } = require('../../services/userManager');
const { generateTradeProposalImage, generateTradeCompletedImage } = require('../../services/imageGenerator');
const boosters = require('../../../data/boosters.json');

// Map pour stocker les echanges en cours
const activeTrades = new Map();

// Admin whitelist for gift commands
const ADMIN_WHITELIST = [
  '98891713610797056',
];

const CARDS_PER_PAGE = 25;

/**
 * Trouve les opportunites d'echange entre deux utilisateurs
 * Une opportunite = une carte que l'un a en double et l'autre n'a pas
 * @param {string} initiatorId - ID de l'initiateur
 * @param {string} targetId - ID de la cible
 * @returns {Object} { canOffer: [], canReceive: [] }
 */
function findTradeOpportunities(initiatorId, targetId) {
  const initiatorData = loadUserData(initiatorId);
  const targetData = loadUserData(targetId);

  const canOffer = []; // Cartes que l'initiateur peut offrir (doublons que la cible n'a pas)
  const canReceive = []; // Cartes que l'initiateur peut recevoir (doublons de la cible que l'initiateur n'a pas)

  // Trouver les cartes que l'initiateur a en double et que la cible n'a pas
  for (const [cardId, quantity] of Object.entries(initiatorData.cards)) {
    if (quantity > 1) {
      const targetQuantity = targetData.cards[cardId] || 0;
      if (targetQuantity === 0) {
        const cardInfo = getCardInfo(cardId);
        if (cardInfo) {
          canOffer.push({
            ...cardInfo,
            quantity,
            boosterId: String(cardInfo.boosterPackId)
          });
        }
      }
    }
  }

  // Trouver les cartes que la cible a en double et que l'initiateur n'a pas
  for (const [cardId, quantity] of Object.entries(targetData.cards)) {
    if (quantity > 1) {
      const initiatorQuantity = initiatorData.cards[cardId] || 0;
      if (initiatorQuantity === 0) {
        const cardInfo = getCardInfo(cardId);
        if (cardInfo) {
          canReceive.push({
            ...cardInfo,
            quantity,
            boosterId: String(cardInfo.boosterPackId)
          });
        }
      }
    }
  }

  return { canOffer, canReceive };
}

/**
 * Obtient les boosters ou l'utilisateur a des cartes
 */
function getUserBoostersWithCards(userId) {
  const userData = loadUserData(userId);
  const userCards = Object.keys(userData.cards).filter(id => userData.cards[id] > 0);

  const boostersWithCards = new Map();

  for (const cardId of userCards) {
    const cardInfo = getCardInfo(cardId);
    if (cardInfo?.boosterPackId) {
      const boosterId = String(cardInfo.boosterPackId);
      if (!boostersWithCards.has(boosterId)) {
        boostersWithCards.set(boosterId, { count: 0, booster: boosters[boosterId] });
      }
      boostersWithCards.get(boosterId).count++;
    }
  }

  return boostersWithCards;
}

/**
 * Obtient les cartes d'un utilisateur pour un booster specifique, triees par quantite
 */
function getUserCardsFromBooster(userId, boosterId) {
  const userData = loadUserData(userId);
  const allBoosterCards = getAllCardsFromBooster(boosterId);

  return allBoosterCards.filter(card => {
    const quantity = userData.cards[String(card.id)] || 0;
    return quantity > 0;
  }).map(card => ({
    ...card,
    quantity: userData.cards[String(card.id)]
  })).sort((a, b) => b.quantity - a.quantity); // Trier par quantite decroissante
}

/**
 * Obtient toutes les cartes d'un utilisateur (tous boosters confondus)
 */
function getAllUserCards(userId) {
  const userData = loadUserData(userId);
  const userCards = [];

  for (const [cardId, quantity] of Object.entries(userData.cards)) {
    if (quantity > 0) {
      const cardInfo = getCardInfo(cardId);
      if (cardInfo) {
        userCards.push({
          ...cardInfo,
          quantity,
          boosterName: boosters[cardInfo.boosterPackId]?.name || 'Unknown'
        });
      }
    }
  }

  // Trier par quantite decroissante puis par nom
  return userCards.sort((a, b) => {
    if (b.quantity !== a.quantity) return b.quantity - a.quantity;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Cree les composants pour la selection de carte globale avec pagination
 */
function createGlobalCardSelectComponents(cards, tradeId, type, page, userId) {
  const totalPages = Math.ceil(cards.length / CARDS_PER_PAGE);
  const startIndex = page * CARDS_PER_PAGE;
  const pageCards = cards.slice(startIndex, startIndex + CARDS_PER_PAGE);

  const components = [];

  // Menu de selection des cartes avec nom du booster
  const cardOptions = pageCards.map(card => ({
    label: `${card.name} (x${card.quantity})`,
    description: `${card.boosterName} - ${card.rarityName}`,
    value: `${type}_card_${card.id}`,
    emoji: card.quantity > 1 ? '🔄' : '🃏'
  }));

  const stepNum = type === 'give' ? '2' : '4';
  const placeholder = totalPages > 1
    ? `${stepNum}. Recherche globale (${page + 1}/${totalPages})`
    : `${stepNum}. Choisissez la carte a ${type === 'give' ? 'donner' : 'recevoir'}`;

  const cardSelect = new StringSelectMenuBuilder()
    .setCustomId(`trade_${type}_card_global_${tradeId}`)
    .setPlaceholder(placeholder)
    .addOptions(cardOptions);

  components.push(new ActionRowBuilder().addComponents(cardSelect));

  // Boutons de pagination si necessaire
  if (totalPages > 1) {
    const prevButton = new ButtonBuilder()
      .setCustomId(`trade_page_global_${type}_prev_${page}_${tradeId}`)
      .setLabel('◀ Precedent')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page === 0);

    const pageIndicator = new ButtonBuilder()
      .setCustomId(`trade_page_indicator_${tradeId}`)
      .setLabel(`${page + 1} / ${totalPages}`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true);

    const nextButton = new ButtonBuilder()
      .setCustomId(`trade_page_global_${type}_next_${page}_${tradeId}`)
      .setLabel('Suivant ▶')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= totalPages - 1);

    components.push(new ActionRowBuilder().addComponents(prevButton, pageIndicator, nextButton));
  }

  // Utility row: close
  const utilityButtons = [];

  if (userId) {
    const closeButton = new ButtonBuilder()
      .setCustomId(`close_${userId}`)
      .setLabel('X')
      .setStyle(ButtonStyle.Danger);
    utilityButtons.push(closeButton);
  }

  components.push(new ActionRowBuilder().addComponents(utilityButtons));

  return { components, totalCards: cards.length, totalPages };
}

/**
 * Cree les composants pour la selection de carte avec pagination
 */
function createCardSelectComponents(cards, tradeId, type, page, _boosterName, userId) {
  const totalPages = Math.ceil(cards.length / CARDS_PER_PAGE);
  const startIndex = page * CARDS_PER_PAGE;
  const pageCards = cards.slice(startIndex, startIndex + CARDS_PER_PAGE);

  const components = [];

  // Menu de selection des cartes
  const cardOptions = pageCards.map(card => ({
    label: `${card.name} (x${card.quantity})`,
    description: `#${card.id} - ${card.rarityName}`,
    value: `${type}_card_${card.id}`,
    emoji: card.quantity > 1 ? '🔄' : '🃏'
  }));

  const stepNum = type === 'give' ? '2' : '4';
  const placeholder = totalPages > 1
    ? `${stepNum}. Carte a ${type === 'give' ? 'donner' : 'recevoir'} (${page + 1}/${totalPages})`
    : `${stepNum}. Choisissez la carte a ${type === 'give' ? 'donner' : 'recevoir'}`;

  const cardSelect = new StringSelectMenuBuilder()
    .setCustomId(`trade_${type}_card_${tradeId}`)
    .setPlaceholder(placeholder)
    .addOptions(cardOptions);

  components.push(new ActionRowBuilder().addComponents(cardSelect));

  // Boutons de pagination si necessaire
  if (totalPages > 1) {
    const prevButton = new ButtonBuilder()
      .setCustomId(`trade_page_${type}_prev_${page}_${tradeId}`)
      .setLabel('◀ Precedent')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page === 0);

    const pageIndicator = new ButtonBuilder()
      .setCustomId(`trade_page_indicator_${tradeId}`)
      .setLabel(`${page + 1} / ${totalPages}`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true);

    const nextButton = new ButtonBuilder()
      .setCustomId(`trade_page_${type}_next_${page}_${tradeId}`)
      .setLabel('Suivant ▶')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= totalPages - 1);

    components.push(new ActionRowBuilder().addComponents(prevButton, pageIndicator, nextButton));
  }

  // Utility row: search + close
  const utilityButtons = [];

  const searchButton = new ButtonBuilder()
    .setCustomId(`search_trade_${tradeId}_${type}`)
    .setEmoji('🔍')
    .setStyle(ButtonStyle.Primary);
  utilityButtons.push(searchButton);

  if (userId) {
    const closeButton = new ButtonBuilder()
      .setCustomId(`close_${userId}`)
      .setLabel('X')
      .setStyle(ButtonStyle.Danger);
    utilityButtons.push(closeButton);
  }

  components.push(new ActionRowBuilder().addComponents(utilityButtons));

  return { components, totalCards: cards.length, totalPages };
}

/**
 * Gere la commande /echange
 */
async function handleTradeCommand(interaction) {
  const initiator = interaction.user;
  const target = interaction.options.getUser('utilisateur');

  if (target.bot) {
    return interaction.reply({
      content: '❌ Vous ne pouvez pas echanger avec un bot.',
      ephemeral: true
    });
  }

  if (target.id === initiator.id) {
    return interaction.reply({
      content: '❌ Vous ne pouvez pas echanger avec vous-meme.',
      ephemeral: true
    });
  }

  const initiatorBoosters = getUserBoostersWithCards(initiator.id);
  const targetBoosters = getUserBoostersWithCards(target.id);

  if (initiatorBoosters.size === 0) {
    return interaction.reply({
      content: '❌ Vous n\'avez aucune carte a echanger.',
      ephemeral: true
    });
  }

  if (targetBoosters.size === 0) {
    return interaction.reply({
      content: `❌ ${target.username} n'a aucune carte a echanger.`,
      ephemeral: true
    });
  }

  const initiatorBoosterOptions = [];
  for (const [boosterId, data] of initiatorBoosters) {
    if (data.booster) {
      initiatorBoosterOptions.push({
        label: data.booster.name,
        description: `${data.count} carte${data.count > 1 ? 's' : ''} disponible${data.count > 1 ? 's' : ''}`,
        value: `give_booster_${boosterId}`,
        emoji: '📦'
      });
    }
  }

  const giveBoosterSelect = new StringSelectMenuBuilder()
    .setCustomId(`trade_give_booster_${interaction.id}`)
    .setPlaceholder('1. Choisissez le booster de la carte a donner')
    .addOptions(initiatorBoosterOptions.slice(0, 25));

  const row1 = new ActionRowBuilder().addComponents(giveBoosterSelect);

  // Boutons: opportunites, recherche globale, close
  const opportunitiesButton = new ButtonBuilder()
    .setCustomId(`trade_opportunities_${interaction.id}`)
    .setLabel('Opportunites')
    .setStyle(ButtonStyle.Primary)
    .setEmoji('💡');

  const globalSearchButton = new ButtonBuilder()
    .setCustomId(`search_trade_global_${interaction.id}_give`)
    .setStyle(ButtonStyle.Success)
    .setEmoji('🔍');

  const closeButton = new ButtonBuilder()
    .setCustomId(`close_${initiator.id}`)
    .setLabel('X')
    .setStyle(ButtonStyle.Danger);

  const row2 = new ActionRowBuilder().addComponents(opportunitiesButton, globalSearchButton, closeButton);

  activeTrades.set(interaction.id, {
    initiatorId: initiator.id,
    targetId: target.id,
    giveBoosterId: null,
    giveCardId: null,
    giveCards: [],
    givePage: 0,
    receiveBoosterId: null,
    receiveCardId: null,
    receiveCards: [],
    receivePage: 0,
    targetBoosters: targetBoosters,
    timestamp: Date.now()
  });

  await interaction.reply({
    content: `📋 **Echange avec ${target.username}**\n\n` +
      `**Etape 1:** Selectionnez le booster contenant la carte que vous voulez donner\n` +
      `💡 Cliquez sur **Opportunites** pour voir les echanges possibles`,
    components: [row1, row2],
    ephemeral: false
  });
}

/**
 * Gere la commande /giftbooster (ADMIN uniquement)
 */
async function handleGiftBoosterCommand(interaction) {
  const adminId = interaction.user.id;
  const targetUser = interaction.options.getUser('utilisateur');

  if (!ADMIN_WHITELIST.includes(adminId)) {
    return interaction.reply({
      content: '❌ Vous n\'avez pas la permission d\'utiliser cette commande.',
      ephemeral: true
    });
  }

  if (targetUser.bot) {
    return interaction.reply({
      content: '❌ Vous ne pouvez pas offrir un booster a un bot.',
      ephemeral: true
    });
  }

  try {
    const userData = loadUserData(targetUser.id);
    delete userData.lastBoosterOpen;
    saveUserData(targetUser.id, userData);

    const embed = new EmbedBuilder()
      .setColor('#FFD700')
      .setTitle('🎁 Booster Offert !')
      .setDescription(
        `${targetUser} a recu un booster gratuit !\n\n` +
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
 * Gere les interactions des menus de selection d'echange
 */
async function handleTradeSelectMenu(interaction) {
  const customId = interaction.customId;
  const parts = customId.split('_');
  const tradeId = parts[parts.length - 1];

  const trade = activeTrades.get(tradeId);
  if (!trade) {
    return interaction.reply({
      content: '❌ Cet echange n\'est plus valide.',
      ephemeral: true
    });
  }

  if (interaction.user.id !== trade.initiatorId) {
    return interaction.reply({
      content: '❌ Seul l\'initiateur de l\'echange peut selectionner les cartes.',
      ephemeral: true
    });
  }

  const selectedValue = interaction.values[0];

  // Selection du booster pour les cartes a donner
  if (customId.startsWith('trade_give_booster_')) {
    const boosterId = selectedValue.replace('give_booster_', '');
    trade.giveBoosterId = boosterId;
    trade.givePage = 0;

    const userCards = getUserCardsFromBooster(trade.initiatorId, boosterId);
    trade.giveCards = userCards;

    if (userCards.length === 0) {
      return interaction.update({
        content: '❌ Aucune carte trouvee dans ce booster.',
        components: []
      });
    }

    const booster = boosters[boosterId];
    const { components, totalCards } = createCardSelectComponents(userCards, tradeId, 'give', 0, booster?.name, trade.initiatorId);

    await interaction.update({
      content: `📋 **Echange en cours**\n\n` +
        `**Booster:** ${booster?.name || boosterId}\n` +
        `**Cartes disponibles:** ${totalCards} (triees par quantite)\n\n` +
        `**Etape 2:** Selectionnez la carte a donner`,
      components
    });
  }
  // Selection de la carte a donner (recherche globale)
  else if (customId.startsWith('trade_give_card_global_')) {
    const cardId = selectedValue.replace('give_card_', '');
    trade.giveCardId = cardId;

    const targetBoosterOptions = [];
    for (const [boosterId, data] of trade.targetBoosters) {
      if (data.booster) {
        targetBoosterOptions.push({
          label: data.booster.name,
          description: `${data.count} carte${data.count > 1 ? 's' : ''} disponible${data.count > 1 ? 's' : ''}`,
          value: `receive_booster_${boosterId}`,
          emoji: '📦'
        });
      }
    }

    const receiveBoosterSelect = new StringSelectMenuBuilder()
      .setCustomId(`trade_receive_booster_${tradeId}`)
      .setPlaceholder('3. Choisissez le booster de la carte a recevoir')
      .addOptions(targetBoosterOptions.slice(0, 25));

    const row1 = new ActionRowBuilder().addComponents(receiveBoosterSelect);

    // Bouton recherche globale
    const globalSearchButton = new ButtonBuilder()
      .setCustomId(`search_trade_global_${tradeId}_receive`)
      .setStyle(ButtonStyle.Success)
      .setEmoji('🔍');

    const closeButton = new ButtonBuilder()
      .setCustomId(`close_${trade.initiatorId}`)
      .setLabel('X')
      .setStyle(ButtonStyle.Danger);

    const row2 = new ActionRowBuilder().addComponents(globalSearchButton, closeButton);

    const giveCard = getCardInfo(trade.giveCardId);
    await interaction.update({
      content: `📋 **Echange en cours**\n\n` +
        `**Vous donnez:** ${giveCard?.name || trade.giveCardId} #${giveCard?.id || trade.giveCardId}\n\n` +
        `**Etape 3:** Selectionnez le booster contenant la carte que vous voulez recevoir`,
      components: [row1, row2]
    });
  }
  // Selection de la carte a donner
  else if (customId.startsWith('trade_give_card_')) {
    const cardId = selectedValue.replace('give_card_', '');
    trade.giveCardId = cardId;

    const targetBoosterOptions = [];
    for (const [boosterId, data] of trade.targetBoosters) {
      if (data.booster) {
        targetBoosterOptions.push({
          label: data.booster.name,
          description: `${data.count} carte${data.count > 1 ? 's' : ''} disponible${data.count > 1 ? 's' : ''}`,
          value: `receive_booster_${boosterId}`,
          emoji: '📦'
        });
      }
    }

    const receiveBoosterSelect = new StringSelectMenuBuilder()
      .setCustomId(`trade_receive_booster_${tradeId}`)
      .setPlaceholder('3. Choisissez le booster de la carte a recevoir')
      .addOptions(targetBoosterOptions.slice(0, 25));

    const row1 = new ActionRowBuilder().addComponents(receiveBoosterSelect);

    // Bouton recherche globale
    const globalSearchButton = new ButtonBuilder()
      .setCustomId(`search_trade_global_${tradeId}_receive`)
      .setStyle(ButtonStyle.Success)
      .setEmoji('🔍');

    const closeButton = new ButtonBuilder()
      .setCustomId(`close_${trade.initiatorId}`)
      .setLabel('X')
      .setStyle(ButtonStyle.Danger);

    const row2 = new ActionRowBuilder().addComponents(globalSearchButton, closeButton);

    const giveCard = getCardInfo(trade.giveCardId);
    await interaction.update({
      content: `📋 **Echange en cours**\n\n` +
        `**Vous donnez:** ${giveCard?.name || trade.giveCardId} #${giveCard?.id || trade.giveCardId}\n\n` +
        `**Etape 3:** Selectionnez le booster contenant la carte que vous voulez recevoir`,
      components: [row1, row2]
    });
  }
  // Selection du booster pour les cartes a recevoir
  else if (customId.startsWith('trade_receive_booster_')) {
    const boosterId = selectedValue.replace('receive_booster_', '');
    trade.receiveBoosterId = boosterId;
    trade.receivePage = 0;

    const targetCards = getUserCardsFromBooster(trade.targetId, boosterId);
    trade.receiveCards = targetCards;

    if (targetCards.length === 0) {
      return interaction.update({
        content: '❌ Aucune carte trouvee dans ce booster.',
        components: []
      });
    }

    const giveCard = getCardInfo(trade.giveCardId);
    const booster = boosters[boosterId];
    const { components, totalCards } = createCardSelectComponents(targetCards, tradeId, 'receive', 0, booster?.name, trade.initiatorId);

    await interaction.update({
      content: `📋 **Echange en cours**\n\n` +
        `**Vous donnez:** ${giveCard?.name || trade.giveCardId} #${giveCard?.id || trade.giveCardId}\n` +
        `**Booster cible:** ${booster?.name || boosterId}\n` +
        `**Cartes disponibles:** ${totalCards} (triees par quantite)\n\n` +
        `**Etape 4:** Selectionnez la carte a recevoir`,
      components
    });
  }
  // Selection de la carte a recevoir (recherche globale)
  else if (customId.startsWith('trade_receive_card_global_')) {
    const cardId = selectedValue.replace('receive_card_', '');
    trade.receiveCardId = cardId;

    await showTradeConfirmation(interaction, trade, tradeId);
  }
  // Selection de la carte a recevoir
  else if (customId.startsWith('trade_receive_card_')) {
    const cardId = selectedValue.replace('receive_card_', '');
    trade.receiveCardId = cardId;

    await showTradeConfirmation(interaction, trade, tradeId);
  }
}

/**
 * Affiche la confirmation de l'echange
 */
async function showTradeConfirmation(interaction, trade, tradeId) {
  const initiator = await interaction.client.users.fetch(trade.initiatorId);
  const target = await interaction.client.users.fetch(trade.targetId);

  const giveCard = getCardInfo(trade.giveCardId);
  const receiveCard = getCardInfo(trade.receiveCardId);

  const confirmButton = new ButtonBuilder()
    .setCustomId(`trade_confirm_${tradeId}`)
    .setLabel('Accepter')
    .setStyle(ButtonStyle.Success)
    .setEmoji('✅');

  const cancelButton = new ButtonBuilder()
    .setCustomId(`trade_cancel_${tradeId}`)
    .setLabel('Refuser')
    .setStyle(ButtonStyle.Danger)
    .setEmoji('❌');

  const row = new ActionRowBuilder().addComponents(confirmButton, cancelButton);

  // Timestamp d'expiration (5 minutes)
  const expirationTimestamp = Math.floor((Date.now() + 5 * 60 * 1000) / 1000);

  // Generate trade proposal image
  const imageBuffer = await generateTradeProposalImage(
    giveCard,
    receiveCard,
    initiator.username,
    target.username
  );

  const attachment = new AttachmentBuilder(imageBuffer, { name: 'trade_proposal.png' });

  const embed = new EmbedBuilder()
    .setColor('#FFA500')
    .setTitle('Confirmation d\'echange')
    .setDescription(
      `**${initiator.username}** propose un echange a **${target}**\n\n` +
      `${initiator.username} donne: **${giveCard?.name || 'Carte inconnue'}** #${giveCard?.id || '?'} (${giveCard?.rarityName || 'Inconnue'})\n` +
      `${target.username} donne: **${receiveCard?.name || 'Carte inconnue'}** #${receiveCard?.id || '?'} (${receiveCard?.rarityName || 'Inconnue'})\n\n` +
      `${target}, acceptez-vous cet echange ?\n` +
      `Expire <t:${expirationTimestamp}:R>`
    )
    .setImage('attachment://trade_proposal.png');

  await interaction.update({
    content: null,
    embeds: [embed],
    components: [row],
    files: [attachment]
  });

  setTimeout(() => {
    if (activeTrades.has(tradeId)) {
      activeTrades.delete(tradeId);
    }
  }, 5 * 60 * 1000);
}

/**
 * Gere les boutons de confirmation d'echange et pagination
 */
async function handleTradeButton(interaction) {
  const customId = interaction.customId;

  // Gestion du bouton Opportunites
  if (customId.startsWith('trade_opportunities_')) {
    const tradeId = customId.replace('trade_opportunities_', '');
    const trade = activeTrades.get(tradeId);

    if (!trade) {
      return interaction.reply({
        content: '❌ Cet echange n\'est plus valide.',
        ephemeral: true
      });
    }

    if (interaction.user.id !== trade.initiatorId) {
      return interaction.reply({
        content: '❌ Seul l\'initiateur peut voir les opportunites.',
        ephemeral: true
      });
    }

    const { canOffer, canReceive } = findTradeOpportunities(trade.initiatorId, trade.targetId);

    // Grouper par booster
    const groupByBooster = (cards) => {
      const grouped = {};
      for (const card of cards) {
        const boosterName = boosters[card.boosterId]?.name || card.boosterId;
        if (!grouped[boosterName]) {
          grouped[boosterName] = [];
        }
        grouped[boosterName].push(card);
      }
      return grouped;
    };

    const offerByBooster = groupByBooster(canOffer);
    const receiveByBooster = groupByBooster(canReceive);

    // Emoji de rarete par couleur
    const rarityEmoji = (rarity) => {
      switch (rarity) {
        case 'common': return '⚪';
        case 'uncommon': return '🟢';
        case 'rare': return '🔵';
        case 'legendary': return '🟠';
        case 'promo': return '🟣';
        default: return '⚪';
      }
    };

    // Construire le message
    let description = '';

    if (canOffer.length === 0 && canReceive.length === 0) {
      description = '*Aucune opportunite d\'echange trouvee.*\n\n' +
        'Les opportunites apparaissent quand:\n' +
        '• Vous avez des doublons que l\'autre n\'a pas\n' +
        '• L\'autre a des doublons que vous n\'avez pas';
    } else {
      // Ce que vous pouvez offrir
      if (canOffer.length > 0) {
        description += '**Vous pouvez offrir** (vos doublons):\n';
        for (const [boosterName, cards] of Object.entries(offerByBooster)) {
          const cardList = cards.slice(0, 5).map(c => `${rarityEmoji(c.rarity)}${c.name} #${c.id} x${c.quantity}`).join(', ');
          const more = cards.length > 5 ? ` +${cards.length - 5}` : '';
          description += `📦 ${boosterName}: ${cardList}${more}\n`;
        }
        description += '\n';
      }

      // Ce que vous pouvez recevoir
      if (canReceive.length > 0) {
        description += '**Vous pouvez recevoir** (leurs doublons):\n';
        for (const [boosterName, cards] of Object.entries(receiveByBooster)) {
          const cardList = cards.slice(0, 5).map(c => `${rarityEmoji(c.rarity)}${c.name} #${c.id} x${c.quantity}`).join(', ');
          const more = cards.length > 5 ? ` +${cards.length - 5}` : '';
          description += `📦 ${boosterName}: ${cardList}${more}\n`;
        }
      }
    }

    const embed = new EmbedBuilder()
      .setColor('#3498db')
      .setTitle('💡 Opportunites d\'echange')
      .setDescription(description)
      .setFooter({ text: `${canOffer.length} carte(s) a offrir • ${canReceive.length} carte(s) a recevoir` });

    return interaction.reply({
      embeds: [embed],
      ephemeral: true
    });
  }

  // Gestion de la pagination globale
  if (customId.startsWith('trade_page_global_')) {
    const parts = customId.split('_');
    // Format: trade_page_global_give/receive_prev/next_currentPage_tradeId
    const type = parts[3]; // give ou receive
    const direction = parts[4]; // prev ou next
    const currentPage = parseInt(parts[5]);
    const tradeId = parts[6];

    const trade = activeTrades.get(tradeId);
    if (!trade) {
      return interaction.reply({
        content: '❌ Cet echange n\'est plus valide.',
        ephemeral: true
      });
    }

    if (interaction.user.id !== trade.initiatorId) {
      return interaction.reply({
        content: '❌ Seul l\'initiateur peut naviguer dans les pages.',
        ephemeral: true
      });
    }

    const newPage = direction === 'next' ? currentPage + 1 : currentPage - 1;
    const userId = type === 'give' ? trade.initiatorId : trade.targetId;
    const cards = getAllUserCards(userId);

    const { components, totalCards } = createGlobalCardSelectComponents(cards, tradeId, type, newPage, trade.initiatorId);

    let content;
    if (type === 'give') {
      content = `📋 **Echange en cours**\n\n` +
        `🔍 Recherche globale\n` +
        `**Cartes disponibles:** ${totalCards}\n\n` +
        `**Etape 2:** Selectionnez la carte a donner`;
    } else {
      const giveCard = getCardInfo(trade.giveCardId);
      content = `📋 **Echange en cours**\n\n` +
        `**Vous donnez:** ${giveCard?.name || trade.giveCardId} #${giveCard?.id || trade.giveCardId}\n` +
        `🔍 Recherche globale\n` +
        `**Cartes disponibles:** ${totalCards}\n\n` +
        `**Etape 4:** Selectionnez la carte a recevoir`;
    }

    await interaction.update({
      content,
      components
    });
    return;
  }

  // Gestion de la pagination
  if (customId.startsWith('trade_page_')) {
    const parts = customId.split('_');
    // Format: trade_page_give/receive_prev/next_currentPage_tradeId
    const type = parts[2]; // give ou receive
    const direction = parts[3]; // prev ou next
    const currentPage = parseInt(parts[4]);
    const tradeId = parts[5];

    const trade = activeTrades.get(tradeId);
    if (!trade) {
      return interaction.reply({
        content: '❌ Cet echange n\'est plus valide.',
        ephemeral: true
      });
    }

    if (interaction.user.id !== trade.initiatorId) {
      return interaction.reply({
        content: '❌ Seul l\'initiateur peut naviguer dans les pages.',
        ephemeral: true
      });
    }

    const newPage = direction === 'next' ? currentPage + 1 : currentPage - 1;
    const cards = type === 'give' ? trade.giveCards : trade.receiveCards;
    const boosterId = type === 'give' ? trade.giveBoosterId : trade.receiveBoosterId;
    const booster = boosters[boosterId];

    if (type === 'give') {
      trade.givePage = newPage;
    } else {
      trade.receivePage = newPage;
    }

    const { components, totalCards } = createCardSelectComponents(cards, tradeId, type, newPage, booster?.name, trade.initiatorId);

    let content;
    if (type === 'give') {
      content = `📋 **Echange en cours**\n\n` +
        `**Booster:** ${booster?.name || boosterId}\n` +
        `**Cartes disponibles:** ${totalCards} (triees par quantite)\n\n` +
        `**Etape 2:** Selectionnez la carte a donner`;
    } else {
      const giveCard = getCardInfo(trade.giveCardId);
      content = `📋 **Echange en cours**\n\n` +
        `**Vous donnez:** ${giveCard?.name || trade.giveCardId} #${giveCard?.id || trade.giveCardId}\n` +
        `**Booster cible:** ${booster?.name || boosterId}\n` +
        `**Cartes disponibles:** ${totalCards} (triees par quantite)\n\n` +
        `**Etape 4:** Selectionnez la carte a recevoir`;
    }

    await interaction.update({
      content,
      components
    });
    return;
  }

  // Gestion de la confirmation/annulation
  const [, decision, tradeId] = customId.split('_');

  const trade = activeTrades.get(tradeId);
  if (!trade) {
    return interaction.reply({
      content: '❌ Cet echange n\'est plus valide ou a expire.',
      ephemeral: true
    });
  }

  if (interaction.user.id !== trade.targetId) {
    return interaction.reply({
      content: '❌ Seul l\'utilisateur cible peut accepter ou refuser l\'echange.',
      ephemeral: true
    });
  }

  if (decision === 'cancel') {
    activeTrades.delete(tradeId);
    await interaction.update({
      content: '❌ Echange refuse.',
      embeds: [],
      components: []
    });
    return;
  }

  try {
    const initiator = await interaction.client.users.fetch(trade.initiatorId);
    const target = await interaction.client.users.fetch(trade.targetId);

    const success1 = removeCardFromUser(trade.initiatorId, trade.giveCardId);
    const success2 = removeCardFromUser(trade.targetId, trade.receiveCardId);

    if (!success1 || !success2) {
      if (success1) addCardsToUser(trade.initiatorId, [trade.giveCardId]);
      if (success2) addCardsToUser(trade.targetId, [trade.receiveCardId]);

      await interaction.update({
        content: '❌ Erreur: Une des parties ne possede plus la carte proposee.',
        embeds: [],
        components: []
      });
      activeTrades.delete(tradeId);
      return;
    }

    addCardsToUser(trade.initiatorId, [trade.receiveCardId]);
    addCardsToUser(trade.targetId, [trade.giveCardId]);

    // Clear team slots if the traded card was the last copy
    clearTeamSlotIfNotOwned(trade.initiatorId, trade.giveCardId);
    clearTeamSlotIfNotOwned(trade.targetId, trade.receiveCardId);

    activeTrades.delete(tradeId);

    const giveCard = getCardInfo(trade.giveCardId);
    const receiveCard = getCardInfo(trade.receiveCardId);

    // Generate trade completed image
    const imageBuffer = await generateTradeCompletedImage(
      giveCard,
      receiveCard,
      initiator.username,
      target.username
    );

    const attachment = new AttachmentBuilder(imageBuffer, { name: 'trade_completed.png' });

    const embed = new EmbedBuilder()
      .setColor('#00FF00')
      .setTitle('Echange reussi !')
      .setDescription(
        `${initiator} a recu **${receiveCard?.name || 'Carte'}** #${receiveCard?.id || '?'}\n` +
        `${target} a recu **${giveCard?.name || 'Carte'}** #${giveCard?.id || '?'}`
      )
      .setImage('attachment://trade_completed.png');

    await interaction.update({
      content: null,
      embeds: [embed],
      components: [],
      files: [attachment]
    });

  } catch (error) {
    console.error('Erreur lors de l\'echange:', error);
    await interaction.update({
      content: '❌ Une erreur est survenue lors de l\'echange.',
      embeds: [],
      components: []
    });
    activeTrades.delete(tradeId);
  }
}

/**
 * Gere le modal de recherche dans l'echange
 */
async function handleTradeSearchModal(interaction) {
  const searchTerm = interaction.fields.getTextInputValue('search_input').toLowerCase();
  const parts = interaction.customId.split('_');
  // search_trade_tradeId_type OR search_trade_global_tradeId_type
  const isGlobal = parts[2] === 'global';
  const tradeId = isGlobal ? parts[3] : parts[2];
  const type = isGlobal ? parts[4] : parts[3]; // 'give' or 'receive'

  const trade = activeTrades.get(tradeId);
  if (!trade) {
    return interaction.reply({
      content: '❌ Cet echange n\'est plus valide.',
      ephemeral: true
    });
  }

  if (interaction.user.id !== trade.initiatorId) {
    return interaction.reply({
      content: '❌ Seul l\'initiateur peut rechercher.',
      ephemeral: true
    });
  }

  let allCards, filteredCards;

  if (isGlobal) {
    // Recherche globale
    const userId = type === 'give' ? trade.initiatorId : trade.targetId;
    allCards = getAllUserCards(userId);
    filteredCards = allCards.filter(card =>
      card.name.toLowerCase().includes(searchTerm)
    );
  } else {
    // Recherche dans un booster specifique
    allCards = type === 'give' ? trade.giveCards : trade.receiveCards;
    filteredCards = allCards.filter(card =>
      card.name.toLowerCase().includes(searchTerm)
    );
  }

  if (filteredCards.length === 0) {
    return interaction.reply({
      content: `❌ Aucune carte trouvee pour "${searchTerm}".`,
      ephemeral: true
    });
  }

  await interaction.deferUpdate();

  let content;
  let components;

  if (isGlobal) {
    // Recherche globale
    const result = createGlobalCardSelectComponents(filteredCards, tradeId, type, 0, trade.initiatorId);
    components = result.components;

    if (type === 'give') {
      content = `📋 **Echange en cours**\n\n` +
        `🔍 Recherche globale: "${searchTerm}" (${filteredCards.length} resultat${filteredCards.length > 1 ? 's' : ''})\n\n` +
        `**Etape 2:** Selectionnez la carte a donner`;
    } else {
      const giveCard = getCardInfo(trade.giveCardId);
      content = `📋 **Echange en cours**\n\n` +
        `**Vous donnez:** ${giveCard?.name || trade.giveCardId} #${giveCard?.id || trade.giveCardId}\n` +
        `🔍 Recherche globale: "${searchTerm}" (${filteredCards.length} resultat${filteredCards.length > 1 ? 's' : ''})\n\n` +
        `**Etape 4:** Selectionnez la carte a recevoir`;
    }
  } else {
    // Recherche dans un booster
    const boosterId = type === 'give' ? trade.giveBoosterId : trade.receiveBoosterId;
    const booster = boosters[boosterId];
    const result = createCardSelectComponents(filteredCards, tradeId, type, 0, booster?.name, trade.initiatorId);
    components = result.components;

    if (type === 'give') {
      content = `📋 **Echange en cours**\n\n` +
        `**Booster:** ${booster?.name || boosterId}\n` +
        `🔍 "${searchTerm}" (${filteredCards.length} resultat${filteredCards.length > 1 ? 's' : ''})\n\n` +
        `**Etape 2:** Selectionnez la carte a donner`;
    } else {
      const giveCard = getCardInfo(trade.giveCardId);
      content = `📋 **Echange en cours**\n\n` +
        `**Vous donnez:** ${giveCard?.name || trade.giveCardId} #${giveCard?.id || trade.giveCardId}\n` +
        `**Booster cible:** ${booster?.name || boosterId}\n` +
        `🔍 "${searchTerm}" (${filteredCards.length > 1 ? 's' : ''})\n\n` +
        `**Etape 4:** Selectionnez la carte a recevoir`;
    }
  }

  await interaction.editReply({
    content,
    components
  });
}

module.exports = {
  handleTradeCommand,
  handleGiftBoosterCommand,
  handleTradeSelectMenu,
  handleTradeButton,
  handleTradeSearchModal,
  ADMIN_WHITELIST
};
