const { MessageFlags } = require('discord.js');
const crypto = require('node:crypto');
const { loadUserData, addMoney, removeMoney } = require('../../services/userManager');

/**
 * Gere la commande /flip (pile ou face)
 */
async function handleFlipCommand(interaction) {
  const userId = interaction.user.id;
  const bet = interaction.options.getInteger('mise');

  // Verifier que la mise est valide
  if (bet < 1 || bet > 100) {
    return interaction.reply({
      content: '❌ La mise doit etre entre 1 et 100 Poke Dollars.',
      flags: MessageFlags.Ephemeral
    });
  }

  // Verifier que l'utilisateur a assez d'argent
  const userData = loadUserData(userId);
  const currentMoney = userData.money || 0;

  if (currentMoney < bet) {
    return interaction.reply({
      content: `❌ Vous n'avez pas assez de Poke Dollars ! (Solde: ${currentMoney} P)`,
      flags: MessageFlags.Ephemeral
    });
  }

  // Retirer la mise
  removeMoney(userId, bet);

  // 0.01% x10, 0.99% x3, 48% x2, 51% perte
  const roll = crypto.randomInt(0, 10000);

  if (roll === 0) {
    // MEGA JACKPOT! x10 (0.01%)
    const winAmount = bet * 10;
    const newBalance = addMoney(userId, winAmount);

    return interaction.reply({
      content: `💰 **MEGA JACKPOT !!!** Vous avez mise ${bet} P et gagne ${bet * 9} P !\n` +
        `Nouveau solde: ${newBalance} P`
    });
  } else if (roll <= 99) {
    // JACKPOT! x3 (0.99%)
    const winAmount = bet * 3;
    const newBalance = addMoney(userId, winAmount);

    return interaction.reply({
      content: `💎 **JACKPOT !** Vous avez mise ${bet} P et gagne ${bet * 2} P !\n` +
        `Nouveau solde: ${newBalance} P`
    });
  } else if (roll <= 4899) {
    // Gagner = doubler la mise (48%)
    const winAmount = bet * 2;
    const newBalance = addMoney(userId, winAmount);

    return interaction.reply({
      content: `🎉 **GAGNE !** Vous avez mise ${bet} P et gagne ${bet} P !\n` +
        `Nouveau solde: ${newBalance} P`
    });
  } else {
    // Perdre = perdre la mise (51%)
    const userData = loadUserData(userId);
    const newBalance = userData.money || 0;

    return interaction.reply({
      content: `😢 **PERDU !** Vous avez perdu ${bet} P.\n` +
        `Nouveau solde: ${newBalance} P`
    });
  }
}

module.exports = {
  handleFlipCommand
};
