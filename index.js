const { Client, GatewayIntentBits, REST, Routes } = require("discord.js");
const config = require("./config.js");
const MessageHandler = require("./messageHandler.js");
const { commands, handleCommand, handleAutocomplete } = require("./commandHandler.js");

const client = new Client({
	intents: [
		GatewayIntentBits.Guilds,
		GatewayIntentBits.GuildMessages,
		GatewayIntentBits.MessageContent,
	],
});

// Initialize message handler
const messageHandler = new MessageHandler(client, config);

// Register slash commands
async function registerCommands() {
	const rest = new REST({ version: "10" }).setToken(config.token);
	try {
		console.log("Enregistrement des commandes slash...");
		await rest.put(Routes.applicationCommands(client.user.id), {
			body: commands.map((cmd) => cmd.toJSON()),
		});
		console.log("Commandes slash enregistrées !");
	} catch (error) {
		console.error("Erreur lors de l'enregistrement des commandes:", error);
	}
}

// Event handler for interactions (slash commands)
client.on("interactionCreate", async (interaction) => {
	if (interaction.isAutocomplete()) {
		await handleAutocomplete(interaction);
	} else if (interaction.isChatInputCommand()) {
		await handleCommand(interaction);
	}
});

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
client.on("ready", async () => {
	console.log(
		`[${new Date().toISOString()}] Bot connecté en tant que ${client.user.tag}`,
	);
	await registerCommands();
	console.log("=".repeat(50));
});

client.login(config.token);
