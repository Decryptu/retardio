const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require('discord.js');
const { getCardInfo, getAllCardsFromBooster } = require('../../services/cardGenerator');
const { loadUserData, getBoosterCompletion } = require('../../services/userManager');
const { generateCollectionImage, generateCardDetailImage } = require('../../services/imageGenerator');
const boosters = require('../../../data/boosters.json');
const path = require('node:path');
const fs = require('node:fs');

const ASSETS_DIR = path.join(__dirname, '../../../assets');
const CARDS_PER_PAGE = 25;

/**
 * Obtient les cartes possedees d'un utilisateur pour un booster, triees par quantite
 */
function getOwnedCardsFromBooster(userId, boosterId) {
  const userData = loadUserData(userId);
  const allCards = getAllCardsFromBooster(boosterId);

  return allCards.filter(card => {
    const quantity = userData.cards[String(card.id)] || 0;
    return quantity > 0;
  }).map(card => ({
    ...card,
    quantity: userData.cards[String(card.id)]
  })).sort((a, b) => b.quantity - a.quantity);
}

/**
 * Obtient toutes les cartes possedees d'un utilisateur (tous boosters confondus)
 */
function getAllOwnedCards(userId) {
  const userData = loadUserData(userId);
  const ownedCards = [];

  for (const [cardId, quantity] of Object.entries(userData.cards)) {
    if (quantity > 0) {
      const cardInfo = getCardInfo(cardId);
      if (cardInfo) {
        ownedCards.push({
          ...cardInfo,
          quantity,
          boosterName: boosters[cardInfo.boosterPackId]?.name || 'Unknown'
        });
      }
    }
  }

  // Trier par quantite decroissante puis par nom
  return ownedCards.sort((a, b) => {
    if (b.quantity !== a.quantity) return b.quantity - a.quantity;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Cree les composants pour la recherche globale dans la collection
 */
function createGlobalCollectionComponents(targetUserId, ownedCards, page = 0, callerId = null) {
  const components = [];

  // Menu de selection de carte avec pagination
  if (ownedCards.length > 0) {
    const totalPages = Math.ceil(ownedCards.length / CARDS_PER_PAGE);
    const startIndex = page * CARDS_PER_PAGE;
    const pageCards = ownedCards.slice(startIndex, startIndex + CARDS_PER_PAGE);

    const cardOptions = pageCards.map(card => ({
      label: card.name,
      description: `${card.boosterName} - ${card.rarityName} - x${card.quantity}`,
      value: `${card.id}::global`,
      emoji: card.quantity > 1 ? '🔄' : '🃏'
    }));

    const placeholder = totalPages > 1
      ? `Recherche globale (${page + 1}/${totalPages})`
      : 'Voir une carte en detail';

    const cardSelectMenu = new StringSelectMenuBuilder()
      .setCustomId(`collection_card_global_${targetUserId}_${page}`)
      .setPlaceholder(placeholder)
      .addOptions(cardOptions);

    components.push(new ActionRowBuilder().addComponents(cardSelectMenu));

    // Boutons de pagination si necessaire
    if (totalPages > 1) {
      const prevButton = new ButtonBuilder()
        .setCustomId(`collection_page_global_prev_${targetUserId}_${page}`)
        .setLabel('◀ Precedent')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page === 0);

      const pageIndicator = new ButtonBuilder()
        .setCustomId(`collection_page_indicator_${targetUserId}`)
        .setLabel(`${page + 1} / ${totalPages}`)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true);

      const nextButton = new ButtonBuilder()
        .setCustomId(`collection_page_global_next_${targetUserId}_${page}`)
        .setLabel('Suivant ▶')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page >= totalPages - 1);

      components.push(new ActionRowBuilder().addComponents(prevButton, pageIndicator, nextButton));
    }
  }

  // Utility row: back + close
  const utilityButtons = [];

  const backButton = new ButtonBuilder()
    .setCustomId(`collection_back_${targetUserId}_1_0`)
    .setLabel('Retour')
    .setStyle(ButtonStyle.Secondary)
    .setEmoji('↩️');
  utilityButtons.push(backButton);

  const closeButton = new ButtonBuilder()
    .setCustomId(`close_${callerId || targetUserId}`)
    .setLabel('X')
    .setStyle(ButtonStyle.Danger);
  utilityButtons.push(closeButton);

  components.push(new ActionRowBuilder().addComponents(utilityButtons));

  return components;
}

/**
 * Cree les composants de la collection (booster select + card select avec pagination)
 */
function createCollectionComponents(targetUserId, boosterId, ownedCards, page = 0, callerId = null) {
  const components = [];

  // Menu de selection de booster
  const boosterOptions = Object.values(boosters).map(booster => ({
    label: booster.name,
    description: `${booster.totalCards} cartes${booster.isPromo ? ' (Promo)' : ''}`,
    value: String(booster.id),
    default: String(booster.id) === String(boosterId),
    emoji: booster.isPromo ? '✨' : '📦'
  }));

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId(`collection_select_${targetUserId}`)
    .setPlaceholder('Changer de booster')
    .addOptions(boosterOptions.slice(0, 25));

  components.push(new ActionRowBuilder().addComponents(selectMenu));

  // Menu de selection de carte avec pagination
  if (ownedCards.length > 0) {
    const totalPages = Math.ceil(ownedCards.length / CARDS_PER_PAGE);
    const startIndex = page * CARDS_PER_PAGE;
    const pageCards = ownedCards.slice(startIndex, startIndex + CARDS_PER_PAGE);

    const cardOptions = pageCards.map(card => ({
      label: card.name,
      description: `${card.rarityName} - x${card.quantity}`,
      value: `${card.id}::${boosterId}`,
      emoji: card.quantity > 1 ? '🔄' : '🃏'
    }));

    const placeholder = totalPages > 1
      ? `Voir une carte (${page + 1}/${totalPages})`
      : 'Voir une carte en detail';

    const cardSelectMenu = new StringSelectMenuBuilder()
      .setCustomId(`collection_card_${targetUserId}_${boosterId}_${page}`)
      .setPlaceholder(placeholder)
      .addOptions(cardOptions);

    components.push(new ActionRowBuilder().addComponents(cardSelectMenu));

    // Boutons de pagination si necessaire
    if (totalPages > 1) {
      const prevButton = new ButtonBuilder()
        .setCustomId(`collection_page_prev_${targetUserId}_${boosterId}_${page}`)
        .setLabel('◀ Precedent')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page === 0);

      const pageIndicator = new ButtonBuilder()
        .setCustomId(`collection_page_indicator_${targetUserId}`)
        .setLabel(`${page + 1} / ${totalPages}`)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true);

      const nextButton = new ButtonBuilder()
        .setCustomId(`collection_page_next_${targetUserId}_${boosterId}_${page}`)
        .setLabel('Suivant ▶')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page >= totalPages - 1);

      components.push(new ActionRowBuilder().addComponents(prevButton, pageIndicator, nextButton));
    }
  }

  // Utility row: search + global search + close
  const utilityButtons = [];

  if (ownedCards.length > 0) {
    const searchButton = new ButtonBuilder()
      .setCustomId(`search_collection_${targetUserId}_${boosterId}`)
      .setEmoji('🔍')
      .setStyle(ButtonStyle.Primary);
    utilityButtons.push(searchButton);
  }

  // Always add global search if user has any cards
  const userData = loadUserData(targetUserId);
  const hasAnyCards = Object.values(userData.cards).some(qty => qty > 0);

  if (hasAnyCards) {
    const globalSearchButton = new ButtonBuilder()
      .setCustomId(`search_collection_global_${targetUserId}`)
      .setEmoji('🌐')
      .setStyle(ButtonStyle.Success);
    utilityButtons.push(globalSearchButton);
  }

  const closeButton = new ButtonBuilder()
    .setCustomId(`close_${callerId || targetUserId}`)
    .setLabel('X')
    .setStyle(ButtonStyle.Danger);
  utilityButtons.push(closeButton);

  components.push(new ActionRowBuilder().addComponents(utilityButtons));

  return components;
}

/**
 * Gere la commande /collection
 */
async function handleCollectionCommand(interaction) {
  const targetUser = interaction.options.getUser('utilisateur') || interaction.user;
  const boosterIdOption = interaction.options.getString('booster');
  let boosterId = boosterIdOption || '1';
  const userId = targetUser.id;

  if (!boosters[boosterId]) {
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
    const imageBuffer = await generateCollectionImage(userId, boosterId);
    const attachment = new AttachmentBuilder(imageBuffer, { name: 'collection.png' });

    const { owned, total } = getBoosterCompletion(userId, boosterId);
    const percentage = total > 0 ? Math.round((owned / total) * 100) : 0;

    const boosterImagePath = path.join(ASSETS_DIR, 'boosters', `booster_${boosterId}.png`);
    const files = [attachment];

    const embed = new EmbedBuilder()
      .setColor('#0099ff')
      .setTitle(`Collection de ${targetUser.username}`)
      .setDescription(`**${boosters[boosterId].name}**\n${owned}/${total} cartes (${percentage}%)`)
      .setImage('attachment://collection.png');

    if (fs.existsSync(boosterImagePath)) {
      const boosterAttachment = new AttachmentBuilder(boosterImagePath, { name: 'booster_thumb.png' });
      files.push(boosterAttachment);
      embed.setThumbnail('attachment://booster_thumb.png');
    }

    const ownedCards = getOwnedCardsFromBooster(userId, boosterId);
    const components = createCollectionComponents(targetUser.id, boosterId, ownedCards, 0, interaction.user.id);

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
 * Gere le menu de selection de booster dans /collection
 */
async function handleCollectionSelectMenu(interaction) {
  const [, , targetUserId] = interaction.customId.split('_');
  const selectedBoosterId = interaction.values[0];

  if (!boosters[selectedBoosterId]) {
    return interaction.reply({
      content: '❌ Ce booster n\'existe pas.',
      ephemeral: true
    });
  }

  await interaction.deferUpdate();

  try {
    const targetUser = await interaction.client.users.fetch(targetUserId);

    const imageBuffer = await generateCollectionImage(targetUserId, selectedBoosterId);
    const attachment = new AttachmentBuilder(imageBuffer, { name: 'collection.png' });

    const { owned, total } = getBoosterCompletion(targetUserId, selectedBoosterId);
    const percentage = total > 0 ? Math.round((owned / total) * 100) : 0;

    const boosterImagePath = path.join(ASSETS_DIR, 'boosters', `booster_${selectedBoosterId}.png`);
    const files = [attachment];

    const embed = new EmbedBuilder()
      .setColor('#0099ff')
      .setTitle(`📚 Collection de ${targetUser.username}`)
      .setDescription(`**${boosters[selectedBoosterId].name}**\n${owned}/${total} cartes (${percentage}%)`)
      .setImage('attachment://collection.png');

    if (fs.existsSync(boosterImagePath)) {
      const boosterAttachment = new AttachmentBuilder(boosterImagePath, { name: 'booster_thumb.png' });
      files.push(boosterAttachment);
      embed.setThumbnail('attachment://booster_thumb.png');
    }

    const ownedCards = getOwnedCardsFromBooster(targetUserId, selectedBoosterId);
    const components = createCollectionComponents(targetUserId, selectedBoosterId, ownedCards, 0, interaction.user.id);

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
 * Gere la selection de carte pour voir en detail
 */
async function handleCardDetailSelectMenu(interaction) {
  const parts = interaction.customId.split('_');
  // Format: collection_card_targetUserId_boosterId_page OR collection_card_global_targetUserId_page
  const isGlobal = parts[2] === 'global';
  const targetUserId = isGlobal ? parts[3] : parts[2];
  const [cardId, boosterIdOrGlobal] = interaction.values[0].split('::');

  // Determine the actual booster ID
  let boosterId;
  if (boosterIdOrGlobal === 'global') {
    const cardInfo = getCardInfo(cardId);
    boosterId = String(cardInfo?.boosterPackId || '1');
  } else {
    boosterId = boosterIdOrGlobal;
  }

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

    const imageBuffer = await generateCardDetailImage(cardId, quantity, boosterId);
    const attachment = new AttachmentBuilder(imageBuffer, { name: 'card_detail.png' });

    const embed = new EmbedBuilder()
      .setColor(cardInfo.rarityColor)
      .setTitle(`🃏 ${cardInfo.name}`)
      .setDescription(`**Rarete:** ${cardInfo.rarityName}\n**Quantite:** x${quantity}`)
      .setImage('attachment://card_detail.png');

    const backButton = new ButtonBuilder()
      .setCustomId(`collection_back_${targetUserId}_${boosterId}_0`)
      .setLabel('Retour a la collection')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('◀️');

    const closeButton = new ButtonBuilder()
      .setCustomId(`close_${interaction.user.id}`)
      .setLabel('X')
      .setStyle(ButtonStyle.Danger);

    const row = new ActionRowBuilder().addComponents(backButton, closeButton);

    await interaction.editReply({
      embeds: [embed],
      files: [attachment],
      components: [row]
    });

  } catch (error) {
    console.error('Erreur lors de l\'affichage du detail de carte:', error);
    await interaction.followUp({
      content: '❌ Une erreur est survenue lors de l\'affichage de la carte.',
      ephemeral: true
    });
  }
}

/**
 * Gere les boutons de la collection (retour et pagination)
 */
async function handleCollectionButton(interaction) {
  const customId = interaction.customId;

  // Pagination globale
  if (customId.startsWith('collection_page_global_prev_') || customId.startsWith('collection_page_global_next_')) {
    const parts = customId.split('_');
    // Format: collection_page_global_prev/next_targetUserId_currentPage
    const direction = parts[3];
    const targetUserId = parts[4];
    const currentPage = parseInt(parts[5]);

    const newPage = direction === 'next' ? currentPage + 1 : currentPage - 1;

    await interaction.deferUpdate();

    try {
      const targetUser = await interaction.client.users.fetch(targetUserId);
      const allOwnedCards = getAllOwnedCards(targetUserId);

      const imageBuffer = await generateCollectionImage(targetUserId, '1');
      const attachment = new AttachmentBuilder(imageBuffer, { name: 'collection.png' });

      const embed = new EmbedBuilder()
        .setColor('#0099ff')
        .setTitle(`📚 Collection de ${targetUser.username}`)
        .setDescription(`🌐 Recherche globale\n${allOwnedCards.length} carte${allOwnedCards.length > 1 ? 's' : ''} au total`)
        .setImage('attachment://collection.png');

      const components = createGlobalCollectionComponents(targetUserId, allOwnedCards, newPage, interaction.user.id);

      await interaction.editReply({
        embeds: [embed],
        files: [attachment],
        components: components
      });

    } catch (error) {
      console.error('Erreur lors de la pagination globale:', error);
      await interaction.followUp({
        content: '❌ Une erreur est survenue.',
        ephemeral: true
      });
    }
    return;
  }

  // Pagination
  if (customId.startsWith('collection_page_prev_') || customId.startsWith('collection_page_next_')) {
    const parts = customId.split('_');
    // Format: collection_page_prev/next_targetUserId_boosterId_currentPage
    const direction = parts[2];
    const targetUserId = parts[3];
    const boosterId = parts[4];
    const currentPage = parseInt(parts[5]);

    const newPage = direction === 'next' ? currentPage + 1 : currentPage - 1;

    await interaction.deferUpdate();

    try {
      const targetUser = await interaction.client.users.fetch(targetUserId);

      const imageBuffer = await generateCollectionImage(targetUserId, boosterId);
      const attachment = new AttachmentBuilder(imageBuffer, { name: 'collection.png' });

      const { owned, total } = getBoosterCompletion(targetUserId, boosterId);
      const percentage = total > 0 ? Math.round((owned / total) * 100) : 0;

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

      const ownedCards = getOwnedCardsFromBooster(targetUserId, boosterId);
      const components = createCollectionComponents(targetUserId, boosterId, ownedCards, newPage, interaction.user.id);

      await interaction.editReply({
        embeds: [embed],
        files: files,
        components: components
      });

    } catch (error) {
      console.error('Erreur lors de la pagination:', error);
      await interaction.followUp({
        content: '❌ Une erreur est survenue.',
        ephemeral: true
      });
    }
    return;
  }

  // Bouton retour
  if (customId.startsWith('collection_back_')) {
    const parts = customId.split('_');
    // Format: collection_back_targetUserId_boosterId_page
    const targetUserId = parts[2];
    const boosterId = parts[3];
    const page = parseInt(parts[4]) || 0;

    await interaction.deferUpdate();

    try {
      const targetUser = await interaction.client.users.fetch(targetUserId);

      const imageBuffer = await generateCollectionImage(targetUserId, boosterId);
      const attachment = new AttachmentBuilder(imageBuffer, { name: 'collection.png' });

      const { owned, total } = getBoosterCompletion(targetUserId, boosterId);
      const percentage = total > 0 ? Math.round((owned / total) * 100) : 0;

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

      const ownedCards = getOwnedCardsFromBooster(targetUserId, boosterId);
      const components = createCollectionComponents(targetUserId, boosterId, ownedCards, page, interaction.user.id);

      await interaction.editReply({
        embeds: [embed],
        files: files,
        components: components
      });

    } catch (error) {
      console.error('Erreur lors du retour a la collection:', error);
      await interaction.followUp({
        content: '❌ Une erreur est survenue.',
        ephemeral: true
      });
    }
  }
}

/**
 * Gere le modal de recherche dans la collection
 */
async function handleCollectionSearchModal(interaction) {
  const searchTerm = interaction.fields.getTextInputValue('search_input').toLowerCase();
  const parts = interaction.customId.split('_');
  // search_collection_targetUserId_boosterId OR search_collection_global_targetUserId
  const isGlobal = parts[2] === 'global';
  const targetUserId = isGlobal ? parts[3] : parts[2];
  const boosterId = isGlobal ? null : parts[3];

  let allOwnedCards, filteredCards;

  if (isGlobal) {
    // Recherche globale dans tous les boosters
    allOwnedCards = getAllOwnedCards(targetUserId);
    filteredCards = allOwnedCards.filter(card =>
      card.name.toLowerCase().includes(searchTerm)
    );
  } else {
    // Recherche dans un booster specifique
    allOwnedCards = getOwnedCardsFromBooster(targetUserId, boosterId);
    filteredCards = allOwnedCards.filter(card =>
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

  try {
    const targetUser = await interaction.client.users.fetch(targetUserId);

    if (isGlobal) {
      // Recherche globale
      const imageBuffer = await generateCollectionImage(targetUserId, '1');
      const attachment = new AttachmentBuilder(imageBuffer, { name: 'collection.png' });

      const embed = new EmbedBuilder()
        .setColor('#0099ff')
        .setTitle(`Collection de ${targetUser.username}`)
        .setDescription(
          `🔍 Recherche globale: "${searchTerm}"\n` +
          `${filteredCards.length} resultat${filteredCards.length > 1 ? 's' : ''} trouve${filteredCards.length > 1 ? 's' : ''}`
        )
        .setImage('attachment://collection.png');

      const components = createGlobalCollectionComponents(targetUserId, filteredCards, 0, interaction.user.id);

      await interaction.editReply({
        embeds: [embed],
        files: [attachment],
        components: components
      });
    } else {
      // Recherche dans un booster specifique
      const imageBuffer = await generateCollectionImage(targetUserId, boosterId);
      const attachment = new AttachmentBuilder(imageBuffer, { name: 'collection.png' });

      const { owned, total } = getBoosterCompletion(targetUserId, boosterId);
      const percentage = total > 0 ? Math.round((owned / total) * 100) : 0;

      const boosterImagePath = path.join(ASSETS_DIR, 'boosters', `booster_${boosterId}.png`);
      const files = [attachment];

      const embed = new EmbedBuilder()
        .setColor('#0099ff')
        .setTitle(`Collection de ${targetUser.username}`)
        .setDescription(
          `**${boosters[boosterId].name}**\n${owned}/${total} cartes (${percentage}%)\n` +
          `🔍 Recherche: "${searchTerm}" (${filteredCards.length} resultat${filteredCards.length > 1 ? 's' : ''})`
        )
        .setImage('attachment://collection.png');

      if (fs.existsSync(boosterImagePath)) {
        const boosterAttachment = new AttachmentBuilder(boosterImagePath, { name: 'booster_thumb.png' });
        files.push(boosterAttachment);
        embed.setThumbnail('attachment://booster_thumb.png');
      }

      const components = createCollectionComponents(targetUserId, boosterId, filteredCards, 0, interaction.user.id);

      await interaction.editReply({
        embeds: [embed],
        files: files,
        components: components
      });
    }

  } catch (error) {
    console.error('Erreur lors de la recherche collection:', error);
    await interaction.followUp({
      content: '❌ Une erreur est survenue lors de la recherche.',
      ephemeral: true
    });
  }
}

module.exports = {
  handleCollectionCommand,
  handleCollectionSelectMenu,
  handleCardDetailSelectMenu,
  handleCollectionButton,
  handleCollectionSearchModal
};
