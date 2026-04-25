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
  getItemCount,
  addCardToUser,
} = require('../../services/userManager');
const { getCardInfo } = require('../../services/cardGenerator');
const {
  generateSafariProgressImage,
  generateSafariResultImage,
} = require('../../services/imageGenerator');
const cards = require('../../../data/cards.json');
const rarities = require('../../../data/rarities.json');

// Active safaris per user (personal, not global)
const activeSafaris = new Map();

const SAFARI_DURATION = 10 * 60 * 1000; // 10 minutes
const TOTAL_ENCOUNTERS = 5;
const ENCOUNTER_INTERVAL = SAFARI_DURATION / TOTAL_ENCOUNTERS; // 2min between encounters, last one at 10min

// Safari zones (thematic areas to explore)
const SAFARI_ZONES = [
  { id: 'tall_grass', name: 'Hautes Herbes', emoji: '🌿', color: '#2ECC71' },
  { id: 'lake', name: 'Lac Secret', emoji: '💧', color: '#3498DB' },
  { id: 'cave', name: 'Grotte Cachée', emoji: '🪨', color: '#8E44AD' },
  { id: 'clearing', name: 'Clairière Ensoleillée', emoji: '☀️', color: '#F39C12' },
  { id: 'swamp', name: 'Marécage Brumeux', emoji: '🌫️', color: '#1ABC9C' },
];

// Catch rates per rarity
const CATCH_RATES = {
  common: 0.90,
  uncommon: 0.70,
  rare: 0.45,
  legendary: 0.30,
};

// Rarity weights for safari encounters (same as booster system)
const RARITY_WEIGHTS = {
  common: 0.54,
  uncommon: 0.28,
  rare: 0.14,
  legendary: 0.04,
};

/**
 * Get all cards the user does NOT own, grouped by rarity
 */
function getMissingCardsByRarity(userId) {
  const userData = loadUserData(userId);
  const missing = {};

  for (const [cardId, card] of Object.entries(cards)) {
    // Skip promo cards
    if (card.isPromo) continue;
    // Skip cards user already owns
    if (userData.cards[cardId] && userData.cards[cardId] > 0) continue;

    const rarity = card.rarity;
    if (!missing[rarity]) missing[rarity] = [];
    missing[rarity].push(card);
  }

  return missing;
}

/**
 * Get ALL non-promo cards grouped by rarity (for fallback when user owns everything)
 */
function getAllCardsByRarity() {
  const all = {};
  for (const [, card] of Object.entries(cards)) {
    if (card.isPromo) continue;
    const rarity = card.rarity;
    if (!all[rarity]) all[rarity] = [];
    all[rarity].push(card);
  }
  return all;
}

/**
 * Safari becomes more targeted as the user's collection nears completion.
 */
function getMissingPreference(totalMissing) {
  if (totalMissing <= 2) return 0.95;
  if (totalMissing <= 5) return 0.85;
  if (totalMissing <= 10) return 0.75;
  if (totalMissing <= 25) return 0.65;
  return 0.50;
}

/**
 * Select a rarity based on weighted probabilities
 */
function selectSafariRarity(availableRarities) {
  const weights = {};
  let totalWeight = 0;

  for (const rarity of availableRarities) {
    const w = RARITY_WEIGHTS[rarity] || 0;
    if (w > 0) {
      weights[rarity] = w;
      totalWeight += w;
    }
  }

  if (totalWeight === 0) return availableRarities[0] || 'common';

  const rand = Math.random();
  let cumulative = 0;
  for (const [rarity, weight] of Object.entries(weights)) {
    cumulative += weight / totalWeight;
    if (rand < cumulative) return rarity;
  }

  return availableRarities[0] || 'common';
}

/**
 * Run a single safari encounter
 */
function runEncounter(userId) {
  const missingByRarity = getMissingCardsByRarity(userId);
  const allByRarity = getAllCardsByRarity();

  // Available rarities (from all cards, not just missing)
  const allRarities = Object.keys(allByRarity);
  const rarity = selectSafariRarity(allRarities);

  // Try to pick from missing cards first
  let card;
  let isNew = false;

  const totalMissing = Object.values(missingByRarity)
    .reduce((sum, pool) => sum + pool.length, 0);
  const hasMissing = missingByRarity[rarity] && missingByRarity[rarity].length > 0;
  const pickNew = hasMissing && Math.random() < getMissingPreference(totalMissing);

  if (pickNew) {
    // Completion roll won: pick a card the user doesn't have.
    const pool = missingByRarity[rarity];
    card = pool[Math.floor(Math.random() * pool.length)];
    isNew = true;
  } else if (allByRarity[rarity] && allByRarity[rarity].length > 0) {
    // Pick any card of this rarity (may or may not be new)
    const pool = allByRarity[rarity];
    card = pool[Math.floor(Math.random() * pool.length)];
    // Check if it happens to be new anyway
    const userData = loadUserData(userId);
    isNew = !userData.cards[String(card.id)] || userData.cards[String(card.id)] <= 0;
  } else {
    // User owns all cards of this rarity — pick any card (duplicate)
    const pool = allByRarity[rarity];
    if (pool && pool.length > 0) {
      card = pool[Math.floor(Math.random() * pool.length)];
    }
  }

  if (!card) return null;

  // Catch attempt
  const catchRate = CATCH_RATES[rarity] || 0.5;
  const caught = Math.random() < catchRate;

  return {
    card: getCardInfo(card.id),
    rarity,
    isNew,
    caught,
    catchRate: Math.round(catchRate * 100),
  };
}

/**
 * Process the next encounter for a safari
 */
async function processEncounter(safari) {
  const encounter = runEncounter(safari.userId);
  if (!encounter) return;

  safari.encounters.push(encounter);

  // If caught, add card to user
  if (encounter.caught) {
    addCardToUser(safari.userId, encounter.card.id);
    safari.cardsCaught.push(encounter.card);
  }

  // Pick a random zone for flavor
  const zone = SAFARI_ZONES[Math.floor(Math.random() * SAFARI_ZONES.length)];

  // Update the message with progress
  try {
    const channel = safari.client.channels.cache.get(safari.channelId);
    if (!channel) return;
    const message = await channel.messages.fetch(safari.messageId);

    const elapsed = Date.now() - safari.startTime;
    const progress = Math.min(elapsed / SAFARI_DURATION, 1.0);
    const timeRemaining = Math.max(0, Math.ceil((SAFARI_DURATION - elapsed) / 60000));

    const progressImage = await generateSafariProgressImage(
      safari.avatarURL,
      safari.username,
      progress,
      timeRemaining,
      safari.encounters,
      TOTAL_ENCOUNTERS
    );

    const attachment = new AttachmentBuilder(progressImage, { name: 'safari.png' });

    // Build encounter log
    const encounterLines = safari.encounters.map((enc, i) => {
      const zoneEmoji = SAFARI_ZONES[i % SAFARI_ZONES.length].emoji;
      const rarityData = rarities[enc.rarity];
      const rarityName = rarityData?.name || enc.rarity;
      if (enc.caught) {
        return `${zoneEmoji} **${enc.card.name}** (${rarityName}) — ✅ Capturé !${enc.isNew ? ' 🆕' : ''}`;
      } else {
        return `${zoneEmoji} **${enc.card.name}** (${rarityName}) — ❌ Échappé... (${enc.catchRate}%)`;
      }
    });

    const embed = new EmbedBuilder()
      .setColor('#2ECC71')
      .setTitle(`🌿 Safari de ${safari.username}`)
      .setDescription(
        `**Rencontres:** ${safari.encounters.length}/${TOTAL_ENCOUNTERS}\n` +
        `**Capturés:** ${safari.cardsCaught.length}\n\n` +
        encounterLines.join('\n') +
        `\n\nTemps restant: **${timeRemaining} min**`
      )
      .setImage('attachment://safari.png');

    await message.edit({
      embeds: [embed],
      files: [attachment],
      components: message.components,
    });
  } catch (error) {
    console.error('Erreur lors de la mise à jour du safari:', error);
  }
}

/**
 * End the safari and show results
 */
async function endSafari(userId) {
  const safari = activeSafaris.get(userId);
  if (!safari) return;

  // Clear timers
  if (safari.encounterTimer) clearInterval(safari.encounterTimer);
  if (safari.endTimer) clearTimeout(safari.endTimer);
  activeSafaris.delete(userId);

  try {
    const channel = safari.client.channels.cache.get(safari.channelId);
    if (!channel) return;

    // Process any remaining encounters
    while (safari.encounters.length < TOTAL_ENCOUNTERS) {
      const encounter = runEncounter(userId);
      if (!encounter) break;
      safari.encounters.push(encounter);
      if (encounter.caught) {
        addCardToUser(userId, encounter.card.id);
        safari.cardsCaught.push(encounter.card);
      }
    }

    // Generate result image
    const resultImage = await generateSafariResultImage(
      safari.avatarURL,
      safari.username,
      safari.encounters,
      safari.cardsCaught
    );
    const attachment = new AttachmentBuilder(resultImage, { name: 'safari_result.png' });

    // Build recap
    const encounterLines = safari.encounters.map((enc, i) => {
      const zoneEmoji = SAFARI_ZONES[i % SAFARI_ZONES.length].emoji;
      const rarityData = rarities[enc.rarity];
      const rarityName = rarityData?.name || enc.rarity;
      if (enc.caught) {
        return `${zoneEmoji} **${enc.card.name}** (${rarityName}) — ✅ Capturé !${enc.isNew ? ' 🆕' : ''}`;
      } else {
        return `${zoneEmoji} **${enc.card.name}** (${rarityName}) — ❌ Échappé...`;
      }
    });

    const newCards = safari.cardsCaught.filter((_, i) => {
      const enc = safari.encounters.find(e => e.caught && e.card.id === safari.cardsCaught[i].id);
      return enc?.isNew;
    });

    let resultTitle;
    if (safari.cardsCaught.length >= 4) {
      resultTitle = '🌟 Safari Exceptionnel !';
    } else if (safari.cardsCaught.length >= 2) {
      resultTitle = '✨ Bon Safari !';
    } else if (safari.cardsCaught.length === 1) {
      resultTitle = '👍 Safari Correct';
    } else {
      resultTitle = '😔 Safari Bredouille...';
    }

    const resultEmbed = new EmbedBuilder()
      .setColor(safari.cardsCaught.length > 0 ? '#FFD700' : '#E74C3C')
      .setTitle(resultTitle)
      .setDescription(
        `**Safari de ${safari.username} terminé !**\n\n` +
        `**Rencontres:** ${safari.encounters.length}\n` +
        `**Capturés:** ${safari.cardsCaught.length}/${safari.encounters.length}\n` +
        (newCards.length > 0 ? `**Nouvelles cartes:** ${newCards.length} 🆕\n` : '') +
        `\n${encounterLines.join('\n')}`
      )
      .setImage('attachment://safari_result.png');

    // Edit original message to remove button
    try {
      const message = await channel.messages.fetch(safari.messageId);
      await message.edit({ components: [] });
    } catch { /* message may be deleted */ }

    await channel.send({
      content: `<@${userId}> Votre safari est terminé !`,
      embeds: [resultEmbed],
      files: [attachment],
    });

  } catch (error) {
    console.error('Erreur lors de la fin du safari:', error);
    activeSafaris.delete(userId);
  }
}

/**
 * Check if a user has an active safari
 */
function hasActiveSafari(userId) {
  return activeSafaris.has(userId);
}

/**
 * Start a safari from the inventory menu
 * Called from shopHandler when user clicks "Utiliser" on a safari ticket
 */
async function handleSafariFromInventory(interaction, ownerId) {
  const userId = ownerId;

  // Check if already in safari
  if (activeSafaris.has(userId)) {
    return interaction.update({
      embeds: [new EmbedBuilder().setColor('#E74C3C').setDescription('❌ Vous êtes déjà en safari ! Attendez la fin de votre safari actuel.')],
      components: [],
      files: []
    });
  }

  // Block safari during active raid/expedition
  const { hasActiveRaid } = require('./raidHandler');
  const { hasActiveExpedition } = require('./expeditionHandler');

  if (hasActiveRaid() || hasActiveExpedition()) {
    return interaction.update({
      embeds: [new EmbedBuilder().setColor('#E74C3C').setDescription('❌ Un raid ou une expédition est en cours ! Attendez la fin avant de partir en safari.')],
      components: [],
      files: []
    });
  }

  // Consume the ticket
  const consumed = removeItemFromInventory(userId, 'safari_ticket');
  if (!consumed) {
    return interaction.update({
      embeds: [new EmbedBuilder().setColor('#E74C3C').setDescription('❌ Vous n\'avez pas de **Ticket Safari** !')],
      components: [],
      files: []
    });
  }

  const avatarURL = interaction.user.displayAvatarURL({ extension: 'png', size: 64 });
  const username = interaction.user.username;

  // Generate initial image
  const progressImage = await generateSafariProgressImage(
    avatarURL,
    username,
    0,
    Math.ceil(SAFARI_DURATION / 60000),
    [],
    TOTAL_ENCOUNTERS
  );

  const attachment = new AttachmentBuilder(progressImage, { name: 'safari.png' });

  const embed = new EmbedBuilder()
    .setColor('#2ECC71')
    .setTitle(`🌿 Safari de ${username}`)
    .setDescription(
      `Votre aventure Safari commence !\n\n` +
      `Vous allez explorer la zone et rencontrer **${TOTAL_ENCOUNTERS} Pokémon**.\n` +
      `Les Pokémon que vous ne possédez pas ont plus de chances d'apparaître !\n\n` +
      `**Taux de capture:**\n` +
      `• Commun: 85% • Peu commun: 60%\n` +
      `• Rare: 35% • Légendaire: 12%\n\n` +
      `Temps restant: **${Math.ceil(SAFARI_DURATION / 60000)} min**`
    )
    .setImage('attachment://safari.png')
    .setFooter({ text: 'Les rencontres apparaîtront au fur et à mesure !' });

  const cancelButton = new ButtonBuilder()
    .setCustomId(`safari_cancel_${userId}`)
    .setLabel('Quitter le Safari')
    .setStyle(ButtonStyle.Danger)
    .setEmoji('🚪');

  const row = new ActionRowBuilder().addComponents(cancelButton);

  // Update the inventory message to show safari launching, then send a new safari message
  await interaction.update({
    embeds: [new EmbedBuilder().setColor('#2ECC71').setDescription('🌿 Safari lancé ! Regardez le message ci-dessous.')],
    components: [],
    files: []
  });

  const safariMessage = await interaction.channel.send({
    embeds: [embed],
    files: [attachment],
    components: [row],
  });

  // Create safari state
  const safari = {
    userId,
    username,
    avatarURL,
    channelId: interaction.channelId,
    messageId: safariMessage.id,
    client: interaction.client,
    startTime: Date.now(),
    encounters: [],
    cardsCaught: [],
    encounterTimer: null,
    endTimer: null,
  };

  activeSafaris.set(userId, safari);

  // Schedule encounters at regular intervals
  let encounterCount = 0;
  safari.encounterTimer = setInterval(async () => {
    encounterCount++;
    await processEncounter(safari);
    if (encounterCount >= TOTAL_ENCOUNTERS) {
      clearInterval(safari.encounterTimer);
    }
  }, ENCOUNTER_INTERVAL);

  // Schedule end of safari
  safari.endTimer = setTimeout(() => endSafari(userId), SAFARI_DURATION);

  console.log(`Safari démarré pour ${username} (${userId})`);
}

/**
 * Handle safari buttons
 */
async function handleSafariButton(interaction) {
  const customId = interaction.customId;

  if (customId.startsWith('safari_cancel_')) {
    const safariUserId = customId.split('_')[2];

    if (interaction.user.id !== safariUserId) {
      return interaction.reply({
        content: '❌ Ce n\'est pas votre safari !',
        flags: MessageFlags.Ephemeral,
      });
    }

    const safari = activeSafaris.get(safariUserId);
    if (!safari) {
      return interaction.reply({
        content: '❌ Aucun safari actif trouvé.',
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferUpdate();
    await endSafari(safariUserId);
  }
}

module.exports = {
  handleSafariFromInventory,
  handleSafariButton,
  hasActiveSafari,
};
