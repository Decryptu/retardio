const { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { pokemonCommands } = require('./commands');
const { handleBoosterCommand, handleBoosterSelectMenu, handleBoosterButton } = require('./boosterHandler');
const { handleCollectionCommand, handleCollectionSelectMenu, handleCardDetailSelectMenu, handleCollectionButton, handleCollectionSearchModal } = require('./collectionHandler');
const { handleTradeCommand, handleGiftBoosterCommand, handleTradeSelectMenu, handleTradeButton, handleTradeSearchModal } = require('./tradeHandler');
const { handleTeamCommand, handleTeamButton, handleTeamSelectMenu, handleTeamSearchModal } = require('./teamHandler');
const { handleForceRaidCommand, handleRaidButton, checkRaidTrigger, hasActiveRaid } = require('./raidHandler');
const { handleForceExpeditionCommand, handleExpeditionButton, checkExpeditionTrigger, hasActiveExpedition } = require('./expeditionHandler');
const { handleFlipCommand } = require('./flipHandler');

/**
 * Gere toutes les commandes Pokemon
 */
async function handlePokemonCommand(interaction) {
  const commandName = interaction.commandName;

  if (commandName === 'booster') {
    await handleBoosterCommand(interaction);
  } else if (commandName === 'collection') {
    await handleCollectionCommand(interaction);
  } else if (commandName === 'echange') {
    await handleTradeCommand(interaction);
  } else if (commandName === 'giftbooster') {
    await handleGiftBoosterCommand(interaction);
  } else if (commandName === 'team') {
    await handleTeamCommand(interaction);
  } else if (commandName === 'forceraid') {
    await handleForceRaidCommand(interaction);
  } else if (commandName === 'forceexpedition') {
    await handleForceExpeditionCommand(interaction);
  } else if (commandName === 'flip') {
    await handleFlipCommand(interaction);
  }
}

/**
 * Gere les interactions (menus, boutons)
 */
async function handlePokemonInteraction(interaction) {
  if (interaction.isStringSelectMenu()) {
    if (interaction.customId.startsWith('trade_')) {
      await handleTradeSelectMenu(interaction);
    } else if (interaction.customId.startsWith('collection_card_')) {
      await handleCardDetailSelectMenu(interaction);
    } else if (interaction.customId.startsWith('collection_select_')) {
      await handleCollectionSelectMenu(interaction);
    } else if (interaction.customId.startsWith('booster_select_open_')) {
      await handleBoosterSelectMenu(interaction);
    } else if (interaction.customId.startsWith('team_select_')) {
      await handleTeamSelectMenu(interaction);
    }
  } else if (interaction.isButton()) {
    if (interaction.customId.startsWith('search_')) {
      // Show search modal
      const modal = new ModalBuilder()
        .setCustomId(interaction.customId)
        .setTitle('Rechercher une carte');

      const searchInput = new TextInputBuilder()
        .setCustomId('search_input')
        .setLabel('Nom de la carte')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Tapez un nom...')
        .setRequired(true)
        .setMaxLength(50);

      modal.addComponents(new ActionRowBuilder().addComponents(searchInput));
      await interaction.showModal(modal);
    } else if (interaction.customId.startsWith('trade_')) {
      await handleTradeButton(interaction);
    } else if (interaction.customId.startsWith('collection_')) {
      await handleCollectionButton(interaction);
    } else if (interaction.customId.startsWith('booster_')) {
      await handleBoosterButton(interaction);
    } else if (interaction.customId.startsWith('team_')) {
      await handleTeamButton(interaction);
    } else if (interaction.customId.startsWith('raid_')) {
      await handleRaidButton(interaction);
    } else if (interaction.customId.startsWith('expedition_')) {
      await handleExpeditionButton(interaction);
    }
  } else if (interaction.isModalSubmit()) {
    if (interaction.customId.startsWith('search_team_')) {
      await handleTeamSearchModal(interaction);
    } else if (interaction.customId.startsWith('search_trade_')) {
      await handleTradeSearchModal(interaction);
    } else if (interaction.customId.startsWith('search_collection_')) {
      await handleCollectionSearchModal(interaction);
    }
  }
}

module.exports = {
  pokemonCommands,
  handlePokemonCommand,
  handlePokemonInteraction,
  checkRaidTrigger,
  hasActiveRaid,
  checkExpeditionTrigger,
  hasActiveExpedition
};
