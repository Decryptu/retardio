const crypto = require('node:crypto');
const boosters = require('../../data/boosters.json');
const cards = require('../../data/cards.json');
const rarities = require('../../data/rarities.json');
const godpackConfig = require('../../data/godpack.json');

/**
 * Cache des cardIds groupés par booster et rareté
 * Structure: { boosterId: { rarityKey: [cardIds...] } }
 */
const cardIdsCache = {};

/**
 * Construit le cache des cardIds au démarrage
 */
function buildCardIdsCache() {
  Object.values(cards).forEach(card => {
    const boosterId = card.boosterPackId;
    const rarity = card.rarity;

    if (!cardIdsCache[boosterId]) {
      cardIdsCache[boosterId] = {};
    }

    if (!cardIdsCache[boosterId][rarity]) {
      cardIdsCache[boosterId][rarity] = [];
    }

    cardIdsCache[boosterId][rarity].push(card.id);
  });

  console.log('✅ Cache des cardIds construit:', JSON.stringify(cardIdsCache, null, 2));
}

// Construire le cache au chargement du module
buildCardIdsCache();

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
 * @param {number} boosterId - ID du booster
 * @returns {string} Nom de la rareté tirée
 */
function selectRarity(boosterId) {
  const rand = Math.random(); // On peut utiliser Math.random() pour la sélection de rareté
  let cumulative = 0;

  // Ordre de priorité pour les raretés (du plus rare au plus commun)
  const rarityOrder = ['legendary', 'epic', 'rare', 'uncommon', 'common'];
  // Ne garder que les raretés qui existent dans ce booster
  const rarityKeys = rarityOrder.filter(key => cardIdsCache[boosterId]?.[key]);

  for (const rarityKey of rarityKeys) {
    const rarity = rarities[rarityKey];
    if (!rarity) continue;
    cumulative += rarity.probability;
    if (rand < cumulative) {
      return rarityKey;
    }
  }

  // Fallback sur la première rareté disponible
  return rarityKeys[rarityKeys.length - 1] || 'common';
}

/**
 * Tire une carte aléatoire d'une rareté donnée
 * @param {number} boosterId - ID du booster
 * @param {string} rarityKey - Clé de la rareté
 * @returns {number} ID de la carte tirée
 */
function drawCardFromRarity(boosterId, rarityKey) {
  const cardIds = cardIdsCache[boosterId]?.[rarityKey];
  if (!cardIds || cardIds.length === 0) {
    throw new Error(`Aucune carte de rareté ${rarityKey} trouvée dans le booster ${boosterId}`);
  }
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
 * @returns {Object} { cards: number[], isGodPack: boolean }
 */
function drawBoosterPack(boosterId) {
  const booster = boosters[boosterId];
  if (!booster) {
    throw new Error(`Booster ${boosterId} introuvable`);
  }

  const drawnCards = [];
  const cardsPerPack = booster.cardsPerPack || 5;
  let minRarity = booster.guarantees?.minRarity || 'uncommon';

  // God Pack: utiliser la configuration de godpack.json
  const godPackProbability = godpackConfig.probability;
  const isGodPack = Math.random() < godPackProbability;
  if (isGodPack) {
    minRarity = godpackConfig.minRarity; // Toutes les cartes seront au moins Rare
    console.log('🌟 GOD PACK ACTIVATED! 🌟');
  }

  // Tirer les cartes
  for (let i = 0; i < cardsPerPack; i++) {
    let rarityKey;

    if (isGodPack) {
      // Pour God Pack, tirer uniquement parmi les raretés qui respectent minRarity
      const availableRarities = Object.keys(cardIdsCache[boosterId] || {});
      const godRarities = availableRarities.filter(key =>
        isRarityAtLeast(key, godpackConfig.minRarity)
      );
      const totalProb = godRarities.reduce((sum, key) => {
        return sum + (rarities[key]?.probability || 0);
      }, 0);
      const rand = Math.random();
      let cumulative = 0;

      for (const key of godRarities) {
        cumulative += (rarities[key]?.probability || 0) / totalProb;
        if (rand < cumulative) {
          rarityKey = key;
          break;
        }
      }
      if (!rarityKey) rarityKey = godpackConfig.minRarity; // Fallback
    } else {
      // Tirage normal
      rarityKey = selectRarity(boosterId);
    }

    const cardId = drawCardFromRarity(boosterId, rarityKey);
    drawnCards.push(cardId);
  }

  // Vérifier la garantie de rareté (sauf si God Pack, déjà garanti)
  if (!isGodPack) {
    const hasGuaranteedRarity = drawnCards.some(cardId => {
      const rarity = getCardRarity(cardId);
      return isRarityAtLeast(rarity, minRarity);
    });

    // Si pas de carte garantie, remplacer la dernière carte par une carte garantie
    if (!hasGuaranteedRarity) {
      const availableRarities = Object.keys(cardIdsCache[boosterId] || {});
      const guaranteedRarities = availableRarities.filter(key =>
        isRarityAtLeast(key, minRarity)
      );

      // Calculer la somme des probabilités pour normalisation
      const totalProb = guaranteedRarities.reduce((sum, key) => {
        return sum + (rarities[key]?.probability || 0);
      }, 0);

      // Sélectionner une rareté garantie aléatoirement (pondérée, normalisée)
      let guaranteedRarity = minRarity;
      const rand = Math.random();
      let cumulative = 0;

      for (const rarityKey of guaranteedRarities) {
        const rarityData = rarities[rarityKey];
        if (!rarityData) continue;
        cumulative += rarityData.probability / totalProb; // Normaliser
        if (rand < cumulative) {
          guaranteedRarity = rarityKey;
          break;
        }
      }

      // Remplacer la dernière carte
      const guaranteedCard = drawCardFromRarity(boosterId, guaranteedRarity);
      drawnCards[drawnCards.length - 1] = guaranteedCard;
    }
  }

  return { cards: drawnCards, isGodPack };
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

  const rarityData = rarities[card.rarity];

  return {
    ...card,
    rarityColor: rarityData?.color || '#FFFFFF',
    rarityName: rarityData?.name || card.rarity
  };
}

/**
 * Obtient toutes les cartes d'un booster
 * @param {number|string} boosterId - ID du booster
 * @returns {Object[]} Tableau d'informations de cartes
 */
function getAllCardsFromBooster(boosterId) {
  const allCards = [];

  Object.values(cards).forEach(card => {
    // Comparer en tant que strings pour supporter les IDs numériques et string
    if (String(card.boosterPackId) === String(boosterId)) {
      allCards.push(getCardInfo(card.id));
    }
  });

  // Trier par ID (gère les IDs string comme "promo_1")
  allCards.sort((a, b) => {
    const aNum = parseInt(a.id);
    const bNum = parseInt(b.id);
    if (!Number.isNaN(aNum) && !Number.isNaN(bNum)) {
      return aNum - bNum;
    }
    return String(a.id).localeCompare(String(b.id));
  });

  return allCards;
}

module.exports = {
  drawBoosterPack,
  getCardInfo,
  getCardRarity,
  getAllCardsFromBooster
};
