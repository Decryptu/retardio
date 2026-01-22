const OpenAI = require("openai");
const personalities = require("../utils/personalities.js");
const { processMessageReward } = require("../services/userManager.js");

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
	async getAIResponse(prompt, channel, context = "") {
		try {
			if (channel) await channel.sendTyping();
			const completion = await this.openai.chat.completions.create({
				model: "gpt-4o-mini",
				messages: [
					{ role: "system", content: prompt },
					{ role: "user", content: context },
				],
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

	// Main message handling function
	async handleMessage(message) {
		// Update message history
		const channelHistory = this.updateMessageHistory(
			message.channelId,
			message.content,
			message.author.username,
		);

		// Traiter les récompenses en Poké Dollars (silencieux)
		if (!message.author.bot) {
			processMessageReward(message.author.id, message.content);
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
			const response = await this.getAIResponse(
				personalities.randomTalker.prompt,
				message.channel,
				message.content.replace(`<@${this.client.user.id}>`, "").trim(),
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
		const context = channelHistory
			.map((msg) => `${msg.author}: ${msg.content}`)
			.join("\n");

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
			// Random intervention
			const response = await this.getAIResponse(
				personalities.randomTalker.prompt,
				message.channel,
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
		}
	}
}

module.exports = MessageHandler;