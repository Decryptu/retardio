const OpenAI = require("openai");
const personalities = require("../utils/personalities.js");
const { processMessageReward } = require("../services/userManager.js");

// Channels where pokedollar rewards are disabled
const REWARD_BLACKLIST_CHANNELS = [
	"1284811914437988406",
	"1359148815008923840",
];

// Channels where bot responses are disabled
const RESPONSE_BLACKLIST_CHANNELS = [
	"1272543925286211606",
];

class MessageHandler {
	constructor(client, config) {
		this.client = client;
		this.config = config;
		this.messageHistory = new Map();
		this.openai = new OpenAI({
			apiKey: config.openaiApiKey,
		});
	}

	// Function to alternate uppercase/lowercase
	mockText(text) {
		return text
			.split("")
			.map((char, i) => (i % 2 === 0 ? char.toUpperCase() : char.toLowerCase()))
			.join("");
	}

	// Function to get OpenAI response
	async getAIResponse(prompt, channel, userMessage = "", history = "") {
		try {
			if (channel) await channel.sendTyping();
			const messages = [{ role: "system", content: prompt }];
			if (history) {
				messages.push({
					role: "system",
					content: `Voici la conversation en cours dans le salon Discord. Tu dois réagir naturellement à ce qui se dit, comme un vrai participant du groupe :\n${history}`,
				});
			}
			messages.push({
				role: "user",
				content: userMessage
					? `${userMessage}\n\nRéponds directement. Ne préfixe JAMAIS ta réponse avec ton nom ou un format "nom: message".`
					: "Réponds directement. Ne préfixe JAMAIS ta réponse avec ton nom ou un format \"nom: message\".",
			});
			const completion = await this.openai.chat.completions.create({
				model: "gpt-4o-mini",
				messages,
				max_tokens: 1024,
				temperature: 0.8,
			});
			return completion.choices[0].message.content;
		} catch (error) {
			console.error("Erreur OpenAI:", error);
			return null;
		}
	}

	// Update message history
	updateMessageHistory(channelId, content, author) {
		let channelHistory = this.messageHistory.get(channelId) || [];
		channelHistory = [...channelHistory, { content, author }];

		if (channelHistory.length > 10) {
			channelHistory = channelHistory.slice(-10);
		}

		this.messageHistory.set(channelId, channelHistory);
		return channelHistory;
	}

	// Fetch context around a message for replies (grabs recent channel messages)
	async getReplyContext(message) {
		try {
			const messages = await message.channel.messages.fetch({ limit: 15, before: message.id });
			const sorted = [...messages.values()].reverse();
			return sorted
				.map((msg) => `${msg.author.username}: ${msg.content}`)
				.join("\n");
		} catch (error) {
			console.error("Erreur fetch reply context:", error);
			return "";
		}
	}

	// Main message handling function
	async handleMessage(message) {
		// Update message history
		const channelHistory = this.updateMessageHistory(
			message.channelId,
			message.content,
			message.author.username,
		);

		// Traiter les récompenses en Poké Dollars (silencieux)
		if (!message.author.bot && !REWARD_BLACKLIST_CHANNELS.includes(message.channelId)) {
			processMessageReward(message.author.id, message.content);
		}

		// Skip all bot responses in blacklisted channels
		if (RESPONSE_BLACKLIST_CHANNELS.includes(message.channelId)) {
			return;
		}

		// Handle direct replies to the bot's messages
		if (message.reference && !message.author.bot) {
			try {
				const repliedTo = await message.channel.messages.fetch(message.reference.messageId);
				if (repliedTo.author.id === this.client.user.id) {
					const replyContext = await this.getReplyContext(message);
					const response = await this.getAIResponse(
						personalities.randomTalker.prompt,
						message.channel,
						message.content,
						replyContext,
					);
					if (response) {
						message.reply(response);
						return;
					}
				}
			} catch (error) {
				console.error("Erreur traitement reply:", error);
			}
		}

		// Handle "$p" trigger (100% chance)
		if (message.content === "$p") {
			const response = await this.getAIResponse(
				personalities.swearingCat.prompt,
				message.channel,
			);
			if (response) {
				message.reply(response);
				return;
			}
		}

		// Handle direct mentions
		if (message.mentions.has(this.client.user)) {
			const replyContext = await this.getReplyContext(message);
			const userMessage = message.content.replace(`<@${this.client.user.id}>`, "").trim();
			const response = await this.getAIResponse(
				personalities.randomTalker.prompt,
				message.channel,
				userMessage,
				replyContext,
			);
			if (response) {
				message.reply(response);
				return;
			}
		}

		// Handle "yakak" or "yakkak"
		const contentLower = message.content.toLowerCase();

		if (/\b(yakak|yakkak)\b/.test(contentLower)) {
			message.channel.send("Elle est conne ou quoi cette pute ?");
			return;
		}

		// Handle "susane" or "susan"
		if (contentLower.includes("susane") || contentLower.includes("susan")) {
			message.channel.send("<:yakak:1374489364213796884>");
			return;
		}

		// Handle "quoi" trigger
		if (
			contentLower.endsWith("quoi") ||
			contentLower.endsWith("quoi ?")
		) {
			if (Math.random() < this.config.triggers.quoiChance) {
				const response = await this.getAIResponse(
					personalities.quoiFeur.prompt,
					message.channel,
					message.content,
				);
				if (response) {
					message.reply(response);
					return;
				}
			}
		}

		// Single random check for all other triggers
		const randomValue = Math.random();

		if (randomValue < this.config.triggers.mockChance) {
			// Mock response
			const response = await this.getAIResponse(
				personalities.mocker.prompt,
				message.channel,
				message.content,
			);
			if (response) message.reply(this.mockText(response));
		} else if (
			randomValue <
			this.config.triggers.mockChance +
				this.config.triggers.randomInterventionChance
		) {
			// Random intervention - fetch real channel history for better context
			const context = await this.getReplyContext(message);
			const response = await this.getAIResponse(
				personalities.randomTalker.prompt,
				message.channel,
				"Interviens naturellement dans cette conversation en réagissant à ce qui vient d'être dit.",
				context,
			);
			if (response) message.channel.send(response);
		} else if (
			randomValue <
			this.config.triggers.mockChance +
				this.config.triggers.randomInterventionChance +
				this.config.triggers.waterReminderChance
		) {
			// Water reminder
			const response = await this.getAIResponse(
				personalities.waterReminder.prompt,
				message.channel,
			);
			if (response) message.channel.send(response);
		} else if (
			randomValue <
			this.config.triggers.mockChance +
				this.config.triggers.randomInterventionChance +
				this.config.triggers.waterReminderChance +
				this.config.triggers.haikuChance
		) {
			// Haiku creation
			const response = await this.getAIResponse(
				personalities.haikuMaker.prompt,
				message.channel,
				message.content,
			);
			if (response) message.channel.send(response);
		} else if (
			randomValue <
			this.config.triggers.mockChance +
				this.config.triggers.randomInterventionChance +
				this.config.triggers.waterReminderChance +
				this.config.triggers.haikuChance +
				this.config.triggers.linkedinChance
		) {
			// LinkedIn influencer post
			const linkedinContext = await this.getReplyContext(message);
			const response = await this.getAIResponse(
				personalities.linkedinInfluencer.prompt,
				message.channel,
				"Transforme cette conversation en un post LinkedIn inspirationnel absurde.",
				linkedinContext,
			);
			if (response) message.channel.send(response);
		}
	}
}

module.exports = MessageHandler;