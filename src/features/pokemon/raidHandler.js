const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder, MessageFlags } = require('discord.js');
const OpenAI = require('openai');
const { getCardInfo } = require('../../services/cardGenerator');
const { getTeam, hasTeamMember, addCardToUser, addMoney } = require('../../services/userManager');
const { generateRaidBossImage, generateRaidResultImage } = require('../../services/imageGenerator');
const config = require('../../config');
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

  // Send without content to avoid showing attachment twice
  const message = await channel.send({
    content: '<@&1464335798341206046>',
    embeds: [embed],
    files: [attachment],
    components: [row],
    allowedMentions: { roles: ['1464335798341206046'] }
  });


  // Stocker le raid actif (including the image buffer to avoid duplication on edits)
  activeRaid = {
    messageId: message.id,
    channelId: channel.id,
    bossCard,
    level,
    participants: new Map(), // userId -> { username, team }
    endTime,
    client,
    imageBuffer: bossImageBuffer // Store for potential re-use
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
      flags: MessageFlags.Ephemeral
    });
  }

  const userId = interaction.user.id;

  // Verifier si l'utilisateur a deja rejoint
  if (activeRaid.participants.has(userId)) {
    return interaction.reply({
      content: '✅ Vous avez deja rejoint ce raid !',
      flags: MessageFlags.Ephemeral
    });
  }

  // Verifier si l'utilisateur a une equipe
  if (!hasTeamMember(userId)) {
    return interaction.reply({
      content: '❌ Vous devez avoir au moins un Pokemon dans votre equipe pour rejoindre un raid !\n' +
        'Utilisez `/team` pour configurer votre equipe.',
      flags: MessageFlags.Ephemeral
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
  // We update the message content (not the embed) to avoid attachment duplication issues
  try {
    const channel = interaction.client.channels.cache.get(activeRaid.channelId);
    const message = await channel.messages.fetch(activeRaid.messageId);

    // Build participants list with mentions
    const participantMentions = Array.from(activeRaid.participants.keys())
      .map(id => `<@${id}>`)
      .join(', ');

    const contentText = `**Participants (${activeRaid.participants.size}):** ${participantMentions}`;

    // Only edit the content, leave embed and attachments untouched
    await message.edit({ content: contentText });
  } catch (error) {
    console.error('Erreur lors de la mise a jour du message de raid:', error);
  }

  await interaction.reply({
    content: `⚔️ Vous avez rejoint le raid avec ${teamCards.length} Pokemon !\n` +
      `Equipe: ${teamCards.map(c => c.name).join(', ')}`,
    flags: MessageFlags.Ephemeral
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
  for (const [, data] of raid.participants) {
    participantData.push({
      username: data.username,
      team: data.team.map(card => ({
        name: card.name,
        rarity: card.rarityName
      }))
    });
  }

  // Compter le nombre total de Pokemon participants
  const totalParticipantPokemon = participantData.reduce((sum, p) => sum + p.team.length, 0);

  const prompt = `Tu simules un combat de raid Pokemon. Reponds UNIQUEMENT avec du JSON brut, pas de markdown, pas de blocs de code, pas de texte supplementaire.

Boss du raid: ${raid.bossCard.name} (${raid.bossCard.rarityName}, Niveau ${raid.level})
Participants (${raid.participants.size} dresseurs, ${totalParticipantPokemon} Pokemon au total):
${participantData.map(p => `- ${p.username}: ${p.team.map(t => t.name).join(', ')}`).join('\n')}

REGLES IMPORTANTES:
- C'est un combat ${totalParticipantPokemon} contre 1 (avantage numerique aux dresseurs)
- Respecte les avantages de types Pokemon (Eau>Feu, Feu>Plante, Plante>Eau, Psy>Combat, Combat ne peut PAS toucher Spectre, etc)
- Les noms sont en francais, identifie correctement les types de chaque Pokemon
- Boss plus haut niveau = plus difficile (Nv100 legendaire = tres dur)
- Plus de participants = meilleures chances
- Garde le combat realiste selon la strategie Pokemon

Genere un objet JSON avec:
- "victory": boolean (les joueurs ont-ils gagne?)
- "battleLog": string (resume du combat en francais, 3-5 lignes max, utilise \\n pour les retours a la ligne)

Format exemple: {"victory":true,"battleLog":"Ligne1\\nLigne2\\nLigne3"}`;

  let result = { victory: false, battleLog: 'Le combat fut intense...' };

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'Tu reponds uniquement en JSON brut valide. Pas de markdown, pas de blocs de code, pas d\'explication. Le battleLog doit etre en francais.' },
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

    // S'assurer que les \n dans le battleLog sont bien des retours a la ligne
    if (result.battleLog) {
      // Remplacer les \n litteraux par de vrais retours a la ligne si necessaire
      result.battleLog = result.battleLog.replace(/\\n/g, '\n');
    }
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

  // Generate random bonus based on raid level
  let bonus = 0;
  if (result.victory) {
    if (raid.level === 100) {
      // legendary: 1-100
      bonus = Math.floor(Math.random() * 100) + 1;
    } else if (raid.level === 75) {
      // rare: 100-250
      bonus = Math.floor(Math.random() * 151) + 100;
    } else {
      // uncommon: 250-500
      bonus = Math.floor(Math.random() * 251) + 250;
    }

    for (const participantId of participantIds) {
      // Donner la carte du boss
      addCardToUser(participantId, raid.bossCard.id);
      // Donner le bonus en Poke Dollars
      addMoney(participantId, bonus);
    }
  }

  // Generer l'image de resultat
  const resultImageBuffer = await generateRaidResultImage(
    raid.bossCard,
    raid.level,
    result.victory,
    participantIds,
    result.battleLog,
    bonus
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
        ? `\n**Recompenses:** ${raid.bossCard.name} + ${bonus} P`
        : '\nAucune recompense.')
    )
    .setImage('attachment://raid_result.png');

  // Mentionner les participants
  const mentions = participantIds.map(id => `<@${id}>`).join(' ');

  try {
    const message = await channel.messages.fetch(raid.messageId);
    // Remove components from original message (disable join button)
    await message.edit({
      components: []
    });

    // Send result as a new message to avoid attachment duplication issue
    await channel.send({
      content: result.victory
        ? `${mentions}\nVictoire ! Vous avez vaincu le raid !`
        : `${mentions}\nDefaite... Le boss etait trop puissant.`,
      embeds: [resultEmbed],
      files: [attachment]
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
      flags: MessageFlags.Ephemeral
    });
  }

  if (activeRaid) {
    return interaction.reply({
      content: '❌ Un raid est deja en cours !',
      flags: MessageFlags.Ephemeral
    });
  }

  await interaction.reply({
    content: '⚔️ Declenchement d\'un raid...',
    flags: MessageFlags.Ephemeral
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
