const { SlashCommandBuilder } = require('discord.js');

// Commandes slash Pokemon
const pokemonCommands = [
  new SlashCommandBuilder()
    .setName('booster')
    .setDescription('Ouvrir un booster de cartes Pokemon'),

  new SlashCommandBuilder()
    .setName('collection')
    .setDescription('Consulter une collection de cartes')
    .addUserOption(option =>
      option.setName('utilisateur')
        .setDescription('Utilisateur dont vous voulez voir la collection (par defaut: vous)')
        .setRequired(false)
    )
    .addStringOption(option =>
      option.setName('booster')
        .setDescription('ID du booster a afficher')
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('echange')
    .setDescription('Echanger des cartes avec un autre utilisateur')
    .addUserOption(option =>
      option.setName('utilisateur')
        .setDescription('Utilisateur avec qui echanger')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('giftbooster')
    .setDescription('[ADMIN] Offrir un booster a un utilisateur')
    .addUserOption(option =>
      option.setName('utilisateur')
        .setDescription('Utilisateur a qui offrir un booster')
        .setRequired(true)
    )
];

module.exports = { pokemonCommands };
