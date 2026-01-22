const { SlashCommandBuilder } = require("discord.js");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const DRINKS_FILE = path.join(__dirname, "../../drinks.json");

// Load drinks data (with fallback for missing keys)
function loadDrinks() {
	const defaults = { thes: [], infusions: [], cafes: [], sirops: [] };
	try {
		const data = JSON.parse(fs.readFileSync(DRINKS_FILE, "utf8"));
		return { ...defaults, ...data };
	} catch {
		return defaults;
	}
}

// Save drinks data
function saveDrinks(data) {
	fs.writeFileSync(DRINKS_FILE, JSON.stringify(data, null, 2));
}

// Better random selection using crypto
function secureRandom(array) {
	if (array.length === 0) return null;
	const index = crypto.randomInt(0, array.length);
	return array[index];
}

// Command definitions
const commands = [
	new SlashCommandBuilder()
		.setName("ajouter")
		.setDescription("Ajouter un thé, infusion, café ou sirop à la liste")
		.addStringOption((option) =>
			option
				.setName("type")
				.setDescription("Type de boisson")
				.setRequired(true)
				.addChoices(
					{ name: "Thé", value: "thes" },
					{ name: "Infusion", value: "infusions" },
					{ name: "Café", value: "cafes" },
					{ name: "Sirop", value: "sirops" },
				),
		)
		.addStringOption((option) =>
			option
				.setName("nom")
				.setDescription("Nom à ajouter")
				.setRequired(true),
		),

	new SlashCommandBuilder()
		.setName("supprimer")
		.setDescription("Supprimer un thé, infusion, café ou sirop de la liste")
		.addStringOption((option) =>
			option
				.setName("type")
				.setDescription("Type de boisson")
				.setRequired(true)
				.addChoices(
					{ name: "Thé", value: "thes" },
					{ name: "Infusion", value: "infusions" },
					{ name: "Café", value: "cafes" },
					{ name: "Sirop", value: "sirops" },
				),
		)
		.addStringOption((option) =>
			option
				.setName("nom")
				.setDescription("Nom à supprimer")
				.setRequired(true)
				.setAutocomplete(true),
		),

	new SlashCommandBuilder()
		.setName("aleatoire")
		.setDescription("Choisir une boisson au hasard")
		.addStringOption((option) =>
			option
				.setName("type")
				.setDescription("Type de boisson")
				.setRequired(true)
				.addChoices(
					{ name: "Thé", value: "the" },
					{ name: "Infusion", value: "infusion" },
					{ name: "Café", value: "cafe" },
				),
		)
		.addStringOption((option) =>
			option
				.setName("sirop")
				.setDescription("Ajouter un sirop ? (laisser vide = sans sirop)")
				.setRequired(false)
				.setAutocomplete(true),
		),

	new SlashCommandBuilder()
		.setName("liste")
		.setDescription("Afficher la liste des thés, infusions, cafés ou sirops")
		.addStringOption((option) =>
			option
				.setName("type")
				.setDescription("Type à afficher")
				.setRequired(true)
				.addChoices(
					{ name: "Thés", value: "thes" },
					{ name: "Infusions", value: "infusions" },
					{ name: "Cafés", value: "cafes" },
					{ name: "Sirops", value: "sirops" },
				),
		),
];

// Handle autocomplete
async function handleAutocomplete(interaction) {
	const focusedOption = interaction.options.getFocused(true);
	const drinks = loadDrinks();

	// Autocomplete pour /supprimer
	if (focusedOption.name === "nom") {
		const type = interaction.options.getString("type");
		if (!type) return interaction.respond([]);

		const list = drinks[type] || [];
		const filtered = list
			.filter((item) =>
				item.toLowerCase().includes(focusedOption.value.toLowerCase()),
			)
			.slice(0, 25);

		await interaction.respond(
			filtered.map((item) => ({ name: item, value: item })),
		);
	}

	// Autocomplete pour sirop dans /aleatoire
	if (focusedOption.name === "sirop") {
		const sirops = drinks.sirops || [];
		const options = [
			{ name: "🎲 Aléatoire", value: "aleatoire" },
			...sirops.map((s) => ({ name: s, value: s })),
		];
		const filtered = options
			.filter((opt) =>
				opt.name.toLowerCase().includes(focusedOption.value.toLowerCase()),
			)
			.slice(0, 25);

		await interaction.respond(filtered);
	}
}

// Handle slash command interactions
async function handleCommand(interaction) {
	const { commandName } = interaction;

	if (commandName === "ajouter") {
		const type = interaction.options.getString("type");
		const nom = interaction.options.getString("nom");
		const drinks = loadDrinks();

		if (drinks[type].map((n) => n.toLowerCase()).includes(nom.toLowerCase())) {
			return interaction.reply({
				content: `**${nom}** est déjà dans la liste !`,
				ephemeral: true,
			});
		}

		drinks[type].push(nom);
		saveDrinks(drinks);

		const typeNames = { thes: "thé", infusions: "infusion", cafes: "café", sirops: "sirop" };
		return interaction.reply(`**${nom}** ajouté aux ${typeNames[type]}s !`);
	}

	if (commandName === "supprimer") {
		const type = interaction.options.getString("type");
		const nom = interaction.options.getString("nom");
		const drinks = loadDrinks();

		const index = drinks[type].findIndex(
			(item) => item.toLowerCase() === nom.toLowerCase(),
		);

		if (index === -1) {
			return interaction.reply({
				content: `**${nom}** n'est pas dans la liste !`,
				ephemeral: true,
			});
		}

		drinks[type].splice(index, 1);
		saveDrinks(drinks);

		const typeNames = { thes: "thé", infusions: "infusion", cafes: "café", sirops: "sirop" };
		return interaction.reply(`**${nom}** supprimé des ${typeNames[type]}s !`);
	}

	if (commandName === "aleatoire") {
		const type = interaction.options.getString("type");
		const siropChoice = interaction.options.getString("sirop");
		const drinks = loadDrinks();

		if (type === "the") {
			const the = secureRandom(drinks.thes);
			if (!the) {
				return interaction.reply({
					content: "Aucun thé dans la liste !",
					ephemeral: true,
				});
			}
			return interaction.reply(`Tu vas boire un **${the}**`);
		}

		if (type === "infusion") {
			const infusion = secureRandom(drinks.infusions);
			if (!infusion) {
				return interaction.reply({
					content: "Aucune infusion dans la liste !",
					ephemeral: true,
				});
			}
			return interaction.reply(`Tu vas boire une **${infusion}**`);
		}

		if (type === "cafe") {
			const cafe = secureRandom(drinks.cafes);
			if (!cafe) {
				return interaction.reply({
					content: "Aucun café dans la liste !",
					ephemeral: true,
				});
			}

			// Si un sirop est sélectionné
			if (siropChoice) {
				let sirop;
				if (siropChoice === "aleatoire") {
					sirop = secureRandom(drinks.sirops);
				} else {
					sirop = siropChoice;
				}

				if (sirop) {
					return interaction.reply(
						`Tu vas boire un **${cafe}** avec du sirop **${sirop}**`,
					);
				}
			}

			return interaction.reply(`Tu vas boire un **${cafe}**`);
		}
	}

	if (commandName === "liste") {
		const type = interaction.options.getString("type");
		const drinks = loadDrinks();
		const list = drinks[type] || [];

		if (list.length === 0) {
			return interaction.reply({
				content: "La liste est vide !",
				ephemeral: true,
			});
		}

		const typeNames = { thes: "Thés", infusions: "Infusions", cafes: "Cafés", sirops: "Sirops" };
		return interaction.reply(
			`**${typeNames[type]} disponibles :**\n${list.map((item) => `• ${item}`).join("\n")}`,
		);
	}
}

module.exports = {
	commands,
	handleCommand,
	handleAutocomplete,
};
