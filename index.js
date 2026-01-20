const { Client, GatewayIntentBits, REST, Routes } = require("discord.js");
const config = require("./config.js");
const MessageHandler = require("./messageHandler.js");
const { commands, handleCommand, handleAutocomplete } = require("./commandHandler.js");
const {
	birthdayCommands,
	handleBirthdayCommand,
	handleBirthdayAutocomplete,
	startBirthdayCheck,
} = require("./birthdayHandler.js");
const {
	pokemonCommands,
	handlePokemonCommand,
	handlePokemonInteraction,
} = require("./pokemonHandler.js");

// Combine all commands
const allCommands = [...commands, ...birthdayCommands, ...pokemonCommands];

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
	const clientId = config.clientId || client.user.id;

	console.log("Enregistrement des commandes slash...");
	console.log(`Client ID: ${clientId}`);

	try {
		const commandsData = allCommands.map((cmd) => cmd.toJSON());

		// Si GUILD_ID est défini, utiliser les commandes de guilde (instantané)
		if (config.guildId) {
			console.log(`Mode guilde: ${config.guildId}`);
			await rest.put(Routes.applicationGuildCommands(clientId, config.guildId), {
				body: commandsData,
			});
		} else {
			// Sinon, commandes globales (peut prendre 1h)
			console.log("Mode global (peut prendre jusqu'à 1h pour apparaître)");
			await rest.put(Routes.applicationCommands(clientId), {
				body: commandsData,
			});
		}
		console.log(`${commandsData.length} commandes slash enregistrées !`);
	} catch (error) {
		console.error("Erreur lors de l'enregistrement des commandes:");
		console.error(error.stack || error);
	}
}

// Event handler for interactions (slash commands)
client.on("interactionCreate", async (interaction) => {
	const cmdName = interaction.commandName;
	const isBirthdayCmd = cmdName?.startsWith("anniversaire");
	const isPokemonCmd = ["booster", "collection", "echange"].includes(cmdName);

	if (interaction.isAutocomplete()) {
		if (isBirthdayCmd) {
			await handleBirthdayAutocomplete(interaction);
		} else {
			await handleAutocomplete(interaction);
		}
	} else if (interaction.isChatInputCommand()) {
		if (isBirthdayCmd) {
			await handleBirthdayCommand(interaction);
		} else if (isPokemonCmd) {
			await handlePokemonCommand(interaction);
		} else {
			await handleCommand(interaction);
		}
	} else if (interaction.isStringSelectMenu() || interaction.isButton()) {
		// Gérer les interactions Pokémon (menus et boutons)
		await handlePokemonInteraction(interaction);
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

	// Démarrer la vérification des anniversaires
	if (config.birthdayChannelId) {
		startBirthdayCheck(client, config.birthdayChannelId);
	} else {
		console.log("BIRTHDAY_CHANNEL_ID non configuré - anniversaires désactivés");
	}

	console.log("=".repeat(50));
});

client.login(config.token);
