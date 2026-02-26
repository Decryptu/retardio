/**
 * One-time migration script: Recover historical flip losses from Discord message history.
 *
 * This script:
 * 1. Connects to Discord using the bot token
 * 2. Scans all text channels in the server for bot messages matching "PERDU"
 * 3. Extracts who lost how much from interaction metadata
 * 4. Updates each user's data/db/{userId}.json with totalMoneyLost
 *
 * Usage: node scripts/migrate-flip-losses.js
 *
 * Run this ONCE, then deploy the updated bot code.
 */

require('dotenv').config();
const { Client, GatewayIntentBits, ChannelType } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');

const GUILD_ID = '1266723885295079445';
const BOT_ID = '1334577967917043743';
const DB_DIR = path.join(__dirname, '../data/db');

// Regex to match loss messages: "PERDU ! Vous avez perdu XX P."
const LOSS_REGEX = /PERDU\s*!?\s*(?:\*\*PERDU\s*!?\*\*\s*)?Vous avez perdu (\d+) P/i;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// Track losses per user: { userId: totalLost }
const userLosses = {};

/**
 * Fetch all messages from a channel, going back through history
 */
async function fetchAllMessages(channel) {
  const messages = [];
  let lastId = null;

  while (true) {
    const options = { limit: 100 };
    if (lastId) options.before = lastId;

    const batch = await channel.messages.fetch(options);
    if (batch.size === 0) break;

    messages.push(...batch.values());
    lastId = batch.last().id;

    // Small delay to avoid rate limits
    await new Promise(r => setTimeout(r, 200));
  }

  return messages;
}

async function main() {
  console.log('Connecting to Discord...');

  await client.login(process.env.DISCORD_TOKEN);
  console.log(`Logged in as ${client.user.tag}`);

  const guild = await client.guilds.fetch(GUILD_ID);
  console.log(`Found guild: ${guild.name}`);

  // Get all text channels
  const channels = await guild.channels.fetch();
  const textChannels = channels.filter(
    ch => ch && (ch.type === ChannelType.GuildText || ch.type === ChannelType.PublicThread || ch.type === ChannelType.PrivateThread)
  );

  console.log(`Found ${textChannels.size} text channels to scan\n`);

  let totalLossMessages = 0;
  let totalChannelsScanned = 0;

  for (const [channelId, channel] of textChannels) {
    try {
      totalChannelsScanned++;
      process.stdout.write(`[${totalChannelsScanned}/${textChannels.size}] Scanning #${channel.name}...`);

      const messages = await fetchAllMessages(channel);

      // Filter bot messages that match the loss pattern
      let channelLosses = 0;
      for (const msg of messages) {
        if (msg.author.id !== BOT_ID) continue;

        const match = msg.content.match(LOSS_REGEX);
        if (!match) continue;

        const lossAmount = parseInt(match[1]);

        // Get the user who triggered this interaction
        // Discord.js stores this in msg.interaction (for slash command responses)
        let userId = null;

        if (msg.interaction) {
          userId = msg.interaction.user?.id || msg.interaction.user;
        } else if (msg.interactionMetadata) {
          userId = msg.interactionMetadata.user?.id || msg.interactionMetadata.user;
        }

        // Fallback: check if the message is a reply to someone
        if (!userId && msg.reference) {
          try {
            const referenced = await channel.messages.fetch(msg.reference.messageId);
            userId = referenced.author.id;
          } catch {
            // Referenced message might be deleted
          }
        }

        // Fallback: check mentions
        if (!userId && msg.mentions.users.size > 0) {
          userId = msg.mentions.users.first().id;
        }

        if (!userId) {
          console.log(`\n  WARNING: Could not determine user for loss message (${lossAmount} P) in #${channel.name} at ${msg.createdAt.toISOString()}`);
          continue;
        }

        userLosses[userId] = (userLosses[userId] || 0) + lossAmount;
        channelLosses++;
        totalLossMessages++;
      }

      if (channelLosses > 0) {
        console.log(` ${channelLosses} losses found`);
      } else {
        console.log(` no losses`);
      }
    } catch (error) {
      console.log(` SKIPPED (no access or error: ${error.message})`);
    }
  }

  console.log(`\n========== RESULTS ==========`);
  console.log(`Total loss messages found: ${totalLossMessages}`);
  console.log(`Users with losses: ${Object.keys(userLosses).length}\n`);

  // Display per-user losses
  const sortedUsers = Object.entries(userLosses).sort((a, b) => b[1] - a[1]);
  for (const [userId, totalLost] of sortedUsers) {
    // Try to get username
    let username = userId;
    try {
      const user = await client.users.fetch(userId);
      username = user.username;
    } catch {}
    console.log(`  ${username} (${userId}): ${totalLost} P lost`);
  }

  // Ask for confirmation before writing
  console.log(`\n========== APPLYING TO DATABASE ==========`);

  // Ensure DB directory exists
  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }

  let updatedCount = 0;
  for (const [userId, totalLost] of sortedUsers) {
    const filePath = path.join(DB_DIR, `${userId}.json`);

    let userData;
    try {
      if (fs.existsSync(filePath)) {
        userData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      } else {
        console.log(`  WARNING: No data file for ${userId}, skipping (user has no saved data yet)`);
        continue;
      }
    } catch (error) {
      console.log(`  ERROR reading ${userId}.json: ${error.message}`);
      continue;
    }

    // Initialize stats if missing
    if (!userData.stats) userData.stats = {};

    // Set the historical loss total
    userData.stats.totalMoneyLost = (userData.stats.totalMoneyLost || 0) + totalLost;

    fs.writeFileSync(filePath, JSON.stringify(userData, null, 2), 'utf8');
    updatedCount++;
    console.log(`  Updated ${userId}.json: totalMoneyLost = ${userData.stats.totalMoneyLost} P`);
  }

  console.log(`\nDone! Updated ${updatedCount} user files.`);

  client.destroy();
  process.exit(0);
}

main().catch(error => {
  console.error('Fatal error:', error);
  client.destroy();
  process.exit(1);
});
