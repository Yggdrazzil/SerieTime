// Socle visuel PlotTime — identité Prisme et thèmes Clair / Sombre / Sunset /
// Nuit / Glass.
import { Appearance, Platform, type ViewStyle } from 'react-native';

// Police unique de l'app (native + web) : Mulish — sans-serif humaniste,
// choisie pour rester lisible dans les interfaces denses comme dans les grands
// titres. Une famille est déclarée par
// graisse (pas de fontWeight : Android ne synthétise pas les graisses embarquées).
export const FONTS = {
  regular: 'Mulish_400Regular',
  medium: 'Mulish_500Medium',
  semiBold: 'Mulish_600SemiBold',
  bold: 'Mulish_700Bold',
  extraBold: 'Mulish_800ExtraBold',
} as const;

// ---------------------------------------------------------------------------
// Les clés historiques restent disponibles pendant la migration. Les nouveaux
// écrans utilisent en priorité les rôles sémantiques (`primary`, `secondary`,
// `surfaceMuted`, etc.) :
//  - `white`  = surface (pages, cartes)      - `black` = texte fort / éléments
//  - `pageMuted` = fond derrière les cartes  - `yellow` = accent de marque
//  - `onAccent` = texte posé SUR l'accent    - `imagePlaceholder` = vignettes vides
// Tout style qui utilise COLORS.* devient donc thémable sans être réécrit.
// ---------------------------------------------------------------------------

export type ThemePreference = 'system' | 'light' | 'dark' | 'sunset' | 'midnight' | 'glass';
export type ThemeName = 'light' | 'dark' | 'sunset' | 'midnight' | 'glass';

const LIGHT = {
  bg: '#F7F5FA',
  pageMuted: '#F1EDF4',
  surface: '#FFFFFF',
  surfaceMuted: '#F1EDF4',
  text: '#201A24',
  textMuted: '#736B78',
  textSoft: '#9A929E',
  border: '#DED7E2',
  borderLight: '#EDE8EF',
  primary: '#6D4ED1',
  onPrimary: '#FFFFFF',
  primarySoft: '#EEE8FF',
  secondary: '#EF5BA8',
  tertiary: '#F3C54F',
  success: '#2E9A62',
  warning: '#B66C0E',
  danger: '#C83F60',
  info: '#2E71B8',
  focus: '#6D4ED1',
  yellow: '#F3C54F',
  yellowSoft: '#FFF2C4',
  black: '#201A24',
  white: '#FFFFFF',
  pillGrey: '#736B78',
  chipGrey: '#F1EDF4',
  chipSelected: '#DED7E2',
  blue: '#2E71B8',
  red: '#C83F60',
  green: '#2E9A62',
  checkBg: '#F1EDF4',
  overlay: 'rgba(32,26,36,0.58)',
  provider: '#6D4ED1',
  // Texte/icônes posés sur l'accent (boutons jaunes/terracotta, FAB, badges).
  onAccent: '#000000',
  // Rôles visuels conservés pour les sections, notifications et compteurs.
  pillBg: '#6D4ED1',
  pillFg: '#FFFFFF',
  notif: '#EF5BA8',
  plusCount: '#EF5BA8',
  // Accent de navigation actif.
  navActive: '#6D4ED1',
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
  surfaceMuted: '#24242C',
  text: '#F1F1F4',
  textMuted: '#9C9CA8',
  textSoft: '#6E6E7A',
  border: '#3A3A45',
  borderLight: '#2A2A33',
  primary: '#A58EF4',
  onPrimary: '#17131E',
  primarySoft: '#30294F',
  secondary: '#F47FBC',
  tertiary: '#F4CC65',
  success: '#66C58F',
  warning: '#F3B85B',
  danger: '#F07C94',
  info: '#73A7E8',
  focus: '#C0AEFF',
  // JAUNE DU LOGO (#FBAE00) pour tout l'accent jaune du thème Sombre —
  // uniformisé avec les pastilles de section (demande produit 17/07, Sombre
  // uniquement : Clair/Sunset gardent le #FFD400 historique).
  yellow: '#FBAE00',
  yellowSoft: '#3E300F',
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
  // Pastilles de section en JAUNE du logo (demande produit 17/07 — thème
  // Sombre uniquement) ; le rose reste réservé au thème Nuit (midnight).
  pillBg: '#FBAE00',
  pillFg: '#101014',
  // Navigation active (ajout main 34615e1) : texte fort pour le thème Sombre.
  navActive: '#F1F1F4',
  notif: '#E36067',
  plusCount: '#9C9CA8',
  imagePlaceholder: '#2A2A32',
};

// Sunset : palette chaude INSPIRÉE de la charte Claude.ai (pas un copier-coller)
// — fonds crème, texte brun profond, accent terracotta, liens cuivrés.
const SUNSET: Palette = {
  bg: '#FAF5EE',
  pageMuted: '#F1E9DD',
  surface: '#FDFAF4',
  text: '#40332A',
  surfaceMuted: '#F1E9DD',
  textMuted: '#8D7B6C',
  textSoft: '#B5A494',
  border: '#DECFBD',
  borderLight: '#ECE1D2',
  yellow: '#E2854F',
  primary: '#A84F35',
  onPrimary: '#FFF9F2',
  primarySoft: '#F6D7C2',
  secondary: '#B8436D',
  tertiary: '#D69938',
  success: '#648642',
  warning: '#A96716',
  danger: '#B8433C',
  info: '#316F8D',
  focus: '#8E3F2A',
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
  pillBg: '#A5907D',
  pillFg: '#FDFAF4',
  navActive: '#40332A',
  notif: '#B8433C',
  plusCount: '#8D7B6C',
  imagePlaceholder: '#E7DBCB',
};

// Nuit : les couleurs du logo PlotTime — fond bleu nuit #0B075A, accents
// jaune #FBAE00 / rose #E6027F / violet #6401F0 (éclaircis pour la lisibilité
// sur fond sombre). Le texte posé sur l'accent jaune est bleu nuit, comme le
// motif de l'icône.
const MIDNIGHT: Palette = {
  bg: '#0B075A',
  pageMuted: '#070440',
  surface: '#160F73',
  text: '#F3F1FF',
  textMuted: '#A9A3E0',
  surfaceMuted: '#1E1780',
  textSoft: '#7D76C2',
  border: '#3A32A8',
  borderLight: '#251D8C',
  yellow: '#FBAE00',
  yellowSoft: 'rgba(251,174,0,0.28)',
  primary: '#B39DFF',
  onPrimary: '#0B075A',
  primarySoft: '#30279A',
  secondary: '#FF71B4',
  tertiary: '#FBC34B',
  success: '#72D69A',
  warning: '#FBC34B',
  danger: '#FF71A5',
  info: '#7EC2FF',
  focus: '#D1C5FF',
  black: '#F3F1FF',
  white: '#160F73',
  pillGrey: '#5C55B4',
  chipGrey: '#1E1780',
  chipSelected: '#39309F',
  blue: '#B39DFF', // liens : violet du logo, éclairci
  red: '#FF4D9E', // rose du logo, éclairci (favoris, alertes)
  green: '#62D600',
  checkBg: '#1E1780',
  overlay: 'rgba(3,2,34,0.74)',
  provider: '#7A2BFF', // violet du logo (bouton « où regarder »)
  onAccent: '#0B075A', // bleu nuit sur les boutons jaunes, comme l'icône
  // ROSE du logo sur les pastilles de section, notifications et compteurs
  // « +N » : casse le monochrome bleu du thème Nuit (demande produit 16/07).
  pillBg: '#FF4D9E',
  pillFg: '#FFFFFF',
  notif: '#FF4D9E',
  plusCount: '#FF4D9E',
  // JAUNE du logo sur la navigation active (barre du bas + onglets hauts).
  navActive: '#FBAE00',
  imagePlaceholder: '#221B8A',
};

// Glass : matériau « verre liquide » (translucidité, reflets, flou d'arrière-
// plan) inspiré du langage Liquid Glass d'Apple (WWDC 2025), transposé à
// l'identité PlotTime — accents violet/jaune inchangés, AUCUNE réplique
// d'écran Apple. Les surfaces sont des blancs translucides posés sur le
// dégradé pastel peint par `app/+html.tsx` (web) ; le flou vient de
// GLASS_BLUR ci-dessous. Les textes/accents restent opaques pour la
// lisibilité (le verre, c'est les surfaces, pas le contenu).
const GLASS: Palette = {
  // Voiles givrés : plusieurs écrans repeignent bg/white PAR-DESSUS le dégradé
  // du document, et ces couches S'EMPILENT (contentStyle du Stack + fond
  // d'écran) — les alphas sont calibrés pour qu'après empilement le dégradé
  // reste nettement visible (≈ 0,65 de voile cumulé au maximum).
  bg: 'rgba(246,248,253,0.35)',
  pageMuted: 'rgba(238,242,250,0.30)',
  surface: 'rgba(255,255,255,0.55)',
  surfaceMuted: 'rgba(255,255,255,0.34)',
  text: '#1F1D2B',
  textMuted: 'rgba(31,29,43,0.64)',
  textSoft: 'rgba(31,29,43,0.45)',
  // Arête spéculaire : bord blanc lumineux, signature du verre.
  border: 'rgba(255,255,255,0.78)',
  borderLight: 'rgba(255,255,255,0.55)',
  primary: '#6D4ED1',
  onPrimary: '#FFFFFF',
  primarySoft: 'rgba(109,78,209,0.14)',
  secondary: '#E14A9B',
  tertiary: '#D9A22B',
  success: '#27824F',
  warning: '#9C5C0C',
  danger: '#C0365C',
  info: '#2A66A8',
  focus: '#6D4ED1',
  yellow: '#F3C54F',
  yellowSoft: 'rgba(243,197,79,0.30)',
  black: '#1F1D2B',
  white: 'rgba(255,255,255,0.45)',
  pillGrey: 'rgba(31,29,43,0.55)',
  chipGrey: 'rgba(255,255,255,0.32)',
  chipSelected: 'rgba(255,255,255,0.70)',
  blue: '#2A66A8',
  red: '#C0365C',
  green: '#27824F',
  checkBg: 'rgba(255,255,255,0.40)',
  overlay: 'rgba(25,22,40,0.35)',
  provider: '#6D4ED1',
  onAccent: '#000000',
  pillBg: '#6D4ED1',
  pillFg: '#FFFFFF',
  notif: '#E14A9B',
  plusCount: '#E14A9B',
  navActive: '#6D4ED1',
  imagePlaceholder: 'rgba(255,255,255,0.45)',
};

// NB : si un `bg` change ici, reporter la valeur dans le script pré-peinture
// de `app/+html.tsx` (barres système Android teintées avant le premier rendu).
const PALETTES: Record<ThemeName, Palette> = { light: LIGHT, dark: DARK, sunset: SUNSET, midnight: MIDNIGHT, glass: GLASS };

const STORAGE_KEY = 'serietime-theme';

// Préférence persistée, lue de façon SYNCHRONE au chargement du module (les
// StyleSheet des écrans figent les couleurs à l'import). Sur la web app
// (plateforme principale) : localStorage. Sur natif, pas de lecture synchrone
// possible → on suit le thème de l'appareil (Appearance) ; un choix explicite
// s'applique via le rechargement web.
export function getThemePreference(): ThemePreference {
  if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'light' || v === 'dark' || v === 'sunset' || v === 'midnight' || v === 'glass' || v === 'system') return v;
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
// « Sombre » au sens large : pilote la barre de statut claire, le colorScheme
// du document et les ombres renforcées. Nuit est un thème sombre.
export const IS_DARK = THEME === 'dark' || THEME === 'midnight';

export const COLORS: Palette = { ...PALETTES[THEME] };

// Thème Glass : flou d'arrière-plan des surfaces (backdrop-filter, web
// uniquement — react-native-web ≥ 0.21 le supporte et le préfixe pour Safari).
// À étaler dans les styles des cartes, barres et feuilles : objet VIDE pour
// les autres thèmes et sur natif, donc strictement sans effet ailleurs.
export const GLASS_BLUR = (THEME === 'glass' && Platform.OS === 'web'
  ? { backdropFilter: 'blur(18px) saturate(1.6)' }
  : {}) as unknown as ViewStyle;

// Couleur SOLIDE pour les metas theme-color (les barres système n'acceptent
// pas d'alpha) : Glass a des fonds translucides, on publie le rendu voilé du
// haut de son dégradé (aligné sur le script pré-peinture de `app/+html.tsx`).
export const THEME_COLOR_META = THEME === 'glass' ? '#DCE4F8' : PALETTES[THEME].bg;

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
  if (typeof document === 'undefined') return THEME_COLOR_META;
  return document.querySelector('meta[name="theme-color"]')?.getAttribute('content') ?? THEME_COLOR_META;
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
  // En cours (jaune) — jaune du logo en Sombre, jaune historique ailleurs.
  watching: THEME === 'dark'
    ? { fill: '#FBAE00', track: 'rgba(251,174,0,0.30)' }
    : { fill: '#FFD400', track: 'rgba(255,212,0,0.30)' },
  upToDate: { fill: '#62D600', track: 'rgba(98,214,0,0.30)' }, // À jour (vert)
  completed: { fill: '#2F80ED', track: 'rgba(47,128,237,0.30)' }, // Terminé (bleu)
  watchlist: { fill: '#F7941D', track: 'rgba(247,148,29,0.30)' }, // Regarder plus tard (orange)
  stopped: { fill: '#E53935', track: 'rgba(229,57,53,0.30)' }, // Arrêté (rouge)
} as const;

// Piste pâle des barres de progression dont le remplissage est COLORS.yellow :
// suit le jaune du thème (Sombre = jaune logo, ailleurs jaune historique).
export const YELLOW_TRACK = THEME === 'dark' ? 'rgba(251,174,0,0.30)' : 'rgba(255,212,0,0.30)';

// Échelle Prisme partagée par les écrans refondus.
export const SPACE = {
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const SIZES = {
  touch: 44,
  touchComfortable: 48,
  header: 56,
  tabBar: 56,
  contentMax: 760,
} as const;

export const MOTION = {
  fast: 160,
  standard: 200,
  slow: 280,
  easing: [0.2, 0, 0, 1] as const,
  easingCss: 'cubic-bezier(0.2, 0, 0, 1)',
} as const;

export const RADIUS = {
  small: 8,
  control: 12,
  poster: 14,
  card: 18,
  sheet: 24,
  pill: 999,
} as const;

export const SHADOW = {
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: IS_DARK ? 0.32 : 0.08,
    shadowRadius: 18,
    elevation: 3,
  },
  season: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: IS_DARK ? 0.28 : 0.07,
    shadowRadius: 20,
    elevation: 3,
  },
};
