const { createCanvas, loadImage, registerFont } = require('canvas');
const path = require('node:path');
const fs = require('node:fs');
const { getCardInfo, getAllCardsFromBooster } = require('./cardGenerator');
const { loadUserData } = require('./userManager');
const boosters = require('../../data/boosters.json');

const ASSETS_DIR = path.join(__dirname, '../../assets');
const CARD_WIDTH = 300;
const CARD_HEIGHT = 363;
const BORDER_RADIUS = 8; // Small border radius for card frames
const GLOW_BLUR = 20; // Blur amount for glow effect

// Rarities that get the glow effect (uncommon and above)
const GLOW_RARITIES = ['uncommon', 'rare', 'epic', 'legendary', 'promo'];

/**
 * Create a rounded rectangle path
 */
function roundedRectPath(ctx, x, y, width, height, radius) {
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
}

/**
 * Draw a rounded rectangle stroke
 */
function strokeRoundedRect(ctx, x, y, width, height, radius) {
  roundedRectPath(ctx, x, y, width, height, radius);
  ctx.stroke();
}

/**
 * Draw a rounded rectangle fill
 */
function fillRoundedRect(ctx, x, y, width, height, radius) {
  roundedRectPath(ctx, x, y, width, height, radius);
  ctx.fill();
}

/**
 * Wrap text to fit within a specific width
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {string} text - Text to wrap
 * @param {number} maxWidth - Maximum width in pixels
 * @returns {string[]} Array of text lines
 */
function wrapText(ctx, text, maxWidth) {
  const words = text.split(' ');
  const lines = [];
  let currentLine = '';

  for (let i = 0; i < words.length; i++) {
    const testLine = currentLine + (currentLine ? ' ' : '') + words[i];
    const metrics = ctx.measureText(testLine);

    if (metrics.width > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = words[i];
    } else {
      currentLine = testLine;
    }
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines;
}

/**
 * Draw glow effect behind a card (only for uncommon+)
 */
function drawCardGlow(ctx, x, y, width, height, color) {
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = GLOW_BLUR;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  ctx.fillStyle = color;
  // Draw rounded rectangle for glow - slightly larger to create the glow effect
  fillRoundedRect(ctx, x, y, width, height, BORDER_RADIUS);
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
  } catch {
    console.warn('⚠️  Impossible de charger PixelOperator8-Bold.ttf, utilisation d\'Arial');
  }
} else {
  console.warn('⚠️  PixelOperator8-Bold.ttf non trouvée dans assets/fonts/, utilisation d\'Arial');
}

/**
 * Génère l'image d'ouverture d'un booster (5 cartes)
 * @param {number[]} cardIds - IDs des 5 cartes tirées
 * @param {boolean} isGodPack - Si c'est un God Pack
 * @param {string[]} newCardIds - IDs des cartes nouvellement obtenues (pas possedees avant)
 * @returns {Buffer} Buffer PNG de l'image générée
 */
async function generateBoosterOpeningImage(cardIds, isGodPack = false, newCardIds = []) {
  const newCardSet = new Set(newCardIds.map(id => String(id)));
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

      // Draw glow effect for uncommon+ cards
      const hasGlow = GLOW_RARITIES.includes(cardInfo.rarity);
      if (hasGlow) {
        drawCardGlow(ctx, x, y, CARD_WIDTH, CARD_HEIGHT, cardInfo.rarityColor);
      }

      // Dessiner la carte
      ctx.drawImage(cardImage, x, y, CARD_WIDTH, CARD_HEIGHT);

      // Dessiner un cadre coloré selon la rareté (avec border radius)
      ctx.strokeStyle = cardInfo.rarityColor;
      ctx.lineWidth = 4;
      strokeRoundedRect(ctx, x - 2, y - 2, CARD_WIDTH + 4, CARD_HEIGHT + 4, BORDER_RADIUS);

      // Dessiner le badge "NEW" si c'est une nouvelle carte
      if (newCardSet.has(String(cardId))) {
        const badgeWidth = 70;
        const badgeHeight = 32;
        const badgeX = x + CARD_WIDTH - badgeWidth - 8;
        const badgeY = y + 8;

        // Ombre du badge
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.beginPath();
        ctx.roundRect(badgeX + 3, badgeY + 3, badgeWidth, badgeHeight, 6);
        ctx.fill();

        // Fond du badge
        ctx.fillStyle = '#FF2222';
        ctx.beginPath();
        ctx.roundRect(badgeX, badgeY, badgeWidth, badgeHeight, 6);
        ctx.fill();

        // Bordure du badge
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.roundRect(badgeX, badgeY, badgeWidth, badgeHeight, 6);
        ctx.stroke();

        // Texte du badge
        ctx.fillStyle = '#FFFFFF';
        ctx.font = `bold 20px ${PIXEL_FONT}`;
        ctx.textAlign = 'center';
        ctx.shadowColor = 'transparent';
        ctx.fillText('NEW', badgeX + badgeWidth / 2, badgeY + 23);
      }

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

        // Draw glow effect for uncommon+ cards
        const hasGlow = GLOW_RARITIES.includes(card.rarity);
        if (hasGlow) {
          drawCardGlow(ctx, x, y, cardDisplayWidth, cardDisplayHeight, card.rarityColor);
        }

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

/**
 * Genere l'image de l'equipe d'un utilisateur (3 slots)
 * @param {string} userId - ID Discord de l'utilisateur
 * @param {Array} team - Tableau de 3 cardIds (ou null)
 * @returns {Buffer} Buffer PNG de l'image generee
 */
async function generateTeamImage(_userId, team) {
  // Dimensions: 3 cartes + espaces
  const padding = 30;
  const cardSpacing = 20;
  const slotWidth = CARD_WIDTH;
  const slotHeight = CARD_HEIGHT;

  const totalWidth = (slotWidth * 3) + (cardSpacing * 2) + (padding * 2);
  const totalHeight = slotHeight + (padding * 2) + 100; // +100 pour le titre et infos

  const canvas = createCanvas(totalWidth, totalHeight);
  const ctx = canvas.getContext('2d');

  // Charger le fond personnalise
  const bgImage = await loadBackgroundImage('team');
  if (bgImage) {
    drawCenteredCrop(ctx, bgImage, totalWidth, totalHeight);
  } else {
    // Fallback sur le degrade
    const gradient = ctx.createLinearGradient(0, 0, 0, totalHeight);
    gradient.addColorStop(0, '#1a1a2e');
    gradient.addColorStop(0.5, '#16213e');
    gradient.addColorStop(1, '#0f3460');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, totalWidth, totalHeight);
  }

  // Titre avec ombre
  ctx.shadowColor = '#000000';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 3;
  ctx.shadowOffsetY = 3;

  ctx.fillStyle = '#FFD700';
  ctx.font = `bold 32px ${PIXEL_FONT}`;
  ctx.textAlign = 'center';
  ctx.fillText('EQUIPE', totalWidth / 2, 50);

  ctx.shadowColor = 'transparent';

  // Charger l'image du dos de carte pour les slots vides
  const cardBackPath = path.join(ASSETS_DIR, 'cards', 'card_back.png');
  let cardBackImage;
  try {
    cardBackImage = await loadImage(cardBackPath);
  } catch (error) {
    console.error('Erreur lors du chargement du dos de carte:', error);
  }

  // Dessiner les 3 slots
  for (let i = 0; i < 3; i++) {
    const x = padding + (i * (slotWidth + cardSpacing));
    const y = 80;

    const cardId = team[i];

    if (cardId) {
      // Slot avec Pokemon
      const cardInfo = getCardInfo(cardId);
      const cardImagePath = path.join(ASSETS_DIR, 'cards', `card_${cardId}.png`);

      try {
        const cardImage = await loadImage(cardImagePath);

        // Glow effect pour les cartes peu communes+
        const hasGlow = GLOW_RARITIES.includes(cardInfo?.rarity);
        if (hasGlow && cardInfo) {
          drawCardGlow(ctx, x, y, slotWidth, slotHeight, cardInfo.rarityColor);
        }

        ctx.drawImage(cardImage, x, y, slotWidth, slotHeight);

        // Bordure coloree
        if (cardInfo) {
          ctx.strokeStyle = cardInfo.rarityColor;
          ctx.lineWidth = 4;
          strokeRoundedRect(ctx, x - 2, y - 2, slotWidth + 4, slotHeight + 4, BORDER_RADIUS);
        }

        // Numero de slot
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(x, y + slotHeight - 30, 35, 30);
        ctx.fillStyle = '#FFD700';
        ctx.font = `bold 18px ${PIXEL_FONT}`;
        ctx.textAlign = 'center';
        ctx.fillText(`${i + 1}`, x + 17, y + slotHeight - 8);

      } catch (error) {
        console.error(`Erreur lors du chargement de la carte ${cardId}:`, error);
        // Placeholder
        ctx.fillStyle = '#333333';
        ctx.fillRect(x, y, slotWidth, slotHeight);
      }
    } else {
      // Slot vide
      if (cardBackImage) {
        ctx.save();
        ctx.globalAlpha = 0.3;
        ctx.drawImage(cardBackImage, x, y, slotWidth, slotHeight);
        ctx.restore();
      } else {
        ctx.fillStyle = '#222222';
        ctx.fillRect(x, y, slotWidth, slotHeight);
      }

      // Bordure grise
      ctx.strokeStyle = '#555555';
      ctx.lineWidth = 3;
      ctx.setLineDash([10, 5]);
      strokeRoundedRect(ctx, x, y, slotWidth, slotHeight, BORDER_RADIUS);
      ctx.setLineDash([]);

      // Numero de slot + texte vide
      ctx.fillStyle = '#666666';
      ctx.font = `bold 24px ${PIXEL_FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText(`SLOT ${i + 1}`, x + slotWidth / 2, y + slotHeight / 2 - 10);
      ctx.font = `18px ${PIXEL_FONT}`;
      ctx.fillText('Vide', x + slotWidth / 2, y + slotHeight / 2 + 20);
    }
  }

  return canvas.toBuffer('image/png');
}

/**
 * Genere l'image d'un raid boss
 * @param {Object} bossCard - Infos de la carte boss
 * @param {number} level - Niveau du raid (50, 75, ou 100)
 * @returns {Buffer} Buffer PNG de l'image generee
 */
async function generateRaidBossImage(bossCard, level) {
  const padding = 40;
  const totalWidth = CARD_WIDTH + (padding * 2);
  const totalHeight = CARD_HEIGHT + (padding * 2) + 120;

  const canvas = createCanvas(totalWidth, totalHeight);
  const ctx = canvas.getContext('2d');

  // Fond avec effet dramatique selon le niveau
  const bgImage = await loadBackgroundImage('raid');
  if (bgImage) {
    drawCenteredCrop(ctx, bgImage, totalWidth, totalHeight);
    // Overlay couleur selon niveau
    const overlayColor = level === 100 ? 'rgba(255, 80, 0, 0.3)' :
                         level === 75 ? 'rgba(47, 210, 255, 0.2)' :
                         'rgba(30, 255, 0, 0.2)';
    ctx.fillStyle = overlayColor;
    ctx.fillRect(0, 0, totalWidth, totalHeight);
  } else {
    const gradient = ctx.createLinearGradient(0, 0, 0, totalHeight);
    if (level === 100) {
      gradient.addColorStop(0, '#4a0000');
      gradient.addColorStop(0.5, '#8B0000');
      gradient.addColorStop(1, '#4a0000');
    } else if (level === 75) {
      gradient.addColorStop(0, '#0a2a4a');
      gradient.addColorStop(0.5, '#1a4a7a');
      gradient.addColorStop(1, '#0a2a4a');
    } else {
      gradient.addColorStop(0, '#0a4a0a');
      gradient.addColorStop(0.5, '#1a6a1a');
      gradient.addColorStop(1, '#0a4a0a');
    }
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, totalWidth, totalHeight);
  }

  // Titre RAID avec ombre
  ctx.shadowColor = '#000000';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 3;
  ctx.shadowOffsetY = 3;

  const raidColor = level === 100 ? '#FF8000' : level === 75 ? '#2fd2ff' : '#1EFF00';
  ctx.fillStyle = raidColor;
  ctx.font = `bold 36px ${PIXEL_FONT}`;
  ctx.textAlign = 'center';
  ctx.fillText('RAID', totalWidth / 2, 45);

  // Niveau
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `bold 24px ${PIXEL_FONT}`;
  ctx.fillText(`Niveau ${level}`, totalWidth / 2, 75);

  ctx.shadowColor = 'transparent';

  // Carte du boss
  const x = padding;
  const y = 95;

  const cardImagePath = path.join(ASSETS_DIR, 'cards', `card_${bossCard.id}.png`);
  try {
    const cardImage = await loadImage(cardImagePath);

    // Glow effect
    drawCardGlow(ctx, x, y, CARD_WIDTH, CARD_HEIGHT, raidColor);

    ctx.drawImage(cardImage, x, y, CARD_WIDTH, CARD_HEIGHT);

    // Bordure
    ctx.strokeStyle = raidColor;
    ctx.lineWidth = 5;
    strokeRoundedRect(ctx, x - 3, y - 3, CARD_WIDTH + 6, CARD_HEIGHT + 6, BORDER_RADIUS);

  } catch (error) {
    console.error(`Erreur lors du chargement de la carte ${bossCard.id}:`, error);
    ctx.fillStyle = '#333333';
    ctx.fillRect(x, y, CARD_WIDTH, CARD_HEIGHT);
  }

  // Nom du boss en bas
  ctx.shadowColor = '#000000';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 2;
  ctx.shadowOffsetY = 2;

  ctx.fillStyle = '#FFFFFF';
  ctx.font = `bold 22px ${PIXEL_FONT}`;
  ctx.textAlign = 'center';
  ctx.fillText(bossCard.name, totalWidth / 2, totalHeight - 45);

  ctx.fillStyle = raidColor;
  ctx.font = `18px ${PIXEL_FONT}`;
  ctx.fillText(bossCard.rarityName, totalWidth / 2, totalHeight - 20);

  ctx.shadowColor = 'transparent';

  return canvas.toBuffer('image/png');
}

/**
 * Genere l'image des resultats du raid
 * @param {Object} bossCard - Infos de la carte boss
 * @param {number} level - Niveau du raid
 * @param {boolean} victory - Si le raid a ete gagne
 * @param {Array} participants - Liste des participants
 * @param {string} battleLog - Resume du combat
 * @param {number} bonus - Bonus en Poke Dollars
 * @returns {Buffer} Buffer PNG de l'image generee
 */
async function generateRaidResultImage(bossCard, level, victory, participants, battleLog, bonus = 0) {
  const padding = 30;
  const totalWidth = 800;
  const totalHeight = 500;

  const canvas = createCanvas(totalWidth, totalHeight);
  const ctx = canvas.getContext('2d');

  // Fond
  const bgImage = await loadBackgroundImage('raid');
  if (bgImage) {
    drawCenteredCrop(ctx, bgImage, totalWidth, totalHeight);
    const overlayColor = victory ? 'rgba(0, 100, 0, 0.5)' : 'rgba(100, 0, 0, 0.5)';
    ctx.fillStyle = overlayColor;
    ctx.fillRect(0, 0, totalWidth, totalHeight);
  } else {
    const gradient = ctx.createLinearGradient(0, 0, 0, totalHeight);
    if (victory) {
      gradient.addColorStop(0, '#0a3a0a');
      gradient.addColorStop(0.5, '#1a5a1a');
      gradient.addColorStop(1, '#0a3a0a');
    } else {
      gradient.addColorStop(0, '#3a0a0a');
      gradient.addColorStop(0.5, '#5a1a1a');
      gradient.addColorStop(1, '#3a0a0a');
    }
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, totalWidth, totalHeight);
  }

  // Titre
  ctx.shadowColor = '#000000';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 3;
  ctx.shadowOffsetY = 3;

  ctx.fillStyle = victory ? '#00FF00' : '#FF0000';
  ctx.font = `bold 48px ${PIXEL_FONT}`;
  ctx.textAlign = 'center';
  ctx.fillText(victory ? 'VICTOIRE !' : 'DEFAITE...', totalWidth / 2, 60);

  // Sous-titre
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `24px ${PIXEL_FONT}`;
  ctx.fillText(`Raid Nv.${level} - ${bossCard.name}`, totalWidth / 2, 95);

  ctx.shadowColor = 'transparent';

  // Carte du boss a gauche
  const cardX = padding;
  const cardY = 133;
  const cardScale = 0.6;
  const cardW = CARD_WIDTH * cardScale;
  const cardH = CARD_HEIGHT * cardScale;

  const cardImagePath = path.join(ASSETS_DIR, 'cards', `card_${bossCard.id}.png`);
  try {
    const cardImage = await loadImage(cardImagePath);
    ctx.drawImage(cardImage, cardX, cardY, cardW, cardH);

    ctx.strokeStyle = victory ? '#00FF00' : '#FF0000';
    ctx.lineWidth = 3;
    strokeRoundedRect(ctx, cardX - 2, cardY - 2, cardW + 4, cardH + 4, BORDER_RADIUS);
  } catch (_error) {
    ctx.fillStyle = '#333333';
    ctx.fillRect(cardX, cardY, cardW, cardH);
  }

  // Log de combat a droite
  const logX = cardX + cardW + 30;
  const logY = 130;
  const logWidth = totalWidth - logX - padding;
  const logHeight = 280;

  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.fillRect(logX, logY, logWidth, logHeight);
  ctx.strokeStyle = '#555555';
  ctx.lineWidth = 2;
  ctx.strokeRect(logX, logY, logWidth, logHeight);

  // Texte du log with proper wrapping
  ctx.fillStyle = '#CCCCCC';
  ctx.font = `14px ${PIXEL_FONT}`;
  ctx.textAlign = 'left';

  // Split by newlines first, then wrap each paragraph
  const paragraphs = battleLog.split('\n');
  const allLines = [];

  for (const paragraph of paragraphs) {
    if (paragraph.trim()) {
      const wrappedLines = wrapText(ctx, paragraph.trim(), logWidth - 20);
      allLines.push(...wrappedLines);
    }
  }

  // Render wrapped lines
  let lineY = logY + 25;
  const maxLines = Math.floor((logHeight - 30) / 18); // Calculate max lines that fit
  for (let i = 0; i < Math.min(allLines.length, maxLines); i++) {
    ctx.fillText(allLines[i], logX + 10, lineY);
    lineY += 18;
  }

  // Participants en bas
  ctx.fillStyle = '#FFD700';
  ctx.font = `bold 18px ${PIXEL_FONT}`;
  ctx.textAlign = 'center';
  ctx.fillText(`Participants: ${participants.length}`, totalWidth / 2, totalHeight - 60);

  // Recompenses
  if (victory) {
    const rewardText = `Recompense: ${bossCard.name} + ${bonus} P`;
    ctx.fillStyle = '#00FF00';
    ctx.font = `bold 20px ${PIXEL_FONT}`;
    ctx.fillText(rewardText, totalWidth / 2, totalHeight - 30);
  } else {
    ctx.fillStyle = '#888888';
    ctx.font = `18px ${PIXEL_FONT}`;
    ctx.fillText('Aucune recompense...', totalWidth / 2, totalHeight - 30);
  }

  return canvas.toBuffer('image/png');
}

module.exports = {
  generateBoosterOpeningImage,
  generateCollectionImage,
  generateCardDetailImage,
  generateTeamImage,
  generateRaidBossImage,
  generateRaidResultImage
};