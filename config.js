const dotenv = require('dotenv');
dotenv.config();

const config = {
    token: process.env.TOKEN,
    openaiApiKey: process.env.API_KEY,
    triggers: {
        quoiChance: 0.7, // 70% de chance de répondre à "quoi"
        mockChance: 0.15, // 15% de chance de mocker
        randomInterventionChance: 0.05, // 5% de chance d'intervenir random
        waterReminderChance: 0.01 // 1% de chance de rappeler de boire de l'eau
    }
};

module.exports = config;