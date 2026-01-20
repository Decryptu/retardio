const { createCanvas, loadImage, registerFont } = require('canvas');
const path = require('path');
const fs = require('fs');
const { getCardInfo, getAllCardsFromBooster } = require('./cardGenerator');
const { loadUserData } = require('./userManager');
const boosters = require('./data/boosters.json');

const ASSETS_DIR = path.join(__dirname, 'assets');
const CARD_WIDTH = 300;
const CARD_HEIGHT = 363;
const BOOSTER_WIDTH = 280;
const BOOSTER_HEIGHT = 420;

// Charger la police GameBoy si disponible
const FONT_PATH = path.join(ASSETS_DIR, 'fonts', 'GameBoy.ttf');
let PIXEL_FONT = 'Arial'; // Fallback

if (fs.existsSync(FONT_PATH)) {
  try {
    registerFont(FONT_PATH, { family: 'GameBoy' });
    PIXEL_FONT = 'GameBoy';
    console.log('✅ Police GameBoy.ttf chargée avec succès');
  } catch (error) {
    console.warn('⚠️  Impossible de charger GameBoy.ttf, utilisation d\'Arial');
  }
} else {
  console.warn('⚠️  GameBoy.ttf non trouvée dans assets/fonts/, utilisation d\'Arial');
}

/**
 * Génère l'image d'ouverture d'un booster (5 cartes)
 * @param {number[]} cardIds - IDs des 5 cartes tirées
 * @param {boolean} isGodPack - Si c'est un God Pack
 * @returns {Buffer} Buffer PNG de l'image générée
 */
async function generateBoosterOpeningImage(cardIds, isGodPack = false) {
  // Dimensions de l'image finale
  const padding = 20;
  const cardSpacing = 15;
  const totalWidth = (CARD_WIDTH * 5) + (cardSpacing * 4) + (padding * 2);
  const totalHeight = CARD_HEIGHT + (padding * 2) + 140; // +140 pour les infos en bas

  const canvas = createCanvas(totalWidth, totalHeight);
  const ctx = canvas.getContext('2d');

  // Fond dégradé (différent pour God Pack)
  const gradient = ctx.createLinearGradient(0, 0, 0, totalHeight);
  if (isGodPack) {
    gradient.addColorStop(0, '#4a0e4e');
    gradient.addColorStop(0.5, '#81007f');
    gradient.addColorStop(1, '#4a0e4e');
  } else {
    gradient.addColorStop(0, '#1a1a2e');
    gradient.addColorStop(1, '#16213e');
  }
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, totalWidth, totalHeight);

  // Charger et dessiner chaque carte
  for (let i = 0; i < cardIds.length; i++) {
    const cardId = cardIds[i];
    const cardInfo = getCardInfo(cardId);

    const x = padding + (i * (CARD_WIDTH + cardSpacing));
    const y = padding;

    // Charger l'image de la carte
    const cardImagePath = path.join(ASSETS_DIR, 'cards', `card_${cardId}.png`);
    try {
      const cardImage = await loadImage(cardImagePath);

      // Dessiner un cadre coloré selon la rareté
      ctx.strokeStyle = cardInfo.rarityColor;
      ctx.lineWidth = 4;
      ctx.strokeRect(x - 2, y - 2, CARD_WIDTH + 4, CARD_HEIGHT + 4);

      // Dessiner la carte
      ctx.drawImage(cardImage, x, y, CARD_WIDTH, CARD_HEIGHT);

      // Dessiner le nom et la rareté en bas
      const textY = y + CARD_HEIGHT + 35;

      // Nom de la carte
      ctx.fillStyle = '#FFFFFF';
      ctx.font = `bold 16px ${PIXEL_FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText(`Carte ${cardId}`, x + CARD_WIDTH / 2, textY);

      // Rareté
      ctx.fillStyle = cardInfo.rarityColor;
      ctx.font = `14px ${PIXEL_FONT}`;
      ctx.fillText(cardInfo.rarityName, x + CARD_WIDTH / 2, textY + 22);

    } catch (error) {
      console.error(`Erreur lors du chargement de la carte ${cardId}:`, error);

      // Dessiner un placeholder en cas d'erreur
      ctx.fillStyle = '#333333';
      ctx.fillRect(x, y, CARD_WIDTH, CARD_HEIGHT);
      ctx.fillStyle = '#FFFFFF';
      ctx.font = `24px ${PIXEL_FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText(`Carte ${cardId}`, x + CARD_WIDTH / 2, y + CARD_HEIGHT / 2);
    }
  }

  // Titre en bas
  if (isGodPack) {
    ctx.fillStyle = '#FFD700';
    ctx.font = `bold 32px ${PIXEL_FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText('★ GOD PACK ★', totalWidth / 2, totalHeight - 50);
    ctx.fillStyle = '#FF00FF';
    ctx.font = `18px ${PIXEL_FONT}`;
    ctx.fillText('Toutes les cartes sont au moins Rare !', totalWidth / 2, totalHeight - 20);
  } else {
    ctx.fillStyle = '#FFD700';
    ctx.font = `bold 28px ${PIXEL_FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText('Nouveau Booster Ouvert !', totalWidth / 2, totalHeight - 40);
  }

  return canvas.toBuffer('image/png');
}

/**
 * Génère l'image de la collection d'un utilisateur pour un booster
 * @param {string} userId - ID Discord de l'utilisateur
 * @param {number} boosterId - ID du booster
 * @returns {Buffer} Buffer PNG de l'image générée
 */
async function generateCollectionImage(userId, boosterId) {
  const userData = loadUserData(userId);
  const booster = boosters[boosterId];
  const allCards = getAllCardsFromBooster(boosterId);

  if (!booster || allCards.length === 0) {
    throw new Error(`Booster ${boosterId} introuvable ou vide`);
  }

  // Grille 10x5 pour 50 cartes
  const columns = 10;
  const rows = Math.ceil(allCards.length / columns);
  const cardDisplayWidth = 120;
  const cardDisplayHeight = Math.round(120 * (363 / 300)); // Maintenir le ratio
  const cardSpacing = 10;
  const padding = 40;
  const headerHeight = 100;

  const totalWidth = (cardDisplayWidth * columns) + (cardSpacing * (columns - 1)) + (padding * 2);
  const totalHeight = headerHeight + (cardDisplayHeight * rows) + (cardSpacing * (rows - 1)) + (padding * 2);

  const canvas = createCanvas(totalWidth, totalHeight);
  const ctx = canvas.getContext('2d');

  // Fond
  const gradient = ctx.createLinearGradient(0, 0, 0, totalHeight);
  gradient.addColorStop(0, '#0f3460');
  gradient.addColorStop(1, '#16213e');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, totalWidth, totalHeight);

  // Titre
  const owned = Object.keys(userData.cards).filter(cardId => {
    const card = allCards.find(c => c.id === parseInt(cardId));
    return card !== undefined;
  }).length;

  ctx.fillStyle = '#FFFFFF';
  ctx.font = `bold 36px ${PIXEL_FONT}`;
  ctx.textAlign = 'center';
  ctx.fillText(`Collection - ${booster.name}`, totalWidth / 2, 45);

  ctx.font = `22px ${PIXEL_FONT}`;
  const percentage = booster.totalCards > 0 ? Math.round((owned / booster.totalCards) * 100) : 0;
  ctx.fillText(`${owned}/${booster.totalCards} (${percentage}%)`, totalWidth / 2, 80);

  // Charger l'image du dos de carte
  const cardBackPath = path.join(ASSETS_DIR, 'cards', 'card_back.png');
  let cardBackImage;
  try {
    cardBackImage = await loadImage(cardBackPath);
  } catch (error) {
    console.error('Erreur lors du chargement du dos de carte:', error);
  }

  // Dessiner chaque carte de la collection
  for (let i = 0; i < allCards.length; i++) {
    const card = allCards[i];
    const col = i % columns;
    const row = Math.floor(i / columns);

    const x = padding + (col * (cardDisplayWidth + cardSpacing));
    const y = headerHeight + padding + (row * (cardDisplayHeight + cardSpacing));

    const hasCard = userData.cards[String(card.id)] && userData.cards[String(card.id)] > 0;

    if (hasCard) {
      // Carte possédée : afficher l'image de face
      const cardImagePath = path.join(ASSETS_DIR, 'cards', `card_${card.id}.png`);
      try {
        const cardImage = await loadImage(cardImagePath);
        ctx.drawImage(cardImage, x, y, cardDisplayWidth, cardDisplayHeight);

        // Bordure colorée
        ctx.strokeStyle = card.rarityColor;
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, cardDisplayWidth, cardDisplayHeight);

        // Afficher la quantité si > 1
        const quantity = userData.cards[String(card.id)];
        if (quantity > 1) {
          ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
          ctx.fillRect(x + cardDisplayWidth - 35, y + 5, 30, 25);
          ctx.fillStyle = '#FFD700';
          ctx.font = `bold 14px ${PIXEL_FONT}`;
          ctx.textAlign = 'center';
          ctx.fillText(`x${quantity}`, x + cardDisplayWidth - 20, y + 22);
        }

      } catch (error) {
        console.error(`Erreur lors du chargement de la carte ${card.id}:`, error);
        // Placeholder
        ctx.fillStyle = '#555555';
        ctx.fillRect(x, y, cardDisplayWidth, cardDisplayHeight);
      }
    } else {
      // Carte non possédée : afficher le dos
      if (cardBackImage) {
        ctx.save();
        ctx.globalAlpha = 0.3; // Opacité réduite pour les cartes non possédées
        ctx.drawImage(cardBackImage, x, y, cardDisplayWidth, cardDisplayHeight);
        ctx.restore();

        // Bordure grise
        ctx.strokeStyle = '#555555';
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, cardDisplayWidth, cardDisplayHeight);
      } else {
        // Placeholder si pas de dos de carte
        ctx.fillStyle = '#333333';
        ctx.fillRect(x, y, cardDisplayWidth, cardDisplayHeight);
        ctx.fillStyle = '#666666';
        ctx.font = `16px ${PIXEL_FONT}`;
        ctx.textAlign = 'center';
        ctx.fillText('?', x + cardDisplayWidth / 2, y + cardDisplayHeight / 2);
      }
    }

    // Numéro de la carte en petit
    ctx.fillStyle = hasCard ? '#FFFFFF' : '#666666';
    ctx.font = `9px ${PIXEL_FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText(`#${card.id}`, x + cardDisplayWidth / 2, y + cardDisplayHeight - 5);
  }

  return canvas.toBuffer('image/png');
}

module.exports = {
  generateBoosterOpeningImage,
  generateCollectionImage
};
