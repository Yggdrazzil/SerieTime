// Parse une date "YYYY-MM-DD" en timestamp UTC minuit — évite tout décalage
// de fuseau lors des soustractions (les jours actifs sont déjà résolus en
// Europe/Paris côté appelant, cf. spec §4).
function parseDayUtc(day: string): number {
  const parts = day.split('-').map(Number);
  const y = parts[0] ?? 0;
  const m = parts[1] ?? 1;
  const d = parts[2] ?? 1;
  return Date.UTC(y, m - 1, d);
}

function daysBetween(from: string, to: string): number {
  return Math.round((parseDayUtc(to) - parseDayUtc(from)) / 86_400_000);
}

// `activeDays` : jours "actifs" (≥ 1 épisode/film coché), triés croissant,
// "YYYY-MM-DD". `today` : date de référence, paramètre explicite pour rester
// déterministe (jamais de `new Date()` interne).
export function computeStreaks(activeDays: string[], today: string): { current: number; best: number } {
  if (activeDays.length === 0) return { current: 0, best: 0 };

  // Défensif : dédoublonne et re-trie même si le contrat garantit déjà l'ordre.
  const days = Array.from(new Set(activeDays)).sort();

  let best = 1;
  let run = 1;
  for (let i = 1; i < days.length; i++) {
    const prev = days[i - 1] as string;
    const cur = days[i] as string;
    run = daysBetween(prev, cur) === 1 ? run + 1 : 1;
    if (run > best) best = run;
  }

  const lastDay = days[days.length - 1] as string;
  const gapToToday = daysBetween(lastDay, today);
  let current = 0;
  if (gapToToday <= 1) {
    // Le streak courant se termine aujourd'hui ou hier (spec §4) ; sinon 0
    // (streak cassé, même si un `best` historique existe).
    current = 1;
    for (let i = days.length - 1; i > 0; i--) {
      const prev = days[i - 1] as string;
      const cur = days[i] as string;
      if (daysBetween(prev, cur) === 1) current += 1;
      else break;
    }
  }

  return { current, best };
}
