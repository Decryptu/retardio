const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require('discord.js');
const { getCardInfo, getAllCardsFromBooster } = require('../../services/cardGenerator');
const { loadUserData, getBoosterCompletion } = require('../../services/userManager');
const { generateCollectionImage, generateCardDetailImage } = require('../../services/imageGenerator');
const boosters = require('../../../data/boosters.json');
const path = require('node:path');
const fs = require('node:fs');

const ASSETS_DIR = path.join(__dirname, '../../../assets');

/**
 * Gere la commande /collection
 */
async function handleCollectionCommand(interaction) {
  const targetUser = interaction.options.getUser('utilisateur') || interaction.user;
  const boosterIdOption = interaction.options.getString('booster');
  let boosterId = boosterIdOption || '1';
  const userId = targetUser.id;

  // Verifier que le booster existe
  if (!boosters[boosterId]) {
    // Essayer de trouver un booster par defaut
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
    // Generer l'image de la collection
    const imageBuffer = await generateCollectionImage(userId, boosterId);
    const attachment = new AttachmentBuilder(imageBuffer, { name: 'collection.png' });

    // Recuperer les stats
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

    // Creer le menu de selection de booster (tous les boosters, y compris promo)
    const boosterOptions = Object.values(boosters).map(booster => ({
      label: booster.name,
      description: `${booster.totalCards} cartes${booster.isPromo ? ' (Promo)' : ''}`,
      value: String(booster.id),
      default: String(booster.id) === String(boosterId),
      emoji: booster.isPromo ? '✨' : '📦'
    }));

    // Limiter a 25 options
    const limitedOptions = boosterOptions.slice(0, 25);

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(`collection_select_${targetUser.id}`)
      .setPlaceholder('Changer de booster')
      .addOptions(limitedOptions);

    const row1 = new ActionRowBuilder().addComponents(selectMenu);

    // Creer le menu de selection de carte possedee
    const userData = loadUserData(userId);
    const allCards = getAllCardsFromBooster(boosterId);
    const ownedCards = allCards.filter(card => userData.cards[String(card.id)] && userData.cards[String(card.id)] > 0);

    const components = [row1];

    if (ownedCards.length > 0) {
      const cardOptions = ownedCards.slice(0, 25).map(card => ({
        label: card.name,
        description: `${card.rarityName} - x${userData.cards[String(card.id)]}`,
        value: `${card.id}::${boosterId}`,
        emoji: '🃏'
      }));

      const cardSelectMenu = new StringSelectMenuBuilder()
        .setCustomId(`collection_card_${targetUser.id}`)
        .setPlaceholder('Voir une carte en detail')
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
 * Gere le menu de selection de booster dans /collection
 */
async function handleCollectionSelectMenu(interaction) {
  const [, , targetUserId] = interaction.customId.split('_');
  const selectedBoosterId = interaction.values[0];

  // Verifier que le booster existe
  if (!boosters[selectedBoosterId]) {
    return interaction.reply({
      content: '❌ Ce booster n\'existe pas.',
      ephemeral: true
    });
  }

  await interaction.deferUpdate();

  try {
    const targetUser = await interaction.client.users.fetch(targetUserId);

    // Generer l'image de la nouvelle collection
    const imageBuffer = await generateCollectionImage(targetUserId, selectedBoosterId);
    const attachment = new AttachmentBuilder(imageBuffer, { name: 'collection.png' });

    // Recuperer les stats
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

    // Recreer le menu avec la nouvelle selection
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

    // Creer le menu de selection de carte possedee
    const userData = loadUserData(targetUserId);
    const allCards = getAllCardsFromBooster(selectedBoosterId);
    const ownedCards = allCards.filter(card => userData.cards[String(card.id)] && userData.cards[String(card.id)] > 0);

    const components = [row1];

    if (ownedCards.length > 0) {
      const cardOptions = ownedCards.slice(0, 25).map(card => ({
        label: card.name,
        description: `${card.rarityName} - x${userData.cards[String(card.id)]}`,
        value: `${card.id}::${selectedBoosterId}`,
        emoji: '🃏'
      }));

      const cardSelectMenu = new StringSelectMenuBuilder()
        .setCustomId(`collection_card_${targetUserId}`)
        .setPlaceholder('Voir une carte en detail')
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
 * Gere la selection de carte pour voir en detail
 */
async function handleCardDetailSelectMenu(interaction) {
  const [, , targetUserId] = interaction.customId.split('_');
  const [cardId, boosterId] = interaction.values[0].split('::');

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

    // Generer l'image de detail de la carte
    const imageBuffer = await generateCardDetailImage(cardId, quantity, boosterId);
    const attachment = new AttachmentBuilder(imageBuffer, { name: 'card_detail.png' });

    const embed = new EmbedBuilder()
      .setColor(cardInfo.rarityColor)
      .setTitle(`🃏 ${cardInfo.name}`)
      .setDescription(`**Rarete:** ${cardInfo.rarityName}\n**Quantite:** x${quantity}`)
      .setImage('attachment://card_detail.png');

    // Bouton retour
    const backButton = new ButtonBuilder()
      .setCustomId(`collection_back_${targetUserId}_${boosterId}`)
      .setLabel('Retour a la collection')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('◀️');

    const row = new ActionRowBuilder().addComponents(backButton);

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
 * Gere le bouton retour vers la collection
 */
async function handleCollectionBackButton(interaction) {
  const parts = interaction.customId.split('_');
  const targetUserId = parts[2];
  const boosterId = parts[3];

  await interaction.deferUpdate();

  try {
    const targetUser = await interaction.client.users.fetch(targetUserId);

    // Generer l'image de la collection
    const imageBuffer = await generateCollectionImage(targetUserId, boosterId);
    const attachment = new AttachmentBuilder(imageBuffer, { name: 'collection.png' });

    // Recuperer les stats
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

    // Recreer les menus
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

    // Creer le menu de selection de carte possedee
    const userData = loadUserData(targetUserId);
    const allCards = getAllCardsFromBooster(boosterId);
    const ownedCards = allCards.filter(card => userData.cards[String(card.id)] && userData.cards[String(card.id)] > 0);

    const components = [row1];

    if (ownedCards.length > 0) {
      const cardOptions = ownedCards.slice(0, 25).map(card => ({
        label: card.name,
        description: `${card.rarityName} - x${userData.cards[String(card.id)]}`,
        value: `${card.id}::${boosterId}`,
        emoji: '🃏'
      }));

      const cardSelectMenu = new StringSelectMenuBuilder()
        .setCustomId(`collection_card_${targetUserId}`)
        .setPlaceholder('Voir une carte en detail')
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
    console.error('Erreur lors du retour a la collection:', error);
    await interaction.followUp({
      content: '❌ Une erreur est survenue.',
      ephemeral: true
    });
  }
}

module.exports = {
  handleCollectionCommand,
  handleCollectionSelectMenu,
  handleCardDetailSelectMenu,
  handleCollectionBackButton
};
