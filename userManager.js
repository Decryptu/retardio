const fs = require('fs');
const path = require('path');

const DB_DIR = path.join(__dirname, 'data', 'db');

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
    stats: {
      totalBoosters: 0,
      totalCards: 0
    }
  };

  try {
    if (!fs.existsSync(filePath)) {
      return defaultData;
    }
    const fileData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return { ...defaultData, ...fileData };
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
 * @param {number} boosterId - ID du booster
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

  // Compter les cartes possédées de ce booster
  let owned = 0;
  Object.keys(cards).forEach(cardId => {
    const card = cards[cardId];
    if (card.boosterPackId === boosterId && userData.cards[cardId]) {
      owned++;
    }
  });

  return { owned, total: booster.totalCards };
}

module.exports = {
  loadUserData,
  saveUserData,
  canOpenBooster,
  addCardsToUser,
  removeCardFromUser,
  userHasCard,
  getBoosterCompletion,
  getTodayDate
};
