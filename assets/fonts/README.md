# Police Pixel Art - GameBoy.ttf

## Installation

### **Méthode simple (recommandée)**

Placez simplement votre fichier `GameBoy.ttf` dans ce dossier :

```
assets/fonts/GameBoy.ttf
```

Le bot chargera automatiquement la police depuis ce fichier.

---

### **Méthode alternative : Installation système**

Si vous préférez installer la police au niveau système :

**Sur Linux (VPS) :**
```bash
# Copier la police dans le dossier système
sudo cp GameBoy.ttf /usr/share/fonts/truetype/

# Mettre à jour le cache des polices
sudo fc-cache -f -v
```

**Vérification :**
```bash
# Vérifier que la police est détectée
fc-list | grep -i gameboy
```

---

## Utilisation

La police sera utilisée automatiquement pour :
- Les numéros de cartes
- Les noms de raretés
- Les titres sur les images de collection
- Les labels sur les images d'ouverture de booster

---

## Police de fallback

Si `GameBoy.ttf` n'est pas trouvée, le bot utilisera :
- **Arial** (police de secours)

Le bot continuera de fonctionner normalement, mais sans le style pixel art.

---

## Format de fichier

- **Format :** TTF (TrueType Font)
- **Nom du fichier :** `GameBoy.ttf` (respectez la casse exacte)
- **Emplacement :** Ce dossier (`assets/fonts/`)

---

**Note :** Après avoir ajouté la police, redémarrez le bot pour qu'elle soit prise en compte.
