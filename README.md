# Retardio Discord Bot

Bot Discord multifonction avec gestion de boissons, anniversaires et système de collection de cartes Pokémon.

## Fonctionnalités

### 🍵 Gestion de Boissons

Gestion de listes de thés, infusions, cafés et sirops avec sélection aléatoire.

**Commandes:**

- `/ajouter <type> <nom>` - Ajouter une boisson à la liste
- `/supprimer <type> <nom>` - Supprimer une boisson de la liste
- `/aleatoire <type> [sirop]` - Choisir une boisson au hasard (avec option sirop)
- `/liste <type>` - Afficher la liste complète d'un type de boisson

**Types disponibles:** thé, infusion, café, sirop

**Stockage:** `data/boissons.json`

### 🎂 Anniversaires

Système de rappel d'anniversaires avec vérification quotidienne automatique.

**Commandes:**

- `/anniversaire_ajouter <jour> <mois> [membre|nom]` - Ajouter un anniversaire
- `/anniversaire_supprimer <nom>` - Supprimer un anniversaire
- `/anniversaire_liste` - Afficher tous les anniversaires enregistrés

**Fonctionnalités:**

- Vérification quotidienne à minuit (timezone Paris)
- Mention automatique dans le canal configuré
- Support membres Discord et noms personnalisés
- Stockage: `data/anniversaires.json`

### 🎴 Pokémon Boosters

Système de collection de cartes avec boosters quotidiens, échanges, boutique et God Packs.

**Commandes:**

- `/booster` - Ouvrir un booster (quotidien gratuit ou depuis l'inventaire)
- `/collection [utilisateur] [booster]` - Voir une collection avec menu de sélection
- `/echange <utilisateur>` - Échanger des cartes via menu interactif
- `/boutique` - Acheter des boosters et cartes promo
- `/solde [utilisateur]` - Voir son solde de Poké Dollars (Ꝑ)
- `/inventaire` - Voir ses boosters en stock
- `/giftbooster <utilisateur>` - [ADMIN] Offrir un booster (reset cooldown)

**Caractéristiques:**

- 5 cartes par booster avec garantie Peu commun minimum
- God Pack: 1/256 chance (toutes cartes Rare+)
- Raretés: Commun (54%), Peu commun (28%), Rare (14%), Légendaire (4%), Promo
- Économie: Gagnez des Ꝑ en discutant (5-15 Ꝑ/message, anti-spam)
- Cartes Promo exclusives (achat en boutique, certaines limitées)
- Images générées avec police pixel (PixelOperator8-Bold.ttf)
- Admin whitelist configurable dans `pokemonHandler.js` ligne 14

**Stockage:**

- Configuration: `data/boosters.json`, `data/rarities.json`, `data/godpack.json`
- Cartes: `data/cards.json`
- Utilisateurs: `data/db/{userId}.json` (1 fichier par utilisateur)
- Assets: `assets/cards/`, `assets/backgrounds/`, `assets/fonts/`

## Configuration

**Fichiers requis:**

- `config.js` - Token Discord, IDs client/guild, canal anniversaires
- `data/boissons.json` - Listes de boissons
- `data/anniversaires.json` - Anniversaires enregistrés
- `data/cards.json` - Base de données des cartes
- `data/boosters.json` - Configuration des boosters
- `data/rarities.json` - Définition des raretés
- `data/godpack.json` - Configuration God Pack

**Variables d'environnement:**

- `DISCORD_TOKEN` - Token du bot
- `CLIENT_ID` - ID de l'application Discord
- `GUILD_ID` - (Optionnel) ID du serveur pour commandes instantanées
- `BIRTHDAY_CHANNEL_ID` - Canal pour les annonces d'anniversaires

## Installation

```bash
bun install
node index.js
```

**Dépendances principales:**

- discord.js - Framework Discord
- canvas - Génération d'images
- crypto - Nombres aléatoires sécurisés

## Structure

```tree
/
├── index.js                    # Point d'entrée
├── commandHandler.js           # Commandes boissons
├── birthdayHandler.js          # Système anniversaires
├── pokemonHandler.js           # Système Pokémon
├── shopHandler.js              # Boutique et économie
├── cardGenerator.js            # Génération de cartes
├── imageGenerator.js           # Création d'images
├── userManager.js              # Gestion utilisateurs et économie
├── messageHandler.js           # Traitement messages + récompenses
├── config.js                   # Configuration
├── data/
│   ├── boissons.json
│   ├── anniversaires.json
│   ├── cards.json
│   ├── boosters.json
│   ├── rarities.json
│   ├── godpack.json
│   └── db/                     # Données utilisateurs (cartes, argent, inventaire)
└── assets/
    ├── cards/                  # Images cartes (300x363px)
    ├── boosters/               # Images boosters
    ├── backgrounds/            # Fonds (opening: 1600x543, collection: 1370x1100)
    └── fonts/                  # PixelOperator8-Bold.ttf
```

## Notes Techniques

- Timezone: Europe/Paris pour tous les resets
- Cooldowns: Stockés par utilisateur dans fichiers JSON individuels
- Sécurité: crypto.randomInt() pour God Pack et tirages de cartes
- Cache: cardIds groupés par booster/rareté au démarrage
- Images: Génération dynamique avec node-canvas, ombres sharp 3px
- Interactions: Support menus déroulants et boutons Discord

## Personnalisation

**Admin Pokémon:** Modifier `ADMIN_WHITELIST` dans `pokemonHandler.js` (ligne 14)

**Économie:** Ajuster `ECONOMY_CONFIG` dans `userManager.js` (récompenses, cooldown, anti-spam)

**Probabilités God Pack:** Éditer `data/godpack.json`

**Raretés:** Ajuster probabilités dans `data/rarities.json`

**Cartes:** Ajouter dans `data/cards.json` + images dans `assets/cards/`

**Boosters:** Ajouter dans `data/boosters.json` + image dans `assets/boosters/`

## Assets Images

Images placées dans `assets/`. Le système utilise le center-crop (pas d'étirement).

| Type | Fichier | Personnalisé | Taille recommandée |
|------|---------|--------------|-------------------|
| Cartes | `cards/card_{id}.png` | - | 300 x 363 px |
| Boosters | `boosters/booster_{id}.png` | - | 200 x 280 px |
| Ouverture | `backgrounds/opening_bg.png` | - | 1640 x 643 px |
| Collection | `backgrounds/collection_bg.png` | `collection_{nom}.png` ou `collection_booster_{id}.png` | 1370 x variable |
| Détail carte | `backgrounds/carddetail_bg.png` | `carddetail_card_{id}.png` (per-card) ou `carddetail_{nom}.png` (per-booster) | 380 x 563 px |

**Priorité détail carte:** per-card → per-booster → générique → dégradé

**Nommage per-booster:** Le nom est en minuscules, caractères spéciaux remplacés par `_` (ex: "Puissance Génétique" → `collection_puissance_g_n_tique.png`)
