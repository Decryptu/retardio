# 🎴 Pokémon Booster - Documentation

## Vue d'ensemble

Système de collection de cartes avec boosters quotidiens, système de collection et échanges entre joueurs.

---

## 📋 Commandes disponibles

### `/booster`
Ouvre votre booster quotidien gratuit (5 cartes).

**Restrictions:**
- 1 booster par jour (reset à minuit, heure de Paris)
- Les cartes sont tirées avec un système de rareté pondéré
- Garantie: Au moins 1 carte Peu commun ou mieux

**Répartition des raretés:**
- 🟢 **Commun** (60%) - Cartes 1-30
- 🟣 **Peu commun** (25%) - Cartes 31-42
- 🔵 **Rare** (10%) - Cartes 43-47
- 🟪 **Épique** (4%) - Cartes 48-49
- 🟠 **Légendaire** (1%) - Carte 50

**✨ GOD PACK - Probabilité 1/256:**
- Chance ultra rare d'obtenir un **God Pack**
- Toutes les 5 cartes sont au moins **Rare** ou mieux
- Fond violet spécial et message de félicitations
- Les God Packs utilisent un tirage pondéré parmi Rare/Épique/Légendaire uniquement

### `/collection [utilisateur] [booster]`
Affiche la collection de cartes.

**Options:**
- `utilisateur` (optionnel): Voir la collection d'un autre joueur
- `booster` (optionnel): Numéro du booster à afficher (défaut: 1)

**Affichage:**
- Grille 10x5 avec toutes les cartes du booster
- Cartes possédées: image de face avec bordure colorée
- Cartes manquantes: dos de carte en transparence
- Quantité affichée si vous avez des doublons
- Statistiques: X/50 cartes (pourcentage)

### `/echange @utilisateur`
Initie un échange de cartes avec un autre joueur.

**Processus:**
1. Sélectionnez la carte que vous donnez (depuis votre collection)
2. Sélectionnez la carte que vous recevez (depuis leur collection)
3. Le joueur ciblé reçoit une demande de confirmation
4. Il peut accepter ✅ ou refuser ❌
5. Si accepté, les cartes sont échangées automatiquement

**Règles:**
- Vous pouvez échanger n'importe quelle carte que vous possédez
- Si vous échangez votre dernière copie, vous ne l'aurez plus
- Les doublons sont pris en compte
- L'échange expire après 5 minutes sans réponse

---

## 🗂️ Structure des fichiers

```
retardio/
├── pokemonHandler.js          # Handler principal des commandes
├── cardGenerator.js           # Logique de tirage aléatoire (crypto.randomInt)
├── userManager.js             # Gestion des données utilisateur
├── imageGenerator.js          # Génération des images avec node-canvas
│
├── data/
│   ├── boosters.json          # Configuration des boosters
│   ├── cards.json             # Base de données des cartes
│   └── db/                    # Données utilisateur (1 fichier JSON par user)
│       └── {userId}.json      # Format: { cards: {}, lastBoosterOpen, stats }
│
└── assets/
    ├── cards/
    │   ├── card_1.png à card_50.png
    │   ├── card_back.png      # Dos de carte (pour cartes non possédées)
    │   └── README.md
    ├── boosters/
    │   ├── booster_1.png
    │   └── README.md
    └── backgrounds/           # Optionnel
        ├── collection_bg.png
        ├── opening_bg.png
        └── README.md
```

---

## 🎨 Remplacement des images

**IMPORTANT:** Les images actuelles sont des placeholders transparents 1x1px.

### Pour remplacer les images:

1. **Cartes** (`assets/cards/`)
   - Créez 50 images PNG (**300x363px**)
   - Nommez-les: `card_1.png`, `card_2.png`, ..., `card_50.png`
   - Créez le dos: `card_back.png` (même dimensions: 300x363px)
   - Remplacez les placeholders

2. **Boosters** (`assets/boosters/`)
   - Créez l'image du booster: `booster_1.png` (**280x420px**)
   - Remplacez le placeholder

3. **Police Pixel Art** (`assets/fonts/`)
   - Placez votre fichier `GameBoy.ttf` dans ce dossier
   - La police sera automatiquement chargée au démarrage
   - Utilisée pour tous les textes sur les images générées
   - Si absente, le bot utilisera Arial en fallback

4. **Backgrounds** (optionnel)
   - `collection_bg.png` (1370x945px)
   - `opening_bg.png` (1600x543px)

Consultez les README dans chaque dossier `assets/` pour plus de détails.

---

## ⚙️ Configuration technique

### Système de tirage aléatoire
- Utilise `crypto.randomInt()` pour un aléatoire cryptographiquement sécurisé
- Probabilités configurables dans `data/boosters.json`
- Garantie de rareté minimum par pack (Peu commun ou mieux)
- **God Pack:** 1/256 chance - Toutes les cartes sont au moins Rare
- Les God Packs ont un fond violet spécial et un message unique

### Génération d'images
- Utilise **node-canvas** pour générer les images à la volée
- Police pixel art **GameBoy.ttf** chargée automatiquement depuis `assets/fonts/`
- Fallback sur Arial si la police n'est pas trouvée
- Dimensions des cartes: 300x363px
- Dimensions des boosters: 280x420px
- God Packs ont un fond violet dégradé spécial

### Stockage des données
- **JSON local** (pas de base de données externe)
- 1 fichier par utilisateur: `data/db/{userId}.json`
- Format:
  ```json
  {
    "userId": "123456789",
    "cards": {
      "1": 2,    // Possède 2x carte #1
      "5": 1     // Possède 1x carte #5
    },
    "lastBoosterOpen": "2026-01-20",
    "stats": {
      "totalBoosters": 15,
      "totalCards": 75
    }
  }
  ```

### Timezone
- Configuré sur **Europe/Paris**
- Reset quotidien à minuit (00:00)

---

## 🔧 Maintenance

### Ajouter un nouveau booster

1. Ajoutez les nouvelles cartes dans `data/cards.json` (IDs 51+)
2. Ajoutez la configuration dans `data/boosters.json`:
   ```json
   "2": {
     "id": 2,
     "name": "Deuxième Édition",
     "totalCards": 50,
     "rarities": { ... }
   }
   ```
3. Ajoutez les images: `card_51.png` à `card_100.png`
4. Ajoutez l'image: `booster_2.png`

### Modifier les probabilités

Éditez `data/boosters.json` et ajustez les valeurs `probability` de chaque rareté.

**IMPORTANT:** La somme des probabilités doit = 1.00

---

## 📊 Statistiques

Pour obtenir des stats globales, vous pouvez analyser le dossier `data/db/`:

```bash
# Nombre total de joueurs
ls data/db/*.json | wc -l

# Voir un profil utilisateur
cat data/db/123456789.json
```

---

## 🐛 Dépannage

### Le bot ne répond pas
- Vérifiez que `canvas` est bien installé: `npm list canvas`
- Consultez les logs du bot pour les erreurs

### Images manquantes
- Vérifiez que les fichiers existent dans `assets/`
- Respectez bien le nommage: `card_X.png` (pas `cardX.png`)

### Échange bloqué
- Les échanges expirent après 5 minutes
- Relancez la commande `/echange`

---

## 🚀 Future-proof

Le code est conçu pour être facilement extensible:

- **Nouveaux boosters**: Ajoutez simplement dans `boosters.json`
- **Nouvelles raretés**: Ajoutez dans la config du booster
- **Nouvelles commandes**: Ajoutez dans `pokemonHandler.js`
- **Statistiques**: Les données JSON sont facilement requêtables

Le système `userManager.js` centralise toute la gestion des données utilisateur, facilitant les futures évolutions.

---

**Bon jeu ! 🎮**
