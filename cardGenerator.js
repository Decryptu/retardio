const crypto = require('crypto');
const boosters = require('./data/boosters.json');
const cards = require('./data/cards.json');

/**
 * Génère un nombre aléatoire cryptographiquement sécurisé entre min (inclus) et max (exclus)
 * @param {number} min - Minimum (inclus)
 * @param {number} max - Maximum (exclus)
 * @returns {number} Nombre aléatoire
 */
function secureRandomInt(min, max) {
  return crypto.randomInt(min, max);
}

/**
 * Sélectionne une rareté basée sur les probabilités
 * @param {Object} rarities - Configuration des raretés du booster
 * @returns {string} Nom de la rareté tirée
 */
function selectRarity(rarities) {
  const rand = Math.random(); // On peut utiliser Math.random() pour la sélection de rareté
  let cumulative = 0;

  const rarityKeys = ['legendary', 'epic', 'rare', 'uncommon', 'common']; // Ordre décroissant

  for (const rarityKey of rarityKeys) {
    const rarity = rarities[rarityKey];
    cumulative += rarity.probability;
    if (rand < cumulative) {
      return rarityKey;
    }
  }

  return 'common'; // Fallback
}

/**
 * Tire une carte aléatoire d'une rareté donnée
 * @param {Object} rarities - Configuration des raretés
 * @param {string} rarityKey - Clé de la rareté
 * @returns {number} ID de la carte tirée
 */
function drawCardFromRarity(rarities, rarityKey) {
  const rarity = rarities[rarityKey];
  const cardIds = rarity.cardIds;
  const randomIndex = secureRandomInt(0, cardIds.length);
  return cardIds[randomIndex];
}

/**
 * Vérifie si une rareté est au moins aussi rare que la minimum requise
 * @param {string} rarity - Rareté à vérifier
 * @param {string} minRarity - Rareté minimum
 * @returns {boolean}
 */
function isRarityAtLeast(rarity, minRarity) {
  const rarityOrder = {
    'common': 0,
    'uncommon': 1,
    'rare': 2,
    'epic': 3,
    'legendary': 4
  };

  return rarityOrder[rarity] >= rarityOrder[minRarity];
}

/**
 * Obtient la rareté d'une carte
 * @param {number} cardId - ID de la carte
 * @returns {string} Rareté de la carte
 */
function getCardRarity(cardId) {
  const card = cards[String(cardId)];
  return card ? card.rarity : 'common';
}

/**
 * Tire 5 cartes aléatoires d'un booster avec garantie de rareté
 * @param {number} boosterId - ID du booster
 * @returns {number[]} Tableau de 5 IDs de cartes
 */
function drawBoosterPack(boosterId) {
  const booster = boosters[boosterId];
  if (!booster) {
    throw new Error(`Booster ${boosterId} introuvable`);
  }

  const drawnCards = [];
  const rarities = booster.rarities;
  const cardsPerPack = booster.cardsPerPack || 5;
  const minRarity = booster.guarantees?.minRarity || 'uncommon';

  // Tirer les cartes normalement
  for (let i = 0; i < cardsPerPack; i++) {
    const rarityKey = selectRarity(rarities);
    const cardId = drawCardFromRarity(rarities, rarityKey);
    drawnCards.push(cardId);
  }

  // Vérifier la garantie de rareté
  const hasGuaranteedRarity = drawnCards.some(cardId => {
    const rarity = getCardRarity(cardId);
    return isRarityAtLeast(rarity, minRarity);
  });

  // Si pas de carte garantie, remplacer la dernière carte par une carte garantie
  if (!hasGuaranteedRarity) {
    const guaranteedRarities = Object.keys(rarities).filter(key =>
      isRarityAtLeast(key, minRarity)
    );

    // Calculer la somme des probabilités pour normalisation
    const totalProb = guaranteedRarities.reduce((sum, key) => {
      return sum + rarities[key].probability;
    }, 0);

    // Sélectionner une rareté garantie aléatoirement (pondérée, normalisée)
    let guaranteedRarity = minRarity;
    const rand = Math.random();
    let cumulative = 0;

    for (const rarityKey of guaranteedRarities) {
      const rarity = rarities[rarityKey];
      cumulative += rarity.probability / totalProb; // Normaliser
      if (rand < cumulative) {
        guaranteedRarity = rarityKey;
        break;
      }
    }

    // Remplacer la dernière carte
    const guaranteedCard = drawCardFromRarity(rarities, guaranteedRarity);
    drawnCards[drawnCards.length - 1] = guaranteedCard;
  }

  return drawnCards;
}

/**
 * Obtient les informations d'une carte
 * @param {number} cardId - ID de la carte
 * @returns {Object} Informations de la carte
 */
function getCardInfo(cardId) {
  const card = cards[String(cardId)];
  if (!card) {
    return null;
  }

  const booster = boosters[card.boosterPackId];
  const rarityData = booster.rarities[card.rarity];

  return {
    ...card,
    rarityColor: rarityData?.color || '#FFFFFF',
    rarityName: rarityData?.name || card.rarity
  };
}

/**
 * Obtient toutes les cartes d'un booster
 * @param {number} boosterId - ID du booster
 * @returns {Object[]} Tableau d'informations de cartes
 */
function getAllCardsFromBooster(boosterId) {
  const allCards = [];

  Object.values(cards).forEach(card => {
    if (card.boosterPackId === boosterId) {
      allCards.push(getCardInfo(card.id));
    }
  });

  // Trier par ID
  allCards.sort((a, b) => a.id - b.id);

  return allCards;
}

module.exports = {
  drawBoosterPack,
  getCardInfo,
  getCardRarity,
  getAllCardsFromBooster
};
