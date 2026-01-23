const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder, MessageFlags } = require('discord.js');
const { getCardInfo, getAllCardsFromBooster } = require('../../services/cardGenerator');
const { loadUserData, getTeam, setTeamSlot } = require('../../services/userManager');
const { generateTeamImage } = require('../../services/imageGenerator');
const boosters = require('../../../data/boosters.json');

const CARDS_PER_PAGE = 24; // 24 cards + 1 "empty slot" option = 25 max

// Map pour stocker les sessions de modification d'equipe
const activeTeamSessions = new Map();

/**
 * Obtient les boosters ou l'utilisateur possede des cartes
 */
function getUserBoostersWithCards(userId) {
  const userData = loadUserData(userId);
  const boostersWithCards = [];

  for (const [boosterId, booster] of Object.entries(boosters)) {
    // Compter les cartes possedees dans ce booster
    const allBoosterCards = getAllCardsFromBooster(boosterId);
    let cardCount = 0;

    for (const card of allBoosterCards) {
      const cardId = String(card.id);
      if (userData.cards[cardId] && userData.cards[cardId] > 0) {
        cardCount++;
      }
    }

    if (cardCount > 0) {
      boostersWithCards.push({
        id: boosterId,
        name: booster.name,
        cardCount
      });
    }
  }

  return boostersWithCards;
}

/**
 * Obtient les cartes possedees par un utilisateur dans un booster specifique
 */
function getUserCardsFromBooster(userId, boosterId) {
  const userData = loadUserData(userId);
  const allBoosterCards = getAllCardsFromBooster(boosterId);
  const userCards = [];

  for (const card of allBoosterCards) {
    const cardId = String(card.id);
    const quantity = userData.cards[cardId] || 0;

    if (quantity > 0) {
      const cardInfo = getCardInfo(cardId);
      if (cardInfo) {
        userCards.push({
          ...cardInfo,
          quantity
        });
      }
    }
  }

  // Trier par nom
  userCards.sort((a, b) => a.name.localeCompare(b.name));
  return userCards;
}

/**
 * Retourne l'emoji correspondant a la rarete
 */
function getCardEmoji(rarity) {
  const emojis = {
    common: '⚪',
    uncommon: '🟢',
    rare: '🔵',
    legendary: '🟠',
    promo: '🟣'
  };
  return emojis[rarity] || '⚪';
}

/**
 * Cree les composants de selection de booster avec pagination
 */
function createBoosterSelectComponents(userBoosters, sessionId, slot, page) {
  const totalPages = Math.ceil(userBoosters.length / 25);
  const startIndex = page * 25;
  const pageBoosters = userBoosters.slice(startIndex, startIndex + 25);

  const components = [];

  // Menu de selection des boosters
  const boosterOptions = pageBoosters.map(booster => ({
    label: booster.name,
    description: `${booster.cardCount} carte${booster.cardCount > 1 ? 's' : ''} possedee${booster.cardCount > 1 ? 's' : ''}`,
    value: `team_booster_${booster.id}`
  }));

  // Ajouter option pour vider le slot
  boosterOptions.unshift({
    label: 'Vider ce slot',
    description: 'Retirer le Pokemon de ce slot',
    value: 'team_booster_empty',
    emoji: '❌'
  });

  const placeholder = totalPages > 1
    ? `Choisir un booster (${page + 1}/${totalPages})`
    : 'Choisir un booster';

  const boosterSelect = new StringSelectMenuBuilder()
    .setCustomId(`team_select_booster_${sessionId}_${slot}_${page}`)
    .setPlaceholder(placeholder)
    .addOptions(boosterOptions.slice(0, 25));

  components.push(new ActionRowBuilder().addComponents(boosterSelect));

  // Boutons de pagination si necessaire
  if (totalPages > 1) {
    const prevButton = new ButtonBuilder()
      .setCustomId(`team_booster_prev_${sessionId}_${slot}_${page}`)
      .setLabel('< Precedent')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page === 0);

    const pageIndicator = new ButtonBuilder()
      .setCustomId(`team_booster_indicator_${sessionId}`)
      .setLabel(`${page + 1} / ${totalPages}`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true);

    const nextButton = new ButtonBuilder()
      .setCustomId(`team_booster_next_${sessionId}_${slot}_${page}`)
      .setLabel('Suivant >')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= totalPages - 1);

    components.push(new ActionRowBuilder().addComponents(prevButton, pageIndicator, nextButton));
  }

  // Bouton retour
  const backButton = new ButtonBuilder()
    .setCustomId(`team_back_${sessionId}`)
    .setLabel('Retour')
    .setStyle(ButtonStyle.Danger)
    .setEmoji('↩️');

  components.push(new ActionRowBuilder().addComponents(backButton));

  return { components, totalBoosters: userBoosters.length, totalPages };
}

/**
 * Cree les composants de selection de carte avec pagination
 */
function createCardSelectComponents(cards, sessionId, slot, boosterId, page) {
  const totalPages = Math.ceil(cards.length / CARDS_PER_PAGE);
  const startIndex = page * CARDS_PER_PAGE;
  const pageCards = cards.slice(startIndex, startIndex + CARDS_PER_PAGE);

  const components = [];

  // Menu de selection des cartes
  const cardOptions = pageCards.map(card => ({
    label: card.name,
    description: `${card.rarityName} (x${card.quantity})`,
    value: `team_card_${card.id}`,
    emoji: getCardEmoji(card.rarity)
  }));

  const boosterName = boosters[boosterId]?.name || 'Booster';
  const placeholder = totalPages > 1
    ? `${boosterName} - Page ${page + 1}/${totalPages}`
    : `Choisir un Pokemon`;

  const cardSelect = new StringSelectMenuBuilder()
    .setCustomId(`team_select_card_${sessionId}_${slot}_${boosterId}_${page}`)
    .setPlaceholder(placeholder)
    .addOptions(cardOptions.slice(0, 25));

  components.push(new ActionRowBuilder().addComponents(cardSelect));

  // Boutons de pagination si necessaire
  if (totalPages > 1) {
    const prevButton = new ButtonBuilder()
      .setCustomId(`team_card_prev_${sessionId}_${slot}_${boosterId}_${page}`)
      .setLabel('< Precedent')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page === 0);

    const pageIndicator = new ButtonBuilder()
      .setCustomId(`team_card_indicator_${sessionId}`)
      .setLabel(`${page + 1} / ${totalPages}`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true);

    const nextButton = new ButtonBuilder()
      .setCustomId(`team_card_next_${sessionId}_${slot}_${boosterId}_${page}`)
      .setLabel('Suivant >')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= totalPages - 1);

    components.push(new ActionRowBuilder().addComponents(prevButton, pageIndicator, nextButton));
  }

  // Boutons retour (vers boosters) et annuler (vers equipe)
  const backToBoostersButton = new ButtonBuilder()
    .setCustomId(`team_back_boosters_${sessionId}_${slot}`)
    .setLabel('Changer de booster')
    .setStyle(ButtonStyle.Secondary)
    .setEmoji('📦');

  const cancelButton = new ButtonBuilder()
    .setCustomId(`team_back_${sessionId}`)
    .setLabel('Annuler')
    .setStyle(ButtonStyle.Danger)
    .setEmoji('↩️');

  components.push(new ActionRowBuilder().addComponents(backToBoostersButton, cancelButton));

  return { components, totalCards: cards.length, totalPages };
}

/**
 * Genere l'affichage principal de l'equipe
 */
async function generateMainTeamView(session, sessionId) {
  const team = getTeam(session.userId);
  const teamImageBuffer = await generateTeamImage(session.userId, team);
  const attachment = new AttachmentBuilder(teamImageBuffer, { name: 'team.png' });

  const slotButtons = [];
  for (let i = 0; i < 3; i++) {
    const cardId = team[i];
    const cardInfo = cardId ? getCardInfo(cardId) : null;
    const label = cardInfo ? `Slot ${i + 1}: ${cardInfo.name}` : `Slot ${i + 1}: Vide`;

    const button = new ButtonBuilder()
      .setCustomId(`team_slot_${sessionId}_${i}`)
      .setLabel(label.substring(0, 80))
      .setStyle(cardInfo ? ButtonStyle.Primary : ButtonStyle.Secondary)
      .setEmoji(cardInfo ? getCardEmoji(cardInfo.rarity) : '➕');

    slotButtons.push(button);
  }

  const row = new ActionRowBuilder().addComponents(slotButtons);
  const teamCount = team.filter(c => c !== null).length;

  return {
    content: `**Votre Equipe** (${teamCount}/3)\n\nCliquez sur un slot pour le modifier.`,
    files: [attachment],
    components: [row]
  };
}

/**
 * Gere la commande /team
 */
async function handleTeamCommand(interaction) {
  const userId = interaction.user.id;
  const userBoosters = getUserBoostersWithCards(userId);

  // Stocker la session
  const sessionId = interaction.id;
  activeTeamSessions.set(sessionId, {
    userId,
    userBoosters,
    currentSlot: null,
    currentBooster: null,
    boosterPage: 0,
    cardPage: 0,
    timestamp: Date.now()
  });

  // Nettoyer les anciennes sessions (plus de 10 minutes)
  setTimeout(() => {
    activeTeamSessions.delete(sessionId);
  }, 10 * 60 * 1000);

  const hasCards = userBoosters.length > 0;

  if (!hasCards) {
    const team = getTeam(userId);
    const teamImageBuffer = await generateTeamImage(userId, team);
    const attachment = new AttachmentBuilder(teamImageBuffer, { name: 'team.png' });
    const teamCount = team.filter(c => c !== null).length;

    return interaction.reply({
      content: `**Votre Equipe** (${teamCount}/3)\n\n❌ Vous n'avez aucune carte ! Ouvrez des boosters avec \`/booster\`.`,
      files: [attachment],
      components: []
    });
  }

  const session = activeTeamSessions.get(sessionId);
  const view = await generateMainTeamView(session, sessionId);

  await interaction.reply(view);
}

/**
 * Gere les boutons de l'interface team
 */
async function handleTeamButton(interaction) {
  const customId = interaction.customId;

  // Bouton de slot -> afficher selection de booster
  if (customId.startsWith('team_slot_')) {
    const parts = customId.split('_');
    const sessionId = parts[2];
    const slot = parseInt(parts[3]);

    const session = activeTeamSessions.get(sessionId);
    if (!session) {
      return interaction.reply({
        content: '❌ Cette session a expire. Utilisez `/team` a nouveau.',
        flags: MessageFlags.Ephemeral
      });
    }

    if (interaction.user.id !== session.userId) {
      return interaction.reply({
        content: '❌ Cette interaction ne vous appartient pas.',
        flags: MessageFlags.Ephemeral
      });
    }

    session.currentSlot = slot;
    session.boosterPage = 0;

    const { components, totalBoosters } = createBoosterSelectComponents(session.userBoosters, sessionId, slot, 0);

    await interaction.update({
      content: `**Modification du Slot ${slot + 1}**\n\n` +
        `Choisissez un booster parmi vos ${totalBoosters} booster${totalBoosters > 1 ? 's' : ''} avec des cartes.`,
      files: [],
      components
    });
  }
  // Pagination boosters - precedent
  else if (customId.startsWith('team_booster_prev_')) {
    const parts = customId.split('_');
    const sessionId = parts[3];
    const slot = parseInt(parts[4]);
    const currentPage = parseInt(parts[5]);

    const session = activeTeamSessions.get(sessionId);
    if (!session || interaction.user.id !== session.userId) {
      return interaction.reply({ content: '❌ Session invalide.', ephemeral: true });
    }

    const newPage = currentPage - 1;
    session.boosterPage = newPage;

    const { components, totalBoosters } = createBoosterSelectComponents(session.userBoosters, sessionId, slot, newPage);

    await interaction.update({
      content: `**Modification du Slot ${slot + 1}**\n\n` +
        `Choisissez un booster parmi vos ${totalBoosters} booster${totalBoosters > 1 ? 's' : ''} avec des cartes.`,
      components
    });
  }
  // Pagination boosters - suivant
  else if (customId.startsWith('team_booster_next_')) {
    const parts = customId.split('_');
    const sessionId = parts[3];
    const slot = parseInt(parts[4]);
    const currentPage = parseInt(parts[5]);

    const session = activeTeamSessions.get(sessionId);
    if (!session || interaction.user.id !== session.userId) {
      return interaction.reply({ content: '❌ Session invalide.', ephemeral: true });
    }

    const newPage = currentPage + 1;
    session.boosterPage = newPage;

    const { components, totalBoosters } = createBoosterSelectComponents(session.userBoosters, sessionId, slot, newPage);

    await interaction.update({
      content: `**Modification du Slot ${slot + 1}**\n\n` +
        `Choisissez un booster parmi vos ${totalBoosters} booster${totalBoosters > 1 ? 's' : ''} avec des cartes.`,
      components
    });
  }
  // Pagination cartes - precedent
  else if (customId.startsWith('team_card_prev_')) {
    const parts = customId.split('_');
    const sessionId = parts[3];
    const slot = parseInt(parts[4]);
    const boosterId = parts[5];
    const currentPage = parseInt(parts[6]);

    const session = activeTeamSessions.get(sessionId);
    if (!session || interaction.user.id !== session.userId) {
      return interaction.reply({ content: '❌ Session invalide.', ephemeral: true });
    }

    const newPage = currentPage - 1;
    session.cardPage = newPage;

    const boosterCards = getUserCardsFromBooster(session.userId, boosterId);
    const { components, totalCards } = createCardSelectComponents(boosterCards, sessionId, slot, boosterId, newPage);
    const boosterName = boosters[boosterId]?.name || 'Booster';

    await interaction.update({
      content: `**Modification du Slot ${slot + 1}**\n\n` +
        `**${boosterName}** - ${totalCards} carte${totalCards > 1 ? 's' : ''} disponible${totalCards > 1 ? 's' : ''}.`,
      components
    });
  }
  // Pagination cartes - suivant
  else if (customId.startsWith('team_card_next_')) {
    const parts = customId.split('_');
    const sessionId = parts[3];
    const slot = parseInt(parts[4]);
    const boosterId = parts[5];
    const currentPage = parseInt(parts[6]);

    const session = activeTeamSessions.get(sessionId);
    if (!session || interaction.user.id !== session.userId) {
      return interaction.reply({ content: '❌ Session invalide.', ephemeral: true });
    }

    const newPage = currentPage + 1;
    session.cardPage = newPage;

    const boosterCards = getUserCardsFromBooster(session.userId, boosterId);
    const { components, totalCards } = createCardSelectComponents(boosterCards, sessionId, slot, boosterId, newPage);
    const boosterName = boosters[boosterId]?.name || 'Booster';

    await interaction.update({
      content: `**Modification du Slot ${slot + 1}**\n\n` +
        `**${boosterName}** - ${totalCards} carte${totalCards > 1 ? 's' : ''} disponible${totalCards > 1 ? 's' : ''}.`,
      components
    });
  }
  // Retour vers selection de boosters
  else if (customId.startsWith('team_back_boosters_')) {
    const parts = customId.split('_');
    const sessionId = parts[3];
    const slot = parseInt(parts[4]);

    const session = activeTeamSessions.get(sessionId);
    if (!session || interaction.user.id !== session.userId) {
      return interaction.reply({ content: '❌ Session invalide.', ephemeral: true });
    }

    session.boosterPage = 0;
    session.currentBooster = null;

    const { components, totalBoosters } = createBoosterSelectComponents(session.userBoosters, sessionId, slot, 0);

    await interaction.update({
      content: `**Modification du Slot ${slot + 1}**\n\n` +
        `Choisissez un booster parmi vos ${totalBoosters} booster${totalBoosters > 1 ? 's' : ''} avec des cartes.`,
      components
    });
  }
  // Bouton retour vers equipe
  else if (customId.startsWith('team_back_')) {
    const parts = customId.split('_');
    const sessionId = parts[2];

    const session = activeTeamSessions.get(sessionId);
    if (!session || interaction.user.id !== session.userId) {
      return interaction.reply({ content: '❌ Session invalide.', ephemeral: true });
    }

    const view = await generateMainTeamView(session, sessionId);
    await interaction.update(view);
  }
}

/**
 * Gere les menus de selection pour l'equipe
 */
async function handleTeamSelectMenu(interaction) {
  const customId = interaction.customId;

  // Selection de booster
  if (customId.startsWith('team_select_booster_')) {
    const parts = customId.split('_');
    const sessionId = parts[3];
    const slot = parseInt(parts[4]);

    const session = activeTeamSessions.get(sessionId);
    if (!session) {
      return interaction.reply({
        content: '❌ Cette session a expire. Utilisez `/team` a nouveau.',
        flags: MessageFlags.Ephemeral
      });
    }

    if (interaction.user.id !== session.userId) {
      return interaction.reply({
        content: '❌ Cette interaction ne vous appartient pas.',
        flags: MessageFlags.Ephemeral
      });
    }

    const selectedValue = interaction.values[0];

    // Option vider le slot
    if (selectedValue === 'team_booster_empty') {
      setTeamSlot(session.userId, slot, null);

      const view = await generateMainTeamView(session, sessionId);
      view.content = `**Votre Equipe** (${getTeam(session.userId).filter(c => c !== null).length}/3)\n\n` +
        `Slot ${slot + 1} vide !\n\nCliquez sur un slot pour le modifier.`;

      return interaction.update(view);
    }

    // Booster selectionne -> afficher les cartes
    const boosterId = selectedValue.replace('team_booster_', '');
    session.currentBooster = boosterId;
    session.cardPage = 0;

    const boosterCards = getUserCardsFromBooster(session.userId, boosterId);
    const { components, totalCards } = createCardSelectComponents(boosterCards, sessionId, slot, boosterId, 0);
    const boosterName = boosters[boosterId]?.name || 'Booster';

    await interaction.update({
      content: `**Modification du Slot ${slot + 1}**\n\n` +
        `**${boosterName}** - ${totalCards} carte${totalCards > 1 ? 's' : ''} disponible${totalCards > 1 ? 's' : ''}.`,
      components
    });
  }
  // Selection de carte
  else if (customId.startsWith('team_select_card_')) {
    const parts = customId.split('_');
    const sessionId = parts[3];
    const slot = parseInt(parts[4]);

    const session = activeTeamSessions.get(sessionId);
    if (!session) {
      return interaction.reply({
        content: '❌ Cette session a expire. Utilisez `/team` a nouveau.',
        flags: MessageFlags.Ephemeral
      });
    }

    if (interaction.user.id !== session.userId) {
      return interaction.reply({
        content: '❌ Cette interaction ne vous appartient pas.',
        flags: MessageFlags.Ephemeral
      });
    }

    const selectedValue = interaction.values[0];
    const cardId = selectedValue.replace('team_card_', '');

    // Mettre a jour le slot
    const success = setTeamSlot(session.userId, slot, cardId);

    if (!success) {
      return interaction.reply({
        content: '❌ Vous ne possedez pas cette carte.',
        flags: MessageFlags.Ephemeral
      });
    }

    const cardInfo = getCardInfo(cardId);
    const view = await generateMainTeamView(session, sessionId);
    view.content = `**Votre Equipe** (${getTeam(session.userId).filter(c => c !== null).length}/3)\n\n` +
      `**${cardInfo?.name}** ajoute au slot ${slot + 1} !\n\nCliquez sur un slot pour le modifier.`;

    await interaction.update(view);
  }
}

module.exports = {
  handleTeamCommand,
  handleTeamButton,
  handleTeamSelectMenu
};
