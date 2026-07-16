import { BLOCKLIST, type ModerationCategory } from './blocklist.js';

// Modération des commentaires : détecte les termes haineux/gravement injurieux
// malgré les contournements courants (accents, leetspeak, répétitions,
// séparateurs insérés entre les lettres) tout en minimisant les faux positifs.

// Table leetspeak : chiffres/symboles couramment substitués aux lettres.
const LEET: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '@': 'a',
  $: 's',
};

/**
 * Normalise un texte pour la modération :
 *   - minuscules ;
 *   - suppression des accents (NFD + retrait des diacritiques) ;
 *   - mapping leetspeak (0→o, 1→i, 3→e, 4→a, 5→s, 7→t, @→a, $→s) ;
 *   - réduction des répétitions (« niiiig » → « niig » : au plus 2 identiques
 *     consécutifs) — le matcher tolère ensuite toute répétition restante ;
 *   - remplacement de tout séparateur (espaces, ponctuation, tirets, points,
 *     underscores…) par une espace unique, puis trim.
 *
 * Le résultat est « tokenisé par mots » (mots séparés par une espace unique) :
 * `findBlockedTerm` en dérive aussi une version compacte (sans séparateur) pour
 * attraper les slurs écrits « n-i-g-g-e-r » ou « n i g g e r ».
 */
export function normalizeForModeration(text: string): string {
  const lowered = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
  let mapped = '';
  for (const ch of lowered) mapped += LEET[ch] ?? ch;
  return mapped
    .replace(/(.)\1{2,}/g, '$1$1') // 3+ répétitions → 2
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Un terme précompilé : pattern tolérant aux répétitions (chaque lettre peut
// se répéter), + stratégie de correspondance selon la longueur.
type Matcher = {
  term: string;
  category: ModerationCategory;
  // Termes courts (< 5 lettres) : frontière de mot obligatoire, testé sur la
  // version tokenisée — évite « scunthorpe » (cunt), « assassin » (ass), etc.
  bounded: RegExp | null;
  // Slurs longs (≥ 5 lettres) non ambigus : sous-chaîne autorisée, testé sur la
  // version compacte — attrape « n-i-g-g-e-r », « n i g g e r », etc.
  substr: RegExp | null;
};

// Construit un pattern où chaque caractère peut être répété (« a » → « a+ ») :
// combiné à la réduction des répétitions ci-dessus, cela attrape aussi bien
// « nigger » que « niiigger », « niggggger », etc.
function repeatTolerantPattern(compactTerm: string): string {
  let pattern = '';
  for (const ch of compactTerm) pattern += `${escapeRegExp(ch)}+`;
  return pattern;
}

function buildMatchers(): Matcher[] {
  const matchers: Matcher[] = [];
  const seen = new Set<string>();
  for (const category of Object.keys(BLOCKLIST) as ModerationCategory[]) {
    for (const raw of BLOCKLIST[category]) {
      // Normalise le terme comme le texte, puis compacte (sans séparateur).
      const compact = normalizeForModeration(raw).replace(/[^a-z0-9]/g, '');
      if (!compact) continue;
      const dedupeKey = `${category}:${compact}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      const pattern = repeatTolerantPattern(compact);
      const short = compact.length < 5;
      matchers.push({
        term: raw,
        category,
        bounded: short ? new RegExp(`\\b${pattern}\\b`) : null,
        substr: short ? null : new RegExp(pattern),
      });
    }
  }
  return matchers;
}

const MATCHERS = buildMatchers();

/**
 * Retourne le premier terme interdit trouvé dans `text`, ou `null`.
 * Ne renvoie que le terme et sa catégorie (jamais le texte complet) afin que
 * l'appelant puisse journaliser la catégorie sans exposer le commentaire.
 */
export function findBlockedTerm(text: string): { term: string; category: ModerationCategory } | null {
  if (!text) return null;
  const spaced = normalizeForModeration(text);
  if (!spaced) return null;
  const compact = spaced.replace(/[^a-z0-9]/g, '');
  for (const m of MATCHERS) {
    if (m.bounded) {
      if (m.bounded.test(spaced)) return { term: m.term, category: m.category };
    } else if (m.substr) {
      if (m.substr.test(compact)) return { term: m.term, category: m.category };
    }
  }
  return null;
}
