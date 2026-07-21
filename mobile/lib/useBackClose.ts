import { useEffect, useRef } from 'react';
import { BackHandler, Platform } from 'react-native';

// Ferme un overlay piloté par ÉTAT (feuille/modale, hors routeur) au « retour »
// système. Sans lui, ces overlays n'ont aucune entrée d'historique : le bouton
// précédent du navigateur fait reculer le routeur (et peut quitter la web app
// depuis un onglet racine) au lieu de simplement fermer l'overlay.
//
// - Web : à l'ouverture, on empile un cran d'historique « fantôme » (même URL) ;
//   le prochain `popstate` (bouton précédent) le consomme → on ferme l'overlay
//   et l'app reste en place. Fermé autrement (bouton X, tap sur le fond), on
//   retire nous-mêmes ce cran.
// - Natif : on intercepte le bouton retour matériel (Android).
export function useBackClose(visible: boolean, onClose: () => void) {
  // Référence stable : évite de re-jouer l'effet (donc de ré-empiler un cran)
  // quand l'identité de onClose change entre deux rendus.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!visible) return;

    if (Platform.OS !== 'web') {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        onCloseRef.current();
        return true; // on a géré le retour : ne pas quitter l'écran
      });
      return () => sub.remove();
    }

    if (typeof window === 'undefined') return;
    let poppedByBack = false;
    window.history.pushState({ __overlay: true }, '');
    const onPop = () => {
      poppedByBack = true;
      onCloseRef.current();
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      // Fermé sans passer par le bouton précédent (X, fond) : le cran fantôme
      // est encore là, on le retire pour ne pas laisser d'entrée parasite.
      if (!poppedByBack) window.history.back();
    };
  }, [visible]);
}
