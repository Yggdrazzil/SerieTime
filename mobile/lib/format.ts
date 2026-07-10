export function episodeCode(season: number, ep: number): string {
  return `S${String(season).padStart(2, '0')} | E${String(ep).padStart(2, '0')}`;
}

const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

export function shortDateFr(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function timeHHMM(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// Heure de diffusion à afficher, uniquement si elle est RÉELLE. Beaucoup
// d'épisodes n'ont qu'une date (pas d'heure) : ils sont stockés à minuit UTC,
// ce qui afficherait « 02:00 » à Paris. Dans ce cas on ne montre rien.
export function airTimeLabel(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  if (d.getUTCHours() === 0 && d.getUTCMinutes() === 0) return ''; // date seule = heure inconnue
  return timeHHMM(iso);
}

export function watchTime(minutes: number): { months: number; days: number; hours: number } {
  const totalHours = Math.floor(minutes / 60);
  const months = Math.floor(totalHours / (24 * 30));
  const days = Math.floor((totalHours - months * 24 * 30) / 24);
  const hours = totalHours - months * 24 * 30 - days * 24;
  return { months, days, hours };
}

const GROUP_LABELS: Record<string, string> = {
  a_voir: 'À VOIR',
  pas_regarde_depuis_un_moment: 'PAS REGARDÉ DEPUIS UN MOMENT',
  pas_commence: 'PAS COMMENCÉ',
  abandonne: 'ABANDONNÉ',
};
export function queueGroupLabel(group: string): string {
  return GROUP_LABELS[group] ?? group.toUpperCase();
}

// Compteurs sociaux compacts, format FR (séparateur virgule) façon TikTok :
// 12 → "12" · 1200 → "1,2 K" · 13400 → "13,4 K" · 2_000_000 → "2 M".
export function formatCount(n: number): string {
  if (n < 1000) return String(n);
  const [value, suffix]: [number, string] = n < 1_000_000 ? [n / 1000, 'K'] : [n / 1_000_000, 'M'];
  const label = value.toFixed(1).replace(/\.0$/, '').replace('.', ',');
  return `${label} ${suffix}`;
}
