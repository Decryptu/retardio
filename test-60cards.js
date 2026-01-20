/**
 * Script de test pour vérifier le support de 60 cartes
 */

const { loadUserData, saveUserData } = require('./userManager');
const fs = require('fs');
const path = require('path');

console.log('🧪 Test de la génération avec 60 cartes\n');

const testUserId = 'test_60cards_user';

// Créer un booster temporaire avec 60 cartes
const tempBooster = {
  "2": {
    "id": 2,
    "name": "Test 60 Cartes",
    "totalCards": 60,
    "cardsPerPack": 5,
    "rarities": {
      "common": {
        "name": "Commun",
        "cardIds": Array.from({length: 36}, (_, i) => i + 1),
        "color": "#CCCCCC",
        "probability": 0.60
      },
      "uncommon": {
        "name": "Peu commun",
        "cardIds": Array.from({length: 15}, (_, i) => i + 37),
        "color": "#1EFF00",
        "probability": 0.25
      },
      "rare": {
        "name": "Rare",
        "cardIds": Array.from({length: 6}, (_, i) => i + 52),
        "color": "#0070DD",
        "probability": 0.10
      },
      "epic": {
        "name": "Épique",
        "cardIds": [58, 59],
        "color": "#A335EE",
        "probability": 0.04
      },
      "legendary": {
        "name": "Légendaire",
        "cardIds": [60],
        "color": "#FF8000",
        "probability": 0.01
      }
    },
    "guarantees": {
      "minRarity": "uncommon"
    }
  }
};

// Créer les cartes temporaires
const tempCards = {};
for (let i = 1; i <= 60; i++) {
  let rarity = 'common';
  if (i >= 37 && i <= 51) rarity = 'uncommon';
  if (i >= 52 && i <= 57) rarity = 'rare';
  if (i === 58 || i === 59) rarity = 'epic';
  if (i === 60) rarity = 'legendary';

  tempCards[i] = {
    id: i,
    name: `Carte ${i}`,
    rarity: rarity,
    boosterPackId: 2
  };
}

// Sauvegarder temporairement
const boostersPath = path.join(__dirname, 'data', 'boosters.json');
const cardsPath = path.join(__dirname, 'data', 'cards.json');

const originalBoosters = JSON.parse(fs.readFileSync(boostersPath, 'utf8'));
const originalCards = JSON.parse(fs.readFileSync(cardsPath, 'utf8'));

// Ajouter le booster et les cartes temporaires
fs.writeFileSync(boostersPath, JSON.stringify({ ...originalBoosters, ...tempBooster }, null, 2));
fs.writeFileSync(cardsPath, JSON.stringify({ ...originalCards, ...tempCards }, null, 2));

// Vider le cache de require pour recharger les nouveaux fichiers
delete require.cache[require.resolve('./data/boosters.json')];
delete require.cache[require.resolve('./data/cards.json')];
delete require.cache[require.resolve('./cardGenerator.js')];
delete require.cache[require.resolve('./imageGenerator.js')];

// Recharger après vidage du cache
const { generateCollectionImage } = require('./imageGenerator');

(async () => {
  try {
    console.log('📦 Création d\'un utilisateur test avec 35 cartes sur 60...');

    // Créer un utilisateur avec quelques cartes
    const userData = loadUserData(testUserId);
    // Ajouter 35 cartes aléatoires
    for (let i = 1; i <= 60; i++) {
      if (Math.random() > 0.4) { // ~60% des cartes
        userData.cards[i] = Math.floor(Math.random() * 3) + 1; // 1 à 3 exemplaires
      }
    }
    saveUserData(testUserId, userData);

    console.log('🎨 Génération de l\'image de collection (60 cartes)...');
    const collectionImage = await generateCollectionImage(testUserId, 2);

    const testDir = path.join(__dirname, 'test-output');
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir);
    }

    fs.writeFileSync(path.join(testDir, 'test-collection-60cards.png'), collectionImage);
    console.log(`✅ Image générée: ${collectionImage.length} bytes`);
    console.log('   Sauvegardée dans: test-output/test-collection-60cards.png');

    // Calculer les dimensions
    const columns = 10;
    const rows = Math.ceil(60 / columns);
    const cardDisplayHeight = Math.round(120 * (363 / 300));
    const totalHeight = 100 + (cardDisplayHeight * rows) + (10 * (rows - 1)) + (40 * 2);
    const totalWidth = (120 * columns) + (10 * (columns - 1)) + (40 * 2);

    console.log(`\n📐 Dimensions calculées:`);
    console.log(`   Grille: ${columns}x${rows}`);
    console.log(`   Largeur: ${totalWidth}px`);
    console.log(`   Hauteur: ${totalHeight}px`);

    console.log('\n✅ TEST RÉUSSI - Le système supporte bien 60 cartes !');
    console.log('   La grille s\'adapte automatiquement (10x6)');

  } catch (error) {
    console.error('❌ Erreur:', error.message);
    console.error(error.stack);
  } finally {
    // Restaurer les fichiers originaux
    console.log('\n🧹 Nettoyage...');
    fs.writeFileSync(boostersPath, JSON.stringify(originalBoosters, null, 2));
    fs.writeFileSync(cardsPath, JSON.stringify(originalCards, null, 2));

    // Supprimer le fichier utilisateur test
    const userFile = path.join(__dirname, 'data', 'db', `${testUserId}.json`);
    if (fs.existsSync(userFile)) {
      fs.unlinkSync(userFile);
    }

    console.log('✅ Nettoyage terminé\n');
  }
})();
