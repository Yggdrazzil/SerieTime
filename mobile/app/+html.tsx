import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

// Coquille HTML de la version web (export `expo export -p web`).
// Ajoute les metas « web app » : icône d'écran d'accueil, plein écran iOS, thème.
export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="fr">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        {/* App-like : on bloque le zoom navigateur (double-tap / pincement) qui
            « décadrait » le flux et rendait les boutons peu réactifs (délai de
            300 ms). initial-scale figé + user-scalable=no = comportement natif. */}
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover"
        />
        <title>SerieTime</title>
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="SerieTime" />
        {/* Barre de statut : blanc pour se fondre avec le haut de l'app (le jaune
            de marque tranchait trop, notamment en PWA installée sur Android).
            Le script ci-dessous remplace cette valeur par le fond du thème actif
            AVANT le premier rendu. */}
        <meta name="theme-color" content="#FFFFFF" />
        {/* En PWA installée, Chrome/Android choisit la couleur des barres
            système via le meta theme-color dont le `media` correspond au thème
            SYSTÈME du téléphone (supporté depuis Chrome 93, PWA uniquement) :
            sans ces deux variantes, la barre de gestes restait blanche quand
            l'app est sombre sur un téléphone réglé en clair. Le script
            ci-dessous met les TROIS metas à la couleur du thème choisi. */}
        <meta name="theme-color" media="(prefers-color-scheme: light)" content="#FFFFFF" />
        <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#FFFFFF" />
        {/* Thème AVANT peinture : Android échantillonne la couleur des barres
            système (statut + barre de gestes en bas) au chargement de la page —
            attendre le bundle JS laissait un liseré blanc en bas en Sombre/Sunset.
            Les fonds ci-dessous doivent rester alignés sur `bg` des palettes de
            `lib/theme.ts`. Teinter <html> évite aussi le flash blanc au reload
            (changement de thème), et `color-scheme` fait suivre la barre de
            gestes (et les scrollbars) au thème de l'app, pas à celui du système. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function () {
                try {
                  var pref = localStorage.getItem('serietime-theme');
                  var theme = (pref === 'light' || pref === 'dark' || pref === 'sunset' || pref === 'midnight')
                    ? pref
                    : (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
                  var bg = theme === 'dark' ? '#121217' : theme === 'midnight' ? '#0B075A' : theme === 'sunset' ? '#FAF5EE' : '#FFFFFF';
                  document.documentElement.style.backgroundColor = bg;
                  document.documentElement.style.colorScheme = (theme === 'dark' || theme === 'midnight') ? 'dark' : 'light';
                  var metas = document.querySelectorAll('meta[name="theme-color"]');
                  for (var i = 0; i < metas.length; i++) metas[i].setAttribute('content', bg);
                } catch (e) {}
              })();
            `,
          }}
        />
        {/* Manifest PWA : sur Android, c'est lui qui transforme « ajouter à
            l'écran d'accueil » en vraie app plein écran (et non un raccourci
            navigateur). iOS s'appuie sur les metas apple-* ci-dessus. */}
        <link rel="manifest" href="/manifest.json" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <link rel="icon" href="/favicon.ico" />
        {/* Lissage de police : sans ça, la web app rend le texte plus épais /
            « grossier » qu'en natif. On force l'anticrénelage en niveaux de gris
            (comme iOS/Android natif) pour un rendu fin et lisible façon TV Time. */}
        <style
          dangerouslySetInnerHTML={{
            __html: `
              html, body, #root, * {
                -webkit-font-smoothing: antialiased;
                -moz-osx-font-smoothing: grayscale;
                text-rendering: optimizeLegibility;
              }
              /* Tailles identiques pour tous : neutralise le « text scaling »
                 du navigateur Android (Brave/Chrome) qui gonflait nos textes
                 par rapport à TV Time. Le zoom page reste possible. */
              html, body {
                -webkit-text-size-adjust: 100%;
                text-size-adjust: none;
              }
              /* Supprime le double-tap-zoom + le délai de clic de ~300 ms sur
                 mobile : boutons plus réactifs, plus de « mini-zoom » accidentel. */
              html, body, #root {
                touch-action: manipulation;
              }
              /* Champs de saisie : pas d'anneau de focus navigateur (encadré
                 orange/bleu incohérent avec le style « soulignement » de l'app).
                 Le focus reste signalé par le caret + les styles de l'app. */
              input:focus, textarea:focus {
                outline: none;
              }
            `,
          }}
        />
        <ScrollViewStyleReset />
      </head>
      <body>{children}</body>
    </html>
  );
}
