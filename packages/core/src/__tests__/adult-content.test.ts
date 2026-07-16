import { describe, expect, it } from 'vitest';
import { containsAdultContent, ADULT_MARKERS, isKnownAdultTmdbId } from '../moderation/adultContent.js';

describe('containsAdultContent — BLOQUE le porno (multilingue)', () => {
  const porn = [
    // Hentai / eroge (japonais romanisé)
    'Hentai Paradise',
    'Overflow (Hentai)',
    'Eroge! H mo Game mo Kaihatsu Zanmai',
    'Nukige collection',
    'Ahegao Special',
    'Bukkake Party',
    'Futanari World',
    // Porno explicite (en/fr/es/de/it/pt)
    'Pornographic feature',
    'A hardcore porn movie',
    'Softcore Nights',
    'Celebrity Sex Tape',
    'Famous Porn Star',
    'Film porno amateur',
    'Película porno',
    'Filme pornográfico',
    'Pornografie Klassiker',
    'Sexo explícito garantizado',
    // Marqueurs courts (frontière de mot)
    'XXX',
    'JAV Uncensored',
    'MILF Diaries',
    'Adult Anime Uncut',
  ];
  for (const t of porn) {
    it(`bloque : « ${t} »`, () => {
      expect(containsAdultContent(t)).toBe(true);
    });
  }

  it('attrape les contournements (leet / séparateurs / répétitions)', () => {
    expect(containsAdultContent('p0rn')).toBe(true); // leet 0→o
    expect(containsAdultContent('p.o.r.n hub')).toBe(true); // séparateurs
    expect(containsAdultContent('poooorn')).toBe(true); // répétitions
    expect(containsAdultContent('h3ntai')).toBe(true); // leet 3→e
    expect(containsAdultContent('pornographique')).toBe(true); // dérivé de « porn »
  });

  it('teste chaque champ fourni séparément (titre + résumé)', () => {
    expect(containsAdultContent('Titre anodin', null, 'Un synopsis franchement pornographique')).toBe(true);
    expect(containsAdultContent(undefined, 'Hentai uncensored')).toBe(true);
  });

  it('bloque les marqueurs CJK NON AMBIGUS uniquement', () => {
    expect(containsAdultContent('18禁アニメ')).toBe(true); // interdit -18
    expect(containsAdultContent('成人向けアダルトビデオ')).toBe(true); // pour adultes / AV
    expect(containsAdultContent('エロアニメ集')).toBe(true); // ero-anime (compound)
    // Vu même quand seul le résumé (ou un champ tardif) contient le marqueur.
    expect(containsAdultContent('Neutral title', null, 'ポルノ映画')).toBe(true);
  });

  it('NE bloque PAS 変態 / エロ seuls (animés grand public)', () => {
    // « 変態 » = hentai MAIS aussi « métamorphose » → le blocage passe par la
    // liste d'ids, pas par la sous-chaîne (sinon on bloque « 変態王子 »).
    expect(containsAdultContent('変態王子と笑わない猫')).toBe(false); // The Hentai Prince
    expect(containsAdultContent('エロマンガ先生')).toBe(false); // Eromanga-sensei (mainstream)
    expect(containsAdultContent('変態植物倶楽部')).toBe(false); // 変態 seul → pas via texte
  });

  it('isKnownAdultTmdbId : liste noire d’ids exacte', () => {
    expect(isKnownAdultTmdbId('233071')).toBe(true);
    expect(isKnownAdultTmdbId('306449')).toBe(true);
    expect(isKnownAdultTmdbId('12345')).toBe(false); // id quelconque non banni
    expect(isKnownAdultTmdbId(null)).toBe(false);
  });
});

describe('containsAdultContent — NE BLOQUE PAS le grand public (0 faux positif)', () => {
  const safe = [
    // « sex » / « erotic » / « nude » grand public
    'Sex Education',
    'Sex and the City',
    'Basic Instinct — an erotic thriller',
    'Eyes Wide Shut',
    'The Erotic Adventures of Robin Hood', // « erotic » seul → autorisé
    'Nude descending a staircase', // « nude » seul → autorisé
    // Violence / gore 18+ → doit rester autorisé (on ne bloque QUE le porno)
    'Game of Thrones',
    'The Boys',
    'A gory horror slasher full of blood and murder',
    'Violence, gore, blood and murder everywhere',
    'Saw',
    // Anime ecchi léger (fan-service, pas du porno)
    'To Love-Ru (ecchi comedy)',
    'High School DxD ecchi',
    // Cas limites arthouse : « Nymphomaniac » (von Trier) reste grand public
    'Nymphomaniac',
    // Collisions de sous-chaînes évitées grâce à la frontière de mot
    'MaXXXine', // film d'horreur 2024 (Ti West) — « xxx » interne, pas un token
    'Watermilfoil documentary', // « milf » interne à « milfoil »
    'Learning Java in 24 hours', // « jav » interne à « java »
    // Titres japonais NORMAUX (aucun marqueur CJK adulte) → autorisés
    '進撃の巨人', // L'Attaque des Titans
    '鬼滅の刃', // Demon Slayer
    'ワンピース', // One Piece
    // Divers grand public
    'Cette série est géniale',
    'A masterpiece about war and loss',
  ];
  for (const t of safe) {
    it(`ne bloque pas : « ${t} »`, () => {
      expect(containsAdultContent(t)).toBe(false);
    });
  }
});

describe('ADULT_MARKERS', () => {
  it('exporte une liste non vide de marqueurs multilingues', () => {
    expect(ADULT_MARKERS.length).toBeGreaterThan(20);
    const langs = new Set(ADULT_MARKERS.map((m) => m.lang));
    for (const l of ['en', 'fr', 'es', 'de', 'it', 'pt', 'ja']) expect(langs.has(l)).toBe(true);
  });
  it('ne contient aucun marqueur grand public ambigu', () => {
    const terms = ADULT_MARKERS.map((m) => m.term.toLowerCase());
    for (const banned of ['sex', 'erotic', 'erotique', 'ecchi', 'sexy', 'nude', 'nudity']) {
      expect(terms).not.toContain(banned);
    }
  });
});
