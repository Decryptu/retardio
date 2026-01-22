const { createCanvas, loadImage, registerFont } = require('canvas');
const path = require('path');
const fs = require('fs');
const { getCardInfo, getAllCardsFromBooster } = require('./cardGenerator');
const { loadUserData } = require('./userManager');
const boosters = require('./data/boosters.json');

const ASSETS_DIR = path.join(__dirname, 'assets');
const CARD_WIDTH = 300;
const CARD_HEIGHT = 363;
const BORDER_RADIUS = 8; // Small border radius for card frames
const GLOW_BLUR = 20; // Blur amount for glow effect

// Rarities that get the glow effect (uncommon and above)
const GLOW_RARITIES = ['uncommon', 'rare', 'epic', 'legendary', 'promo'];

/**
 * Draw a rounded rectangle stroke
 */
function strokeRoundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
  ctx.stroke();
}

/**
 * Draw colored background behind a card (no glow for common)
 */
function drawCardBackground(ctx, x, y, width, height, color, withGlow = true) {
  ctx.save();
  if (withGlow) {
    ctx.shadowColor = color;
    ctx.shadowBlur = GLOW_BLUR;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
  }
  ctx.fillStyle = color;
  ctx.fillRect(x, y, width, height);
  ctx.restore();
}

/**
 * Draw background image with center-crop (no stretching)
 */
function drawCenteredCrop(ctx, image, canvasWidth, canvasHeight) {
  const imgRatio = image.width / image.height;
  const canvasRatio = canvasWidth / canvasHeight;

  let srcX = 0, srcY = 0, srcW = image.width, srcH = image.height;

  if (imgRatio > canvasRatio) {
    // Image is wider - crop horizontally
    srcW = image.height * canvasRatio;
    srcX = (image.width - srcW) / 2;
  } else {
    // Image is taller - crop vertically
    srcH = image.width / canvasRatio;
    srcY = (image.height - srcH) / 2;
  }

  ctx.drawImage(image, srcX, srcY, srcW, srcH, 0, 0, canvasWidth, canvasHeight);
}

/**
 * Try to load a background image with fallback
 * Priority: booster-specific > generic > gradient fallback
 */
async function loadBackgroundImage(type, boosterId = null) {
  const bgDir = path.join(ASSETS_DIR, 'backgrounds');

  // Try booster-specific background first
  if (boosterId) {
    const booster = boosters[boosterId];
    if (booster) {
      // Try by booster name (sanitized)
      const sanitizedName = booster.name.toLowerCase().replace(/[^a-z0-9]/g, '_');
      const boosterBgPath = path.join(bgDir, `${type}_${sanitizedName}.png`);
      if (fs.existsSync(boosterBgPath)) {
        return await loadImage(boosterBgPath);
      }
      // Try by booster id
      const boosterIdBgPath = path.join(bgDir, `${type}_booster_${boosterId}.png`);
      if (fs.existsSync(boosterIdBgPath)) {
        return await loadImage(boosterIdBgPath);
      }
    }
  }

  // Try generic background
  const genericPath = path.join(bgDir, `${type}_bg.png`);
  if (fs.existsSync(genericPath)) {
    return await loadImage(genericPath);
  }

  return null;
}

// Charger la police PixelOperator8-Bold si disponible
const FONT_PATH = path.join(ASSETS_DIR, 'fonts', 'PixelOperator8-Bold.ttf');
let PIXEL_FONT = 'Arial'; // Fallback

if (fs.existsSync(FONT_PATH)) {
  try {
    registerFont(FONT_PATH, { family: 'PixelOperator8Bold' });
    PIXEL_FONT = 'PixelOperator8Bold';
    console.log('✅ Police PixelOperator8-Bold.ttf chargée avec succès');
  } catch (error) {
    console.warn('⚠️  Impossible de charger PixelOperator8-Bold.ttf, utilisation d\'Arial');
  }
} else {
  console.warn('⚠️  PixelOperator8-Bold.ttf non trouvée dans assets/fonts/, utilisation d\'Arial');
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

  // Charger le fond personnalisé (avec center-crop)
  const bgImage = await loadBackgroundImage('opening');
  if (bgImage) {
    drawCenteredCrop(ctx, bgImage, totalWidth, totalHeight);
    // Ajouter une overlay légère pour God Pack
    if (isGodPack) {
      ctx.fillStyle = 'rgba(129, 0, 127, 0.3)';
      ctx.fillRect(0, 0, totalWidth, totalHeight);
    }
  } else {
    // Fallback sur le dégradé
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
  }

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

      // Draw colored background (with glow for uncommon+, without for common)
      const hasGlow = GLOW_RARITIES.includes(cardInfo.rarity);
      drawCardBackground(ctx, x, y, CARD_WIDTH, CARD_HEIGHT, cardInfo.rarityColor, hasGlow);

      // Dessiner la carte
      ctx.drawImage(cardImage, x, y, CARD_WIDTH, CARD_HEIGHT);

      // Dessiner un cadre coloré selon la rareté (avec border radius)
      ctx.strokeStyle = cardInfo.rarityColor;
      ctx.lineWidth = 4;
      strokeRoundedRect(ctx, x - 2, y - 2, CARD_WIDTH + 4, CARD_HEIGHT + 4, BORDER_RADIUS);

      // Dessiner le nom et la rareté en bas
      const textY = y + CARD_HEIGHT + 35;

      // Ajouter une ombre noire sharp (pas floue)
      ctx.shadowColor = '#000000';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 3;
      ctx.shadowOffsetY = 3;

      // Nom de la carte
      ctx.fillStyle = '#FFFFFF';
      ctx.font = `bold 16px ${PIXEL_FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText(cardInfo.name, x + CARD_WIDTH / 2, textY);

      // Rareté
      ctx.fillStyle = cardInfo.rarityColor;
      ctx.font = `14px ${PIXEL_FONT}`;
      ctx.fillText(cardInfo.rarityName, x + CARD_WIDTH / 2, textY + 22);

      // Retirer l'ombre
      ctx.shadowColor = 'transparent';

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

  // Titre en bas avec ombre
  ctx.shadowColor = '#000000';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 3;
  ctx.shadowOffsetY = 3;

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

  // Retirer l'ombre
  ctx.shadowColor = 'transparent';

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

  // Grille 10 colonnes, supporte jusqu'à 60 cartes (10x6)
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

  // Charger le fond personnalisé (per-booster ou générique, avec center-crop)
  const bgImage = await loadBackgroundImage('collection', boosterId);
  if (bgImage) {
    drawCenteredCrop(ctx, bgImage, totalWidth, totalHeight);
  } else {
    // Fallback sur le dégradé
    const gradient = ctx.createLinearGradient(0, 0, 0, totalHeight);
    gradient.addColorStop(0, '#0f3460');
    gradient.addColorStop(1, '#16213e');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, totalWidth, totalHeight);
  }

  // Titre
  const owned = Object.keys(userData.cards).filter(cardId => {
    const card = allCards.find(c => c.id === parseInt(cardId));
    return card !== undefined;
  }).length;

  // Ajouter une ombre noire sharp (pas floue)
  ctx.shadowColor = '#000000';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 3;
  ctx.shadowOffsetY = 3;

  ctx.fillStyle = '#FFFFFF';
  ctx.font = `bold 36px ${PIXEL_FONT}`;
  ctx.textAlign = 'center';
  ctx.fillText(`Collection - ${booster.name}`, totalWidth / 2, 65);

  ctx.font = `22px ${PIXEL_FONT}`;
  const percentage = booster.totalCards > 0 ? Math.round((owned / booster.totalCards) * 100) : 0;
  ctx.fillText(`${owned}/${booster.totalCards} (${percentage}%)`, totalWidth / 2, 100);

  // Retirer l'ombre pour le reste
  ctx.shadowColor = 'transparent';

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

        // Draw colored background (with glow for uncommon+, without for common)
        const hasGlow = GLOW_RARITIES.includes(card.rarity);
        drawCardBackground(ctx, x, y, cardDisplayWidth, cardDisplayHeight, card.rarityColor, hasGlow);

        ctx.drawImage(cardImage, x, y, cardDisplayWidth, cardDisplayHeight);

        // Bordure colorée (avec border radius)
        ctx.strokeStyle = card.rarityColor;
        ctx.lineWidth = 2;
        strokeRoundedRect(ctx, x, y, cardDisplayWidth, cardDisplayHeight, BORDER_RADIUS);

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

        // Bordure grise (avec border radius)
        ctx.strokeStyle = '#555555';
        ctx.lineWidth = 2;
        strokeRoundedRect(ctx, x, y, cardDisplayWidth, cardDisplayHeight, BORDER_RADIUS);
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
    ctx.fillStyle = '#000000';
    ctx.font = `9px ${PIXEL_FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText(`#${card.id}`, x + cardDisplayWidth / 2, y + cardDisplayHeight - 14);
  }

  return canvas.toBuffer('image/png');
}

/**
 * Génère l'image de détail d'une carte
 * @param {number|string} cardId - ID de la carte
 * @param {number} quantity - Quantité possédée
 * @param {string} boosterId - ID du booster (pour le fond personnalisé)
 * @returns {Buffer} Buffer PNG de l'image générée
 */
async function generateCardDetailImage(cardId, quantity = 1, boosterId = null) {
  const cardInfo = getCardInfo(cardId);
  if (!cardInfo) {
    throw new Error(`Carte ${cardId} introuvable`);
  }

  const padding = 40;
  const totalWidth = CARD_WIDTH + (padding * 2);
  const totalHeight = CARD_HEIGHT + (padding * 2) + 80; // +80 pour le texte en dessous

  const canvas = createCanvas(totalWidth, totalHeight);
  const ctx = canvas.getContext('2d');

  // Charger le fond personnalisé (per-card > per-booster > générique, avec center-crop)
  const bgDir = path.join(ASSETS_DIR, 'backgrounds');
  let bgImage = null;

  // Try per-card background first
  const cardBgPath = path.join(bgDir, `carddetail_card_${cardId}.png`);
  if (fs.existsSync(cardBgPath)) {
    bgImage = await loadImage(cardBgPath);
  } else {
    // Fall back to per-booster or generic
    bgImage = await loadBackgroundImage('carddetail', boosterId);
  }

  if (bgImage) {
    drawCenteredCrop(ctx, bgImage, totalWidth, totalHeight);
  } else {
    // Fallback sur le dégradé
    const gradient = ctx.createLinearGradient(0, 0, 0, totalHeight);
    gradient.addColorStop(0, '#1a1a2e');
    gradient.addColorStop(1, '#16213e');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, totalWidth, totalHeight);
  }

  const x = padding;
  const y = padding;

  // Charger l'image de la carte
  const cardImagePath = path.join(ASSETS_DIR, 'cards', `card_${cardId}.png`);
  try {
    const cardImage = await loadImage(cardImagePath);

    // Dessiner la carte (sans bordure ni glow)
    ctx.drawImage(cardImage, x, y, CARD_WIDTH, CARD_HEIGHT);

  } catch (error) {
    console.error(`Erreur lors du chargement de la carte ${cardId}:`, error);
    ctx.fillStyle = '#333333';
    ctx.fillRect(x, y, CARD_WIDTH, CARD_HEIGHT);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `24px ${PIXEL_FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText(`Carte ${cardId}`, x + CARD_WIDTH / 2, y + CARD_HEIGHT / 2);
  }

  // Texte en dessous avec fond noir semi-transparent
  const textY = y + CARD_HEIGHT + 35;

  // Dessiner un fond noir semi-transparent pour le texte
  ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
  ctx.fillRect(0, y + CARD_HEIGHT + 8, totalWidth, 70);

  ctx.shadowColor = '#000000';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 2;
  ctx.shadowOffsetY = 2;

  // Nom de la carte
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `bold 20px ${PIXEL_FONT}`;
  ctx.textAlign = 'center';
  ctx.fillText(cardInfo.name, totalWidth / 2, textY);

  // Rareté
  ctx.fillStyle = cardInfo.rarityColor;
  ctx.font = `16px ${PIXEL_FONT}`;
  ctx.fillText(cardInfo.rarityName, totalWidth / 2, textY + 25);

  // Quantité si > 1
  if (quantity > 1) {
    ctx.fillStyle = '#FFD700';
    ctx.font = `bold 14px ${PIXEL_FONT}`;
    ctx.fillText(`x${quantity}`, totalWidth / 2, textY + 48);
  }

  ctx.shadowColor = 'transparent';

  return canvas.toBuffer('image/png');
}

module.exports = {
  generateBoosterOpeningImage,
  generateCollectionImage,
  generateCardDetailImage
};