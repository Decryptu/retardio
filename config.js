const dotenv = require('dotenv');
dotenv.config();

const config = {
    token: process.env.TOKEN,
    openaiApiKey: process.env.API_KEY,
    triggers: {
        quoiChance: 0.5, // 70% de chance de répondre à "quoi"
        mockChance: 0.005, // 0.5% de chance de mocker
        randomInterventionChance: 0.005, // 0.5% de chance d'intervenir random
        waterReminderChance: 0.001, // 0.1% de chance de rappeler de boire de l'eau
        haikuChance: 0.001 // 0.1% de chance de faire un haiku
    }
};

module.exports = config;