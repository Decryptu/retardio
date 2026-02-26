/**
 * One-time migration script: Recover historical flip losses from Discord message history.
 *
 * Uses Discord's guild search API to find only "PERDU" messages from the bot,
 * instead of scanning every message in every channel.
 *
 * Usage: node scripts/migrate-flip-losses.js
 *
 * Run this ONCE, then deploy the updated bot code.
 */

require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');

const GUILD_ID = '1266723885295079445';
const BOT_ID = '1334577967917043743';
const DB_DIR = path.join(__dirname, '../data/db');

// Regex to extract loss amount from message content
const LOSS_REGEX = /PERDU\s*!?\s*(?:\*\*PERDU\s*!?\*\*\s*)?Vous avez perdu (\d+) P/i;

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

// Track losses per user: { userId: totalLost }
const userLosses = {};

/**
 * Search guild messages using Discord's search API.
 * GET /guilds/{guild_id}/messages/search?author_id=...&content=...&offset=...
 * Returns 25 results per page.
 */
async function searchGuildMessages(guildId, authorId, content, offset = 0) {
  const params = new URLSearchParams({
    author_id: authorId,
    content: content,
    offset: String(offset)
  });

  const response = await client.rest.get(
    `/guilds/${guildId}/messages/search?${params.toString()}`
  );

  return response;
}

async function main() {
  console.log('Connecting to Discord...');

  await client.login(process.env.TOKEN);
  console.log(`Logged in as ${client.user.tag}`);

  const guild = await client.guilds.fetch(GUILD_ID);
  console.log(`Found guild: ${guild.name}`);

  // Search for all "PERDU" messages from the bot using guild search API
  console.log(`\nSearching for "PERDU" messages from bot (${BOT_ID})...`);

  let offset = 0;
  let totalResults = null;
  let totalLossMessages = 0;
  let warnings = 0;

  while (true) {
    const result = await searchGuildMessages(GUILD_ID, BOT_ID, 'PERDU', offset);

    if (totalResults === null) {
      totalResults = result.total_results;
      console.log(`Found ${totalResults} messages matching "PERDU" from bot\n`);

      if (totalResults === 0) {
        console.log('No loss messages found. Nothing to migrate.');
        client.destroy();
        process.exit(0);
      }
    }

    // Debug: print first raw result to understand the structure
    if (offset === 0 && result.messages.length > 0) {
      console.log('=== DEBUG: Raw first message group ===');
      console.log(JSON.stringify(result.messages[0], null, 2).slice(0, 3000));
      console.log('=== END DEBUG ===\n');
    }

    // result.messages is an array of arrays (each inner array is the message + context)
    for (const messageGroup of result.messages) {
      // messageGroup might be an array or a single object - handle both
      const messages = Array.isArray(messageGroup) ? messageGroup : [messageGroup];
      const msg = messages.find(m => m.author?.id === BOT_ID);
      if (!msg) continue;

      const match = msg.content?.match(LOSS_REGEX);
      if (!match) continue; // Might be a "PERDU" in a different context

      const lossAmount = parseInt(match[1]);

      // Get the user who triggered this interaction
      let userId = null;

      // interaction_metadata contains the user who used the slash command
      if (msg.interaction_metadata) {
        userId = msg.interaction_metadata.user?.id;
      }
      // Older format
      if (!userId && msg.interaction) {
        userId = msg.interaction.user?.id;
      }
      // Fallback: referenced message
      if (!userId && msg.referenced_message) {
        userId = msg.referenced_message.author?.id;
      }
      // Fallback: mentions
      if (!userId && msg.mentions && msg.mentions.length > 0) {
        userId = msg.mentions[0].id;
      }

      if (!userId) {
        warnings++;
        console.log(`  WARNING: Could not determine user for loss of ${lossAmount} P (msg ID: ${msg.id})`);
        continue;
      }

      userLosses[userId] = (userLosses[userId] || 0) + lossAmount;
      totalLossMessages++;
    }

    offset += result.messages.length;
    process.stdout.write(`\r  Processed ${offset}/${totalResults} search results...`);

    // If we've processed all results, stop
    if (offset >= totalResults || result.messages.length === 0) break;

    // Small delay to respect rate limits (search API is rate-limited)
    await new Promise(r => setTimeout(r, 1000));
  }

  console.log(`\n\n========== RESULTS ==========`);
  console.log(`Total loss messages processed: ${totalLossMessages}`);
  if (warnings > 0) console.log(`Warnings (no user found): ${warnings}`);
  console.log(`Users with losses: ${Object.keys(userLosses).length}\n`);

  // Display per-user losses
  const sortedUsers = Object.entries(userLosses).sort((a, b) => b[1] - a[1]);
  for (const [userId, totalLost] of sortedUsers) {
    let username = userId;
    try {
      const user = await client.users.fetch(userId);
      username = user.username;
    } catch {}
    console.log(`  ${username} (${userId}): ${totalLost} P lost`);
  }

  // Apply to database
  console.log(`\n========== APPLYING TO DATABASE ==========`);

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
        console.log(`  WARNING: No data file for ${userId}, skipping`);
        continue;
      }
    } catch (error) {
      console.log(`  ERROR reading ${userId}.json: ${error.message}`);
      continue;
    }

    if (!userData.stats) userData.stats = {};
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
