const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require('discord.js');
const { drawBoosterPack, getCardInfo } = require('../../services/cardGenerator').default;
const { canOpenBooster, addCardsToUser, loadUserData, saveUserData, getBoosterInventory, removeBoosterFromInventory, getMoney } = require('../../services/userManager');
const { generateBoosterOpeningImage } = require('../../services/imageGenerator');
const boosters = require('../../../data/boosters.json');
const path = require('node:path');
const fs = require('node:fs');

const ASSETS_DIR = path.join(__dirname, '../../../assets');
const CURRENCY_SYMBOL = 'P';

/**
 * Obtient les boosters ouvrables (non-promo)
 */
function getOpenableBoosters() {
  return Object.values(boosters).filter(b => !b.isPromo && b.cardsPerPack > 0);
}

/**
 * Verifie que l'utilisateur qui interagit est le proprietaire
 */
async function verifyOwner(interaction, ownerId) {
  if (interaction.user.id !== ownerId) {
    await interaction.reply({
      content: '❌ Cette interaction ne vous appartient pas.',
      ephemeral: true
    });
    return false;
  }
  return true;
}

/**
 * Gere la commande /booster - Affiche la selection de boosters
 */
async function handleBoosterCommand(interaction) {
  const userId = interaction.user.id;
  const canOpen = canOpenBooster(userId);
  const inventory = getBoosterInventory(userId);
  const userMoney = getMoney(userId);

  const openableBoosters = getOpenableBoosters();

  // Construire la description
  let description = `**Votre solde:** ${userMoney.toLocaleString('fr-FR')} ${CURRENCY_SYMBOL}\n\n`;

  if (canOpen) {
    description += '🎁 **Booster quotidien disponible !**\nChoisissez un booster a ouvrir gratuitement.\n\n';
  } else {
    description += '⏰ Booster quotidien deja ouvert aujourd\'hui.\n\n';
  }

  // Afficher l'inventaire si non vide
  const inventoryLines = [];
  for (const [boosterId, quantity] of Object.entries(inventory)) {
    if (quantity > 0 && boosters[boosterId] && !boosters[boosterId].isPromo) {
      inventoryLines.push(`• **${boosters[boosterId].name}** x${quantity}`);
    }
  }

  if (inventoryLines.length > 0) {
    description += `📦 **Boosters en inventaire:**\n${inventoryLines.join('\n')}\n\n`;
  }

  description += 'Selectionnez un booster ci-dessous pour l\'ouvrir.';

  const embed = new EmbedBuilder()
    .setColor('#FFD700')
    .setTitle('Ouvrir un Booster')
    .setDescription(description);

  // Creer les options du menu
  const boosterOptions = [];

  for (const booster of openableBoosters) {
    const inInventory = inventory[String(booster.id)] || 0;

    const label = booster.name;
    let descText = `${booster.totalCards} cartes`;
    let emoji = '📦';

    if (canOpen) {
      descText += ' • Quotidien gratuit';
      emoji = '🎁';
    } else if (inInventory > 0) {
      descText += ` • ${inInventory} en stock`;
      emoji = '📦';
    } else {
      descText += ' • Aucun disponible';
      emoji = '🔒';
    }

    boosterOptions.push({
      label: label,
      description: descText,
      value: `open_booster_${booster.id}`,
      emoji: emoji
    });
  }

  // Limiter a 25 options maximum pour Discord
  const limitedOptions = boosterOptions.slice(0, 25);

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId(`booster_select_open_${userId}`)
    .setPlaceholder('Choisir un booster a ouvrir...')
    .addOptions(limitedOptions);

  const row = new ActionRowBuilder().addComponents(selectMenu);

  await interaction.reply({
    embeds: [embed],
    components: [row]
  });
}

/**
 * Affiche la previsualisation d'un booster avant ouverture
 */
async function showBoosterPreview(interaction, boosterId, ownerId) {
  const canOpen = canOpenBooster(ownerId);
  const inventory = getBoosterInventory(ownerId);
  const booster = boosters[boosterId];

  if (!booster || booster.isPromo) {
    return interaction.update({
      content: '❌ Ce booster n\'est pas disponible.',
      embeds: [],
      components: []
    });
  }

  const inInventory = inventory[String(boosterId)] || 0;
  if (!canOpen && inInventory === 0) {
    return interaction.update({
      content: '❌ Vous n\'avez pas de booster disponible ! Achetez-en dans la `/boutique` ou attendez minuit pour votre booster quotidien.',
      embeds: [],
      components: []
    });
  }

  // Charger l'image du booster
  const boosterImagePath = path.join(ASSETS_DIR, 'boosters', `booster_${boosterId}.png`);
  const files = [];

  const embed = new EmbedBuilder()
    .setColor('#FFD700')
    .setTitle(booster.name)
    .setDescription(
      `**Cartes par pack:** ${booster.cardsPerPack}\n` +
      `**Total de cartes:** ${booster.totalCards}\n` +
      `**Garantie:** ${booster.guarantees?.minRarity || 'Aucune'}\n\n` +
      (canOpen ? '🎁 Utilise ton **booster quotidien gratuit**' : `📦 Utilise un booster de ton **inventaire** (${inInventory} restant${inInventory > 1 ? 's' : ''})`) +
      '\n\nConfirmer l\'ouverture ?'
    );

  if (fs.existsSync(boosterImagePath)) {
    const attachment = new AttachmentBuilder(boosterImagePath, { name: 'booster.png' });
    files.push(attachment);
    embed.setThumbnail('attachment://booster.png');
  }

  const confirmButton = new ButtonBuilder()
    .setCustomId(`booster_confirm_open_${boosterId}_${ownerId}`)
    .setLabel('Ouvrir le booster !')
    .setStyle(ButtonStyle.Success)
    .setEmoji('🎴');

  const backButton = new ButtonBuilder()
    .setCustomId(`booster_back_select_${ownerId}`)
    .setLabel('Retour')
    .setStyle(ButtonStyle.Secondary);

  const row = new ActionRowBuilder().addComponents(confirmButton, backButton);

  await interaction.update({
    embeds: [embed],
    components: [row],
    files: files
  });
}

/**
 * Ouvre effectivement un booster
 */
async function openBooster(interaction, boosterId, ownerId) {
  const canOpen = canOpenBooster(ownerId);
  const inventory = getBoosterInventory(ownerId);
  const booster = boosters[boosterId];

  if (!booster || booster.isPromo) {
    return interaction.update({
      content: '❌ Ce booster n\'est pas disponible.',
      embeds: [],
      components: []
    });
  }

  const inInventory = inventory[String(boosterId)] || 0;
  const useDaily = canOpen;
  const useInventory = !canOpen && inInventory > 0;

  if (!useDaily && !useInventory) {
    return interaction.update({
      content: '❌ Vous n\'avez pas de booster disponible !',
      embeds: [],
      components: []
    });
  }

  await interaction.deferUpdate();

  try {
    // Consommer le booster
    if (useInventory) {
      const removed = removeBoosterFromInventory(ownerId, boosterId);
      if (!removed) {
        return interaction.editReply({
          content: '❌ Erreur lors de la consommation du booster.',
          embeds: [],
          components: []
        });
      }
    }

    // Tirer les cartes
    const { cards: cardIds, isGodPack } = drawBoosterPack(boosterId);

    // Ajouter les cartes a l'utilisateur (ceci met aussi a jour lastBoosterOpen si c'est le quotidien)
    if (useDaily) {
      addCardsToUser(ownerId, cardIds);
    } else {
      // Pour l'inventaire, on ajoute les cartes sans mettre a jour le cooldown
      const userData = loadUserData(ownerId);
      cardIds.forEach(cardId => {
        const id = String(cardId);
        userData.cards[id] = (userData.cards[id] || 0) + 1;
      });
      userData.stats.totalCards += cardIds.length;
      userData.stats.totalBoosters += 1;
      saveUserData(ownerId, userData);
    }

    // Generer l'image
    const imageBuffer = await generateBoosterOpeningImage(cardIds, isGodPack);
    const attachment = new AttachmentBuilder(imageBuffer, { name: 'booster.png' });

    // Preparer la description des cartes
    const cardDescriptions = cardIds.map(cardId => {
      const cardInfo = getCardInfo(cardId);
      return `**${cardInfo.name}** - ${cardInfo.rarityName}`;
    }).join('\n');

    const sourceText = useDaily ? 'Booster quotidien' : 'Booster de l\'inventaire';

    const embed = new EmbedBuilder()
      .setColor(isGodPack ? '#FF00FF' : '#FFD700')
      .setTitle(isGodPack ? '✨🌟 GOD PACK ! 🌟✨' : `${booster.name} Ouvert !`)
      .setDescription(
        `${isGodPack ? '**INCROYABLE ! Toutes les cartes sont au moins Rare !**\n\n' : ''}` +
        `*${sourceText}*\n\n` +
        `Vous avez recu les cartes suivantes :\n\n${cardDescriptions}`
      )
      .setImage('attachment://booster.png')
      .setFooter({ text: isGodPack ? 'Felicitations pour ce GOD PACK legendaire !' : (useDaily ? 'Revenez demain pour un nouveau booster gratuit !' : 'Achetez plus de boosters dans la /boutique !') });

    await interaction.editReply({
      embeds: [embed],
      files: [attachment],
      components: []
    });

  } catch (error) {
    console.error('Erreur lors de l\'ouverture du booster:', error);
    await interaction.editReply({
      content: '❌ Une erreur est survenue lors de l\'ouverture du booster.',
      embeds: [],
      components: []
    });
  }
}

/**
 * Gere la selection de booster a ouvrir
 */
async function handleBoosterSelectMenu(interaction) {
  const boosterId = interaction.values[0].replace('open_booster_', '');
  // Extraire l'ownerId du customId: booster_select_open_ownerId
  const parts = interaction.customId.split('_');
  const ownerId = parts[parts.length - 1];

  if (!await verifyOwner(interaction, ownerId)) {
    return;
  }

  await showBoosterPreview(interaction, boosterId, ownerId);
}

/**
 * Gere les boutons du booster
 */
async function handleBoosterButton(interaction) {
  const customId = interaction.customId;
  const parts = customId.split('_');
  const ownerId = parts[parts.length - 1];

  if (!await verifyOwner(interaction, ownerId)) {
    return;
  }

  if (customId.includes('_confirm_open_')) {
    // Format: booster_confirm_open_boosterId_ownerId
    const boosterId = parts[3];
    await openBooster(interaction, boosterId, ownerId);
  } else if (customId.startsWith('booster_back_select_')) {
    // Retour a la selection de booster
    const canOpen = canOpenBooster(ownerId);
    const inventory = getBoosterInventory(ownerId);
    const userMoney = getMoney(ownerId);

    const openableBoosters = getOpenableBoosters();

    let description = `**Votre solde:** ${userMoney.toLocaleString('fr-FR')} ${CURRENCY_SYMBOL}\n\n`;

    if (canOpen) {
      description += '🎁 **Booster quotidien disponible !**\nChoisissez un booster a ouvrir gratuitement.\n\n';
    } else {
      description += '⏰ Booster quotidien deja ouvert aujourd\'hui.\n\n';
    }

    const inventoryLines = [];
    for (const [boosterId, quantity] of Object.entries(inventory)) {
      if (quantity > 0 && boosters[boosterId] && !boosters[boosterId].isPromo) {
        inventoryLines.push(`• **${boosters[boosterId].name}** x${quantity}`);
      }
    }

    if (inventoryLines.length > 0) {
      description += `📦 **Boosters en inventaire:**\n${inventoryLines.join('\n')}\n\n`;
    }

    description += 'Selectionnez un booster ci-dessous pour l\'ouvrir.';

    const embed = new EmbedBuilder()
      .setColor('#FFD700')
      .setTitle('Ouvrir un Booster')
      .setDescription(description);

    const boosterOptions = [];

    for (const booster of openableBoosters) {
      const inInventory = inventory[String(booster.id)] || 0;

      let descText = `${booster.totalCards} cartes`;
      let emoji = '📦';

      if (canOpen) {
        descText += ' • Quotidien gratuit';
        emoji = '🎁';
      } else if (inInventory > 0) {
        descText += ` • ${inInventory} en stock`;
        emoji = '📦';
      } else {
        descText += ' • Aucun disponible';
        emoji = '🔒';
      }

      boosterOptions.push({
        label: booster.name,
        description: descText,
        value: `open_booster_${booster.id}`,
        emoji: emoji
      });
    }

    const limitedOptions = boosterOptions.slice(0, 25);

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(`booster_select_open_${ownerId}`)
      .setPlaceholder('Choisir un booster a ouvrir...')
      .addOptions(limitedOptions);

    const row = new ActionRowBuilder().addComponents(selectMenu);

    await interaction.update({
      embeds: [embed],
      components: [row],
      files: []
    });
  }
}

module.exports = {
  handleBoosterCommand,
  handleBoosterSelectMenu,
  handleBoosterButton,
  verifyOwner,
  CURRENCY_SYMBOL,
  ASSETS_DIR,
  boosters
};
