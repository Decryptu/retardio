const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  AttachmentBuilder,
  MessageFlags,
} = require("discord.js");
const { getCardInfo } = require("../../services/cardGenerator");
const { getTeam, hasTeamMember, addMoney } = require("../../services/userManager");
const {
  generateExpeditionStartImage,
  generateExpeditionProgressImage,
  generateExpeditionResultImage,
} = require("../../services/imageGenerator");
const config = require("../../config");
const { ADMIN_WHITELIST } = require("./tradeHandler");

let activeExpedition = null;

const EXPEDITION_DURATION = 15 * 60 * 1000; // 15 minutes
const PROGRESS_INTERVAL = 60 * 1000; // Update every 60 seconds

function sanitizeJsonStringControlChars(jsonStr) {
  return jsonStr.replace(/"(?:[^"\\]|\\.)*"/g, (match) =>
    match.replace(/[\x00-\x1F\x7F]/g, (char) => {
      if (char === "\n") return "\\n";
      if (char === "\r") return "\\r";
      if (char === "\t") return "\\t";
      return "";
    })
  );
}

// Biomes with dominant types and recommendations
const BIOMES = [
  {
    id: "mystic_forest",
    name: "Forêt Mystique",
    emoji: "🌲",
    color: "#2ECC71",
    description: "Une forêt dense et ancienne peuplée de Pokémon Plante et Insecte.",
    dominantTypes: ["Plante", "Insecte"],
    recommendedTypes: ["Feu", "Vol", "Glace"],
    avoidTypes: ["Eau", "Sol"],
  },
  {
    id: "deep_ocean",
    name: "Océan Profond",
    emoji: "🌊",
    color: "#3498DB",
    description: "Les profondeurs marines où rôdent de puissants Pokémon Eau.",
    dominantTypes: ["Eau"],
    recommendedTypes: ["Électrik", "Plante"],
    avoidTypes: ["Feu", "Sol", "Roche"],
  },
  {
    id: "burning_volcano",
    name: "Volcan Ardent",
    emoji: "🌋",
    color: "#E74C3C",
    description: "Un volcan en éruption habité par des Pokémon Feu féroces.",
    dominantTypes: ["Feu", "Roche"],
    recommendedTypes: ["Eau", "Sol", "Roche"],
    avoidTypes: ["Plante", "Insecte", "Acier"],
  },
  {
    id: "dark_cave",
    name: "Grotte Obscure",
    emoji: "🦇",
    color: "#8E44AD",
    description: "Des grottes sombres où vivent les Pokémon Spectre et Ténèbre.",
    dominantTypes: ["Spectre", "Ténèbre", "Roche"],
    recommendedTypes: ["Fée", "Combat", "Insecte"],
    avoidTypes: ["Psy", "Normal"],
  },
  {
    id: "frozen_tundra",
    name: "Toundra Glaciale",
    emoji: "❄️",
    color: "#85C1E9",
    description: "Des terres gelées battues par les vents, territoire des Pokémon Glace.",
    dominantTypes: ["Glace"],
    recommendedTypes: ["Feu", "Combat", "Acier", "Roche"],
    avoidTypes: ["Plante", "Sol", "Vol", "Dragon"],
  },
  {
    id: "stormy_sky",
    name: "Ciel Orageux",
    emoji: "⛈️",
    color: "#F39C12",
    description: "Un ciel déchaîné où les Pokémon Vol et Électrik règnent.",
    dominantTypes: ["Vol", "Électrik"],
    recommendedTypes: ["Roche", "Glace"],
    avoidTypes: ["Sol", "Combat", "Insecte"],
  },
  {
    id: "toxic_swamp",
    name: "Marais Toxique",
    emoji: "☠️",
    color: "#9B59B6",
    description: "Un marécage empoisonné grouillant de Pokémon Poison.",
    dominantTypes: ["Poison"],
    recommendedTypes: ["Psy", "Sol", "Acier"],
    avoidTypes: ["Plante", "Fée"],
  },
  {
    id: "ancient_ruins",
    name: "Ruines Anciennes",
    emoji: "🏛️",
    color: "#E67E22",
    description: "Des ruines mystérieuses gardées par des Pokémon Psy et Acier.",
    dominantTypes: ["Psy", "Acier"],
    recommendedTypes: ["Feu", "Ténèbre", "Spectre", "Sol"],
    avoidTypes: ["Combat", "Poison"],
  },
  {
    id: "fairy_meadow",
    name: "Prairie Féerique",
    emoji: "🌸",
    color: "#FF69B4",
    description: "Une prairie enchantée où vivent les Pokémon Fée.",
    dominantTypes: ["Fée", "Normal"],
    recommendedTypes: ["Poison", "Acier"],
    avoidTypes: ["Dragon", "Combat"],
  },
  {
    id: "sand_desert",
    name: "Désert Aride",
    emoji: "🏜️",
    color: "#D4AC0D",
    description: "Un désert brûlant dominé par les Pokémon Sol et Roche.",
    dominantTypes: ["Sol", "Roche"],
    recommendedTypes: ["Eau", "Plante", "Glace"],
    avoidTypes: ["Feu", "Électrik", "Poison"],
  },
];

function selectBiome() {
  return BIOMES[Math.floor(Math.random() * BIOMES.length)];
}

async function startExpedition(client) {
  // Lazy require to avoid circular dependency
  const { hasActiveRaid } = require("./raidHandler");

  if (activeExpedition) {
    console.log("Une expedition est deja en cours");
    return null;
  }
  if (hasActiveRaid()) {
    console.log("Un raid est en cours, expedition annulee");
    return null;
  }

  const channel = client.channels.cache.get(config.raidChannelId);
  if (!channel) {
    console.error("Canal de raid/expedition introuvable:", config.raidChannelId);
    return null;
  }

  const biome = selectBiome();
  const startImage = await generateExpeditionStartImage(biome);
  const attachment = new AttachmentBuilder(startImage, { name: "expedition.png" });

  const joinButton = new ButtonBuilder()
    .setCustomId("expedition_join")
    .setLabel("Rejoindre l'Expédition")
    .setStyle(ButtonStyle.Primary)
    .setEmoji("🗺️");

  const row = new ActionRowBuilder().addComponents(joinButton);

  const endTime = Date.now() + EXPEDITION_DURATION;
  const endTimestamp = Math.floor(endTime / 1000);

  const embed = new EmbedBuilder()
    .setColor(biome.color)
    .setTitle(`${biome.emoji} Expédition: ${biome.name}`)
    .setDescription(
      `${biome.description}\n\n` +
      `**Types dominants:** ${biome.dominantTypes.join(", ")}\n` +
      `**Types recommandés:** ${biome.recommendedTypes.join(", ")}\n` +
      `**Types à éviter:** ${biome.avoidTypes.join(", ")}\n\n` +
      `L'expédition se termine <t:${endTimestamp}:R>\n\n` +
      `Préparez votre équipe et rejoignez l'expédition !`
    )
    .setImage("attachment://expedition.png")
    .setFooter({ text: "Utilisez /team pour configurer votre équipe !" });

  const message = await channel.send({
    content: "<@&1464335798341206046>",
    embeds: [embed],
    files: [attachment],
    components: [row],
    allowedMentions: { roles: ["1464335798341206046"] },
  });

  activeExpedition = {
    messageId: message.id,
    channelId: channel.id,
    biome,
    participants: new Map(),
    endTime,
    startTime: Date.now(),
    client,
    progressInterval: null,
  };

  // Start progress updates every 60 seconds
  activeExpedition.progressInterval = setInterval(
    () => updateExpeditionProgress(),
    PROGRESS_INTERVAL
  );

  // Execute at end of expedition
  setTimeout(() => executeExpedition(), EXPEDITION_DURATION);

  console.log(`Expedition demarree: ${biome.name}`);
  return activeExpedition;
}

async function handleExpeditionJoin(interaction) {
  if (!activeExpedition) {
    return interaction.reply({
      content: "❌ Il n'y a pas d'expédition en cours.",
      flags: MessageFlags.Ephemeral,
    });
  }

  const userId = interaction.user.id;

  // Block if user is in safari
  const { hasActiveSafari } = require('./safariHandler');
  if (hasActiveSafari(userId)) {
    return interaction.reply({
      content: "❌ Vous êtes en safari ! Terminez votre safari avant de rejoindre une expédition.",
      flags: MessageFlags.Ephemeral,
    });
  }

  if (!hasTeamMember(userId)) {
    return interaction.reply({
      content:
        "❌ Vous devez avoir au moins un Pokémon dans votre équipe pour rejoindre une expédition !\n" +
        "Utilisez `/team` pour configurer votre équipe.",
      flags: MessageFlags.Ephemeral,
    });
  }

  // Defer reply immediately to avoid 3-second interaction timeout
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const team = getTeam(userId);
  const teamCards = team
    .filter((cardId) => cardId !== null)
    .map((cardId) => getCardInfo(cardId))
    .filter((card) => card !== null);

  const alreadyJoined = activeExpedition.participants.has(userId);

  activeExpedition.participants.set(userId, {
    username: interaction.user.username,
    avatarURL: interaction.user.displayAvatarURL({ extension: "png", size: 64 }),
  });

  if (!alreadyJoined) {
    try {
      const channel = interaction.client.channels.cache.get(activeExpedition.channelId);
      const message = await channel.messages.fetch(activeExpedition.messageId);

      const participantMentions = Array.from(activeExpedition.participants.keys())
        .map((id) => `<@${id}>`)
        .join(", ");

      const contentText = `**Explorateurs (${activeExpedition.participants.size}):** ${participantMentions}`;
      await message.edit({ content: contentText });
    } catch (error) {
      console.error("Erreur lors de la mise a jour du message d'expedition:", error);
    }
  }

  if (alreadyJoined) {
    await interaction.editReply({
      content:
        `✅ Votre équipe a été mise à jour pour cette expédition !\n` +
        `Équipe actuelle: ${teamCards.map((c) => c.name).join(", ")}\n\n` +
        `💡 Vous pouvez continuer à modifier votre équipe avec \`/team\`.`,
    });
  } else {
    await interaction.editReply({
      content:
        `🗺️ Vous avez rejoint l'expédition avec ${teamCards.length} Pokémon !\n` +
        `Équipe: ${teamCards.map((c) => c.name).join(", ")}\n\n` +
        `💡 Vous pouvez modifier votre équipe avec \`/team\` jusqu'à la fin de l'expédition.`,
    });
  }
}

async function updateExpeditionProgress() {
  if (!activeExpedition) return;

  const elapsed = Date.now() - activeExpedition.startTime;
  const progress = Math.min(elapsed / EXPEDITION_DURATION, 1.0);
  const timeRemaining = Math.max(0, Math.ceil((EXPEDITION_DURATION - elapsed) / 60000));

  const avatarData = [];
  for (const [, data] of activeExpedition.participants) {
    avatarData.push({ username: data.username, avatarURL: data.avatarURL });
  }

  try {
    const progressImage = await generateExpeditionProgressImage(
      activeExpedition.biome,
      avatarData,
      progress,
      timeRemaining
    );

    const attachment = new AttachmentBuilder(progressImage, { name: "expedition.png" });
    const channel = activeExpedition.client.channels.cache.get(activeExpedition.channelId);
    const message = await channel.messages.fetch(activeExpedition.messageId);

    const embed = EmbedBuilder.from(message.embeds[0])
      .setImage("attachment://expedition.png");

    await message.edit({
      embeds: [embed],
      files: [attachment],
      components: message.components,
    });
  } catch (error) {
    console.error("Erreur lors de la mise a jour de la progression:", error);
  }
}

function clampExpeditionLog(input, maxChars = 400, maxWords = 60) {
  let text = String(input || "").trim();
  if (!text) return "L'expédition fut mouvementée...";

  text = text.replace(/\r\n/g, "\n");

  const words = text.split(/\s+/).filter(Boolean);
  if (words.length > maxWords) text = words.slice(0, maxWords).join(" ");

  if (text.length > maxChars) {
    text = text.slice(0, maxChars);
    const lastSpace = text.lastIndexOf(" ");
    if (lastSpace > 200) text = text.slice(0, lastSpace);
  }

  return text.trim() || "L'expédition fut mouvementée...";
}

async function executeExpedition() {
  if (!activeExpedition) return;

  const expedition = activeExpedition;
  activeExpedition = null;

  // Clear progress interval
  if (expedition.progressInterval) {
    clearInterval(expedition.progressInterval);
  }

  const channel = expedition.client.channels.cache.get(expedition.channelId);
  if (!channel) return;

  // No participants
  if (expedition.participants.size === 0) {
    const embed = new EmbedBuilder()
      .setColor("#888888")
      .setTitle("Expédition annulée...")
      .setDescription(
        `L'expédition dans **${expedition.biome.name}** ${expedition.biome.emoji} a été annulée car personne n'y a participé.`
      );

    try {
      const message = await channel.messages.fetch(expedition.messageId);
      await message.edit({ embeds: [embed], components: [] });
    } catch (error) {
      console.error("Erreur lors de la mise a jour du message d'expedition:", error);
    }
    return;
  }

  // Collect participant teams (fresh data)
  const participantData = [];
  for (const [userId, data] of expedition.participants) {
    const currentTeam = getTeam(userId);
    const teamCards = currentTeam
      .filter((cardId) => cardId !== null)
      .map((cardId) => getCardInfo(cardId))
      .filter((card) => card !== null);

    participantData.push({
      username: data.username,
      team: teamCards.map((card) => ({
        name: card.name,
        rarity: card.rarityName,
      })),
    });
  }

  const totalPokemon = participantData.reduce((sum, p) => sum + p.team.length, 0);

  const prompt = `Tu simules une expédition Pokémon dans un biome spécifique.

IMPORTANT:
- Tu dois répondre UNIQUEMENT par un JSON valide sur UNE SEULE LIGNE.
- Aucun texte avant ou après. Aucun markdown. Aucune explication.
- Le JSON doit contenir exactement ces deux clés: "expeditionLog" (string) et "reward" (number).
- expeditionLog doit respecter STRICTEMENT ces limites:
  - maximum 400 caractères
  - maximum 60 mots
- expeditionLog doit être un texte simple (pas de \\n, pas de retours à la ligne forcés).
- reward: un nombre entier entre 0 et 1000 (Poké Dollars gagnés par chaque participant).

BIOME: ${expedition.biome.name} (${expedition.biome.emoji})
Description: ${expedition.biome.description}
Types dominants du biome: ${expedition.biome.dominantTypes.join(", ")}
Types recommandés: ${expedition.biome.recommendedTypes.join(", ")}
Types à éviter: ${expedition.biome.avoidTypes.join(", ")}

Participants (${expedition.participants.size} explorateurs, ${totalPokemon} Pokémon au total):
${participantData
      .map((p) => `- ${p.username}: ${p.team.map((t) => t.name).join(", ")}`)
      .join("\n")}

REGLES:
- Noms en français, types Pokémon officiels.
- Les équipes peuvent contenir des cartes Dresseur / Objet (pas de type).
- Le reward reflète le succès de l'expédition:
  - Equipes adaptées au biome (types super efficaces contre les types dominants) = reward élevé
  - Equipes inadaptées (types faibles contre les types dominants) = reward faible
  - Plus il y a de participants, plus le reward potentiel est élevé
  - 0-200 = catastrophe, 201-400 = mitigé, 401-600 = correct, 601-800 = réussite, 801-1000 = triomphe

FAIBLESSES_DES_TYPES:
Psy = [Insecte, Spectre, Ténèbre]
Eau = [Plante, Électrik]
Feu = [Eau, Roche, Sol]
Plante = [Feu, Glace, Vol, Poison, Insecte]
Vol = [Électrik, Glace, Roche]
Combat = [Vol, Psy, Fée]
Spectre = [Spectre, Ténèbre]
Dragon = [Glace, Dragon, Fée]
Ténèbre = [Combat, Insecte, Fée]
Acier = [Feu, Combat, Sol]
Fée = [Poison, Acier]
Insecte = [Feu, Vol, Roche]

EXEMPLE STRICT:
{"expeditionLog":"L'expédition dans la forêt mystique fut riche en découvertes. Les dresseurs ont su exploiter les faiblesses des Pokémon sauvages.","reward":650}`;

  const result = { expeditionLog: "L'expédition fut mouvementée...", reward: 300 };

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.openaiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-5.4",
        messages: [
          {
            role: "system",
            content:
              'Output ONLY a single-line JSON object with keys "expeditionLog" and "reward". No other text.',
          },
          { role: "user", content: prompt },
        ],
        max_completion_tokens: 600,
        reasoning_effort: "none",
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`OpenAI API error ${response.status}: ${err}`);
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content || "";

    if (!content.trim()) {
      console.error("OpenAI full response:", JSON.stringify(data, null, 2));
      throw new Error("Empty model output");
    }

    const start = content.indexOf("{");
    const end = content.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
      throw new Error(`No JSON found. First 400 chars:\n${content.slice(0, 400)}`);
    }

    const jsonStr = sanitizeJsonStringControlChars(content.slice(start, end + 1));
    const parsed = JSON.parse(jsonStr);

    result.expeditionLog = clampExpeditionLog(
      String(parsed.expeditionLog || "").replace(/\\n/g, "\n"),
      400,
      60
    );
    result.reward = Math.max(0, Math.min(1000, Math.round(Number(parsed.reward) || 0)));
  } catch (error) {
    console.error("Erreur OpenAI pour l'expedition:", error);
    result.reward = Math.floor(Math.random() * 501) + 200; // 200-700 fallback
    result.expeditionLog = clampExpeditionLog(
      "Les explorateurs ont bravé les dangers du biome... L'expédition s'est terminée avec quelques découvertes.",
      400,
      60
    );
  }

  // Distribute rewards
  const participantIds = Array.from(expedition.participants.keys());
  if (result.reward > 0) {
    for (const participantId of participantIds) {
      addMoney(participantId, result.reward);
    }
  }

  // Determine success tier
  let successTier, successColor;
  if (result.reward >= 801) {
    successTier = "TRIOMPHE";
    successColor = "#FFD700";
  } else if (result.reward >= 601) {
    successTier = "REUSSITE";
    successColor = "#2ECC71";
  } else if (result.reward >= 401) {
    successTier = "CORRECT";
    successColor = "#F39C12";
  } else if (result.reward >= 201) {
    successTier = "MITIGE";
    successColor = "#E67E22";
  } else {
    successTier = "CATASTROPHE";
    successColor = "#E74C3C";
  }

  // Generate result image
  const resultImageBuffer = await generateExpeditionResultImage(
    expedition.biome,
    participantIds,
    result.expeditionLog,
    result.reward,
    successTier
  );
  const attachment = new AttachmentBuilder(resultImageBuffer, { name: "expedition_result.png" });

  const resultEmbed = new EmbedBuilder()
    .setColor(successColor)
    .setTitle(`${expedition.biome.emoji} Expédition terminée — ${successTier}`)
    .setDescription(
      `**${expedition.biome.name}**\n\n` +
      `**Récit:**\n${result.expeditionLog}\n\n` +
      `**Participants:** ${expedition.participants.size}\n` +
      `**Récompense:** ${result.reward} P par explorateur`
    )
    .setImage("attachment://expedition_result.png");

  const mentions = participantIds.map((id) => `<@${id}>`).join(" ");

  try {
    const message = await channel.messages.fetch(expedition.messageId);
    await message.edit({ components: [] });
  } catch (error) {
    console.error("Erreur lors de la suppression des boutons d'expedition:", error);
  }

  try {
    await channel.send({
      content: `${mentions}\nExpédition terminée ! Chaque explorateur reçoit **${result.reward} P** !`,
      embeds: [resultEmbed],
      files: [attachment],
    });
  } catch (error) {
    console.error("Erreur lors de l'envoi du résultat d'expedition:", error);
  }

  console.log(
    `Expedition terminee: ${expedition.biome.name} - ${successTier} (${result.reward} P)`
  );
}

async function handleForceExpeditionCommand(interaction) {
  const adminId = interaction.user.id;

  if (!ADMIN_WHITELIST.includes(adminId)) {
    return interaction.reply({
      content: "❌ Vous n'avez pas la permission d'utiliser cette commande.",
      flags: MessageFlags.Ephemeral,
    });
  }

  const { hasActiveRaid } = require("./raidHandler");

  if (activeExpedition) {
    return interaction.reply({
      content: "❌ Une expédition est déjà en cours !",
      flags: MessageFlags.Ephemeral,
    });
  }

  if (hasActiveRaid()) {
    return interaction.reply({
      content: "❌ Un raid est en cours ! Attendez qu'il se termine.",
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.reply({
    content: "🗺️ Déclenchement d'une expédition...",
    flags: MessageFlags.Ephemeral,
  });

  await startExpedition(interaction.client);
}

async function checkExpeditionTrigger(client) {
  const { hasActiveRaid } = require("./raidHandler");

  if (activeExpedition || hasActiveRaid()) return false;

  const chance = config.triggers.expeditionChance || 0.001;
  if (Math.random() < chance) {
    await startExpedition(client);
    return true;
  }

  return false;
}

async function handleExpeditionButton(interaction) {
  if (interaction.customId === "expedition_join") {
    await handleExpeditionJoin(interaction);
  }
}

function hasActiveExpedition() {
  return activeExpedition !== null;
}

module.exports = {
  startExpedition,
  handleExpeditionJoin,
  handleForceExpeditionCommand,
  checkExpeditionTrigger,
  handleExpeditionButton,
  hasActiveExpedition,
};
