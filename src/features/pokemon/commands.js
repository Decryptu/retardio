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
    ),

  new SlashCommandBuilder()
    .setName('team')
    .setDescription('Gerer votre equipe de 3 Pokemon pour les raids'),

  new SlashCommandBuilder()
    .setName('forceraid')
    .setDescription('[ADMIN] Declencher un raid aleatoire'),

  new SlashCommandBuilder()
    .setName('flip')
    .setDescription('Pile ou face - 49% de chance de doubler votre mise')
    .addIntegerOption(option =>
      option.setName('mise')
        .setDescription('Montant a miser (1-100 Poke Dollars)')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(100)
    )
];

module.exports = { pokemonCommands };
