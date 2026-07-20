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
        {/* Le viewport conserve le cadrage plein écran tout en laissant le
            navigateur zoomer : le pincement reste indispensable pour les
            personnes malvoyantes et n'empêche pas le rendu PWA. */}
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, viewport-fit=cover"
        />
        <title>PlotTime</title>
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="PlotTime" />
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
                  var theme = (pref === 'light' || pref === 'dark' || pref === 'sunset' || pref === 'midnight' || pref === 'glass')
                    ? pref
                    : (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
                  var bg = theme === 'dark' ? '#121217' : theme === 'midnight' ? '#0B075A' : theme === 'sunset' ? '#FAF5EE' : theme === 'glass' ? '#DCE4F8' : '#FFFFFF';
                  document.documentElement.style.backgroundColor = bg;
                  if (theme === 'glass') {
                    // Fond du thème Glass : dégradé pastel que les surfaces en
                    // verre (voiles rgba + backdrop-filter) laissent transparaître.
                    // La page ne scrolle pas (conteneurs React Native Web), le
                    // dégradé reste donc naturellement fixe.
                    document.documentElement.style.backgroundImage =
                      'linear-gradient(155deg, #5E8FE8 0%, #8F7BE0 32%, #E387BD 62%, #6FB2E6 100%)';
                  }
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
              /* Respecte l'agrandissement de texte configuré dans le navigateur
                 tout en gardant une base cohérente entre les moteurs web. */
              html, body {
                -webkit-text-size-adjust: 100%;
                text-size-adjust: 100%;
              }
              /* Supprime le double-tap-zoom + le délai de clic de ~300 ms sur
                 mobile : boutons plus réactifs, plus de « mini-zoom » accidentel. */
              html, body, #root {
                touch-action: manipulation;
              }
              /* Le focus clavier doit rester visible, y compris sur les
                 composants React Native Web qui exposent un rôle interactif. */
              :where(a, button, input, textarea, select, [role="button"], [role="link"], [role="tab"], [tabindex]):focus-visible {
                outline: 3px solid #6D4ED1;
                outline-offset: 3px;
              }
              @media (forced-colors: active) {
                :where(a, button, input, textarea, select, [role="button"], [role="link"], [role="tab"], [tabindex]):focus-visible {
                  outline-color: CanvasText;
                }
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
