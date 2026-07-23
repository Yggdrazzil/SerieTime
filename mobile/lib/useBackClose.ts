import { useEffect, useRef } from 'react';
import { BackHandler, Platform } from 'react-native';
import { useIsFocused } from '@react-navigation/native';

// Ferme un overlay piloté par ÉTAT (feuille/modale, hors routeur) au « retour »
// système. Sans lui, ces overlays n'ont aucune entrée d'historique : le bouton
// précédent du navigateur fait reculer le routeur (et peut quitter la web app
// depuis un onglet racine) au lieu de simplement fermer l'overlay.
//
// - Web : à l'ouverture, on empile un cran d'historique « fantôme » (même URL) ;
//   le prochain `popstate` (bouton précédent) le consomme → on ferme l'overlay
//   et l'app reste en place. Fermé autrement (bouton X, tap sur le fond), on
//   retire nous-mêmes ce cran.
// - Natif : on intercepte le bouton retour matériel (Android), mais UNIQUEMENT
//   quand l'écran hôte est focalisé (voir la note sur l'effet natif).
export function useBackClose(visible: boolean, onClose: () => void) {
  // Référence stable : évite de re-jouer l'effet (donc de ré-empiler un cran)
  // quand l'identité de onClose change entre deux rendus.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // Écran hôte au premier plan ? Un écran empilé PAR-DESSUS (ex. fiche ouverte
  // depuis un résultat de recherche) défocalise l'écran de l'overlay.
  const isFocused = useIsFocused();
  // Valeur COURANTE de `visible`, lue au nettoyage de l'effet web : distingue
  // une vraie fermeture (visible→false) d'une simple défocalisation (nav avant).
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  // Passe à true quand on NAVIGUE depuis l'overlay (openShow, commentaires…) :
  // le nettoyage web ne fera alors PAS history.back() (qui, sur PWA, entrerait
  // en course avec router.push et l'annulerait — au lieu d'ouvrir la fiche
  // ciblée, l'écran sous-jacent se fermait). Bug Étienne : depuis la feuille
  // épisode, taper le nom de la série / les commentaires fermait la fiche.
  const navigatingRef = useRef(false);

  // NATIF (Android) : intercepte le retour matériel — mais seulement si l'écran
  // hôte est focalisé. Sinon le handler d'un overlay resté « ouvert » sous une
  // fiche empilée avalait le retour et fermait l'overlay caché au lieu de
  // dépiler la fiche (bug Étienne : retour depuis la fiche jeu → feed TikTok au
  // lieu des résultats de recherche). Défocalisé, on laisse le routeur gérer le
  // retour (dépile la fiche) ; l'overlay reste ouvert et réapparaît intact.
  useEffect(() => {
    if (Platform.OS === 'web' || !visible || !isFocused) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onCloseRef.current();
      return true; // on a géré le retour : ne pas quitter l'écran
    });
    return () => sub.remove();
  }, [visible, isFocused]);

  // WEB : cran d'historique fantôme, gardé par le focus (comme le natif). Si un
  // écran est empilé PAR-DESSUS (fiche ouverte depuis un résultat), l'écran de
  // l'overlay se défocalise → on retire notre écouteur `popstate`. Le retour
  // navigateur dépile alors la fiche et revient sur nos résultats (recherche
  // préservée dans l'état) au lieu de fermer l'overlay caché → feed (bug
  // Étienne, PWA Android). Refocalisé, on réarme sans ré-empiler de cran.
  useEffect(() => {
    if (Platform.OS !== 'web' || !visible || !isFocused) return;
    if (typeof window === 'undefined') return;
    // L'overlay (ré)apparaît : on repart d'une intention de navigation neuve.
    navigatingRef.current = false;
    let poppedByBack = false;
    // Empile un cran SEULEMENT s'il n'y en a pas déjà un (évite d'en ré-empiler
    // à chaque refocalisation, ex. au retour depuis une fiche empilée).
    const pushed = (window.history.state as { __overlay?: boolean } | null)?.__overlay !== true;
    if (pushed) window.history.pushState({ __overlay: true }, '');
    const onPop = () => {
      poppedByBack = true;
      onCloseRef.current();
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      // Retirer NOTRE cran fantôme UNIQUEMENT sur une vraie fermeture en place
      // (bouton X / tap sur le fond → visible repassé à false). Si l'effet se
      // démonte parce qu'un écran s'est empilé (défocalisation, visible encore
      // true), NE PAS toucher à l'historique : un history.back() ici entrerait
      // en COURSE avec le router.push de la fiche et l'annulerait (fiche qui ne
      // s'ouvre pas). Le cran reste alors derrière la fiche → le retour depuis
      // la fiche revient sur les résultats (recherche préservée).
      const stillOurs = (window.history.state as { __overlay?: boolean } | null)?.__overlay === true;
      if (pushed && !poppedByBack && stillOurs && !visibleRef.current && !navigatingRef.current) window.history.back();
    };
  }, [visible, isFocused]);

  return {
    // À appeler JUSTE AVANT router.push quand on quitte l'overlay pour un autre
    // écran (ex. « voir la série », « commentaires »). Neutralise le
    // history.back() du nettoyage pour la fermeture qui suit → pas de course
    // avec la navigation. Le cran fantôme reste derrière le nouvel écran et est
    // consommé par le prochain retour (comportement voulu).
    beginNavigation: () => {
      navigatingRef.current = true;
    },
  };
}
