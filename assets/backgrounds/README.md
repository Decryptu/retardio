# Images de Fond (Optionnel)

## Spécifications

Ces images sont **optionnelles** mais améliorent le rendu visuel.

### collection_bg.png
- **Largeur:** 1370px
- **Hauteur:** 1100px (pour 60 cartes max en 10x6)
- **Format:** PNG ou JPG
- **Usage:** Fond pour l'image de collection (grille de cartes)
- **Design:** Texture, dégradé, ou pattern discret pour ne pas écraser les cartes
- **Note:** La hauteur s'adapte automatiquement au nombre de cartes (50 cartes = ~1000px, 60 cartes = ~1100px)

### opening_bg.png
- **Largeur:** 1600px
- **Hauteur:** 543px
- **Format:** PNG ou JPG
- **Usage:** Fond pour l'affichage des 5 cartes tirées
- **Design:** Fond dynamique, effet de "révélation", etc.

## Comportement par défaut

Si ces fichiers n'existent pas, le bot utilisera :
- **Fond uni** (couleur neutre)
- **Dégradé simple**

Les images fonctionneront parfaitement sans ces backgrounds !

## Remplacement

Pour ajouter des backgrounds personnalisés :
1. Créez vos images aux bonnes dimensions
2. Nommez-les `collection_bg.png` et `opening_bg.png`
3. Placez-les dans ce dossier
4. Redémarrez le bot

---

**Note :** Ces fichiers sont purement cosmétiques et optionnels.
