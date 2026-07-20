// Durées de repli quand le runtime manque en base — UNE seule paire de
// constantes pour TOUT le serveur (profil, stats détaillées, classements,
// défi hebdo). Sémantique commune : `runtime > 0` sinon fallback (un runtime
// à 0 est traité comme une donnée manquante, jamais compté tel quel).
export const EP_FALLBACK_MIN = 42;
export const MOVIE_FALLBACK_MIN = 115;

// Runtime d'un épisode : runtime épisode > 0, sinon runtime du média série
// > 0, sinon EP_FALLBACK_MIN (même règle que les CASE WHEN SQL).
export function episodeRuntimeMin(
  episodeRuntime: number | null | undefined,
  showRuntime: number | null | undefined,
): number {
  if (episodeRuntime && episodeRuntime > 0) return episodeRuntime;
  if (showRuntime && showRuntime > 0) return showRuntime;
  return EP_FALLBACK_MIN;
}

// Runtime d'un film : runtime > 0, sinon MOVIE_FALLBACK_MIN.
export function movieRuntimeMin(runtime: number | null | undefined): number {
  return runtime && runtime > 0 ? runtime : MOVIE_FALLBACK_MIN;
}
