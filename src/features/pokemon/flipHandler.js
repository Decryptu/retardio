const { MessageFlags } = require('discord.js');
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

  // 49% de chance de gagner
  const won = Math.random() < 0.49;

  if (won) {
    // Gagner = doubler la mise (récupérer la mise + le gain)
    const winAmount = bet * 2;
    addMoney(userId, winAmount);
    const newBalance = currentMoney + bet; // currentMoney - bet + (bet * 2) = currentMoney + bet

    return interaction.reply({
      content: `🎉 **GAGNE !** Vous avez mise ${bet} P et gagne ${bet} P !\n` +
        `Nouveau solde: ${newBalance} P`
    });
  } else {
    // Perdre = perdre la mise
    const newBalance = currentMoney - bet;

    return interaction.reply({
      content: `😢 **PERDU !** Vous avez perdu ${bet} P.\n` +
        `Nouveau solde: ${newBalance} P`
    });
  }
}

module.exports = {
  handleFlipCommand
};
