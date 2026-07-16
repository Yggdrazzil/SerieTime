// Design tokens SerieTime (spec §10) — thèmes Clair / Sombre / Sunset.
import { Appearance, Platform } from 'react-native';

// Police unique de l'app (native + web) : Mulish — sans-serif humaniste fine,
// choisie pour coller au rendu net et léger de TV Time (Rubik, plus ronde et
// large, paraissait trop « grosse »). Les styles utilisent une famille par
// graisse (pas de fontWeight : Android ne synthétise pas les graisses embarquées).
export const FONTS = {
  regular: 'Mulish_400Regular',
  medium: 'Mulish_500Medium',
  semiBold: 'Mulish_600SemiBold',
  bold: 'Mulish_700Bold',
  extraBold: 'Mulish_800ExtraBold',
} as const;

// ---------------------------------------------------------------------------
// Thèmes. Les clés sont des RÔLES (héritées du thème clair d'origine) :
//  - `white`  = surface (pages, cartes)      - `black` = texte fort / éléments
//  - `pageMuted` = fond derrière les cartes  - `yellow` = accent de marque
//  - `onAccent` = texte posé SUR l'accent    - `imagePlaceholder` = vignettes vides
// Tout style qui utilise COLORS.* devient donc thémable sans être réécrit.
// ---------------------------------------------------------------------------

export type ThemePreference = 'system' | 'light' | 'dark' | 'sunset';
export type ThemeName = 'light' | 'dark' | 'sunset';

const LIGHT = {
  bg: '#FFFFFF',
  pageMuted: '#F2F2F2',
  surface: '#FFFFFF',
  text: '#000000',
  textMuted: '#808080',
  textSoft: '#A0A0A0',
  border: '#D6D6D6',
  borderLight: '#E8E8E8',
  yellow: '#FFD400',
  yellowSoft: '#FFE873',
  black: '#000000',
  white: '#FFFFFF',
  pillGrey: '#858585',
  chipGrey: '#EFEFEF',
  chipSelected: '#CFCFCF',
  blue: '#0075D9',
  red: '#C7222A',
  green: '#62D600',
  checkBg: '#F7F7F7',
  overlay: 'rgba(0,0,0,0.58)',
  provider: '#00A8E1',
  // Texte/icônes posés sur l'accent (boutons jaunes/terracotta, FAB, badges).
  onAccent: '#000000',
  // Vignettes/affiches en attente d'image.
  imagePlaceholder: '#E5E5E5',
};

export type Palette = typeof LIGHT;

// Sombre : surfaces charbon, texte presque blanc, jaune de marque inchangé
// (le texte posé dessus reste noir), bordures et puces assombries.
const DARK: Palette = {
  bg: '#121217',
  pageMuted: '#0C0C10',
  surface: '#1B1B22',
  text: '#F1F1F4',
  textMuted: '#9C9CA8',
  textSoft: '#6E6E7A',
  border: '#3A3A45',
  borderLight: '#2A2A33',
  yellow: '#FFD400',
  yellowSoft: '#3E3714',
  black: '#F1F1F4',
  white: '#1B1B22',
  pillGrey: '#6A6A76',
  chipGrey: '#2A2A33',
  chipSelected: '#45454F',
  blue: '#5CA8FF',
  red: '#E36067',
  green: '#62D600',
  checkBg: '#26262E',
  overlay: 'rgba(0,0,0,0.72)',
  provider: '#00A8E1',
  onAccent: '#101014',
  imagePlaceholder: '#2A2A32',
};

// Sunset : palette chaude INSPIRÉE de la charte Claude.ai (pas un copier-coller)
// — fonds crème, texte brun profond, accent terracotta, liens cuivrés.
const SUNSET: Palette = {
  bg: '#FAF5EE',
  pageMuted: '#F1E9DD',
  surface: '#FDFAF4',
  text: '#40332A',
  textMuted: '#8D7B6C',
  textSoft: '#B5A494',
  border: '#DECFBD',
  borderLight: '#ECE1D2',
  yellow: '#E2854F',
  yellowSoft: '#F6D7C2',
  black: '#40332A',
  white: '#FDFAF4',
  pillGrey: '#A5907D',
  chipGrey: '#F0E5D7',
  chipSelected: '#DCCBB6',
  blue: '#B65C2E',
  red: '#B8433C',
  green: '#7A9B4E',
  checkBg: '#F2EADF',
  overlay: 'rgba(61,41,25,0.55)',
  provider: '#C96F45',
  onAccent: '#FFF9F2',
  imagePlaceholder: '#E7DBCB',
};

// NB : si un `bg` change ici, reporter la valeur dans le script pré-peinture
// de `app/+html.tsx` (barres système Android teintées avant le premier rendu).
const PALETTES: Record<ThemeName, Palette> = { light: LIGHT, dark: DARK, sunset: SUNSET };

const STORAGE_KEY = 'serietime-theme';

// Préférence persistée, lue de façon SYNCHRONE au chargement du module (les
// StyleSheet des écrans figent les couleurs à l'import). Sur la web app
// (plateforme principale) : localStorage. Sur natif, pas de lecture synchrone
// possible → on suit le thème de l'appareil (Appearance) ; un choix explicite
// s'applique via le rechargement web.
export function getThemePreference(): ThemePreference {
  if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'light' || v === 'dark' || v === 'sunset' || v === 'system') return v;
  }
  return 'system';
}

function systemTheme(): ThemeName {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && 'matchMedia' in window) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return Appearance.getColorScheme() === 'dark' ? 'dark' : 'light';
}

function resolveTheme(pref: ThemePreference): ThemeName {
  return pref === 'system' ? systemTheme() : pref;
}

// Thème ACTIF de cette session (résolu une fois, au chargement).
export const THEME: ThemeName = resolveTheme(getThemePreference());
export const IS_DARK = THEME === 'dark';

export const COLORS: Palette = { ...PALETTES[THEME] };

// Web : applique une couleur à TOUS les metas theme-color. Il y en a trois
// (un sans `media` + un par variante `prefers-color-scheme`) : en PWA
// installée, Chrome/Android choisit la barre système via le meta dont le
// `media` correspond au thème SYSTÈME du téléphone — si on ne mettait à jour
// que le premier, la barre de gestes restait blanche quand l'app est sombre
// sur un téléphone en clair (liseré blanc en bas).
export function setThemeColorMeta(color: string): void {
  if (typeof document === 'undefined') return;
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', color));
}
export function currentThemeColorMeta(): string {
  if (typeof document === 'undefined') return PALETTES[THEME].bg;
  return document.querySelector('meta[name="theme-color"]')?.getAttribute('content') ?? PALETTES[THEME].bg;
}

// Enregistre la préférence puis recharge la web app pour appliquer la palette
// (les couleurs sont figées dans les styles au chargement — un rechargement
// est le seul moyen fiable de TOUT re-thémer, web comme le fait Twitter/X).
// Retourne true si l'application est immédiate (web), false sinon (natif :
// prise en compte au prochain démarrage via le thème de l'appareil).
export function applyThemePreference(pref: ThemePreference): boolean {
  if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, pref);
    if (typeof window !== 'undefined') {
      setTimeout(() => window.location.reload(), 120);
      return true;
    }
  }
  return false;
}

// Couleurs des barres de progression par STATUT de suivi (bibliothèques du
// profil). FIXES dans tous les thèmes — ce sont des codes de statut, pas des
// accents (en Sunset, l'accent terracotta serait illisible face à l'orange
// « Regarder plus tard »). `track` = même teinte à 30 % (portion restante).
export const STATUS_BAR = {
  watching: { fill: '#FFD400', track: 'rgba(255,212,0,0.30)' }, // En cours (jaune)
  upToDate: { fill: '#62D600', track: 'rgba(98,214,0,0.30)' }, // À jour (vert)
  completed: { fill: '#2F80ED', track: 'rgba(47,128,237,0.30)' }, // Terminé (bleu)
  watchlist: { fill: '#F7941D', track: 'rgba(247,148,29,0.30)' }, // Regarder plus tard (orange)
  stopped: { fill: '#E53935', track: 'rgba(229,57,53,0.30)' }, // Arrêté (rouge)
} as const;

// Rayons calqués sur TV Time (cartes et affiches nettement arrondies).
export const RADIUS = {
  card: 8,
  poster: 6,
  pill: 999,
};

export const SHADOW = {
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: IS_DARK ? 0.5 : 0.16,
    shadowRadius: 14,
    elevation: 4,
  },
  season: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: IS_DARK ? 0.45 : 0.14,
    shadowRadius: 16,
    elevation: 4,
  },
};
