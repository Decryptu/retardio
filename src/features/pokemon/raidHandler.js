const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  AttachmentBuilder,
  MessageFlags,
} = require("discord.js");
const { getCardInfo } = require("../../services/cardGenerator");
const { getTeam, hasTeamMember, addCardToUser, addMoney } = require("../../services/userManager");
const { generateRaidBossImage, generateRaidResultImage } = require("../../services/imageGenerator");
const config = require("../../config");
const cards = require("../../../data/cards.json");
const { ADMIN_WHITELIST } = require("./tradeHandler");

let activeRaid = null;

const RAID_DURATION = 5 * 60 * 1000;

function selectRaidBoss() {
  const rand = Math.random();
  let targetRarity;
  let level;

  if (rand < 0.5) {
    targetRarity = "uncommon";
    level = 50;
  } else if (rand < 0.9) {
    targetRarity = "rare";
    level = 75;
  } else {
    targetRarity = "legendary";
    level = 100;
  }

  const eligibleCards = Object.values(cards).filter((card) => {
    if (card.isPromo || String(card.id).includes("promo")) return false;
    return card.rarity === targetRarity;
  });

  if (eligibleCards.length === 0) {
    const fallbackCards = Object.values(cards).filter(
      (card) => !card.isPromo && !String(card.id).includes("promo")
    );
    const randomCard = fallbackCards[Math.floor(Math.random() * fallbackCards.length)];
    return { card: getCardInfo(randomCard.id), level: 50 };
  }

  const randomCard = eligibleCards[Math.floor(Math.random() * eligibleCards.length)];
  return { card: getCardInfo(randomCard.id), level };
}

async function startRaid(client) {
  // Lazy require to avoid circular dependency
  const { hasActiveExpedition } = require("./expeditionHandler");

  if (activeRaid) {
    console.log("Un raid est deja en cours");
    return null;
  }

  if (hasActiveExpedition()) {
    console.log("Une expedition est en cours, raid annule");
    return null;
  }

  const channel = client.channels.cache.get(config.raidChannelId);
  if (!channel) {
    console.error("Canal de raid introuvable:", config.raidChannelId);
    return null;
  }

  const { card: bossCard, level } = selectRaidBoss();

  const bossImageBuffer = await generateRaidBossImage(bossCard, level);
  const attachment = new AttachmentBuilder(bossImageBuffer, { name: "raid_boss.png" });

  const joinButton = new ButtonBuilder()
    .setCustomId("raid_join")
    .setLabel("Rejoindre le Raid")
    .setStyle(ButtonStyle.Success)
    .setEmoji("⚔️");

  const row = new ActionRowBuilder().addComponents(joinButton);

  const raidTypeText =
    level === 100 ? "**LEGENDAIRE**" : level === 75 ? "**RARE**" : "**PEU COMMUN**";

  const endTime = Date.now() + RAID_DURATION;
  const endTimestamp = Math.floor(endTime / 1000);

  const embed = new EmbedBuilder()
    .setColor(level === 100 ? "#FF8000" : level === 75 ? "#2fd2ff" : "#1EFF00")
    .setTitle("Un Raid est apparu !")
    .setDescription(
      `Un **${bossCard.name}** sauvage de niveau **${level}** est apparu !\n\n` +
      `Type de raid: ${raidTypeText}\n\n` +
      `Le combat commence <t:${endTimestamp}:R>\n\n` +
      `Rejoignez le raid avec votre equipe pour avoir une chance de capturer ce Pokemon !`
    )
    .setImage("attachment://raid_boss.png")
    .setFooter({ text: "Utilisez /team pour configurer votre equipe avant de rejoindre !" });

  const message = await channel.send({
    content: "<@&1464335798341206046>",
    embeds: [embed],
    files: [attachment],
    components: [row],
    allowedMentions: { roles: ["1464335798341206046"] },
  });

  activeRaid = {
    messageId: message.id,
    channelId: channel.id,
    bossCard,
    level,
    participants: new Map(),
    endTime,
    client,
    imageBuffer: bossImageBuffer,
  };

  setTimeout(() => executeRaid(), RAID_DURATION);

  console.log(`Raid demarre: ${bossCard.name} Nv.${level}`);
  return activeRaid;
}

async function handleRaidJoin(interaction) {
  if (!activeRaid) {
    return interaction.reply({
      content: "❌ Il n'y a pas de raid en cours.",
      flags: MessageFlags.Ephemeral,
    });
  }

  const userId = interaction.user.id;

  if (!hasTeamMember(userId)) {
    return interaction.reply({
      content:
        "❌ Vous devez avoir au moins un Pokemon dans votre equipe pour rejoindre un raid !\n" +
        "Utilisez `/team` pour configurer votre equipe.",
      flags: MessageFlags.Ephemeral,
    });
  }

  const team = getTeam(userId);
  const teamCards = team
    .filter((cardId) => cardId !== null)
    .map((cardId) => getCardInfo(cardId))
    .filter((card) => card !== null);

  const alreadyJoined = activeRaid.participants.has(userId);

  // Store/update participant - team will be refreshed at raid execution
  activeRaid.participants.set(userId, {
    username: interaction.user.username,
  });

  if (!alreadyJoined) {
    try {
      const channel = interaction.client.channels.cache.get(activeRaid.channelId);
      const message = await channel.messages.fetch(activeRaid.messageId);

      const participantMentions = Array.from(activeRaid.participants.keys())
        .map((id) => `<@${id}>`)
        .join(", ");

      const contentText = `**Participants (${activeRaid.participants.size}):** ${participantMentions}`;
      await message.edit({ content: contentText });
    } catch (error) {
      console.error("Erreur lors de la mise a jour du message de raid:", error);
    }
  }

  if (alreadyJoined) {
    await interaction.reply({
      content:
        `✅ Votre equipe a ete mise a jour pour ce raid !\n` +
        `Equipe actuelle: ${teamCards.map((c) => c.name).join(", ")}\n\n` +
        `💡 Vous pouvez continuer a modifier votre equipe avec \`/team\` jusqu'au debut du combat.`,
      flags: MessageFlags.Ephemeral,
    });
  } else {
    await interaction.reply({
      content:
        `⚔️ Vous avez rejoint le raid avec ${teamCards.length} Pokemon !\n` +
        `Equipe: ${teamCards.map((c) => c.name).join(", ")}\n\n` +
        `💡 Vous pouvez modifier votre equipe avec \`/team\` jusqu'au debut du combat.`,
      flags: MessageFlags.Ephemeral,
    });
  }
}

function clampBattleLog(input, maxChars = 400, maxWords = 60) {
  let text = String(input || "").trim();
  if (!text) return "Le combat fut intense...";

  text = text.replace(/\r\n/g, "\n");

  const words = text.split(/\s+/).filter(Boolean);
  if (words.length > maxWords) text = words.slice(0, maxWords).join(" ");

  if (text.length > maxChars) {
    text = text.slice(0, maxChars);
    const lastSpace = text.lastIndexOf(" ");
    if (lastSpace > 200) text = text.slice(0, lastSpace);
  }

  return text.trim() || "Le combat fut intense...";
}

async function executeRaid() {
  if (!activeRaid) return;

  const raid = activeRaid;
  activeRaid = null;

  const channel = raid.client.channels.cache.get(raid.channelId);
  if (!channel) return;

  if (raid.participants.size === 0) {
    const embed = new EmbedBuilder()
      .setColor("#888888")
      .setTitle("Raid echoue...")
      .setDescription(`Le **${raid.bossCard.name}** s'est enfui car personne n'a rejoint le raid.`);

    try {
      const message = await channel.messages.fetch(raid.messageId);
      await message.edit({ embeds: [embed], components: [] });
    } catch (error) {
      console.error("Erreur lors de la mise a jour du message de raid:", error);
    }
    return;
  }

  const participantData = [];
  for (const [odPId, data] of raid.participants) {
    // Fetch fresh team data at raid execution time
    const currentTeam = getTeam(odPId);
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

  const totalParticipantPokemon = participantData.reduce((sum, p) => sum + p.team.length, 0);

  const prompt = `Tu simules un combat de raid Pokemon.

IMPORTANT:
- Tu dois repondre UNIQUEMENT par un JSON valide sur UNE SEULE LIGNE.
- Aucun texte avant ou apres. Aucun markdown. Aucune explication.
- Le JSON doit contenir exactement ces deux cles: "victory" (boolean) et "battleLog" (string).
- battleLog doit respecter STRICTEMENT ces limites:
  - maximum 400 caracteres
  - maximum 60 mots
- battleLog doit etre un texte simple (pas besoin de \\n, pas de retours a la ligne forces).
- Discord gerera l'affichage automatiquement.
- Si tu depasses une limite, tu raccourcis toi-meme pour respecter 400 caracteres et 60 mots maximum.

Boss du raid: ${raid.bossCard.name} (${raid.bossCard.rarityName}, Niveau ${raid.level})
Participants (${raid.participants.size} dresseurs, ${totalParticipantPokemon} Pokemon au total):
${participantData
      .map((p) => `- ${p.username}: ${p.team.map((t) => t.name).join(", ")}`)
      .join("\n")}

REGLES:
- Noms en francais, types Pokemon officiels.
- Les equipes peuvent contenir des cartes Dresseur / Objet.
- Prends en compte les strategies Pokemon.

FACTEURS:
+ Nombre de Pokemon des joueurs (${totalParticipantPokemon}) vs boss (1)
+ Avantages de type
+ Synergies
- Niveau eleve du boss (Nv${raid.level})
- Avantage de type du boss

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
{"victory":true,"battleLog":"Invente un scénario de combat Pokémon ici."}`;

  const result = { victory: false, battleLog: "Le combat fut intense..." };

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.openaiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-5.1",
        messages: [
          {
            role: "system",
            content:
              'Output ONLY a single-line JSON object with keys "victory" and "battleLog". No other text.',
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

    const jsonStr = content.slice(start, end + 1);
    const parsed = JSON.parse(jsonStr);

    result.victory = !!parsed.victory;
    result.battleLog = clampBattleLog(String(parsed.battleLog || "").replace(/\\n/g, "\n"), 400, 60);
  } catch (error) {
    console.error("Erreur OpenAI pour le raid:", error);
    result.victory = Math.random() < 0.6;
    result.battleLog = result.victory
      ? "Les dresseurs ont combine leurs forces...\nLe boss a ete vaincu !"
      : "Le boss etait trop puissant...\nLes dresseurs ont du battre en retraite.";
    result.battleLog = clampBattleLog(result.battleLog, 400, 60);
  }

  const participantIds = Array.from(raid.participants.keys());

  let bonus = 0;
  if (result.victory) {
    if (raid.level === 100) bonus = Math.floor(Math.random() * 501) + 500;
    else if (raid.level === 75) bonus = Math.floor(Math.random() * 251) + 250;
    else bonus = Math.floor(Math.random() * 151) + 100;

    for (const participantId of participantIds) {
      addCardToUser(participantId, raid.bossCard.id);
      addMoney(participantId, bonus);
    }
  }

  const resultImageBuffer = await generateRaidResultImage(
    raid.bossCard,
    raid.level,
    result.victory,
    participantIds,
    result.battleLog,
    bonus
  );
  const attachment = new AttachmentBuilder(resultImageBuffer, { name: "raid_result.png" });

  const resultEmbed = new EmbedBuilder()
    .setColor(result.victory ? "#00FF00" : "#FF0000")
    .setTitle(result.victory ? "Raid reussi !" : "Raid echoue...")
    .setDescription(
      `**${raid.bossCard.name}** (Nv.${raid.level})\n\n` +
      `**Combat:**\n${result.battleLog}\n\n` +
      `**Participants:** ${raid.participants.size}\n` +
      (result.victory
        ? `\n**Recompenses:** ${raid.bossCard.name} + ${bonus} P`
        : "\nAucune recompense.")
    )
    .setImage("attachment://raid_result.png");

  const mentions = participantIds.map((id) => `<@${id}>`).join(" ");

  try {
    const message = await channel.messages.fetch(raid.messageId);
    await message.edit({ components: [] });

    await channel.send({
      content: result.victory
        ? `${mentions}\nVictoire ! Vous avez vaincu le raid !`
        : `${mentions}\nDefaite... Le boss etait trop puissant.`,
      embeds: [resultEmbed],
      files: [attachment],
    });
  } catch (error) {
    console.error("Erreur lors de la mise a jour du message de raid:", error);
    await channel.send({
      content: result.victory
        ? `${mentions}\nVictoire ! Vous avez vaincu le raid !`
        : `${mentions}\nDefaite... Le boss etait trop puissant.`,
      embeds: [resultEmbed],
      files: [attachment],
    });
  }

  console.log(
    `Raid termine: ${raid.bossCard.name} - ${result.victory ? "Victoire" : "Defaite"}`
  );
}

async function handleForceRaidCommand(interaction) {
  const adminId = interaction.user.id;

  if (!ADMIN_WHITELIST.includes(adminId)) {
    return interaction.reply({
      content: "❌ Vous n'avez pas la permission d'utiliser cette commande.",
      flags: MessageFlags.Ephemeral,
    });
  }

  const { hasActiveExpedition } = require("./expeditionHandler");

  if (activeRaid) {
    return interaction.reply({
      content: "❌ Un raid est déjà en cours !",
      flags: MessageFlags.Ephemeral,
    });
  }

  if (hasActiveExpedition()) {
    return interaction.reply({
      content: "❌ Une expédition est en cours ! Attendez qu'elle se termine.",
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.reply({
    content: "⚔️ Declenchement d'un raid...",
    flags: MessageFlags.Ephemeral,
  });

  await startRaid(interaction.client);
}

async function checkRaidTrigger(client) {
  if (activeRaid) return false;

  const chance = config.triggers.raidChance || 0.0005;
  if (Math.random() < chance) {
    await startRaid(client);
    return true;
  }

  return false;
}

async function handleRaidButton(interaction) {
  const customId = interaction.customId;

  if (customId === "raid_join") {
    await handleRaidJoin(interaction);
  }
}

function hasActiveRaid() {
  return activeRaid !== null;
}

module.exports = {
  startRaid,
  handleRaidJoin,
  handleForceRaidCommand,
  checkRaidTrigger,
  handleRaidButton,
  hasActiveRaid,
};