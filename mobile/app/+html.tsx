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
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no, viewport-fit=cover" />
        <title>SerieTime</title>
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="SerieTime" />
        <meta name="theme-color" content="#FFD400" />
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
            `,
          }}
        />
        <ScrollViewStyleReset />
      </head>
      <body>{children}</body>
    </html>
  );
}
