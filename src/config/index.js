const dotenv = require('dotenv');
dotenv.config();

const config = {
    token: process.env.TOKEN,
    clientId: process.env.CLIENT_ID,
    guildId: process.env.GUILD_ID, // Pour les commandes de guilde (dev)
    birthdayChannelId: process.env.BIRTHDAY_CHANNEL_ID, // Canal pour les messages d'anniversaire
    openaiApiKey: process.env.API_KEY,
    triggers: {
        quoiChance: 0.5, // 50% de chance de répondre à "quoi"
        mockChance: 0.005, // 0.5% de chance de mocker
        randomInterventionChance: 0.005, // 0.5% de chance d'intervenir random
        waterReminderChance: 0.001, // 0.1% de chance de rappeler de boire de l'eau
        haikuChance: 0.001, // 0.1% de chance de faire un haiku
        raidChance: 0.001 // 0.1% de chance de declencher un raid
    },
    raidChannelId: '1266727276259835946' // Canal pour les raids
};

module.exports = config;