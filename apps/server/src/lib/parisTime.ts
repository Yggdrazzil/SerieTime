// Repères temporels Europe/Paris partagés (gamification, stats détaillées) :
// TOUTES les agrégations par jour/semaine du produit se font en heure de
// Paris, jamais en heure locale du serveur (un VPS en UTC décalerait les
// journées et les semaines d'une heure ou deux).
const PARIS_TZ = 'Europe/Paris';

// Formatter réutilisé (fr-CA = format ISO "YYYY-MM-DD") : un seul objet Intl au
// niveau module au lieu d'un `new Intl.DateTimeFormat` par appel. Sur la grosse
// bibliothèque (>20 000 épisodes vus), `dayKeyParis` est appelé des dizaines de
// milliers de fois par recompute — la création répétée du formatter dominait.
const PARIS_DAY = new Intl.DateTimeFormat('fr-CA', { timeZone: PARIS_TZ });

// "YYYY-MM-DD" en Europe/Paris (fr-CA = format ISO).
export function dayKeyParis(date: Date): string {
  return PARIS_DAY.format(date);
}

export function monthKeyParis(date: Date): string {
  return dayKeyParis(date).slice(0, 7);
}

// Instant UTC du minuit Europe/Paris d'un jour "YYYY-MM-DD" (l'offset Paris
// vaut +01:00 ou +02:00 selon la saison — on teste les deux).
export function parisMidnightUtc(dayKey: string): Date {
  for (const offset of ['+01:00', '+02:00']) {
    const candidate = new Date(`${dayKey}T00:00:00${offset}`);
    if (
      dayKeyParis(candidate) === dayKey &&
      candidate
        .toLocaleTimeString('fr-FR', { timeZone: PARIS_TZ, hour: '2-digit', minute: '2-digit', hour12: false })
        .startsWith('00')
    ) {
      return candidate;
    }
  }
  return new Date(`${dayKey}T00:00:00+01:00`);
}

// Lundi 00:00 Europe/Paris de la semaine contenant `now` (classements hebdo,
// graphiques semaine par semaine des stats détaillées).
export function weekStartParis(now: Date): Date {
  const day = new Date(`${dayKeyParis(now)}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7)); // recule au lundi
  return parisMidnightUtc(day.toISOString().slice(0, 10));
}
