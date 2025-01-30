// index.js
const { Client, GatewayIntentBits } = require('discord.js');
const OpenAI = require('openai');
const config = require('./config.js');
const personalities = require('./personalities.js');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const openai = new OpenAI({
    apiKey: config.openaiApiKey
});

// Garder un historique des derniers messages pour le contexte
const messageHistory = new Map();

// Fonction pour alterner les majuscules
function mockText(text) {
    return text.split('').map((char, i) => 
        i % 2 === 0 ? char.toUpperCase() : char.toLowerCase()
    ).join('');
}

// Fonction pour obtenir une réponse d'OpenAI
async function getAIResponse(prompt, context = '') {
    try {
        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: prompt },
                { role: "user", content: context }
            ],
            max_tokens: 100,
            temperature: 0.8
        });
        return completion.choices[0].message.content;
    } catch (error) {
        console.error('Erreur OpenAI:', error);
        return null;
    }
}

// Event handler pour les messages
client.on('messageCreate', async message => {
    if (message.author.bot) return;

    // Mettre à jour l'historique des messages
    const channelHistory = messageHistory.get(message.channelId) || [];
    channelHistory.push({
        content: message.content,
        author: message.author.username
    });
    if (channelHistory.length > 3) channelHistory.shift();
    messageHistory.set(message.channelId, channelHistory);

    // Vérifier le trigger "quoi"
    if (message.content.toLowerCase().endsWith('quoi') || 
        message.content.toLowerCase().endsWith('quoi ?')) {
        if (Math.random() < config.triggers.quoiChance) {
            const response = await getAIResponse(
                personalities.quoiFeur.prompt,
                message.content
            );
            if (response) message.reply(response);
            return;
        }
    }

    // Chance de moquer
    if (Math.random() < config.triggers.mockChance) {
        const response = await getAIResponse(
            personalities.mocker.prompt,
            message.content
        );
        if (response) message.reply(mockText(response));
        return;
    }

    // Chance d'intervention random
    if (Math.random() < config.triggers.randomInterventionChance) {
        const context = channelHistory
            .map(msg => `${msg.author}: ${msg.content}`)
            .join('\n');
        const response = await getAIResponse(
            personalities.randomTalker.prompt,
            context
        );
        if (response) message.channel.send(response);
        return;
    }

    // Chance de rappel d'eau
    if (Math.random() < config.triggers.waterReminderChance) {
        const response = await getAIResponse(personalities.waterReminder.prompt);
        if (response) message.channel.send(response);
    }
});

client.on('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);
});

client.login(config.token);