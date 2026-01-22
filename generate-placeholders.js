const fs = require('node:fs');
const path = require('node:path');

// PNG 1x1 transparent minimal (base64)
const TRANSPARENT_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

console.log('🎨 Génération des placeholders PNG...\n');

// Générer les cartes (1-50)
console.log('📇 Génération des 50 cartes...');
for (let i = 1; i <= 50; i++) {
  const filePath = path.join(__dirname, 'assets', 'cards', `card_${i}.png`);
  fs.writeFileSync(filePath, TRANSPARENT_PNG);
}
console.log('✅ 50 cartes générées\n');

// Générer le dos de carte
console.log('📇 Génération du dos de carte...');
const backPath = path.join(__dirname, 'assets', 'cards', 'card_back.png');
fs.writeFileSync(backPath, TRANSPARENT_PNG);
console.log('✅ Dos de carte généré\n');

// Générer le booster
console.log('📦 Génération du booster...');
const boosterPath = path.join(__dirname, 'assets', 'boosters', 'booster_1.png');
fs.writeFileSync(boosterPath, TRANSPARENT_PNG);
console.log('✅ Booster généré\n');

// Backgrounds optionnels
console.log('🖼️  Génération des backgrounds optionnels...');
const collectionBgPath = path.join(__dirname, 'assets', 'backgrounds', 'collection_bg.png');
const openingBgPath = path.join(__dirname, 'assets', 'backgrounds', 'opening_bg.png');
fs.writeFileSync(collectionBgPath, TRANSPARENT_PNG);
fs.writeFileSync(openingBgPath, TRANSPARENT_PNG);
console.log('✅ Backgrounds générés\n');

console.log('🎉 Tous les placeholders ont été générés avec succès !');
console.log('📝 Remplacez-les par vos vraies images selon les README dans chaque dossier.');
