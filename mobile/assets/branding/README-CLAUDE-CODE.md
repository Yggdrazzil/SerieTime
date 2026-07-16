# Pack d’icônes SerieTime

Ce dossier contient les fichiers prêts à intégrer. L’icône ne comporte volontairement **aucun angle arrondi** : iOS et Android appliquent eux-mêmes leur masque.

## Fichiers à utiliser

- `icon-master-native-1254.png` : master PNG natif, à conserver comme source.
- `icon-universal-ios-1024.png` : icône universelle opaque 1024 × 1024, à utiliser pour iOS et comme icône générale.
- `icon-google-play-512.png` : fiche Google Play, 512 × 512.
- `android-adaptive-foreground-1024.png` : calque avant Android, transparent et recentré dans la zone de sécurité.
- `android-adaptive-background-1024.png` : fond Android opaque. Couleur équivalente : `#0B075A`.
- `android-monochrome-1024.png` : calque monochrome pour les icônes thématiques Android.
- `android-adaptive-preview.png` : aperçu de contrôle uniquement, à ne pas configurer comme calque.
- `apple-touch-icon-180.png` : raccourci Web iOS.
- `pwa-icon-192.png` et `pwa-icon-512.png` : manifeste PWA.

Tous les fichiers portant l’extension `.png` sont de vrais PNG sRGB. L’icône iOS est opaque, sans canal alpha utile.

## Instruction à donner à Claude Code

> Intègre le pack `serietime-app-icon-pack` comme identité d’application. Inspecte d’abord la stack du projet et adapte la configuration existante sans modifier le dessin, les couleurs, les proportions ni ajouter d’angles arrondis. Utilise `icon-universal-ios-1024.png` pour iOS et l’icône générale, puis `android-adaptive-foreground-1024.png` avec le fond `#0B075A` et `android-monochrome-1024.png` pour l’icône adaptative Android. Utilise `icon-google-play-512.png` uniquement pour la fiche Play Store et les deux fichiers `pwa-icon-*` pour le manifeste Web. Mets à jour les fichiers de configuration ou asset catalogs appropriés, nettoie les anciens assets devenus inutiles, puis vérifie le rendu avec au moins un masque circulaire et un masque squircle. Ne recompresse pas les PNG en JPEG.

## Exemple si le projet utilise Expo

Place le dossier dans `assets/branding/`, puis adapte `app.json` ou `app.config.*` :

```json
{
  "expo": {
    "icon": "./assets/branding/serietime-app-icon-pack/icon-universal-ios-1024.png",
    "ios": {
      "icon": "./assets/branding/serietime-app-icon-pack/icon-universal-ios-1024.png"
    },
    "android": {
      "adaptiveIcon": {
        "foregroundImage": "./assets/branding/serietime-app-icon-pack/android-adaptive-foreground-1024.png",
        "backgroundColor": "#0B075A",
        "monochromeImage": "./assets/branding/serietime-app-icon-pack/android-monochrome-1024.png"
      }
    },
    "web": {
      "favicon": "./assets/branding/serietime-app-icon-pack/pwa-icon-192.png"
    }
  }
}
```

Expo recommande un PNG 1024 × 1024 pour l’icône principale. Android utilise séparément un calque avant et un fond pour appliquer correctement les différents masques des constructeurs.

Références officielles :

- Apple : https://developer.apple.com/documentation/xcode/configuring-your-app-icon
- Android : https://developer.android.com/develop/ui/compose/system/icon_design_adaptive
- Expo : https://docs.expo.dev/versions/latest/config/app/
