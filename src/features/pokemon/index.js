const { pokemonCommands } = require('./commands');
const { handleBoosterCommand, handleBoosterSelectMenu, handleBoosterButton } = require('./boosterHandler');
const { handleCollectionCommand, handleCollectionSelectMenu, handleCardDetailSelectMenu, handleCollectionButton } = require('./collectionHandler');
const { handleTradeCommand, handleGiftBoosterCommand, handleTradeSelectMenu, handleTradeButton } = require('./tradeHandler');
const { handleTeamCommand, handleTeamButton, handleTeamSelectMenu } = require('./teamHandler');
const { handleForceRaidCommand, handleRaidButton, checkRaidTrigger } = require('./raidHandler');
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
    if (interaction.customId.startsWith('trade_')) {
      await handleTradeButton(interaction);
    } else if (interaction.customId.startsWith('collection_')) {
      await handleCollectionButton(interaction);
    } else if (interaction.customId.startsWith('booster_')) {
      await handleBoosterButton(interaction);
    } else if (interaction.customId.startsWith('team_')) {
      await handleTeamButton(interaction);
    } else if (interaction.customId.startsWith('raid_')) {
      await handleRaidButton(interaction);
    }
  }
}

module.exports = {
  pokemonCommands,
  handlePokemonCommand,
  handlePokemonInteraction,
  checkRaidTrigger
};
