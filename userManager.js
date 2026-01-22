const fs = require('node:fs');
const path = require('node:path');

const DB_DIR = path.join(__dirname, 'data', 'db');

// ⚙️ CONFIGURATION ÉCONOMIE - Facile à ajuster
const ECONOMY_CONFIG = {
  // Récompense par message (min-max)
  messageReward: {
    min: 5,
    max: 15
  },
  // Cooldown entre récompenses (en millisecondes) - 30 secondes
  rewardCooldown: 30000,
  // Longueur minimum du message pour être récompensé
  minMessageLength: 5,
  // Nombre de messages uniques récents à garder pour anti-spam
  recentMessagesCount: 5
};

/**
 * Charge les données d'un utilisateur
 * @param {string} userId - ID Discord de l'utilisateur
 * @returns {Object} Données de l'utilisateur
 */
function loadUserData(userId) {
  const filePath = path.join(DB_DIR, `${userId}.json`);

  const defaultData = {
    userId: userId,
    cards: {},
    lastBoosterOpen: null,
    money: 0,
    inventory: {
      boosters: {}
    },
    rewardCooldown: null,
    recentMessages: [],
    stats: {
      totalBoosters: 0,
      totalCards: 0,
      totalMoneyEarned: 0
    }
  };

  try {
    if (!fs.existsSync(filePath)) {
      return defaultData;
    }
    const fileData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    // Merge avec defaultData pour gérer les nouveaux champs
    return {
      ...defaultData,
      ...fileData,
      inventory: { ...defaultData.inventory, ...fileData.inventory },
      stats: { ...defaultData.stats, ...fileData.stats }
    };
  } catch (error) {
    console.error(`Erreur lors du chargement des données utilisateur ${userId}:`, error);
    return defaultData;
  }
}

/**
 * Sauvegarde les données d'un utilisateur
 * @param {string} userId - ID Discord de l'utilisateur
 * @param {Object} data - Données à sauvegarder
 */
function saveUserData(userId, data) {
  const filePath = path.join(DB_DIR, `${userId}.json`);

  try {
    // Créer le dossier s'il n'existe pas
    if (!fs.existsSync(DB_DIR)) {
      fs.mkdirSync(DB_DIR, { recursive: true });
    }

    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (error) {
    console.error(`Erreur lors de la sauvegarde des données utilisateur ${userId}:`, error);
    throw error;
  }
}

/**
 * Vérifie si l'utilisateur peut ouvrir un booster aujourd'hui
 * @param {string} userId - ID Discord de l'utilisateur
 * @returns {boolean} true si l'utilisateur peut ouvrir un booster
 */
function canOpenBooster(userId) {
  const userData = loadUserData(userId);
  const today = getTodayDate();

  return userData.lastBoosterOpen !== today;
}

/**
 * Ajoute des cartes à la collection d'un utilisateur
 * @param {string} userId - ID Discord de l'utilisateur
 * @param {number[]} cardIds - IDs des cartes à ajouter
 */
function addCardsToUser(userId, cardIds) {
  const userData = loadUserData(userId);

  cardIds.forEach(cardId => {
    const id = String(cardId);
    userData.cards[id] = (userData.cards[id] || 0) + 1;
  });

  // Mettre à jour les stats
  userData.stats.totalCards += cardIds.length;
  userData.stats.totalBoosters += 1;
  userData.lastBoosterOpen = getTodayDate();

  saveUserData(userId, userData);
}

/**
 * Obtient la date d'aujourd'hui au format YYYY-MM-DD (timezone Europe/Paris)
 * @returns {string} Date du jour
 */
function getTodayDate() {
  const now = new Date();
  // Convertir en timezone Europe/Paris
  const parisTime = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Paris' }));

  const year = parisTime.getFullYear();
  const month = String(parisTime.getMonth() + 1).padStart(2, '0');
  const day = String(parisTime.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

/**
 * Retire une carte de la collection d'un utilisateur
 * @param {string} userId - ID Discord de l'utilisateur
 * @param {number} cardId - ID de la carte à retirer
 * @returns {boolean} true si la carte a été retirée avec succès
 */
function removeCardFromUser(userId, cardId) {
  const userData = loadUserData(userId);
  const id = String(cardId);

  if (!userData.cards[id] || userData.cards[id] <= 0) {
    return false;
  }

  userData.cards[id] -= 1;
  if (userData.cards[id] === 0) {
    delete userData.cards[id];
  }

  saveUserData(userId, userData);
  return true;
}

/**
 * Vérifie si un utilisateur possède une carte
 * @param {string} userId - ID Discord de l'utilisateur
 * @param {number} cardId - ID de la carte
 * @returns {boolean} true si l'utilisateur possède la carte
 */
function userHasCard(userId, cardId) {
  const userData = loadUserData(userId);
  const id = String(cardId);
  return userData.cards[id] && userData.cards[id] > 0;
}

/**
 * Obtient le nombre de cartes possédées pour un booster donné
 * @param {string} userId - ID Discord de l'utilisateur
 * @param {number|string} boosterId - ID du booster
 * @returns {Object} { owned: number, total: number }
 */
function getBoosterCompletion(userId, boosterId) {
  const userData = loadUserData(userId);
  const boosters = require('./data/boosters.json');
  const cards = require('./data/cards.json');

  const booster = boosters[boosterId];
  if (!booster) {
    return { owned: 0, total: 0 };
  }

  // Compter les cartes possédées de ce booster (comparer en string pour supporter les IDs promo)
  let owned = 0;
  Object.keys(cards).forEach(cardId => {
    const card = cards[cardId];
    if (String(card.boosterPackId) === String(boosterId) && userData.cards[cardId]) {
      owned++;
    }
  });

  return { owned, total: booster.totalCards };
}

/**
 * Ajoute de l'argent à un utilisateur
 * @param {string} userId - ID Discord de l'utilisateur
 * @param {number} amount - Montant à ajouter
 */
function addMoney(userId, amount) {
  const userData = loadUserData(userId);
  userData.money = (userData.money || 0) + amount;
  userData.stats.totalMoneyEarned = (userData.stats.totalMoneyEarned || 0) + amount;
  saveUserData(userId, userData);
  return userData.money;
}

/**
 * Retire de l'argent à un utilisateur
 * @param {string} userId - ID Discord de l'utilisateur
 * @param {number} amount - Montant à retirer
 * @returns {boolean} true si la transaction a réussi
 */
function removeMoney(userId, amount) {
  const userData = loadUserData(userId);
  if ((userData.money || 0) < amount) {
    return false;
  }
  userData.money -= amount;
  saveUserData(userId, userData);
  return true;
}

/**
 * Obtient le solde d'un utilisateur
 * @param {string} userId - ID Discord de l'utilisateur
 * @returns {number} Solde actuel
 */
function getMoney(userId) {
  const userData = loadUserData(userId);
  return userData.money || 0;
}

/**
 * Ajoute un booster à l'inventaire
 * @param {string} userId - ID Discord de l'utilisateur
 * @param {string|number} boosterId - ID du booster
 * @param {number} quantity - Quantité à ajouter (défaut: 1)
 */
function addBoosterToInventory(userId, boosterId, quantity = 1) {
  const userData = loadUserData(userId);
  const id = String(boosterId);
  userData.inventory.boosters[id] = (userData.inventory.boosters[id] || 0) + quantity;
  saveUserData(userId, userData);
}

/**
 * Retire un booster de l'inventaire
 * @param {string} userId - ID Discord de l'utilisateur
 * @param {string|number} boosterId - ID du booster
 * @returns {boolean} true si le booster a été retiré
 */
function removeBoosterFromInventory(userId, boosterId) {
  const userData = loadUserData(userId);
  const id = String(boosterId);

  if (!userData.inventory.boosters[id] || userData.inventory.boosters[id] <= 0) {
    return false;
  }

  userData.inventory.boosters[id] -= 1;
  if (userData.inventory.boosters[id] === 0) {
    delete userData.inventory.boosters[id];
  }

  saveUserData(userId, userData);
  return true;
}

/**
 * Obtient l'inventaire de boosters d'un utilisateur
 * @param {string} userId - ID Discord de l'utilisateur
 * @returns {Object} Inventaire de boosters
 */
function getBoosterInventory(userId) {
  const userData = loadUserData(userId);
  return userData.inventory.boosters || {};
}

/**
 * Vérifie et attribue une récompense pour un message
 * Anti-spam: vérifie le cooldown et les messages dupliqués
 * @param {string} userId - ID Discord de l'utilisateur
 * @param {string} messageContent - Contenu du message
 * @returns {number|null} Montant gagné ou null si pas de récompense
 */
function processMessageReward(userId, messageContent) {
  // Vérifier la longueur minimum
  if (messageContent.length < ECONOMY_CONFIG.minMessageLength) {
    return null;
  }

  const userData = loadUserData(userId);
  const now = Date.now();

  // Vérifier le cooldown
  if (userData.rewardCooldown && now - userData.rewardCooldown < ECONOMY_CONFIG.rewardCooldown) {
    return null;
  }

  // Anti-spam: vérifier les messages dupliqués
  const normalizedMessage = messageContent.toLowerCase().trim();
  const recentMessages = userData.recentMessages || [];

  if (recentMessages.includes(normalizedMessage)) {
    return null;
  }

  // Mettre à jour les messages récents
  recentMessages.push(normalizedMessage);
  if (recentMessages.length > ECONOMY_CONFIG.recentMessagesCount) {
    recentMessages.shift();
  }

  // Calculer la récompense aléatoire
  const reward = Math.floor(
    Math.random() * (ECONOMY_CONFIG.messageReward.max - ECONOMY_CONFIG.messageReward.min + 1)
  ) + ECONOMY_CONFIG.messageReward.min;

  // Mettre à jour les données
  userData.money = (userData.money || 0) + reward;
  userData.stats.totalMoneyEarned = (userData.stats.totalMoneyEarned || 0) + reward;
  userData.rewardCooldown = now;
  userData.recentMessages = recentMessages;

  saveUserData(userId, userData);
  return reward;
}

/**
 * Ajoute une carte spécifique à la collection (pour les achats)
 * @param {string} userId - ID Discord de l'utilisateur
 * @param {string|number} cardId - ID de la carte
 */
function addCardToUser(userId, cardId) {
  const userData = loadUserData(userId);
  const id = String(cardId);
  userData.cards[id] = (userData.cards[id] || 0) + 1;
  userData.stats.totalCards += 1;
  saveUserData(userId, userData);
}

/**
 * Vérifie si l'utilisateur possède déjà une carte limitée
 * @param {string} userId - ID Discord de l'utilisateur
 * @param {string|number} cardId - ID de la carte
 * @returns {boolean} true si l'utilisateur possède déjà la carte
 */
function hasLimitedCard(userId, cardId) {
  const userData = loadUserData(userId);
  const id = String(cardId);
  return userData.cards[id] && userData.cards[id] > 0;
}

module.exports = {
  loadUserData,
  saveUserData,
  canOpenBooster,
  addCardsToUser,
  removeCardFromUser,
  userHasCard,
  getBoosterCompletion,
  getTodayDate,
  addMoney,
  removeMoney,
  getMoney,
  addBoosterToInventory,
  removeBoosterFromInventory,
  getBoosterInventory,
  processMessageReward,
  addCardToUser,
  hasLimitedCard,
  ECONOMY_CONFIG
};
