// Validation des URLs d'affiche / bannière personnalisées.
//
// Les routes `POST .../:id/poster` et `.../:id/banner` (séries, films, jeux)
// écrivent `posterPath`/`backdropPath` — une chaîne postée par le client —
// directement sur la ligne `Media` PARTAGÉE par tous les utilisateurs. Sans
// contrôle, n'importe qui peut injecter une URL arbitraire (pixel de tracking,
// contenu tiers, redirection) affichée à tout le monde. On restreint donc les
// valeurs acceptées, sans changer le fait que la valeur est stockée sur Media
// (comportement existant conservé) :
//   - les chemins TMDb relatifs déjà utilisés partout ("/abc.jpg") ;
//   - les URLs https absolues servies par une source d'images connue.

const ALLOWED_IMAGE_HOSTS = new Set([
  'image.tmdb.org',
  'artworks.thetvdb.com',
  'images.igdb.com',
  'media.igdb.com',
]);

// TheTVDB sert ses illustrations depuis plusieurs sous-domaines (*.thetvdb.com).
function isThetvdbHost(host: string): boolean {
  return host === 'thetvdb.com' || host.endsWith('.thetvdb.com');
}

export function isAllowedImageUrl(url: string): boolean {
  if (typeof url !== 'string' || url.length === 0) return false;
  // Chemin TMDb relatif ("/abc.jpg") : forme historiquement stockée. On exclut
  // les URLs protocole-relatives ("//evil.example/x.jpg").
  if (url.startsWith('/') && !url.startsWith('//')) return true;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  const host = parsed.hostname.toLowerCase();
  return ALLOWED_IMAGE_HOSTS.has(host) || isThetvdbHost(host);
}
