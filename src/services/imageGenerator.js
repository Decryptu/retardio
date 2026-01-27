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

  // Nom de la carte - adjust font size for long names
  ctx.fillStyle = '#FFFFFF';
  ctx.textAlign = 'center';
  const maxNameChars = 20;
  const baseFontSize = 20;
  const minFontSize = 12;
  let nameFontSize = baseFontSize;
  if (cardInfo.name.length > maxNameChars) {
    nameFontSize = Math.max(minFontSize, Math.floor(baseFontSize * maxNameChars / cardInfo.name.length));
  }
  ctx.font = `bold ${nameFontSize}px ${PIXEL_FONT}`;
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

/**
 * Draw a circle-cropped avatar on canvas
 */
function drawCircleAvatar(ctx, image, centerX, centerY, radius) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(image, centerX - radius, centerY - radius, radius * 2, radius * 2);
  ctx.restore();

  // White border
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 2;
  ctx.stroke();
}

/**
 * Draw a fallback colored circle with initial
 */
function drawFallbackAvatar(ctx, centerX, centerY, radius, initial) {
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
  ctx.fillStyle = '#5865F2';
  ctx.fill();
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = '#FFFFFF';
  ctx.font = `bold ${radius}px ${PIXEL_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(initial.toUpperCase(), centerX, centerY);
  ctx.textBaseline = 'alphabetic';
}

/**
 * Biome gradient colors for fallback backgrounds
 */
const BIOME_GRADIENTS = {
  mystic_forest: ['#0a3a0a', '#1a5a1a', '#0a3a0a'],
  deep_ocean: ['#0a1a3a', '#1a3a6a', '#0a1a3a'],
  burning_volcano: ['#3a0a0a', '#6a1a0a', '#3a0a0a'],
  dark_cave: ['#1a0a2a', '#2a1a3a', '#1a0a2a'],
  frozen_tundra: ['#1a2a3a', '#2a4a5a', '#1a2a3a'],
  stormy_sky: ['#2a2a1a', '#4a3a1a', '#2a2a1a'],
  toxic_swamp: ['#1a0a2a', '#2a1a3a', '#1a0a2a'],
  ancient_ruins: ['#2a1a0a', '#4a2a1a', '#2a1a0a'],
  fairy_meadow: ['#2a0a1a', '#4a1a2a', '#2a0a1a'],
  sand_desert: ['#2a2a0a', '#4a3a1a', '#2a2a0a'],
};

/**
 * Draw a biome gradient background
 */
function drawBiomeGradient(ctx, biomeId, width, height) {
  const colors = BIOME_GRADIENTS[biomeId] || ['#1a1a2e', '#16213e', '#1a1a2e'];
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, colors[0]);
  gradient.addColorStop(0.5, colors[1]);
  gradient.addColorStop(1, colors[2]);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
}

/**
 * Genere l'image d'annonce d'une expedition (biome)
 * @param {Object} biome - Biome de l'expedition
 * @returns {Buffer} Buffer PNG
 */
async function generateExpeditionStartImage(biome) {
  const totalWidth = 800;
  const totalHeight = 400;

  const canvas = createCanvas(totalWidth, totalHeight);
  const ctx = canvas.getContext('2d');

  // Background
  const bgImage = await loadBackgroundImage('expedition');
  if (bgImage) {
    drawCenteredCrop(ctx, bgImage, totalWidth, totalHeight);
    // Biome color overlay
    ctx.fillStyle = biome.color.replace(')', ', 0.2)').replace('rgb', 'rgba').replace('#', '');
    // Simple hex overlay
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = biome.color;
    ctx.fillRect(0, 0, totalWidth, totalHeight);
    ctx.globalAlpha = 1.0;
  } else {
    drawBiomeGradient(ctx, biome.id, totalWidth, totalHeight);
  }

  // Dark overlay for text readability
  ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
  ctx.fillRect(0, 0, totalWidth, totalHeight);

  // Title with shadow
  ctx.shadowColor = '#000000';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 3;
  ctx.shadowOffsetY = 3;

  // Emoji + title
  ctx.fillStyle = biome.color;
  ctx.font = `bold 48px ${PIXEL_FONT}`;
  ctx.textAlign = 'center';
  ctx.fillText(`EXPEDITION`, totalWidth / 2, 70);

  ctx.fillStyle = '#FFFFFF';
  ctx.font = `bold 36px ${PIXEL_FONT}`;
  ctx.fillText(`${biome.emoji} ${biome.name}`, totalWidth / 2, 120);

  // Description
  ctx.fillStyle = '#CCCCCC';
  ctx.font = `18px ${PIXEL_FONT}`;
  const descLines = wrapText(ctx, biome.description, totalWidth - 100);
  let descY = 170;
  for (const line of descLines) {
    ctx.fillText(line, totalWidth / 2, descY);
    descY += 24;
  }

  // Type info boxes
  const boxY = 240;
  const boxWidth = 230;
  const boxHeight = 100;
  const boxSpacing = 20;
  const startX = (totalWidth - (boxWidth * 3 + boxSpacing * 2)) / 2;

  // Dominant types box
  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
  fillRoundedRect(ctx, startX, boxY, boxWidth, boxHeight, 8);
  ctx.fillStyle = '#FF6B6B';
  ctx.font = `bold 14px ${PIXEL_FONT}`;
  ctx.fillText('TYPES DOMINANTS', startX + boxWidth / 2, boxY + 25);
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `16px ${PIXEL_FONT}`;
  const domLines = wrapText(ctx, biome.dominantTypes.join(', '), boxWidth - 20);
  let domY = boxY + 50;
  for (const line of domLines) {
    ctx.fillText(line, startX + boxWidth / 2, domY);
    domY += 20;
  }

  // Recommended types box
  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
  fillRoundedRect(ctx, startX + boxWidth + boxSpacing, boxY, boxWidth, boxHeight, 8);
  ctx.fillStyle = '#51CF66';
  ctx.font = `bold 14px ${PIXEL_FONT}`;
  ctx.fillText('RECOMMANDÉS', startX + boxWidth + boxSpacing + boxWidth / 2, boxY + 25);
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `16px ${PIXEL_FONT}`;
  const recLines = wrapText(ctx, biome.recommendedTypes.join(', '), boxWidth - 20);
  let recY = boxY + 50;
  for (const line of recLines) {
    ctx.fillText(line, startX + boxWidth + boxSpacing + boxWidth / 2, recY);
    recY += 20;
  }

  // Avoid types box
  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
  fillRoundedRect(ctx, startX + (boxWidth + boxSpacing) * 2, boxY, boxWidth, boxHeight, 8);
  ctx.fillStyle = '#FF922B';
  ctx.font = `bold 14px ${PIXEL_FONT}`;
  ctx.fillText('À ÉVITER', startX + (boxWidth + boxSpacing) * 2 + boxWidth / 2, boxY + 25);
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `16px ${PIXEL_FONT}`;
  const avoidLines = wrapText(ctx, biome.avoidTypes.join(', '), boxWidth - 20);
  let avoidY = boxY + 50;
  for (const line of avoidLines) {
    ctx.fillText(line, startX + (boxWidth + boxSpacing) * 2 + boxWidth / 2, avoidY);
    avoidY += 20;
  }

  // Footer
  ctx.fillStyle = '#888888';
  ctx.font = `14px ${PIXEL_FONT}`;
  ctx.fillText('Utilisez /team pour préparer votre équipe !', totalWidth / 2, totalHeight - 20);

  ctx.shadowColor = 'transparent';

  return canvas.toBuffer('image/png');
}

/**
 * Genere l'image de progression d'une expedition
 * @param {Object} biome - Biome
 * @param {Array} avatarData - [{username, avatarURL}]
 * @param {number} progress - 0 to 1
 * @param {number} timeRemaining - minutes restantes
 * @returns {Buffer} Buffer PNG
 */
async function generateExpeditionProgressImage(biome, avatarData, progress, timeRemaining) {
  const totalWidth = 800;
  const totalHeight = 250;

  const canvas = createCanvas(totalWidth, totalHeight);
  const ctx = canvas.getContext('2d');

  // Background
  const bgImage = await loadBackgroundImage('expedition');
  if (bgImage) {
    drawCenteredCrop(ctx, bgImage, totalWidth, totalHeight);
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = biome.color;
    ctx.fillRect(0, 0, totalWidth, totalHeight);
    ctx.globalAlpha = 1.0;
  } else {
    drawBiomeGradient(ctx, biome.id, totalWidth, totalHeight);
  }

  // Dark overlay
  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
  ctx.fillRect(0, 0, totalWidth, totalHeight);

  // Title
  ctx.shadowColor = '#000000';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 2;
  ctx.shadowOffsetY = 2;

  ctx.fillStyle = biome.color;
  ctx.font = `bold 24px ${PIXEL_FONT}`;
  ctx.textAlign = 'center';
  ctx.fillText(`${biome.emoji} ${biome.name} — Expédition en cours`, totalWidth / 2, 35);

  ctx.shadowColor = 'transparent';

  // Timeline bar
  const barX = 60;
  const barY = 150;
  const barWidth = totalWidth - 120;
  const barHeight = 14;

  // Bar background
  ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
  fillRoundedRect(ctx, barX, barY, barWidth, barHeight, 7);

  // Bar fill
  const fillWidth = barWidth * progress;
  if (fillWidth > 0) {
    ctx.fillStyle = biome.color;
    fillRoundedRect(ctx, barX, barY, Math.max(fillWidth, 14), barHeight, 7);
  }

  // Step markers at 0%, 25%, 50%, 75%, 100%
  const steps = [0, 0.25, 0.5, 0.75, 1.0];
  const stepLabels = ['Départ', '25%', '50%', '75%', 'Arrivée'];
  for (let i = 0; i < steps.length; i++) {
    const sx = barX + barWidth * steps[i];
    const reached = progress >= steps[i];

    ctx.beginPath();
    ctx.arc(sx, barY + barHeight / 2, 8, 0, Math.PI * 2);
    ctx.fillStyle = reached ? biome.color : 'rgba(255, 255, 255, 0.3)';
    ctx.fill();
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Step label below
    ctx.fillStyle = reached ? '#FFFFFF' : '#888888';
    ctx.font = `10px ${PIXEL_FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText(stepLabels[i], sx, barY + barHeight + 20);
  }

  // Fetch and draw participant avatars at progress point
  const avatarRadius = 20;
  const progressX = barX + barWidth * progress;
  const avatarY = barY - 45; // Above the bar
  const maxAvatars = 8;
  const displayAvatars = avatarData.slice(0, maxAvatars);
  const overflow = avatarData.length - maxAvatars;

  if (displayAvatars.length > 0) {
    // Calculate avatar positions centered on progress point
    const avatarSpacing = Math.min(44, (barWidth * 0.3) / Math.max(displayAvatars.length, 1));
    const groupWidth = (displayAvatars.length - 1) * avatarSpacing;
    const startAvatarX = Math.max(
      barX + avatarRadius,
      Math.min(progressX - groupWidth / 2, barX + barWidth - avatarRadius - groupWidth)
    );

    for (let i = 0; i < displayAvatars.length; i++) {
      const ax = startAvatarX + i * avatarSpacing;
      try {
        const avatarImg = await loadImage(displayAvatars[i].avatarURL);
        drawCircleAvatar(ctx, avatarImg, ax, avatarY, avatarRadius);
      } catch {
        drawFallbackAvatar(ctx, ax, avatarY, avatarRadius, displayAvatars[i].username[0]);
      }
    }

    if (overflow > 0) {
      const overflowX = startAvatarX + displayAvatars.length * avatarSpacing;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.beginPath();
      ctx.arc(overflowX, avatarY, avatarRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = '#FFFFFF';
      ctx.font = `bold 14px ${PIXEL_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`+${overflow}`, overflowX, avatarY);
      ctx.textBaseline = 'alphabetic';
    }
  }

  // Bottom info
  const progressPct = Math.round(progress * 100);
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `bold 18px ${PIXEL_FONT}`;
  ctx.textAlign = 'left';
  ctx.fillText(`${progressPct}%`, barX, totalHeight - 20);

  ctx.textAlign = 'center';
  ctx.fillStyle = '#CCCCCC';
  ctx.font = `16px ${PIXEL_FONT}`;
  ctx.fillText(`${avatarData.length} explorateur${avatarData.length > 1 ? 's' : ''}`, totalWidth / 2, totalHeight - 20);

  ctx.textAlign = 'right';
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `bold 18px ${PIXEL_FONT}`;
  ctx.fillText(`${timeRemaining} min restante${timeRemaining > 1 ? 's' : ''}`, barX + barWidth, totalHeight - 20);

  return canvas.toBuffer('image/png');
}

/**
 * Genere l'image des resultats d'une expedition
 * @param {Object} biome - Biome
 * @param {Array} participants - Liste des participant IDs
 * @param {string} expeditionLog - Recit de l'expedition
 * @param {number} reward - Recompense en P
 * @param {string} successTier - Tier de succes
 * @returns {Buffer} Buffer PNG
 */
async function generateExpeditionResultImage(biome, participants, expeditionLog, reward, successTier) {
  const totalWidth = 800;
  const totalHeight = 500;

  const canvas = createCanvas(totalWidth, totalHeight);
  const ctx = canvas.getContext('2d');

  // Background
  const bgImage = await loadBackgroundImage('expedition');
  if (bgImage) {
    drawCenteredCrop(ctx, bgImage, totalWidth, totalHeight);
  } else {
    drawBiomeGradient(ctx, biome.id, totalWidth, totalHeight);
  }

  // Success-based overlay
  let overlayColor;
  if (reward >= 601) {
    overlayColor = 'rgba(0, 100, 0, 0.5)';
  } else if (reward >= 201) {
    overlayColor = 'rgba(80, 80, 0, 0.5)';
  } else {
    overlayColor = 'rgba(100, 0, 0, 0.5)';
  }
  ctx.fillStyle = overlayColor;
  ctx.fillRect(0, 0, totalWidth, totalHeight);

  // Title
  ctx.shadowColor = '#000000';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 3;
  ctx.shadowOffsetY = 3;

  let titleColor;
  if (reward >= 801) titleColor = '#FFD700';
  else if (reward >= 601) titleColor = '#2ECC71';
  else if (reward >= 401) titleColor = '#F39C12';
  else if (reward >= 201) titleColor = '#E67E22';
  else titleColor = '#E74C3C';

  ctx.fillStyle = titleColor;
  ctx.font = `bold 42px ${PIXEL_FONT}`;
  ctx.textAlign = 'center';
  ctx.fillText(successTier, totalWidth / 2, 55);

  // Biome name
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `24px ${PIXEL_FONT}`;
  ctx.fillText(`${biome.emoji} ${biome.name}`, totalWidth / 2, 90);

  ctx.shadowColor = 'transparent';

  // Reward display (left side)
  const rewardBoxX = 30;
  const rewardBoxY = 120;
  const rewardBoxW = 220;
  const rewardBoxH = 250;

  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
  fillRoundedRect(ctx, rewardBoxX, rewardBoxY, rewardBoxW, rewardBoxH, 10);
  ctx.strokeStyle = titleColor;
  ctx.lineWidth = 2;
  strokeRoundedRect(ctx, rewardBoxX, rewardBoxY, rewardBoxW, rewardBoxH, 10);

  ctx.fillStyle = '#CCCCCC';
  ctx.font = `bold 16px ${PIXEL_FONT}`;
  ctx.textAlign = 'center';
  ctx.fillText('RÉCOMPENSE', rewardBoxX + rewardBoxW / 2, rewardBoxY + 35);

  ctx.fillStyle = titleColor;
  ctx.font = `bold 48px ${PIXEL_FONT}`;
  ctx.fillText(`${reward}`, rewardBoxX + rewardBoxW / 2, rewardBoxY + 95);

  ctx.fillStyle = '#FFD700';
  ctx.font = `bold 24px ${PIXEL_FONT}`;
  ctx.fillText('Poké $', rewardBoxX + rewardBoxW / 2, rewardBoxY + 125);

  // Success stars
  const maxStars = 5;
  const filledStars = Math.ceil((reward / 1000) * maxStars);
  ctx.font = `24px ${PIXEL_FONT}`;
  let starsText = '';
  for (let i = 0; i < maxStars; i++) {
    starsText += i < filledStars ? '★' : '☆';
  }
  ctx.fillStyle = '#FFD700';
  ctx.fillText(starsText, rewardBoxX + rewardBoxW / 2, rewardBoxY + 170);

  // Per participant
  ctx.fillStyle = '#AAAAAA';
  ctx.font = `14px ${PIXEL_FONT}`;
  ctx.fillText('par explorateur', rewardBoxX + rewardBoxW / 2, rewardBoxY + 200);

  ctx.fillStyle = '#FFFFFF';
  ctx.font = `bold 16px ${PIXEL_FONT}`;
  ctx.fillText(`${participants.length} participant${participants.length > 1 ? 's' : ''}`, rewardBoxX + rewardBoxW / 2, rewardBoxY + 230);

  // Expedition log (right side)
  const logX = rewardBoxX + rewardBoxW + 20;
  const logY = 120;
  const logWidth = totalWidth - logX - 30;
  const logHeight = 250;

  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
  fillRoundedRect(ctx, logX, logY, logWidth, logHeight, 10);

  ctx.fillStyle = '#CCCCCC';
  ctx.font = `bold 16px ${PIXEL_FONT}`;
  ctx.textAlign = 'center';
  ctx.fillText('RÉCIT DE L\'EXPÉDITION', logX + logWidth / 2, logY + 30);

  // Log text with wrapping
  ctx.fillStyle = '#CCCCCC';
  ctx.font = `14px ${PIXEL_FONT}`;
  ctx.textAlign = 'left';

  const paragraphs = expeditionLog.split('\n');
  const allLines = [];
  for (const paragraph of paragraphs) {
    if (paragraph.trim()) {
      const wrappedLines = wrapText(ctx, paragraph.trim(), logWidth - 30);
      allLines.push(...wrappedLines);
    }
  }

  let lineY = logY + 55;
  const maxLines = Math.floor((logHeight - 60) / 18);
  for (let i = 0; i < Math.min(allLines.length, maxLines); i++) {
    ctx.fillText(allLines[i], logX + 15, lineY);
    lineY += 18;
  }

  // Bottom bar - biome types summary
  const bottomY = 400;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
  ctx.fillRect(0, bottomY, totalWidth, totalHeight - bottomY);

  ctx.textAlign = 'center';
  ctx.fillStyle = biome.color;
  ctx.font = `bold 16px ${PIXEL_FONT}`;
  ctx.fillText(
    `Biome: ${biome.name} | Types dominants: ${biome.dominantTypes.join(', ')}`,
    totalWidth / 2,
    bottomY + 30
  );

  ctx.fillStyle = '#888888';
  ctx.font = `14px ${PIXEL_FONT}`;
  ctx.fillText(
    `Types recommandés: ${biome.recommendedTypes.join(', ')} | À éviter: ${biome.avoidTypes.join(', ')}`,
    totalWidth / 2,
    bottomY + 55
  );

  return canvas.toBuffer('image/png');
}

module.exports = {
  generateBoosterOpeningImage,
  generateCollectionImage,
  generateCardDetailImage,
  generateTeamImage,
  generateRaidBossImage,
  generateRaidResultImage,
  generateExpeditionStartImage,
  generateExpeditionProgressImage,
  generateExpeditionResultImage
};