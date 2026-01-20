/**
 * Script de test pour le système Pokémon Booster
 * Usage: node test-pokemon.js
 */

const { drawBoosterPack, getCardInfo, getAllCardsFromBooster } = require('./cardGenerator');
const { loadUserData, canOpenBooster, addCardsToUser, getBoosterCompletion } = require('./userManager');
const { generateBoosterOpeningImage, generateCollectionImage } = require('./imageGenerator');
const fs = require('fs');
const path = require('path');

console.log('🧪 Test du système Pokémon Booster\n');

// Test 1: Tirage de cartes
console.log('Test 1: Tirage d\'un booster...');
try {
  const { cards, isGodPack } = drawBoosterPack(1);
  console.log(`✅ Booster tiré: ${cards.length} cartes`);
  console.log(`   God Pack: ${isGodPack ? 'OUI 🌟' : 'Non'}`);
  console.log(`   Cartes: ${cards.join(', ')}`);

  // Vérifier les raretés
  const rarities = cards.map(id => {
    const info = getCardInfo(id);
    return info.rarityName;
  });
  console.log(`   Raretés: ${rarities.join(', ')}`);

  // Vérifier la garantie (au moins 1 peu commun ou mieux, ou Rare+ si God Pack)
  const minRarity = isGodPack ? 'Rare' : 'Peu commun';
  const requiredRarities = isGodPack
    ? ['Rare', 'Épique', 'Légendaire']
    : ['Peu commun', 'Rare', 'Épique', 'Légendaire'];

  const hasGuarantee = cards.some(id => {
    const info = getCardInfo(id);
    return requiredRarities.includes(info.rarityName);
  });

  if (isGodPack) {
    const allRareOrBetter = cards.every(id => {
      const info = getCardInfo(id);
      return ['Rare', 'Épique', 'Légendaire'].includes(info.rarityName);
    });
    if (allRareOrBetter) {
      console.log('   ✅ God Pack valide (toutes les cartes sont Rare+)');
    } else {
      console.log('   ❌ ERREUR: God Pack invalide !');
    }
  } else if (hasGuarantee) {
    console.log('   ✅ Garantie respectée (au moins 1 Peu commun+)');
  } else {
    console.log('   ❌ ERREUR: Garantie non respectée !');
  }
} catch (error) {
  console.log('❌ Erreur:', error.message);
}

console.log('');

// Test 2: Gestion des utilisateurs
console.log('Test 2: Gestion des données utilisateur...');
try {
  const testUserId = 'test_user_123';

  // Vérifier qu'on peut ouvrir un booster
  const canOpen = canOpenBooster(testUserId);
  console.log(`✅ Peut ouvrir un booster: ${canOpen}`);

  // Ajouter des cartes
  const testCards = [1, 5, 10, 30, 50];
  addCardsToUser(testUserId, testCards);
  console.log(`✅ ${testCards.length} cartes ajoutées`);

  // Vérifier les données
  const userData = loadUserData(testUserId);
  console.log(`✅ Cartes possédées: ${Object.keys(userData.cards).length} types`);
  console.log(`   Total tiré: ${userData.stats.totalCards} cartes`);

  // Vérifier la complétion
  const completion = getBoosterCompletion(testUserId, 1);
  console.log(`✅ Complétion: ${completion.owned}/${completion.total}`);

  // Nettoyer
  const userFile = path.join(__dirname, 'data', 'db', `${testUserId}.json`);
  if (fs.existsSync(userFile)) {
    fs.unlinkSync(userFile);
    console.log('✅ Fichier de test nettoyé');
  }
} catch (error) {
  console.log('❌ Erreur:', error.message);
}

console.log('');

// Test 3: Génération d'images
console.log('Test 3: Génération d\'images...');
(async () => {
  try {
    // Test image d'ouverture
    const testCards = [1, 5, 10, 30, 50];
    const openingImage = await generateBoosterOpeningImage(testCards, false);
    console.log(`✅ Image d'ouverture générée: ${openingImage.length} bytes`);

    // Sauvegarder pour vérification visuelle (optionnel)
    const testDir = path.join(__dirname, 'test-output');
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir);
    }
    fs.writeFileSync(path.join(testDir, 'test-opening.png'), openingImage);
    console.log('   Sauvegardée dans: test-output/test-opening.png');

    // Test image de collection
    const testUserId = 'test_user_456';
    addCardsToUser(testUserId, [1, 2, 3, 5, 10, 15, 20, 25, 30, 50]);
    const collectionImage = await generateCollectionImage(testUserId, 1);
    console.log(`✅ Image de collection générée: ${collectionImage.length} bytes`);

    fs.writeFileSync(path.join(testDir, 'test-collection.png'), collectionImage);
    console.log('   Sauvegardée dans: test-output/test-collection.png');

    // Nettoyer
    const userFile = path.join(__dirname, 'data', 'db', `${testUserId}.json`);
    if (fs.existsSync(userFile)) {
      fs.unlinkSync(userFile);
    }

    console.log('\n✅ TOUS LES TESTS RÉUSSIS !');
    console.log('\n📝 Note: Vérifiez visuellement les images dans test-output/');
    console.log('   Elles utilisent les placeholders actuels (transparents).');
    console.log('   Remplacez les images dans assets/ pour voir le rendu final.\n');

  } catch (error) {
    console.log('❌ Erreur:', error.message);
    console.error(error.stack);
  }
})();
