// Design tokens SerieTime (spec §10) — blanc, noir, jaune, mobile-first.
export const COLORS = {
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
    shadowOpacity: 0.16,
    shadowRadius: 14,
    elevation: 4,
  },
  season: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.14,
    shadowRadius: 16,
    elevation: 4,
  },
};
