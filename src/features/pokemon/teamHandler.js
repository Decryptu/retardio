const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require('discord.js');
const { getCardInfo, getAllCardsFromBooster } = require('../../services/cardGenerator');
const { loadUserData, getTeam, setTeamSlot } = require('../../services/userManager');
const { generateTeamImage } = require('../../services/imageGenerator');
const boosters = require('../../../data/boosters.json');

const CARDS_PER_PAGE = 25;

// Map pour stocker les sessions de modification d'equipe
const activeTeamSessions = new Map();

/**
 * Obtient toutes les cartes possedees par un utilisateur (tous boosters confondus)
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
 * Cree les composants de selection de carte avec pagination
 */
function createCardSelectComponents(cards, sessionId, slot, page) {
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

  // Ajouter option pour vider le slot
  cardOptions.unshift({
    label: 'Vider ce slot',
    description: 'Retirer le Pokemon de ce slot',
    value: 'team_card_empty',
    emoji: '❌'
  });

  const placeholder = totalPages > 1
    ? `Choisir Pokemon slot ${slot + 1} (${page + 1}/${totalPages})`
    : `Choisir Pokemon pour le slot ${slot + 1}`;

  const cardSelect = new StringSelectMenuBuilder()
    .setCustomId(`team_select_card_${sessionId}_${slot}`)
    .setPlaceholder(placeholder)
    .addOptions(cardOptions.slice(0, 25));

  components.push(new ActionRowBuilder().addComponents(cardSelect));

  // Boutons de pagination si necessaire
  if (totalPages > 1) {
    const prevButton = new ButtonBuilder()
      .setCustomId(`team_page_prev_${sessionId}_${slot}_${page}`)
      .setLabel('< Precedent')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page === 0);

    const pageIndicator = new ButtonBuilder()
      .setCustomId(`team_page_indicator_${sessionId}`)
      .setLabel(`${page + 1} / ${totalPages}`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true);

    const nextButton = new ButtonBuilder()
      .setCustomId(`team_page_next_${sessionId}_${slot}_${page}`)
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

  return { components, totalCards: cards.length, totalPages };
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
 * Gere la commande /team
 */
async function handleTeamCommand(interaction) {
  const userId = interaction.user.id;
  const team = getTeam(userId);
  const userCards = getAllUserCards(userId);

  // Generer l'image de l'equipe
  const teamImageBuffer = await generateTeamImage(userId, team);
  const attachment = new AttachmentBuilder(teamImageBuffer, { name: 'team.png' });

  // Creer les boutons de slot
  const slotButtons = [];
  for (let i = 0; i < 3; i++) {
    const cardId = team[i];
    const cardInfo = cardId ? getCardInfo(cardId) : null;
    const label = cardInfo ? `Slot ${i + 1}: ${cardInfo.name}` : `Slot ${i + 1}: Vide`;

    const button = new ButtonBuilder()
      .setCustomId(`team_slot_${interaction.id}_${i}`)
      .setLabel(label.substring(0, 80))
      .setStyle(cardInfo ? ButtonStyle.Primary : ButtonStyle.Secondary)
      .setEmoji(cardInfo ? getCardEmoji(cardInfo.rarity) : '➕');

    slotButtons.push(button);
  }

  const row = new ActionRowBuilder().addComponents(slotButtons);

  // Stocker la session
  activeTeamSessions.set(interaction.id, {
    userId,
    userCards,
    currentSlot: null,
    page: 0,
    timestamp: Date.now()
  });

  // Nettoyer les anciennes sessions (plus de 10 minutes)
  setTimeout(() => {
    activeTeamSessions.delete(interaction.id);
  }, 10 * 60 * 1000);

  const hasCards = userCards.length > 0;
  const teamCount = team.filter(c => c !== null).length;

  await interaction.reply({
    content: `**Votre Equipe de Raid** (${teamCount}/3)\n\n` +
      (hasCards ? 'Cliquez sur un slot pour le modifier.' : '❌ Vous n\'avez aucune carte ! Ouvrez des boosters avec `/booster`.'),
    files: [attachment],
    components: hasCards ? [row] : []
  });
}

/**
 * Gere les boutons de l'interface team
 */
async function handleTeamButton(interaction) {
  const customId = interaction.customId;

  // Bouton de slot
  if (customId.startsWith('team_slot_')) {
    const parts = customId.split('_');
    const sessionId = parts[2];
    const slot = parseInt(parts[3]);

    const session = activeTeamSessions.get(sessionId);
    if (!session) {
      return interaction.reply({
        content: '❌ Cette session a expire. Utilisez `/team` a nouveau.',
        ephemeral: true
      });
    }

    if (interaction.user.id !== session.userId) {
      return interaction.reply({
        content: '❌ Cette interaction ne vous appartient pas.',
        ephemeral: true
      });
    }

    session.currentSlot = slot;
    session.page = 0;

    const { components, totalCards } = createCardSelectComponents(session.userCards, sessionId, slot, 0);

    await interaction.update({
      content: `**Modification du Slot ${slot + 1}**\n\n` +
        `${totalCards} carte${totalCards > 1 ? 's' : ''} disponible${totalCards > 1 ? 's' : ''}.`,
      files: [],
      components
    });
  }
  // Bouton pagination precedent
  else if (customId.startsWith('team_page_prev_')) {
    const parts = customId.split('_');
    const sessionId = parts[3];
    const slot = parseInt(parts[4]);
    const currentPage = parseInt(parts[5]);

    const session = activeTeamSessions.get(sessionId);
    if (!session || interaction.user.id !== session.userId) {
      return interaction.reply({
        content: '❌ Session invalide.',
        ephemeral: true
      });
    }

    const newPage = currentPage - 1;
    session.page = newPage;

    const { components, totalCards } = createCardSelectComponents(session.userCards, sessionId, slot, newPage);

    await interaction.update({
      content: `**Modification du Slot ${slot + 1}**\n\n` +
        `${totalCards} carte${totalCards > 1 ? 's' : ''} disponible${totalCards > 1 ? 's' : ''}.`,
      components
    });
  }
  // Bouton pagination suivant
  else if (customId.startsWith('team_page_next_')) {
    const parts = customId.split('_');
    const sessionId = parts[3];
    const slot = parseInt(parts[4]);
    const currentPage = parseInt(parts[5]);

    const session = activeTeamSessions.get(sessionId);
    if (!session || interaction.user.id !== session.userId) {
      return interaction.reply({
        content: '❌ Session invalide.',
        ephemeral: true
      });
    }

    const newPage = currentPage + 1;
    session.page = newPage;

    const { components, totalCards } = createCardSelectComponents(session.userCards, sessionId, slot, newPage);

    await interaction.update({
      content: `**Modification du Slot ${slot + 1}**\n\n` +
        `${totalCards} carte${totalCards > 1 ? 's' : ''} disponible${totalCards > 1 ? 's' : ''}.`,
      components
    });
  }
  // Bouton retour
  else if (customId.startsWith('team_back_')) {
    const parts = customId.split('_');
    const sessionId = parts[2];

    const session = activeTeamSessions.get(sessionId);
    if (!session || interaction.user.id !== session.userId) {
      return interaction.reply({
        content: '❌ Session invalide.',
        ephemeral: true
      });
    }

    // Regenerer l'affichage principal
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

    await interaction.update({
      content: `**Votre Equipe de Raid** (${teamCount}/3)\n\nCliquez sur un slot pour le modifier.`,
      files: [attachment],
      components: [row]
    });
  }
}

/**
 * Gere le menu de selection de carte pour l'equipe
 */
async function handleTeamSelectMenu(interaction) {
  const customId = interaction.customId;

  if (!customId.startsWith('team_select_card_')) return;

  const parts = customId.split('_');
  const sessionId = parts[3];
  const slot = parseInt(parts[4]);

  const session = activeTeamSessions.get(sessionId);
  if (!session) {
    return interaction.reply({
      content: '❌ Cette session a expire. Utilisez `/team` a nouveau.',
      ephemeral: true
    });
  }

  if (interaction.user.id !== session.userId) {
    return interaction.reply({
      content: '❌ Cette interaction ne vous appartient pas.',
      ephemeral: true
    });
  }

  const selectedValue = interaction.values[0];
  let cardId = null;

  if (selectedValue !== 'team_card_empty') {
    cardId = selectedValue.replace('team_card_', '');
  }

  // Mettre a jour le slot
  const success = setTeamSlot(session.userId, slot, cardId);

  if (!success && cardId !== null) {
    return interaction.reply({
      content: '❌ Vous ne possedez pas cette carte.',
      ephemeral: true
    });
  }

  // Regenerer l'affichage principal avec l'equipe mise a jour
  const team = getTeam(session.userId);
  const teamImageBuffer = await generateTeamImage(session.userId, team);
  const attachment = new AttachmentBuilder(teamImageBuffer, { name: 'team.png' });

  const slotButtons = [];
  for (let i = 0; i < 3; i++) {
    const teamCardId = team[i];
    const cardInfo = teamCardId ? getCardInfo(teamCardId) : null;
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

  const cardInfo = cardId ? getCardInfo(cardId) : null;
  const updateMsg = cardId
    ? `**${cardInfo?.name}** ajoute au slot ${slot + 1} !`
    : `Slot ${slot + 1} vide !`;

  await interaction.update({
    content: `**Votre Equipe de Raid** (${teamCount}/3)\n\n${updateMsg}\n\nCliquez sur un slot pour le modifier.`,
    files: [attachment],
    components: [row]
  });
}

module.exports = {
  handleTeamCommand,
  handleTeamButton,
  handleTeamSelectMenu
};
