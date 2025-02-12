const { Client, GatewayIntentBits } = require("discord.js");
const config = require("./config.js");
const MessageHandler = require("./messageHandler.js");

const client = new Client({
	intents: [
		GatewayIntentBits.Guilds,
		GatewayIntentBits.GuildMessages,
		GatewayIntentBits.MessageContent,
	],
});

// Initialize message handler
const messageHandler = new MessageHandler(client, config);

// Event handler for messages
client.on("messageCreate", async (message) => {
	// Only ignore messages from this bot, allow other bots
	if (message.author.bot && message.author.id === client.user.id) return;

	// Logger les messages reçus
	console.log(
		`[${new Date().toISOString()}] Canal #${message.channel.name} (${message.channelId})`,
	);
	console.log(`${message.author.username}: ${message.content}`);
	console.log("-".repeat(50));

	await messageHandler.handleMessage(message);
});

// Event handler pour quand le bot est prêt
client.on("ready", () => {
	console.log(
		`[${new Date().toISOString()}] Bot connecté en tant que ${client.user.tag}`,
	);
	console.log("=".repeat(50));
});

client.login(config.token);
