import { describe, expect, it } from 'vitest';
import { findBlockedTerm, normalizeForModeration } from '../moderation/filter.js';

// Raccourci : le texte est-il bloqué ? (on ne teste pas le terme exact, mais la
// catégorie renvoyée quand c'est pertinent).
const blocked = (text: string) => findBlockedTerm(text) !== null;
const category = (text: string) => findBlockedTerm(text)?.category ?? null;

describe('normalizeForModeration', () => {
  it('minuscule, retire les accents et mappe le leetspeak', () => {
    expect(normalizeForModeration('CAFÉ')).toBe('cafe');
    expect(normalizeForModeration('n1gg3r')).toBe('nigger');
    expect(normalizeForModeration('$4l0pe')).toBe('salope');
  });
  it('réduit les répétitions à deux max', () => {
    expect(normalizeForModeration('niiiiig')).toBe('niig');
    expect(normalizeForModeration('coooool')).toBe('cool');
  });
  it('remplace les séparateurs par une espace unique', () => {
    expect(normalizeForModeration('n-i-g-g-e-r')).toBe('n i g g e r');
    expect(normalizeForModeration('bonjour   le   monde')).toBe('bonjour le monde');
  });
});

describe('findBlockedTerm — chaque catégorie, plusieurs langues', () => {
  it('racisme (en, fr, es, de, it)', () => {
    expect(category('you are a nigger')).toBe('racism');
    expect(category('sale bougnoule')).toBe('racism');
    expect(category('eres un sudaca')).toBe('racism');
    expect(category('du bist ein neger')).toBe('racism');
    expect(category('sei un terrone')).toBe('racism');
  });
  it('antisémitisme (en, fr, de)', () => {
    expect(category('dirty kike')).toBe('antisemitism');
    expect(category('espece de youpin')).toBe('antisemitism');
    expect(category('du judensau')).toBe('antisemitism');
  });
  it('homophobie (en, fr, es, de, it, pt)', () => {
    expect(category('what a faggot')).toBe('homophobia');
    expect(category('sale tapette')).toBe('homophobia');
    expect(category('eres un maricon')).toBe('homophobia');
    expect(category('du schwuchtel')).toBe('homophobia');
    expect(category('sei un frocio')).toBe('homophobia');
    expect(category('seu paneleiro')).toBe('homophobia');
  });
  it('sexisme (en, fr, es, de, it)', () => {
    expect(category('you stupid cunt')).toBe('sexism');
    expect(category('grosse salope')).toBe('sexism');
    expect(category('eres una puta')).toBe('sexism');
    expect(category('du schlampe')).toBe('sexism');
    expect(category('sei una puttana')).toBe('sexism');
  });
  it('injures sexuelles graves (en, fr)', () => {
    expect(category('you motherfucker')).toBe('sexual_slur');
    expect(category('va te faire enculer')).toBe('sexual_slur');
  });
  it('injures composées es/it/pt (bloquées ; catégorie sexism/sexual_slur selon le 1er match)', () => {
    // « hijo de puta » contient « puta » (sexism, testé en premier) : peu importe
    // la catégorie renvoyée, le commentaire DOIT être bloqué.
    expect(blocked('eres un hijo de puta')).toBe(true);
    expect(blocked('sei un figlio di puttana')).toBe(true);
    expect(blocked('seu filho da puta')).toBe(true);
  });
  it('violence / déshumanisation (en, de)', () => {
    expect(category('just kys already')).toBe('violent_slur');
    expect(category('they are subhuman')).toBe('violent_slur');
    expect(category('man sollte sie vergasen')).toBe('violent_slur');
  });
  it('insultes courantes (curseur politesse, 2026-07-17)', () => {
    expect(category('espèce de connard')).toBe('insult');
    expect(category('ta gueule')).toBe('insult');
    expect(category('ferme ta gueule un peu')).toBe('insult');
    expect(category('va te faire foutre')).toBe('insult');
    expect(category('sale enfoiré')).toBe('insult');
    expect(category('quel trou du cul celui-là')).toBe('insult');
    expect(category('what an asshole')).toBe('insult');
    expect(category('stfu dude')).toBe('insult');
    expect(category('eres un gilipollas')).toBe('insult');
    expect(category('sei uno stronzo')).toBe('insult');
    expect(category('halt die fresse')).toBe('insult');
  });
});

describe('findBlockedTerm — contournements attrapés', () => {
  it('leetspeak', () => {
    expect(blocked('n1gg3r')).toBe(true);
    expect(blocked('f4gg0t')).toBe(true);
    expect(blocked('$alope')).toBe(true);
  });
  it('répétitions', () => {
    expect(blocked('niiiigger')).toBe(true);
    expect(blocked('faggggot')).toBe(true);
    expect(blocked('putttte')).toBe(true);
  });
  it('séparateurs insérés entre les lettres', () => {
    expect(blocked('n-i-g-g-e-r')).toBe(true);
    expect(blocked('n i g g e r')).toBe(true);
    expect(blocked('f.a.g.g.o.t')).toBe(true);
  });
  it('accents et casse', () => {
    expect(blocked('SALOPE')).toBe(true);
    expect(blocked('enculé')).toBe(true);
    expect(blocked('Pédé... euh Frocio')).toBe(true); // frocio
  });
  it('injures composées écrites avec des espaces', () => {
    expect(blocked('fils de pute')).toBe(true);
    expect(blocked('nique ta mere')).toBe(true);
    expect(blocked('hijo de puta')).toBe(true);
  });
});

describe('findBlockedTerm — NON-régression (aucun faux positif)', () => {
  const legitimate = [
    'Cette série est géniale',
    'The assassin scene was great',
    'Scunthorpe United',
    "J'ai adoré ce classique",
    'What a masterpiece, 10/10',
    'Sussex is a lovely county',
    'This episode was disappointing but the acting was superb',
    'El gato negro duerme en el sofá', // « negro » = couleur (ES) → ne doit PAS bloquer
    'Un vestido negro muy elegante',
    'Ele pede desculpas no final', // « pede » (PT, il demande) ≠ slur FR
    'Une escalope de veau à la crème', // « escalope » ≠ salope
    "J'adore les abricots en été", // « abricot » ≠ bicot
    'This is pure tyranny on screen', // « tyranny » ≠ tranny
    'There was a chink in his armor', // idiome ≠ slur (terme volontairement exclu)
    'Regeneration was the best Doctor Who arc', // ≠ neger
    'La reputación del personaje mejora', // ≠ puta
    'The dispute between the two houses', // ≠ pute
    'Have a cigarette break, mate', // ≠ fag
    'Le retard du train était énorme', // « retard » (FR) ≠ slur EN
    'Cocoon is an underrated 80s film', // ≠ coon
    'A pakistani cooking show', // ≠ paki
    'Que classe cette réalisation !',
    // Pièges du curseur « insultes » (2026-07-17) — ne doivent JAMAIS bloquer :
    'Une espèce de concept très original', // « espècedecon…cept » ≠ espèce de con
    'La majorité du contenu est excellente', // « du con…tenu » ≠ ducon
    'Le gagnant du concours est annoncé', // « du con…cours »
    'Cette gueule d’ange est parfaite pour le rôle', // « gueule » seul OK
    'Il fait la gueule tout l’épisode', // « la gueule » ≠ ta gueule
    'Un connaisseur appréciera', // ≠ connard
    'Le PDF du programme est en ligne', // ≠ pd
    'Un abricot bien mûr', // contrôle historique
  ];
  for (const text of legitimate) {
    it(`ne bloque pas : « ${text} »`, () => {
      expect(findBlockedTerm(text)).toBeNull();
    });
  }
});
