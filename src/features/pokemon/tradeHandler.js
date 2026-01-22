const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getCardInfo } = require('../../services/cardGenerator').default;
const { loadUserData, removeCardFromUser, addCardsToUser, saveUserData } = require('../../services/userManager');

// Map pour stocker les echanges en cours
const activeTrades = new Map();

// Admin whitelist for gift commands
const ADMIN_WHITELIST = [
  '98891713610797056',
];

/**
 * Gere la commande /echange
 */
async function handleTradeCommand(interaction) {
  const initiator = interaction.user;
  const target = interaction.options.getUser('utilisateur');

  // Verifications de base
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

  // Charger les donnees des utilisateurs
  const initiatorData = loadUserData(initiator.id);
  const targetData = loadUserData(target.id);

  // Verifier qu'ils ont des cartes
  const initiatorCards = Object.keys(initiatorData.cards).filter(id => initiatorData.cards[id] > 0);
  const targetCards = Object.keys(targetData.cards).filter(id => targetData.cards[id] > 0);

  if (initiatorCards.length === 0) {
    return interaction.reply({
      content: '❌ Vous n\'avez aucune carte a echanger.',
      ephemeral: true
    });
  }

  if (targetCards.length === 0) {
    return interaction.reply({
      content: `❌ ${target.username} n'a aucune carte a echanger.`,
      ephemeral: true
    });
  }

  // Creer les menus de selection
  const initiatorOptions = initiatorCards.slice(0, 25).map(cardId => {
    const cardInfo = getCardInfo(cardId);
    const quantity = initiatorData.cards[cardId];
    return {
      label: `${cardInfo?.name || `Carte ${cardId}`} (x${quantity})`,
      description: `${cardInfo?.rarityName || 'Inconnue'}`,
      value: cardId
    };
  });

  const targetOptions = targetCards.slice(0, 25).map(cardId => {
    const cardInfo = getCardInfo(cardId);
    const quantity = targetData.cards[cardId];
    return {
      label: `${cardInfo?.name || `Carte ${cardId}`} (x${quantity})`,
      description: `${cardInfo?.rarityName || 'Inconnue'}`,
      value: cardId
    };
  });

  const initiatorSelect = new StringSelectMenuBuilder()
    .setCustomId(`trade_give_${interaction.id}`)
    .setPlaceholder('Choisissez la carte que vous donnez')
    .addOptions(initiatorOptions);

  const targetSelect = new StringSelectMenuBuilder()
    .setCustomId(`trade_receive_${interaction.id}`)
    .setPlaceholder('Choisissez la carte que vous recevez')
    .addOptions(targetOptions);

  const row1 = new ActionRowBuilder().addComponents(initiatorSelect);
  const row2 = new ActionRowBuilder().addComponents(targetSelect);

  // Initialiser l'echange
  activeTrades.set(interaction.id, {
    initiatorId: initiator.id,
    targetId: target.id,
    giveCardId: null,
    receiveCardId: null,
    timestamp: Date.now()
  });

  await interaction.reply({
    content: `📋 **Echange avec ${target}**\n\nEtape 1: Choisissez la carte que vous donnez\nEtape 2: Choisissez la carte que vous recevez`,
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

  // Verifier si l'utilisateur est admin
  if (!ADMIN_WHITELIST.includes(adminId)) {
    return interaction.reply({
      content: '❌ Vous n\'avez pas la permission d\'utiliser cette commande.',
      ephemeral: true
    });
  }

  // Verifier que ce n'est pas un bot
  if (targetUser.bot) {
    return interaction.reply({
      content: '❌ Vous ne pouvez pas offrir un booster a un bot.',
      ephemeral: true
    });
  }

  try {
    // Charger les donnees de l'utilisateur
    const userData = loadUserData(targetUser.id);

    // Reset le cooldown (retirer lastBoosterOpen)
    delete userData.lastBoosterOpen;
    saveUserData(targetUser.id, userData);

    // Envoyer la confirmation
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
  const [, type, tradeId] = interaction.customId.split('_');

  const trade = activeTrades.get(tradeId);
  if (!trade) {
    return interaction.reply({
      content: '❌ Cet echange n\'est plus valide.',
      ephemeral: true
    });
  }

  // Verifier que c'est l'initiateur qui selectionne
  if (interaction.user.id !== trade.initiatorId) {
    return interaction.reply({
      content: '❌ Seul l\'initiateur de l\'echange peut selectionner les cartes.',
      ephemeral: true
    });
  }

  const selectedCardId = interaction.values[0];

  if (type === 'give') {
    trade.giveCardId = selectedCardId;
  } else if (type === 'receive') {
    trade.receiveCardId = selectedCardId;
  }

  // Verifier si les deux cartes sont selectionnees
  if (trade.giveCardId && trade.receiveCardId) {
    await showTradeConfirmation(interaction, trade, tradeId);
  } else {
    const giveCardInfo = trade.giveCardId ? getCardInfo(trade.giveCardId) : null;
    const receiveCardInfo = trade.receiveCardId ? getCardInfo(trade.receiveCardId) : null;
    const giveCardName = giveCardInfo?.name || '❓ Non selectionnee';
    const receiveCardName = receiveCardInfo?.name || '❓ Non selectionnee';

    await interaction.update({
      content: `📋 **Echange en cours**\n\n` +
        `Vous donnez: ${giveCardName}\n` +
        `Vous recevez: ${receiveCardName}`,
      components: interaction.message.components
    });
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
    .setLabel('✅ Accepter')
    .setStyle(ButtonStyle.Success);

  const cancelButton = new ButtonBuilder()
    .setCustomId(`trade_cancel_${tradeId}`)
    .setLabel('❌ Refuser')
    .setStyle(ButtonStyle.Danger);

  const row = new ActionRowBuilder().addComponents(confirmButton, cancelButton);

  const embed = new EmbedBuilder()
    .setColor('#FFA500')
    .setTitle('🔄 Confirmation d\'echange')
    .setDescription(
      `**${initiator.username}** propose un echange a **${target}**\n\n` +
      `${initiator.username} donne: **${giveCard?.name || 'Carte inconnue'}** (${giveCard?.rarityName || 'Inconnue'})\n` +
      `${target.username} donne: **${receiveCard?.name || 'Carte inconnue'}** (${receiveCard?.rarityName || 'Inconnue'})\n\n` +
      `${target}, acceptez-vous cet echange ?`
    )
    .setFooter({ text: 'L\'echange expire dans 5 minutes' });

  await interaction.update({
    content: null,
    embeds: [embed],
    components: [row]
  });

  // Expiration automatique apres 5 minutes
  setTimeout(() => {
    if (activeTrades.has(tradeId)) {
      activeTrades.delete(tradeId);
    }
  }, 5 * 60 * 1000);
}

/**
 * Gere les boutons de confirmation d'echange
 */
async function handleTradeButton(interaction) {
  const [, decision, tradeId] = interaction.customId.split('_');

  const trade = activeTrades.get(tradeId);
  if (!trade) {
    return interaction.reply({
      content: '❌ Cet echange n\'est plus valide ou a expire.',
      ephemeral: true
    });
  }

  // Verifier que c'est la cible qui repond
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

  // Confirmer l'echange
  try {
    const initiator = await interaction.client.users.fetch(trade.initiatorId);
    const target = await interaction.client.users.fetch(trade.targetId);

    // Retirer les cartes et les ajouter aux autres utilisateurs
    const success1 = removeCardFromUser(trade.initiatorId, trade.giveCardId);
    const success2 = removeCardFromUser(trade.targetId, trade.receiveCardId);

    if (!success1 || !success2) {
      // Rollback si l'un a echoue
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

    // Ajouter les cartes
    addCardsToUser(trade.initiatorId, [trade.receiveCardId]);
    addCardsToUser(trade.targetId, [trade.giveCardId]);

    activeTrades.delete(tradeId);

    const giveCard = getCardInfo(trade.giveCardId);
    const receiveCard = getCardInfo(trade.receiveCardId);

    const embed = new EmbedBuilder()
      .setColor('#00FF00')
      .setTitle('✅ Echange reussi !')
      .setDescription(
        `${initiator} a recu **${receiveCard?.name || 'Carte'}**\n` +
        `${target} a recu **${giveCard?.name || 'Carte'}**`
      );

    await interaction.update({
      content: null,
      embeds: [embed],
      components: []
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

module.exports = {
  handleTradeCommand,
  handleGiftBoosterCommand,
  handleTradeSelectMenu,
  handleTradeButton,
  ADMIN_WHITELIST
};
