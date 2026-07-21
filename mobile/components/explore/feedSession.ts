import { create } from 'zustand';
import type { FeedCategory, FeedItem } from './types';

// Clé STABLE d'un item du flux (id local ?? tmdbId, préfixés par le type ;
// igdbId pour les jeux) — sert de clé FlatList ET de clé d'override.
export const feedItemKey = (f: FeedItem) =>
  f.igdbId ? `game:${f.igdbId}` : `${f.type}:${f.tmdbId ?? f.id}`;

export type FeedOverride = { liked?: boolean; watched?: boolean };

// Session de l'onglet Explorer, MODULE-SCOPE (pattern lib/tabBarHidden.ts) :
// survit à tout ce qui remonte ou recycle les cartes — masquage de l'onglet
// (enableScreens(true) sur web : display:none → scrollTop perdu), ouverture
// d'une fiche, passage par la recherche (FadeSwitch démonte le feed),
// virtualisation de la FlatList.
// - `index` : carte courante, restaurée au (re)montage et au refocus.
// - `cat` : catégorie active, restaurée après un détour par la recherche.
// - `overrides` : choix optimistes (❤️ à voir / 👁 déjà vu) par item — un
//   remontage ré-affiche l'état choisi même si le lot en cache est pré-like.
// - `seq` : tirage auquel appartient la session (= resetSeq de l'onglet) ; un
//   re-tap de l'onglet bump le seq → la session repart de zéro (feed neuf).
type FeedSessionState = {
  seq: number;
  index: number;
  cat: FeedCategory;
  overrides: Record<string, FeedOverride>;
  setIndex: (index: number) => void;
  setCat: (cat: FeedCategory) => void;
  setOverride: (key: string, override: FeedOverride) => void;
  removeOverride: (key: string) => void;
  // Nouveau tirage VOLONTAIRE sans changer d'onglet (pull-to-refresh, carte de
  // fin) : position et choix repartent de zéro, la catégorie est conservée.
  clearDeck: () => void;
  // Reset complet (re-tap de l'onglet Explorer → remontage via key).
  reset: (seq: number) => void;
};

export const useFeedSessionStore = create<FeedSessionState>((set) => ({
  seq: 0,
  index: 0,
  cat: 'tout',
  overrides: {},
  setIndex: (index) => set({ index }),
  setCat: (cat) => set({ cat, index: 0 }),
  setOverride: (key, override) => set((s) => ({ overrides: { ...s.overrides, [key]: override } })),
  removeOverride: (key) =>
    set((s) => {
      const { [key]: _drop, ...rest } = s.overrides;
      return { overrides: rest };
    }),
  clearDeck: () => set({ index: 0, overrides: {} }),
  reset: (seq) => set({ seq, index: 0, cat: 'tout', overrides: {} }),
}));
