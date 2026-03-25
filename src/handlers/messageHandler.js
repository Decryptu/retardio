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

// Tools available to the bot when mentioned
const TOOLS = [
	{
		type: "function",
		function: {
			name: "get_server_members",
			description: "Get the list of all human (non-bot) members in the server with their display name and username",
			parameters: { type: "object", properties: {}, required: [] },
		},
	},
	{
		type: "function",
		function: {
			name: "search_messages",
			description: "Fetch recent messages from the current channel. Use this whenever you need context about what people said — for summaries, roasts, compliments, recaps, tier lists, or any question about recent activity. Can optionally filter by user and/or keyword.",
			parameters: {
				type: "object",
				properties: {
					username: { type: "string", description: "Filter by this username or display name (case-insensitive). Leave empty for all users." },
					keyword: { type: "string", description: "Filter messages containing this word/phrase (case-insensitive). Leave empty for no filter." },
					limit: { type: "number", description: "Max number of messages to scan (default 5000, max 10000). Higher values take longer." },
				},
				required: [],
			},
		},
	},
	{
		type: "function",
		function: {
			name: "count_keyword",
			description: "Count how many times a specific user said a specific word/phrase across recent messages in the current channel",
			parameters: {
				type: "object",
				properties: {
					username: { type: "string", description: "The username or display name to search for" },
					keyword: { type: "string", description: "The word or phrase to count" },
					limit: { type: "number", description: "Max number of messages to scan (default 5000, max 10000). Higher values take longer." },
				},
				required: ["username", "keyword"],
			},
		},
	},
	{
		type: "function",
		function: {
			name: "get_channel_list",
			description: "Get the list of text channels in the server",
			parameters: { type: "object", properties: {}, required: [] },
		},
	},
	{
		type: "function",
		function: {
			name: "get_user_activity_summary",
			description: "Get a summary of recent activity for all human members in the current channel. Returns message count and sample messages per user. Perfect for tier lists, rankings, comparisons, or any analysis across multiple users at once.",
			parameters: {
				type: "object",
				properties: {
					limit: { type: "number", description: "Max number of messages to scan (default 5000, max 10000)" },
					samples_per_user: { type: "number", description: "Number of sample messages to include per user (default 5, max 10)" },
				},
				required: [],
			},
		},
	},
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
	async getAIResponse(prompt, channel, userMessage = "", history = "", imageUrls = []) {
		try {
			if (channel) await channel.sendTyping();
			const messages = [{ role: "system", content: prompt }];
			if (history) {
				messages.push({
					role: "system",
					content: `Voici la conversation en cours dans le salon Discord. Tu dois réagir naturellement à ce qui se dit, comme un vrai participant du groupe :\n${history}`,
				});
			}

			const textContent = userMessage
				? `${userMessage}\n\nRéponds directement. Ne préfixe JAMAIS ta réponse avec ton nom ou un format "nom: message".`
				: "Réponds directement. Ne préfixe JAMAIS ta réponse avec ton nom ou un format \"nom: message\".";

			if (imageUrls.length > 0) {
				const content = [{ type: "text", text: textContent }];
				for (const url of imageUrls) {
					content.push({ type: "image_url", image_url: { url } });
				}
				messages.push({ role: "user", content });
			} else {
				messages.push({ role: "user", content: textContent });
			}

			const completion = await this.openai.chat.completions.create({
				model: "gpt-5.4-mini",
				messages,
				max_completion_tokens: 1024,
				reasoning_effort: "none",
				temperature: 0.8,
			});
			return completion.choices[0].message.content;
		} catch (error) {
			console.error("Erreur OpenAI:", error);
			return null;
		}
	}

	// Extract image URLs from a Discord message's attachments
	getImageUrls(message) {
		const urls = [];
		for (const attachment of message.attachments.values()) {
			if (attachment.contentType?.startsWith("image/")) {
				urls.push(attachment.url);
			}
		}
		return urls;
	}

	// Fetch messages from a channel with pagination
	async fetchMessages(channel, limit = 500) {
		const max = Math.min(limit, 10000);
		const all = [];
		let lastId = null;
		while (all.length < max) {
			const batch = await channel.messages.fetch({
				limit: Math.min(100, max - all.length),
				...(lastId && { before: lastId }),
			});
			if (batch.size === 0) break;
			all.push(...batch.values());
			lastId = batch.last().id;
		}
		return all;
	}

	// Find a guild member by ID, mention, username or displayName
	findMember(guild, name) {
		// Handle Discord mention format <@123> or <@!123> or raw ID
		const idMatch = name.match(/^<?@?!?(\d{17,20})>?$/);
		if (idMatch) {
			return guild.members.cache.get(idMatch[1]);
		}
		const lower = name.toLowerCase();
		return guild.members.cache.find(
			(m) =>
				m.user.username.toLowerCase() === lower ||
				m.displayName.toLowerCase() === lower ||
				m.user.username.toLowerCase().includes(lower) ||
				m.displayName.toLowerCase().includes(lower),
		);
	}

	// Execute a tool call and return the result as a string
	async executeTool(name, args, message) {
		const guild = message.guild;
		const channel = message.channel;
		await guild.members.fetch();

		if (name === "get_server_members") {
			const members = guild.members.cache
				.filter((m) => !m.user.bot)
				.map((m) => `${m.displayName} (@${m.user.username})`)
				.sort();
			return JSON.stringify({ count: members.length, members });
		}

		if (name === "search_messages") {
			const limit = args.limit || 5000;
			const msgs = await this.fetchMessages(channel, limit);
			let filtered = msgs.filter((m) => !m.author.bot);

			if (args.username) {
				const member = this.findMember(guild, args.username);
				if (member) {
					filtered = filtered.filter((m) => m.author.id === member.user.id);
				} else {
					return JSON.stringify({ error: `Utilisateur "${args.username}" introuvable` });
				}
			}
			if (args.keyword) {
				const kw = args.keyword.toLowerCase();
				filtered = filtered.filter((m) => m.content.toLowerCase().includes(kw));
			}

			const results = filtered.slice(0, 50).map((m) => ({
				author: m.author.username,
				content: m.content,
				date: m.createdAt.toISOString(),
			}));
			return JSON.stringify({ total_matches: filtered.length, showing: results.length, messages: results });
		}

		if (name === "count_keyword") {
			const limit = args.limit || 5000;
			const msgs = await this.fetchMessages(channel, limit);
			const kw = args.keyword.toLowerCase();

			let filtered = msgs.filter((m) => !m.author.bot);
			if (args.username) {
				const member = this.findMember(guild, args.username);
				if (member) {
					filtered = filtered.filter((m) => m.author.id === member.user.id);
				} else {
					return JSON.stringify({ error: `Utilisateur "${args.username}" introuvable` });
				}
			}

			let count = 0;
			for (const m of filtered) {
				const matches = m.content.toLowerCase().split(kw).length - 1;
				count += matches;
			}
			return JSON.stringify({ keyword: args.keyword, username: args.username, count, messages_scanned: filtered.length });
		}

		if (name === "get_channel_list") {
			const channels = guild.channels.cache
				.filter((c) => c.isTextBased() && !c.isThread())
				.map((c) => `#${c.name}`)
				.sort();
			return JSON.stringify({ count: channels.length, channels });
		}

		if (name === "get_user_activity_summary") {
			const limit = args.limit || 5000;
			const samplesPerUser = Math.min(args.samples_per_user || 5, 10);
			const msgs = await this.fetchMessages(channel, limit);
			const humanMsgs = msgs.filter((m) => !m.author.bot && m.content);

			const byUser = new Map();
			for (const m of humanMsgs) {
				const key = m.author.id;
				if (!byUser.has(key)) {
					byUser.set(key, { username: m.author.username, count: 0, samples: [] });
				}
				const entry = byUser.get(key);
				entry.count++;
				if (entry.samples.length < samplesPerUser) {
					entry.samples.push(m.content);
				}
			}

			const users = [...byUser.values()]
				.sort((a, b) => b.count - a.count)
				.map((u) => ({ username: u.username, message_count: u.count, sample_messages: u.samples }));
			return JSON.stringify({ total_messages_scanned: humanMsgs.length, users });
		}

		return JSON.stringify({ error: "Outil inconnu" });
	}

	// AI response with tool calling (for mentions and replies)
	async getAIResponseWithTools(prompt, channel, userMessage, history, imageUrls, message) {
		try {
			if (channel) await channel.sendTyping();

			const messages = [
				{ role: "system", content: prompt },
				{ role: "system", content: "Tu as accès à des outils pour interagir avec le serveur Discord. Utilise-les dès que la demande concerne des messages, des membres, ou des données du serveur. Par exemple : résumés, roasts, compliments, récaps, statistiques, tier lists, etc. N'hésite JAMAIS à appeler un outil si ça peut enrichir ta réponse." },
			];
			if (history) {
				messages.push({
					role: "system",
					content: `Voici la conversation en cours dans le salon Discord :\n${history}`,
				});
			}

			const textContent = `${userMessage}\n\nRéponds directement. Ne préfixe JAMAIS ta réponse avec ton nom ou un format "nom: message".`;
			if (imageUrls.length > 0) {
				const content = [{ type: "text", text: textContent }];
				for (const url of imageUrls) {
					content.push({ type: "image_url", image_url: { url } });
				}
				messages.push({ role: "user", content });
			} else {
				messages.push({ role: "user", content: textContent });
			}

			// Tool-calling loop (max 5 rounds to avoid infinite loops)
			for (let i = 0; i < 5; i++) {
				if (channel) await channel.sendTyping();
				const completion = await this.openai.chat.completions.create({
					model: "gpt-5.4-mini",
					messages,
					tools: TOOLS,
					max_completion_tokens: 1024,
					temperature: 0.8,
				});

				const choice = completion.choices[0];

				// If no tool calls, we have the final answer
				if (!choice.message.tool_calls || choice.message.tool_calls.length === 0) {
					return choice.message.content;
				}

				// Process tool calls
				messages.push(choice.message);
				for (const toolCall of choice.message.tool_calls) {
					const args = JSON.parse(toolCall.function.arguments || "{}");
					console.log(`[TOOL] ${toolCall.function.name}(${JSON.stringify(args)})`);
					const result = await this.executeTool(toolCall.function.name, args, message);
					messages.push({
						role: "tool",
						tool_call_id: toolCall.id,
						content: result,
					});
				}
			}

			return null;
		} catch (error) {
			console.error("Erreur OpenAI (tools):", error);
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
		// Skip system messages (pin notifications, member joins, etc.)
		if (message.system) return;

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
					const imageUrls = this.getImageUrls(message);
					const response = await this.getAIResponseWithTools(
						personalities.randomTalker.prompt,
						message.channel,
						message.content,
						replyContext,
						imageUrls,
						message,
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
			const imageUrls = this.getImageUrls(message);
			const response = await this.getAIResponse(
				personalities.swearingCat.prompt,
				message.channel,
				"",
				"",
				imageUrls,
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
			const imageUrls = this.getImageUrls(message);
			const response = await this.getAIResponseWithTools(
				personalities.randomTalker.prompt,
				message.channel,
				userMessage,
				replyContext,
				imageUrls,
				message,
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
				const imageUrls = this.getImageUrls(message);
				const response = await this.getAIResponse(
					personalities.quoiFeur.prompt,
					message.channel,
					message.content,
					"",
					imageUrls,
				);
				if (response) {
					message.reply(response);
					return;
				}
			}
		}

		// Single random check for all other triggers
		const randomValue = Math.random();
		const imageUrls = this.getImageUrls(message);

		if (randomValue < this.config.triggers.mockChance) {
			// Mock response
			const response = await this.getAIResponse(
				personalities.mocker.prompt,
				message.channel,
				message.content,
				"",
				imageUrls,
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
