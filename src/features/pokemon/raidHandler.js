const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require('discord.js');
const OpenAI = require('openai');
const { getCardInfo } = require('../../services/cardGenerator');
const { loadUserData, getTeam, hasTeamMember, addCardToUser, addMoney } = require('../../services/userManager');
const { generateRaidBossImage, generateRaidResultImage } = require('../../services/imageGenerator');
const config = require('../../config');
const boosters = require('../../../data/boosters.json');
const cards = require('../../../data/cards.json');
const { ADMIN_WHITELIST } = require('./tradeHandler');

// OpenAI client
const openai = new OpenAI({
  apiKey: config.openaiApiKey
});

// Raid actif (un seul a la fois)
let activeRaid = null;

// Duree du raid en ms (5 minutes)
const RAID_DURATION = 5 * 60 * 1000;

/**
 * Selectionne un boss de raid aleatoire
 * Probabilites: 50% uncommon, 40% rare, 10% legendary
 */
function selectRaidBoss() {
  const rand = Math.random();
  let targetRarity;
  let level;

  if (rand < 0.5) {
    targetRarity = 'uncommon';
    level = 50;
  } else if (rand < 0.9) {
    targetRarity = 'rare';
    level = 75;
  } else {
    targetRarity = 'legendary';
    level = 100;
  }

  // Collecter toutes les cartes de cette rarete (hors promo)
  const eligibleCards = Object.values(cards).filter(card => {
    // Exclure les promos
    if (card.isPromo || String(card.id).includes('promo')) return false;
    return card.rarity === targetRarity;
  });

  if (eligibleCards.length === 0) {
    // Fallback sur n'importe quelle carte non-promo
    const fallbackCards = Object.values(cards).filter(card =>
      !card.isPromo && !String(card.id).includes('promo')
    );
    const randomCard = fallbackCards[Math.floor(Math.random() * fallbackCards.length)];
    return { card: getCardInfo(randomCard.id), level: 50 };
  }

  const randomCard = eligibleCards[Math.floor(Math.random() * eligibleCards.length)];
  return { card: getCardInfo(randomCard.id), level };
}

/**
 * Demarre un raid
 */
async function startRaid(client) {
  if (activeRaid) {
    console.log('Un raid est deja en cours');
    return null;
  }

  const channel = client.channels.cache.get(config.raidChannelId);
  if (!channel) {
    console.error('Canal de raid introuvable:', config.raidChannelId);
    return null;
  }

  const { card: bossCard, level } = selectRaidBoss();

  // Generer l'image du boss
  const bossImageBuffer = await generateRaidBossImage(bossCard, level);
  const attachment = new AttachmentBuilder(bossImageBuffer, { name: 'raid_boss.png' });

  // Creer le bouton pour rejoindre
  const joinButton = new ButtonBuilder()
    .setCustomId('raid_join')
    .setLabel('Rejoindre le Raid')
    .setStyle(ButtonStyle.Success)
    .setEmoji('⚔️');

  const row = new ActionRowBuilder().addComponents(joinButton);

  const raidTypeText = level === 100 ? '**LEGENDAIRE**' :
                       level === 75 ? '**RARE**' :
                       '**PEU COMMUN**';

  const endTime = Date.now() + RAID_DURATION;
  const endTimestamp = Math.floor(endTime / 1000);

  const embed = new EmbedBuilder()
    .setColor(level === 100 ? '#FF8000' : level === 75 ? '#2fd2ff' : '#1EFF00')
    .setTitle('Un Raid est apparu !')
    .setDescription(
      `Un **${bossCard.name}** sauvage de niveau **${level}** est apparu !\n\n` +
      `Type de raid: ${raidTypeText}\n\n` +
      `Le combat commence <t:${endTimestamp}:R>\n\n` +
      `Rejoignez le raid avec votre equipe pour avoir une chance de capturer ce Pokemon !`
    )
    .setImage('attachment://raid_boss.png')
    .setFooter({ text: 'Utilisez /team pour configurer votre equipe avant de rejoindre !' });

  const message = await channel.send({
    content: '@everyone Un raid vient d\'apparaitre !',
    embeds: [embed],
    files: [attachment],
    components: [row]
  });

  // Stocker le raid actif
  activeRaid = {
    messageId: message.id,
    channelId: channel.id,
    bossCard,
    level,
    participants: new Map(), // userId -> { username, team }
    endTime,
    client
  };

  // Programmer la fin du raid
  setTimeout(() => executeRaid(), RAID_DURATION);

  console.log(`Raid demarre: ${bossCard.name} Nv.${level}`);
  return activeRaid;
}

/**
 * Gere le bouton pour rejoindre le raid
 */
async function handleRaidJoin(interaction) {
  if (!activeRaid) {
    return interaction.reply({
      content: '❌ Il n\'y a pas de raid en cours.',
      ephemeral: true
    });
  }

  const userId = interaction.user.id;

  // Verifier si l'utilisateur a deja rejoint
  if (activeRaid.participants.has(userId)) {
    return interaction.reply({
      content: '✅ Vous avez deja rejoint ce raid !',
      ephemeral: true
    });
  }

  // Verifier si l'utilisateur a une equipe
  if (!hasTeamMember(userId)) {
    return interaction.reply({
      content: '❌ Vous devez avoir au moins un Pokemon dans votre equipe pour rejoindre un raid !\n' +
               'Utilisez `/team` pour configurer votre equipe.',
      ephemeral: true
    });
  }

  // Obtenir l'equipe du joueur
  const team = getTeam(userId);
  const teamCards = team
    .filter(cardId => cardId !== null)
    .map(cardId => getCardInfo(cardId))
    .filter(card => card !== null);

  // Ajouter le participant
  activeRaid.participants.set(userId, {
    username: interaction.user.username,
    team: teamCards
  });

  // Mettre a jour le message avec le nombre de participants
  try {
    const channel = interaction.client.channels.cache.get(activeRaid.channelId);
    const message = await channel.messages.fetch(activeRaid.messageId);

    const embed = EmbedBuilder.from(message.embeds[0]);
    const endTimestamp = Math.floor(activeRaid.endTime / 1000);

    const raidTypeText = activeRaid.level === 100 ? '**LEGENDAIRE**' :
                         activeRaid.level === 75 ? '**RARE**' :
                         '**PEU COMMUN**';

    embed.setDescription(
      `Un **${activeRaid.bossCard.name}** sauvage de niveau **${activeRaid.level}** est apparu !\n\n` +
      `Type de raid: ${raidTypeText}\n\n` +
      `Le combat commence <t:${endTimestamp}:R>\n\n` +
      `**Participants: ${activeRaid.participants.size}**\n\n` +
      `Rejoignez le raid avec votre equipe pour avoir une chance de capturer ce Pokemon !`
    );

    await message.edit({ embeds: [embed] });
  } catch (error) {
    console.error('Erreur lors de la mise a jour du message de raid:', error);
  }

  await interaction.reply({
    content: `⚔️ Vous avez rejoint le raid avec ${teamCards.length} Pokemon !\n` +
             `Equipe: ${teamCards.map(c => c.name).join(', ')}`,
    ephemeral: true
  });
}

/**
 * Execute le combat du raid via OpenAI
 */
async function executeRaid() {
  if (!activeRaid) return;

  const raid = activeRaid;
  activeRaid = null; // Liberer le slot

  const channel = raid.client.channels.cache.get(raid.channelId);
  if (!channel) return;

  // Verifier s'il y a des participants
  if (raid.participants.size === 0) {
    const embed = new EmbedBuilder()
      .setColor('#888888')
      .setTitle('Raid echoue...')
      .setDescription(`Le **${raid.bossCard.name}** s'est enfui car personne n'a rejoint le raid.`);

    try {
      const message = await channel.messages.fetch(raid.messageId);
      await message.edit({
        embeds: [embed],
        components: []
      });
    } catch (error) {
      console.error('Erreur lors de la mise a jour du message de raid:', error);
    }
    return;
  }

  // Construire les donnees pour OpenAI
  const participantData = [];
  for (const [userId, data] of raid.participants) {
    participantData.push({
      username: data.username,
      team: data.team.map(card => ({
        name: card.name,
        rarity: card.rarityName
      }))
    });
  }

  const prompt = `You are simulating a Pokemon raid battle. Answer ONLY with raw JSON, no markdown, no code blocks, no extra text.

Raid boss: ${raid.bossCard.name} (${raid.bossCard.rarityName}, Level ${raid.level})
Participants and their teams:
${participantData.map(p => `- ${p.username}: ${p.team.map(t => t.name).join(', ')}`).join('\n')}

Rules:
- Consider type advantages (water>fire, fire>grass, etc)
- Higher level bosses are harder to beat
- More participants = better chance
- Legendary raids (Lv100) are very hard
- Keep the battle realistic but fun

Generate a JSON object with:
- "victory": boolean (did players win?)
- "battleLog": string (short battle summary, 3-5 lines max, use \\n for newlines)

Example format: {"victory":true,"battleLog":"Line1\\nLine2\\nLine3"}`;

  let result = { victory: false, battleLog: 'Le combat fut intense...' };

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You output only valid raw JSON. No markdown, no code blocks, no explanation.' },
        { role: 'user', content: prompt }
      ],
      max_tokens: 512,
      temperature: 0.7
    });

    const responseText = completion.choices[0].message.content.trim();

    // Nettoyer la reponse (enlever les code blocks si presents)
    let cleanJson = responseText;
    if (cleanJson.startsWith('```')) {
      cleanJson = cleanJson.replace(/```json?\n?/g, '').replace(/```/g, '');
    }
    cleanJson = cleanJson.trim();

    result = JSON.parse(cleanJson);
  } catch (error) {
    console.error('Erreur OpenAI pour le raid:', error);
    // Resultat aleatoire en fallback
    result.victory = Math.random() < 0.6;
    result.battleLog = result.victory
      ? 'Les dresseurs ont combine leurs forces...\nLe boss a ete vaincu !'
      : 'Le boss etait trop puissant...\nLes dresseurs ont du battre en retraite.';
  }

  // Distribuer les recompenses si victoire
  const participantIds = Array.from(raid.participants.keys());

  if (result.victory) {
    const bonus = raid.level === 100 ? 0 : raid.level === 75 ? 100 : 250;

    for (const participantId of participantIds) {
      // Donner la carte du boss
      addCardToUser(participantId, raid.bossCard.id);
      // Donner le bonus en Poke Dollars
      if (bonus > 0) {
        addMoney(participantId, bonus);
      }
    }
  }

  // Generer l'image de resultat
  const resultImageBuffer = await generateRaidResultImage(
    raid.bossCard,
    raid.level,
    result.victory,
    participantIds,
    result.battleLog
  );
  const attachment = new AttachmentBuilder(resultImageBuffer, { name: 'raid_result.png' });

  // Creer l'embed de resultat
  const resultEmbed = new EmbedBuilder()
    .setColor(result.victory ? '#00FF00' : '#FF0000')
    .setTitle(result.victory ? 'Raid reussi !' : 'Raid echoue...')
    .setDescription(
      `**${raid.bossCard.name}** (Nv.${raid.level})\n\n` +
      `**Combat:**\n${result.battleLog}\n\n` +
      `**Participants:** ${raid.participants.size}\n` +
      (result.victory
        ? `\n**Recompenses:** ${raid.bossCard.name}` +
          (raid.level === 100 ? '' : ` + ${raid.level === 75 ? '100' : '250'} P`)
        : '\nAucune recompense.')
    )
    .setImage('attachment://raid_result.png');

  // Mentionner les participants
  const mentions = participantIds.map(id => `<@${id}>`).join(' ');

  try {
    const message = await channel.messages.fetch(raid.messageId);
    await message.edit({
      content: result.victory
        ? `${mentions}\nVictoire ! Vous avez vaincu le raid !`
        : `${mentions}\nDefaite... Le boss etait trop puissant.`,
      embeds: [resultEmbed],
      files: [attachment],
      components: []
    });
  } catch (error) {
    console.error('Erreur lors de la mise a jour du message de raid:', error);
    // Envoyer un nouveau message si l'edit echoue
    await channel.send({
      content: result.victory
        ? `${mentions}\nVictoire ! Vous avez vaincu le raid !`
        : `${mentions}\nDefaite... Le boss etait trop puissant.`,
      embeds: [resultEmbed],
      files: [attachment]
    });
  }

  console.log(`Raid termine: ${raid.bossCard.name} - ${result.victory ? 'Victoire' : 'Defaite'}`);
}

/**
 * Commande admin pour forcer un raid
 */
async function handleForceRaidCommand(interaction) {
  const adminId = interaction.user.id;

  if (!ADMIN_WHITELIST.includes(adminId)) {
    return interaction.reply({
      content: '❌ Vous n\'avez pas la permission d\'utiliser cette commande.',
      ephemeral: true
    });
  }

  if (activeRaid) {
    return interaction.reply({
      content: '❌ Un raid est deja en cours !',
      ephemeral: true
    });
  }

  await interaction.reply({
    content: '⚔️ Declenchement d\'un raid...',
    ephemeral: true
  });

  await startRaid(interaction.client);
}

/**
 * Verifie si un raid doit etre declenche (appele a chaque message)
 */
async function checkRaidTrigger(client) {
  if (activeRaid) return false;

  const chance = config.triggers.raidChance || 0.0005;
  if (Math.random() < chance) {
    await startRaid(client);
    return true;
  }

  return false;
}

/**
 * Gere les boutons du raid
 */
async function handleRaidButton(interaction) {
  const customId = interaction.customId;

  if (customId === 'raid_join') {
    await handleRaidJoin(interaction);
  }
}

/**
 * Verifie s'il y a un raid actif
 */
function hasActiveRaid() {
  return activeRaid !== null;
}

module.exports = {
  startRaid,
  handleRaidJoin,
  handleForceRaidCommand,
  checkRaidTrigger,
  handleRaidButton,
  hasActiveRaid
};
