const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  AttachmentBuilder,
  MessageFlags,
} = require('discord.js');
const {
  loadUserData,
  removeItemFromInventory,
  addCardToUser,
} = require('../../services/userManager');
const { getCardInfo } = require('../../services/cardGenerator');
const cards = require('../../../data/cards.json');

const activeWildAdventures = new Map();

const WILD_BOOSTER_ID = 'wild_1';
const WILD_DURATION = 5 * 60 * 1000;
const PROGRESS_UPDATE_INTERVAL = 60 * 1000;

function imageGenerator() {
  return require('../../services/imageGenerator');
}

function createWildCancelRow(userId) {
  const cancelButton = new ButtonBuilder()
    .setCustomId(`wild_cancel_${userId}`)
    .setLabel('Quitter l\'aventure')
    .setStyle(ButtonStyle.Danger)
    .setEmoji('🚪');

  return new ActionRowBuilder().addComponents(cancelButton);
}

function getWildCards() {
  return Object.values(cards).filter((card) => card.isWild && String(card.boosterPackId) === WILD_BOOSTER_ID);
}

function pickRandomCard(pool) {
  if (!pool.length) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

function userOwnsCard(userData, cardId) {
  return (userData.cards[String(cardId)] || 0) > 0;
}

function selectWildCardForUser(userId) {
  const wildCards = getWildCards();
  if (wildCards.length === 0) return null;

  const userData = loadUserData(userId);
  const firstRoll = pickRandomCard(wildCards);
  if (!firstRoll) return null;

  if (!userOwnsCard(userData, firstRoll.id)) {
    return { card: getCardInfo(firstRoll.id), rollCount: 1 };
  }

  const secondPool = wildCards.length > 1
    ? wildCards.filter((card) => String(card.id) !== String(firstRoll.id))
    : wildCards;
  const secondRoll = pickRandomCard(secondPool) || firstRoll;

  return { card: getCardInfo(secondRoll.id), rollCount: 2 };
}

async function updateWildProgress(adventure) {
  try {
    const channel = adventure.client.channels.cache.get(adventure.channelId);
    if (!channel) return;

    const message = await channel.messages.fetch({ message: adventure.messageId, cache: false });
    const elapsed = Date.now() - adventure.startTime;
    const progress = Math.min(elapsed / WILD_DURATION, 1);
    const timeRemaining = Math.max(0, Math.ceil((WILD_DURATION - elapsed) / 60000));
    const endTimestamp = Math.floor((adventure.startTime + WILD_DURATION) / 1000);

    const progressImage = await imageGenerator().generateWildProgressImage(
      adventure.avatarURL,
      adventure.username,
      progress,
      timeRemaining
    );
    const attachment = new AttachmentBuilder(progressImage, { name: 'wild.png' });

    const embed = new EmbedBuilder()
      .setColor('#8E5CFF')
      .setTitle(`Aventure Wild de ${adventure.username}`)
      .setDescription(
        `Une présence mystique vous accompagne...\n\n` +
        `Le Pokémon restera inconnu jusqu'à la fin de l'aventure.\n` +
        `Capture garantie <t:${endTimestamp}:R>.`
      )
      .setImage('attachment://wild.png');

    await message.edit({
      embeds: [embed],
      files: [attachment],
      components: message.components,
    });
  } catch (error) {
    console.error('Erreur lors de la mise à jour de l\'aventure Wild:', error);
  }
}

async function endWildAdventure(userId) {
  const adventure = activeWildAdventures.get(userId);
  if (!adventure) return;

  if (adventure.progressTimer) clearInterval(adventure.progressTimer);
  if (adventure.endTimer) clearTimeout(adventure.endTimer);
  activeWildAdventures.delete(userId);

  try {
    const channel = adventure.client.channels.cache.get(adventure.channelId);
    if (!channel) return;

    const userDataBeforeAward = loadUserData(userId);
    const isNew = !userOwnsCard(userDataBeforeAward, adventure.card.id);
    addCardToUser(userId, adventure.card.id);

    const resultImage = await imageGenerator().generateWildResultImage(
      adventure.avatarURL,
      adventure.username,
      adventure.card,
      isNew
    );
    const attachment = new AttachmentBuilder(resultImage, { name: 'wild_result.png' });

    const resultEmbed = new EmbedBuilder()
      .setColor(adventure.card.rarityColor)
      .setTitle('Capture Wild réussie !')
      .setDescription(
        `**${adventure.username}** a capturé **${adventure.card.name}** !\n\n` +
        `**Rareté:** ${adventure.card.rarityName}\n` +
        (isNew ? `**Nouvelle carte:** Oui 🆕\n` : '') +
        `**Ticket utilisé:** Ticket Mystique`
      )
      .setImage('attachment://wild_result.png');

    try {
      const message = await channel.messages.fetch({ message: adventure.messageId, cache: false });
      await message.edit({ components: [] });
    } catch { /* message may be deleted */ }

    await channel.send({
      content: `<@${userId}> Votre aventure Wild est terminée !`,
      embeds: [resultEmbed],
      files: [attachment],
    });
  } catch (error) {
    console.error('Erreur lors de la fin de l\'aventure Wild:', error);
    activeWildAdventures.delete(userId);
  }
}

async function cancelWildAdventure(userId) {
  const adventure = activeWildAdventures.get(userId);
  if (!adventure) return false;

  if (adventure.progressTimer) clearInterval(adventure.progressTimer);
  if (adventure.endTimer) clearTimeout(adventure.endTimer);
  activeWildAdventures.delete(userId);

  try {
    const channel = adventure.client.channels.cache.get(adventure.channelId);
    if (!channel) return true;

    try {
      const message = await channel.messages.fetch({ message: adventure.messageId, cache: false });
      await message.edit({ components: [] });
    } catch { /* message may be deleted */ }

    await channel.send({
      content: `<@${userId}> Vous avez quitté l'aventure Wild. Le Pokémon mystère s'est évanoui dans la brume...`,
    });
  } catch (error) {
    console.error('Erreur lors de l\'annulation de l\'aventure Wild:', error);
  }

  return true;
}

function hasActiveWild(userId) {
  return activeWildAdventures.has(userId);
}

async function handleWildFromInventory(interaction, ownerId) {
  const userId = ownerId;

  if (activeWildAdventures.has(userId)) {
    return interaction.update({
      embeds: [new EmbedBuilder().setColor('#E74C3C').setDescription('❌ Vous êtes déjà en aventure Wild ! Attendez la fin de votre aventure actuelle.')],
      components: [],
      files: [],
    });
  }

  const { hasActiveSafari } = require('./safariHandler');
  if (hasActiveSafari(userId)) {
    return interaction.update({
      embeds: [new EmbedBuilder().setColor('#E74C3C').setDescription('❌ Vous êtes déjà en safari ! Terminez votre safari avant de partir en aventure Wild.')],
      components: [],
      files: [],
    });
  }

  const { hasActiveRaid } = require('./raidHandler');
  const { hasActiveExpedition } = require('./expeditionHandler');

  if (hasActiveRaid() || hasActiveExpedition()) {
    return interaction.update({
      embeds: [new EmbedBuilder().setColor('#E74C3C').setDescription('❌ Un raid ou une expédition est en cours ! Attendez la fin avant de partir en aventure Wild.')],
      components: [],
      files: [],
    });
  }

  const selected = selectWildCardForUser(userId);
  if (!selected?.card) {
    return interaction.update({
      embeds: [new EmbedBuilder().setColor('#E74C3C').setDescription('❌ Aucune carte Wild disponible pour le moment.')],
      components: [],
      files: [],
    });
  }

  const consumed = removeItemFromInventory(userId, 'mystic_ticket');
  if (!consumed) {
    return interaction.update({
      embeds: [new EmbedBuilder().setColor('#E74C3C').setDescription('❌ Vous n\'avez pas de **Ticket Mystique** !')],
      components: [],
      files: [],
    });
  }

  const avatarURL = interaction.user.displayAvatarURL({ extension: 'png', size: 64 });
  const username = interaction.user.username;
  const endTimestamp = Math.floor((Date.now() + WILD_DURATION) / 1000);

  const progressImage = await imageGenerator().generateWildProgressImage(
    avatarURL,
    username,
    0,
    Math.ceil(WILD_DURATION / 60000)
  );
  const attachment = new AttachmentBuilder(progressImage, { name: 'wild.png' });

  const embed = new EmbedBuilder()
    .setColor('#8E5CFF')
    .setTitle(`Aventure Wild de ${username}`)
    .setDescription(
      `Le Ticket Mystique se consume...\n\n` +
      `Vous partez pour **5 minutes** et rencontrerez **un seul Pokémon**.\n` +
      `Son identité restera inconnue jusqu'à la fin.\n` +
      `Capture garantie <t:${endTimestamp}:R>.`
    )
    .setImage('attachment://wild.png')
    .setFooter({ text: 'Quitter met fin à l\'aventure sans révéler le Pokémon mystère.' });

  await interaction.update({
    embeds: [new EmbedBuilder().setColor('#8E5CFF').setDescription('🔮 Aventure Wild lancée ! Regardez le message ci-dessous.')],
    components: [],
    files: [],
  });

  const wildMessage = await interaction.channel.send({
    embeds: [embed],
    files: [attachment],
    components: [createWildCancelRow(userId)],
  });

  const adventure = {
    userId,
    username,
    avatarURL,
    channelId: interaction.channelId,
    messageId: wildMessage.id,
    client: interaction.client,
    startTime: Date.now(),
    card: selected.card,
    rollCount: selected.rollCount,
    progressTimer: null,
    endTimer: null,
  };

  activeWildAdventures.set(userId, adventure);

  adventure.progressTimer = setInterval(() => updateWildProgress(adventure), PROGRESS_UPDATE_INTERVAL);
  adventure.endTimer = setTimeout(() => endWildAdventure(userId), WILD_DURATION);

  console.log(`Aventure Wild démarrée pour ${username} (${userId})`);
}

async function handleWildButton(interaction) {
  const customId = interaction.customId;

  if (customId.startsWith('wild_cancel_')) {
    const wildUserId = customId.split('_')[2];

    if (interaction.user.id !== wildUserId) {
      return interaction.reply({
        content: '❌ Ce n\'est pas votre aventure Wild !',
        flags: MessageFlags.Ephemeral,
      });
    }

    const adventure = activeWildAdventures.get(wildUserId);
    if (!adventure) {
      return interaction.reply({
        content: '❌ Aucune aventure Wild active trouvée.',
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferUpdate();
    await cancelWildAdventure(wildUserId);
  }
}

module.exports = {
  handleWildFromInventory,
  handleWildButton,
  hasActiveWild,
};
