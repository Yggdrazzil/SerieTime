const DAY_NAMES = ['DIMANCHE', 'LUNDI', 'MARDI', 'MERCREDI', 'JEUDI', 'VENDREDI', 'SAMEDI'];
const MONTH_SHORT = [
  'JANV.', 'FÉVR.', 'MARS', 'AVR.', 'MAI', 'JUIN',
  'JUIL.', 'AOÛT', 'SEPT.', 'OCT.', 'NOV.', 'DÉC.',
];

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

// Spec §18: AUJOURD'HUI, DEMAIN, day name within a week, then "12 FÉVR. 2026".
export function upcomingGroupLabel(date: Date, now = new Date()): string {
  const target = startOfDay(date);
  const today = startOfDay(now);
  const diffDays = Math.round((target.getTime() - today.getTime()) / 86_400_000);
  if (diffDays <= 0) return "AUJOURD'HUI";
  if (diffDays === 1) return 'DEMAIN';
  if (diffDays < 7) return DAY_NAMES[target.getDay()] ?? '';
  return `${target.getDate()} ${MONTH_SHORT[target.getMonth()]} ${target.getFullYear()}`;
}

// Historique des sorties (au-dessus de « À venir ») : HIER, AVANT-HIER,
// jour de la semaine dans les 7 derniers jours, puis "12 FÉVR. 2026".
export function pastGroupLabel(date: Date, now = new Date()): string {
  const target = startOfDay(date);
  const today = startOfDay(now);
  const diffDays = Math.round((today.getTime() - target.getTime()) / 86_400_000);
  if (diffDays <= 0) return "AUJOURD'HUI";
  if (diffDays === 1) return 'HIER';
  if (diffDays === 2) return 'AVANT-HIER';
  if (diffDays < 7) return DAY_NAMES[target.getDay()] ?? '';
  return `${target.getDate()} ${MONTH_SHORT[target.getMonth()]} ${target.getFullYear()}`;
}

const MONTH_LONG_SHORT = [
  'janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin',
  'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.',
];

export function formatShortDateFr(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getDate()} ${MONTH_LONG_SHORT[d.getMonth()]} ${d.getFullYear()}`;
}

export function formatTimeHHMM(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
