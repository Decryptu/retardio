const {
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  AttachmentBuilder,
  MessageFlags,
} = require('discord.js');
const { getCardInfo } = require('../../services/cardGenerator');
const { getTeam, hasTeamMember } = require('../../services/userManager');
const config = require('../../config');
const cards = require('../../../data/cards.json');
const boosters = require('../../../data/boosters.json');
const rarities = require('../../../data/rarities.json');
const { ADMIN_WHITELIST } = require('./tradeHandler');
const path = require('node:path');
const fs = require('node:fs');

const ASSETS_DIR = path.join(__dirname, '../../../assets');
const WORLD_BOSS_ROLE_ID = '1464335798341206046';
const WORLD_BOSS_DURATION = 60 * 60 * 1000;
const WORLD_BOSS_TICK_INTERVAL = 30 * 1000;
const CARDS_PER_PAGE = 25;

const pickerSessions = new Map();
let activeWorldBoss = null;

function imageGenerator() {
  return require('../../services/imageGenerator');
}

function makeSessionId(userId) {
  return `${userId}${Date.now()}`;
}

function clampText(text, maxLength) {
  const value = String(text || '');
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 3)}...`;
}

function getAllCards() {
  return Object.values(cards)
    .map((card) => getCardInfo(card.id))
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function getFilteredCards(session) {
  const query = session.query.toLowerCase().trim();

  return getAllCards().filter((card) => {
    if (session.boosterId !== 'all' && String(card.boosterPackId) !== session.boosterId) {
      return false;
    }

    if (session.rarity !== 'all' && card.rarity !== session.rarity) {
      return false;
    }

    if (query && !card.name.toLowerCase().includes(query)) {
      return false;
    }

    return true;
  });
}

function getRarityEmoji(rarity) {
  const emojis = {
    common: '⚪',
    uncommon: '🟢',
    rare: '🔵',
    legendary: '🟠',
    promo: '🟣',
    wild: '🔮',
  };
  return emojis[rarity] || '🃏';
}

function createBoosterFilterRow(sessionId, selectedBoosterId) {
  const options = [
    {
      label: 'Toutes les collections',
      description: 'Afficher toutes les cartes',
      value: 'all',
      default: selectedBoosterId === 'all',
      emoji: '🌐',
    },
    ...Object.values(boosters).slice(0, 24).map((booster) => ({
      label: clampText(booster.name, 100),
      description: `${booster.totalCards} cartes`,
      value: String(booster.id),
      default: String(booster.id) === selectedBoosterId,
      emoji: booster.isPromo ? '✨' : booster.isWild ? '🔮' : '📦',
    })),
  ];

  const select = new StringSelectMenuBuilder()
    .setCustomId(`worldboss_booster_select_${sessionId}`)
    .setPlaceholder('Filtrer par collection')
    .addOptions(options);

  return new ActionRowBuilder().addComponents(select);
}

function createRarityFilterRow(sessionId, selectedRarity) {
  const options = [
    {
      label: 'Toutes les raretés',
      description: 'Afficher toutes les raretés',
      value: 'all',
      default: selectedRarity === 'all',
      emoji: '🌐',
    },
    ...Object.entries(rarities).map(([rarity, data]) => ({
      label: data.name,
      description: rarity,
      value: rarity,
      default: rarity === selectedRarity,
      emoji: getRarityEmoji(rarity),
    })),
  ];

  const select = new StringSelectMenuBuilder()
    .setCustomId(`worldboss_rarity_select_${sessionId}`)
    .setPlaceholder('Filtrer par rareté')
    .addOptions(options.slice(0, 25));

  return new ActionRowBuilder().addComponents(select);
}

function createCardSelectRow(sessionId, pageCards, page, totalPages) {
  if (pageCards.length === 0) return null;

  const options = pageCards.map((card) => ({
    label: clampText(card.name, 100),
    description: clampText(`${card.rarityName} • ${boosters[card.boosterPackId]?.name || 'Collection inconnue'}`, 100),
    value: String(card.id),
    emoji: getRarityEmoji(card.rarity),
  }));

  const select = new StringSelectMenuBuilder()
    .setCustomId(`worldboss_card_select_${sessionId}`)
    .setPlaceholder(totalPages > 1 ? `Choisir une carte (${page + 1}/${totalPages})` : 'Choisir une carte')
    .addOptions(options);

  return new ActionRowBuilder().addComponents(select);
}

function createPickerButtonRow(sessionId, page, totalPages) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`search_worldboss_${sessionId}`)
      .setStyle(ButtonStyle.Primary)
      .setEmoji('🔍'),
    new ButtonBuilder()
      .setCustomId(`worldboss_page_prev_${sessionId}`)
      .setLabel('◀')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page <= 0),
    new ButtonBuilder()
      .setCustomId(`worldboss_page_next_${sessionId}`)
      .setLabel('▶')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= totalPages - 1),
    new ButtonBuilder()
      .setCustomId(`worldboss_reset_${sessionId}`)
      .setLabel('Reset')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`worldboss_close_${sessionId}`)
      .setLabel('X')
      .setStyle(ButtonStyle.Danger)
  );
}

function createPreviewButtonRow(sessionId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`worldboss_start_${sessionId}`)
      .setLabel('Lancer le World Boss')
      .setStyle(ButtonStyle.Success)
      .setEmoji('⚔️'),
    new ButtonBuilder()
      .setCustomId(`worldboss_back_${sessionId}`)
      .setLabel('Retour')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('↩️'),
    new ButtonBuilder()
      .setCustomId(`search_worldboss_${sessionId}`)
      .setStyle(ButtonStyle.Primary)
      .setEmoji('🔍'),
    new ButtonBuilder()
      .setCustomId(`worldboss_close_${sessionId}`)
      .setLabel('X')
      .setStyle(ButtonStyle.Danger)
  );
}

function createPickerPayload(sessionId) {
  const session = pickerSessions.get(sessionId);
  const filteredCards = getFilteredCards(session);
  const totalPages = Math.max(1, Math.ceil(filteredCards.length / CARDS_PER_PAGE));
  session.page = Math.max(0, Math.min(session.page, totalPages - 1));

  const startIndex = session.page * CARDS_PER_PAGE;
  const pageCards = filteredCards.slice(startIndex, startIndex + CARDS_PER_PAGE);

  const embed = new EmbedBuilder()
    .setColor('#8E5CFF')
    .setTitle('Préparer un World Boss')
    .setDescription(
      `Choisissez n'importe quelle carte du jeu comme boss.\n\n` +
      `**Résultats:** ${filteredCards.length} carte${filteredCards.length > 1 ? 's' : ''}\n` +
      `**Collection:** ${session.boosterId === 'all' ? 'Toutes' : boosters[session.boosterId]?.name || session.boosterId}\n` +
      `**Rareté:** ${session.rarity === 'all' ? 'Toutes' : rarities[session.rarity]?.name || session.rarity}\n` +
      `**Recherche:** ${session.query || 'Aucune'}`
    )
    .setFooter({ text: 'Sélectionnez une carte pour afficher la preview.' });

  const components = [
    createBoosterFilterRow(sessionId, session.boosterId),
    createRarityFilterRow(sessionId, session.rarity),
  ];

  const cardSelectRow = createCardSelectRow(sessionId, pageCards, session.page, totalPages);
  if (cardSelectRow) components.push(cardSelectRow);
  components.push(createPickerButtonRow(sessionId, session.page, totalPages));

  return { embeds: [embed], components, files: [] };
}

function createPreviewPayload(sessionId) {
  const session = pickerSessions.get(sessionId);
  const card = getCardInfo(session.selectedCardId);
  const files = [];

  const embed = new EmbedBuilder()
    .setColor(card?.rarityColor || '#8E5CFF')
    .setTitle(card ? `World Boss: ${card.name}` : 'World Boss')
    .setDescription(
      card
        ? `**Rareté:** ${card.rarityName}\n` +
          `**Collection:** ${boosters[card.boosterPackId]?.name || card.boosterPackId}\n` +
          `**HP estimés:** ${getBossMaxHp(card).toLocaleString('fr-FR')}\n\n` +
          `L'événement durera au maximum **60 minutes**.`
        : 'Carte introuvable.'
    );

  if (card) {
    const cardImagePath = path.join(ASSETS_DIR, 'cards', `card_${card.id}.png`);
    if (fs.existsSync(cardImagePath)) {
      const attachment = new AttachmentBuilder(cardImagePath, { name: 'world_boss_preview.png' });
      files.push(attachment);
      embed.setImage('attachment://world_boss_preview.png');
    }
  }

  return {
    embeds: [embed],
    components: [createPreviewButtonRow(sessionId)],
    files,
  };
}

function getSessionFromInteraction(interaction, sessionId) {
  const session = pickerSessions.get(sessionId);
  if (!session) {
    return { error: '❌ Cette session a expiré. Relancez `/forceevent`.' };
  }

  if (interaction.user.id !== session.userId) {
    return { error: '❌ Cette interaction ne vous appartient pas.' };
  }

  return { session };
}

function getBossMaxHp(card) {
  const hpByRarity = {
    common: 18000,
    uncommon: 20000,
    rare: 22000,
    legendary: 24000,
    promo: 24000,
    wild: 24000,
  };
  return hpByRarity[card.rarity] || 22000;
}

function getTeamCards(userId) {
  return getTeam(userId)
    .filter((cardId) => cardId !== null)
    .map((cardId) => getCardInfo(cardId))
    .filter(Boolean);
}

function getRarityPower(rarity) {
  const powers = {
    common: 4,
    uncommon: 7,
    rare: 11,
    legendary: 16,
    promo: 18,
    wild: 18,
  };
  return powers[rarity] || 5;
}

function calculateParticipantDamage(teamCards) {
  if (teamCards.length === 0) return 0;

  const randomBase = Math.floor(Math.random() * 17) + 18; // 18-34
  const teamPower = teamCards.reduce((sum, card) => sum + getRarityPower(card.rarity), 0);
  const fullTeamBonus = teamCards.length >= 3 ? 8 : 0;

  return randomBase + teamPower + fullTeamBonus;
}

async function buildParticipantViews(worldBoss) {
  const views = [];

  for (const [userId, participant] of worldBoss.participants.entries()) {
    const teamCards = getTeamCards(userId);
    views.push({
      userId,
      username: participant.username,
      avatarURL: participant.avatarURL,
      teamCards,
      totalDamage: participant.totalDamage || 0,
    });
  }

  views.sort((a, b) => b.totalDamage - a.totalDamage);
  return views;
}

async function updateWorldBossMessage() {
  if (!activeWorldBoss) return;

  const worldBoss = activeWorldBoss;
  const channel = worldBoss.client.channels.cache.get(worldBoss.channelId);
  if (!channel) return;

  try {
    const message = await channel.messages.fetch({ message: worldBoss.messageId, cache: false });
    const participantViews = await buildParticipantViews(worldBoss);
    const imageBuffer = await imageGenerator().generateWorldBossImage(
      worldBoss.bossCard,
      worldBoss.hp,
      worldBoss.maxHp,
      participantViews,
      worldBoss.endTime,
      worldBoss.lastDamageLines
    );
    const attachment = new AttachmentBuilder(imageBuffer, { name: 'world_boss.png' });

    const endTimestamp = Math.floor(worldBoss.endTime / 1000);
    const hpText = `${Math.max(0, worldBoss.hp).toLocaleString('fr-FR')} / ${worldBoss.maxHp.toLocaleString('fr-FR')}`;

    const embed = new EmbedBuilder()
      .setColor('#B88CFF')
      .setTitle(`World Boss — ${worldBoss.bossCard.name}`)
      .setDescription(
        `**HP:** ${hpText}\n` +
        `**Participants:** ${worldBoss.participants.size}\n` +
        `**Fin:** <t:${endTimestamp}:R>\n\n` +
        `Les dégâts sont calculés toutes les **30 secondes** selon les joueurs présents.`
      )
      .setImage('attachment://world_boss.png');

    await message.edit({
      embeds: [embed],
      files: [attachment],
      components: [createJoinRow(false)],
    });
  } catch (error) {
    console.error('Erreur lors de la mise à jour du World Boss:', error);
  }
}

function createJoinRow(disabled) {
  const joinButton = new ButtonBuilder()
    .setCustomId('worldboss_join')
    .setLabel('Rejoindre le World Boss')
    .setStyle(ButtonStyle.Success)
    .setEmoji('⚔️')
    .setDisabled(disabled);

  return new ActionRowBuilder().addComponents(joinButton);
}

async function startWorldBoss(client, bossCard) {
  const channel = client.channels.cache.get(config.raidChannelId);
  if (!channel) {
    throw new Error(`Canal de raid/world boss introuvable: ${config.raidChannelId}`);
  }

  const maxHp = getBossMaxHp(bossCard);
  const endTime = Date.now() + WORLD_BOSS_DURATION;
  const placeholderBoss = {
    bossCard,
    hp: maxHp,
    maxHp,
    participants: new Map(),
    endTime,
    lastDamageLines: [],
  };

  const imageBuffer = await imageGenerator().generateWorldBossImage(
    bossCard,
    maxHp,
    maxHp,
    [],
    endTime,
    []
  );
  const attachment = new AttachmentBuilder(imageBuffer, { name: 'world_boss.png' });
  const endTimestamp = Math.floor(endTime / 1000);

  const embed = new EmbedBuilder()
    .setColor('#B88CFF')
    .setTitle(`World Boss — ${bossCard.name}`)
    .setDescription(
      `Un World Boss est apparu !\n\n` +
      `**HP:** ${maxHp.toLocaleString('fr-FR')} / ${maxHp.toLocaleString('fr-FR')}\n` +
      `**Durée max:** 60 minutes\n` +
      `**Fin:** <t:${endTimestamp}:R>\n\n` +
      `Rejoignez avec votre équipe actuelle. Vous pouvez modifier `/team` puis rejoindre à nouveau pour mettre à jour votre équipe.`
    )
    .setImage('attachment://world_boss.png');

  const message = await channel.send({
    content: `<@&${WORLD_BOSS_ROLE_ID}>`,
    embeds: [embed],
    files: [attachment],
    components: [createJoinRow(false)],
    allowedMentions: { roles: [WORLD_BOSS_ROLE_ID] },
  });

  activeWorldBoss = {
    ...placeholderBoss,
    messageId: message.id,
    channelId: channel.id,
    client,
    tickTimer: setInterval(() => processWorldBossTick(), WORLD_BOSS_TICK_INTERVAL),
    endTimer: setTimeout(() => finishWorldBoss(false), WORLD_BOSS_DURATION),
  };

  console.log(`World Boss démarré: ${bossCard.name}`);
  return activeWorldBoss;
}

async function processWorldBossTick() {
  if (!activeWorldBoss) return;
  const worldBoss = activeWorldBoss;

  if (worldBoss.participants.size === 0) {
    await updateWorldBossMessage();
    return;
  }

  let totalDamage = 0;
  const damageLines = [];

  for (const [userId, participant] of worldBoss.participants.entries()) {
    const teamCards = getTeamCards(userId);
    const damage = calculateParticipantDamage(teamCards);
    participant.totalDamage = (participant.totalDamage || 0) + damage;
    participant.lastDamage = damage;
    totalDamage += damage;
    damageLines.push(`${participant.username}: ${damage}`);
  }

  worldBoss.hp = Math.max(0, worldBoss.hp - totalDamage);
  worldBoss.lastDamageLines = damageLines
    .sort((a, b) => Number(b.split(': ')[1]) - Number(a.split(': ')[1]))
    .slice(0, 5);

  if (worldBoss.hp <= 0) {
    await finishWorldBoss(true);
    return;
  }

  await updateWorldBossMessage();
}

async function finishWorldBoss(victory) {
  if (!activeWorldBoss) return;

  const worldBoss = activeWorldBoss;
  activeWorldBoss = null;

  if (worldBoss.tickTimer) clearInterval(worldBoss.tickTimer);
  if (worldBoss.endTimer) clearTimeout(worldBoss.endTimer);

  const channel = worldBoss.client.channels.cache.get(worldBoss.channelId);
  if (!channel) return;

  const participantViews = await buildParticipantViews(worldBoss);
  const resultImage = await imageGenerator().generateWorldBossImage(
    worldBoss.bossCard,
    victory ? 0 : worldBoss.hp,
    worldBoss.maxHp,
    participantViews,
    worldBoss.endTime,
    worldBoss.lastDamageLines,
    victory ? 'VICTOIRE' : 'DEFAITE'
  );
  const attachment = new AttachmentBuilder(resultImage, { name: 'world_boss_result.png' });

  const mentions = Array.from(worldBoss.participants.keys()).map((id) => `<@${id}>`).join(' ');
  const topDamage = participantViews.slice(0, 5)
    .map((p, index) => `${index + 1}. **${p.username}** — ${p.totalDamage.toLocaleString('fr-FR')} dégâts`)
    .join('\n') || 'Aucun participant.';

  const embed = new EmbedBuilder()
    .setColor(victory ? '#2ECC71' : '#E74C3C')
    .setTitle(victory ? 'World Boss vaincu !' : 'World Boss échoué...')
    .setDescription(
      `**Boss:** ${worldBoss.bossCard.name}\n` +
      `**HP restant:** ${Math.max(0, worldBoss.hp).toLocaleString('fr-FR')} / ${worldBoss.maxHp.toLocaleString('fr-FR')}\n` +
      `**Participants:** ${worldBoss.participants.size}\n\n` +
      `**Top dégâts:**\n${topDamage}`
    )
    .setImage('attachment://world_boss_result.png');

  try {
    const message = await channel.messages.fetch({ message: worldBoss.messageId, cache: false });
    await message.edit({ components: [] });
  } catch (error) {
    console.error('Erreur lors de la fermeture du message World Boss:', error);
  }

  await channel.send({
    content: victory
      ? `${mentions}\nVictoire ! Le World Boss est tombé !`
      : `${mentions}\nDéfaite... Le World Boss s'est enfui.`,
    embeds: [embed],
    files: [attachment],
  });
}

async function handleWorldBossJoin(interaction) {
  if (!activeWorldBoss) {
    return interaction.reply({
      content: '❌ Aucun World Boss actif.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const userId = interaction.user.id;

  const { hasActiveSafari } = require('./safariHandler');
  if (hasActiveSafari(userId)) {
    return interaction.reply({
      content: '❌ Vous êtes en safari ! Terminez votre safari avant de rejoindre le World Boss.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const { hasActiveWild } = require('./wildHandler');
  if (hasActiveWild(userId)) {
    return interaction.reply({
      content: '❌ Vous êtes en aventure Wild ! Terminez votre aventure avant de rejoindre le World Boss.',
      flags: MessageFlags.Ephemeral,
    });
  }

  if (!hasTeamMember(userId)) {
    return interaction.reply({
      content: '❌ Vous devez avoir au moins un Pokémon dans votre équipe. Utilisez `/team`.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const alreadyJoined = activeWorldBoss.participants.has(userId);
  activeWorldBoss.participants.set(userId, {
    username: interaction.user.username,
    avatarURL: interaction.user.displayAvatarURL({ extension: 'png', size: 64 }),
    totalDamage: activeWorldBoss.participants.get(userId)?.totalDamage || 0,
  });

  await interaction.reply({
    content: alreadyJoined
      ? '✅ Votre équipe a été mise à jour pour le World Boss.'
      : '⚔️ Vous avez rejoint le World Boss !',
    flags: MessageFlags.Ephemeral,
  });

  await updateWorldBossMessage();
}

async function handleForceEventCommand(interaction) {
  const adminId = interaction.user.id;

  if (!ADMIN_WHITELIST.includes(adminId)) {
    return interaction.reply({
      content: "❌ Vous n'avez pas la permission d'utiliser cette commande.",
      flags: MessageFlags.Ephemeral,
    });
  }

  if (activeWorldBoss) {
    return interaction.reply({
      content: '❌ Un World Boss est déjà en cours.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const { hasActiveRaid } = require('./raidHandler');
  const { hasActiveExpedition } = require('./expeditionHandler');
  if (hasActiveRaid() || hasActiveExpedition()) {
    return interaction.reply({
      content: '❌ Un raid ou une expédition est déjà en cours.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const sessionId = makeSessionId(adminId);
  pickerSessions.set(sessionId, {
    userId: adminId,
    boosterId: 'all',
    rarity: 'all',
    query: '',
    page: 0,
    selectedCardId: null,
  });

  await interaction.reply({
    ...createPickerPayload(sessionId),
    flags: MessageFlags.Ephemeral,
  });
}

async function handleWorldBossSelectMenu(interaction) {
  const customId = interaction.customId;
  let sessionId;

  if (customId.startsWith('worldboss_booster_select_')) {
    sessionId = customId.replace('worldboss_booster_select_', '');
  } else if (customId.startsWith('worldboss_rarity_select_')) {
    sessionId = customId.replace('worldboss_rarity_select_', '');
  } else if (customId.startsWith('worldboss_card_select_')) {
    sessionId = customId.replace('worldboss_card_select_', '');
  }

  const { session, error } = getSessionFromInteraction(interaction, sessionId);
  if (error) {
    return interaction.reply({ content: error, flags: MessageFlags.Ephemeral });
  }

  if (customId.startsWith('worldboss_booster_select_')) {
    session.boosterId = interaction.values[0];
    session.page = 0;
    session.selectedCardId = null;
    return interaction.update(createPickerPayload(sessionId));
  }

  if (customId.startsWith('worldboss_rarity_select_')) {
    session.rarity = interaction.values[0];
    session.page = 0;
    session.selectedCardId = null;
    return interaction.update(createPickerPayload(sessionId));
  }

  if (customId.startsWith('worldboss_card_select_')) {
    session.selectedCardId = interaction.values[0];
    return interaction.update(createPreviewPayload(sessionId));
  }
}

async function handleWorldBossButton(interaction) {
  const customId = interaction.customId;

  if (customId === 'worldboss_join') {
    return handleWorldBossJoin(interaction);
  }

  const sessionId = customId.split('_').pop();
  const { session, error } = getSessionFromInteraction(interaction, sessionId);
  if (error) {
    return interaction.reply({ content: error, flags: MessageFlags.Ephemeral });
  }

  if (customId.startsWith('worldboss_page_prev_')) {
    session.page = Math.max(0, session.page - 1);
    return interaction.update(createPickerPayload(sessionId));
  }

  if (customId.startsWith('worldboss_page_next_')) {
    session.page += 1;
    return interaction.update(createPickerPayload(sessionId));
  }

  if (customId.startsWith('worldboss_reset_')) {
    session.boosterId = 'all';
    session.rarity = 'all';
    session.query = '';
    session.page = 0;
    session.selectedCardId = null;
    return interaction.update(createPickerPayload(sessionId));
  }

  if (customId.startsWith('worldboss_back_')) {
    return interaction.update(createPickerPayload(sessionId));
  }

  if (customId.startsWith('worldboss_close_')) {
    pickerSessions.delete(sessionId);
    return interaction.update({
      embeds: [new EmbedBuilder().setColor('#888888').setDescription('Session World Boss fermée.')],
      components: [],
      files: [],
    });
  }

  if (customId.startsWith('worldboss_start_')) {
    if (!session.selectedCardId) {
      return interaction.reply({
        content: '❌ Sélectionnez une carte avant de lancer le World Boss.',
        flags: MessageFlags.Ephemeral,
      });
    }

    if (activeWorldBoss) {
      return interaction.reply({
        content: '❌ Un World Boss est déjà en cours.',
        flags: MessageFlags.Ephemeral,
      });
    }

    const bossCard = getCardInfo(session.selectedCardId);
    if (!bossCard) {
      return interaction.reply({
        content: '❌ Cette carte est introuvable.',
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.update({
      embeds: [new EmbedBuilder().setColor('#8E5CFF').setDescription(`⚔️ Lancement du World Boss **${bossCard.name}**...`)],
      components: [],
      files: [],
    });

    try {
      await startWorldBoss(interaction.client, bossCard);
      pickerSessions.delete(sessionId);
    } catch (error) {
      console.error('Erreur lors du lancement du World Boss:', error);
      await interaction.followUp({
        content: '❌ Impossible de lancer le World Boss.',
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}

async function handleWorldBossSearchModal(interaction) {
  const sessionId = interaction.customId.replace('search_worldboss_', '');
  const { session, error } = getSessionFromInteraction(interaction, sessionId);
  if (error) {
    return interaction.reply({ content: error, flags: MessageFlags.Ephemeral });
  }

  session.query = interaction.fields.getTextInputValue('search_input').trim();
  session.page = 0;
  session.selectedCardId = null;

  await interaction.deferUpdate();
  await interaction.editReply(createPickerPayload(sessionId));
}

function hasActiveWorldBoss() {
  return activeWorldBoss !== null;
}

module.exports = {
  handleForceEventCommand,
  handleWorldBossSelectMenu,
  handleWorldBossButton,
  handleWorldBossSearchModal,
  hasActiveWorldBoss,
};
