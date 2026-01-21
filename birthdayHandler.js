const { SlashCommandBuilder } = require("discord.js");
const fs = require("fs");
const path = require("path");

const BIRTHDAYS_FILE = path.join(__dirname, "birthdays.json");

// Load birthdays data
function loadBirthdays() {
	try {
		return JSON.parse(fs.readFileSync(BIRTHDAYS_FILE, "utf8"));
	} catch {
		return [];
	}
}

// Save birthdays data
function saveBirthdays(data) {
	fs.writeFileSync(BIRTHDAYS_FILE, JSON.stringify(data, null, 2));
}

// Get current date in Paris timezone
function getParisDate() {
	return new Date().toLocaleDateString("fr-FR", {
		timeZone: "Europe/Paris",
		day: "2-digit",
		month: "2-digit",
		year: "numeric",
	});
}

// Parse Paris date to day/month
function getParisDayMonth() {
	const now = new Date();
	const parisTime = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Paris" }));
	return {
		day: parisTime.getDate(),
		month: parisTime.getMonth() + 1,
	};
}

// Command definitions
const birthdayCommands = [
	new SlashCommandBuilder()
		.setName("anniversaire_ajouter")
		.setDescription("Ajouter un anniversaire")
		.addIntegerOption((option) =>
			option
				.setName("jour")
				.setDescription("Jour de naissance (1-31)")
				.setRequired(true)
				.setMinValue(1)
				.setMaxValue(31),
		)
		.addIntegerOption((option) =>
			option
				.setName("mois")
				.setDescription("Mois de naissance (1-12)")
				.setRequired(true)
				.setMinValue(1)
				.setMaxValue(12),
		)
		.addUserOption((option) =>
			option
				.setName("membre")
				.setDescription("Membre du serveur")
				.setRequired(false),
		)
		.addStringOption((option) =>
			option
				.setName("nom")
				.setDescription("Ou entrer un nom manuellement")
				.setRequired(false),
		),

	new SlashCommandBuilder()
		.setName("anniversaire_supprimer")
		.setDescription("Supprimer un anniversaire")
		.addStringOption((option) =>
			option
				.setName("nom")
				.setDescription("Nom ou mention à supprimer")
				.setRequired(true)
				.setAutocomplete(true),
		),

	new SlashCommandBuilder()
		.setName("anniversaire_liste")
		.setDescription("Afficher la liste des anniversaires"),
];

// Handle autocomplete for birthday removal
async function handleBirthdayAutocomplete(interaction) {
	const focusedValue = interaction.options.getFocused();
	const birthdays = loadBirthdays();

	const filtered = birthdays
		.filter((b) =>
			b.name.toLowerCase().includes(focusedValue.toLowerCase()),
		)
		.slice(0, 25);

	await interaction.respond(
		filtered.map((b) => ({
			name: `${b.name} (${b.day}/${b.month})`,
			value: b.name,
		})),
	);
}

// Handle birthday commands
async function handleBirthdayCommand(interaction) {
	const { commandName } = interaction;

	if (commandName === "anniversaire_ajouter") {
		const jour = interaction.options.getInteger("jour");
		const mois = interaction.options.getInteger("mois");
		const membre = interaction.options.getUser("membre");
		const nomManuel = interaction.options.getString("nom");

		if (!membre && !nomManuel) {
			return interaction.reply({
				content: "Tu dois spécifier un membre ou un nom !",
				ephemeral: true,
			});
		}

		const name = membre ? membre.username : nomManuel;
		const userId = membre ? membre.id : null;

		const birthdays = loadBirthdays();

		// Check if already exists
		const exists = birthdays.find(
			(b) => b.name.toLowerCase() === name.toLowerCase() || (userId && b.userId === userId),
		);

		if (exists) {
			return interaction.reply({
				content: `**${name}** a déjà un anniversaire enregistré !`,
				ephemeral: true,
			});
		}

		birthdays.push({
			name,
			userId,
			day: jour,
			month: mois,
		});

		// Sort by date (month first, then day)
		birthdays.sort((a, b) => {
			if (a.month !== b.month) return a.month - b.month;
			return a.day - b.day;
		});

		saveBirthdays(birthdays);

		const monthNames = [
			"janvier", "février", "mars", "avril", "mai", "juin",
			"juillet", "août", "septembre", "octobre", "novembre", "décembre",
		];

		return interaction.reply(
			`Anniversaire ajouté : **${name}** le **${jour} ${monthNames[mois - 1]}**`,
		);
	}

	if (commandName === "anniversaire_supprimer") {
		const nom = interaction.options.getString("nom");
		const birthdays = loadBirthdays();

		const index = birthdays.findIndex(
			(b) => b.name.toLowerCase() === nom.toLowerCase(),
		);

		if (index === -1) {
			return interaction.reply({
				content: `**${nom}** n'est pas dans la liste !`,
				ephemeral: true,
			});
		}

		const removed = birthdays.splice(index, 1)[0];
		saveBirthdays(birthdays);

		return interaction.reply(`Anniversaire de **${removed.name}** supprimé !`);
	}

	if (commandName === "anniversaire_liste") {
		const birthdays = loadBirthdays();

		if (birthdays.length === 0) {
			return interaction.reply({
				content: "Aucun anniversaire enregistré !",
				ephemeral: true,
			});
		}

		const monthNames = [
			"janvier", "février", "mars", "avril", "mai", "juin",
			"juillet", "août", "septembre", "octobre", "novembre", "décembre",
		];

		const list = birthdays.map((b) => {
			const displayName = b.name || b.userId;
			return `• **${b.day} ${monthNames[b.month - 1]}** - \`${displayName}\``;
		});

		return interaction.reply(`**Anniversaires :**\n${list.join("\n")}`);
	}
}

// Check for birthdays and send messages
async function checkBirthdays(client, channelId) {
	const birthdays = loadBirthdays();
	if (birthdays.length === 0) return;

	const { day, month } = getParisDayMonth();

	const todayBirthdays = birthdays.filter(
		(b) => b.day === day && b.month === month,
	);

	if (todayBirthdays.length === 0) return;

	try {
		const channel = await client.channels.fetch(channelId);
		if (!channel) return;

		for (const birthday of todayBirthdays) {
			const mention = birthday.userId ? `<@${birthday.userId}>` : birthday.name;
			await channel.send(
				`🎂 **Joyeux anniversaire ${mention} !** 🎉🎁`,
			);
		}
	} catch (error) {
		console.error("Erreur lors de l'envoi du message d'anniversaire:", error);
	}
}

// Start daily birthday check
function startBirthdayCheck(client, channelId) {
	// Check every hour
	setInterval(() => {
		const now = new Date();
		const parisTime = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Paris" }));

		// Check at 9:00 AM Paris time
		if (parisTime.getHours() === 9 && parisTime.getMinutes() < 5) {
			checkBirthdays(client, channelId);
		}
	}, 5 * 60 * 1000); // Check every 5 minutes

	console.log("Vérification des anniversaires activée (9h heure de Paris)");
}

module.exports = {
	birthdayCommands,
	handleBirthdayCommand,
	handleBirthdayAutocomplete,
	startBirthdayCheck,
	checkBirthdays,
	loadBirthdays,
	getParisDayMonth,
};
