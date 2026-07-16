// Liste CURÉE de termes interdits pour la modération des commentaires.
//
// Objectif : bloquer la publication de commentaires réellement haineux ou
// gravement injurieux (slurs racistes, antisémites, homophobes, sexistes,
// injures sexuelles graves, appels à la violence), tout en MINIMISANT les faux
// positifs — une critique de série normale ne doit JAMAIS être bloquée.
//
// Principes de curation (à respecter si on ÉTEND la liste) :
//   - Uniquement des termes SANS AMBIGUÏTÉ (slurs, injures haineuses). On
//     n'ajoute PAS de jurons bénins (« merde », « damn »…) ni de mots légitimes
//     contenant une sous-chaîne sensible. Exemples EXCLUS volontairement :
//       · « negro » = couleur en ES/PT/IT → faux positif garanti ;
//       · « chink » ≈ idiome anglais « a chink in the armor » ;
//       · « fag » = cigarette en anglais britannique ;
//       · « viado » ≈ « enviado » (envoyé) en PT ;
//       · « retard » = « en retard » en FR ;
//       · « macaco » = singe (animal) en ES/PT.
//   - Couverture multilingue : fr, en, es, de, it, pt (langues de contenu de
//     l'app). Toutes les catégories n'existent pas de façon lexicalisée dans
//     toutes les langues — on préfère l'absence à un terme ambigu.
//   - Termes stockés en minuscules, sans accent (le filtre normalise de toute
//     façon). Les injures COMPOSÉES (ex. « fils de pute ») sont stockées
//     CONCATÉNÉES (« filsdepute ») car le filtre les matche sur la version
//     « séparateurs supprimés ».
//   - La correspondance (frontière de mot pour les termes courts, sous-chaîne
//     pour les slurs longs, gestion du leetspeak et des répétitions) est gérée
//     par `filter.ts` — ici on ne met QUE les termes.
//
// La liste est volontairement EXTENSIBLE : ajouter un terme dans la bonne
// catégorie suffit. En cas de doute sur un faux positif, ne pas l'ajouter.

export type ModerationCategory =
  | 'racism'
  | 'antisemitism'
  | 'homophobia'
  | 'sexism'
  | 'sexual_slur'
  | 'violent_slur'
  | 'insult';

export const BLOCKLIST: Record<ModerationCategory, string[]> = {
  // --- Racisme (slurs ethniques/raciaux sans ambiguïté) -------------------
  racism: [
    // en
    'nigger',
    'niggers',
    'nigga',
    'niggas',
    'coon', // court → frontière de mot (n'attrape pas « cocoon »)
    'spic',
    'wetback',
    'gook',
    'paki', // court → n'attrape pas « pakistani »
    'wog',
    'sandnigger',
    'towelhead',
    'raghead',
    'jigaboo',
    'porchmonkey',
    // fr
    'bougnoule',
    'bougnoul',
    'bamboula',
    'bicot', // n'attrape pas « abricot » (…b-r-i-c-o-t ≠ b-i-c-o-t)
    // es
    'sudaca',
    'negrata',
    // de
    'neger',
    'kanake',
    'kanaken',
    // it
    'terrone',
    'terroni',
  ],

  // --- Antisémitisme -------------------------------------------------------
  antisemitism: [
    // en
    'kike',
    'heeb',
    // fr
    'youpin',
    'youtre',
    // de
    'judensau',
    'saujude',
    // es / it / pt : injures antisémites peu lexicalisées (surtout des phrases,
    // p.ex. « judio de mierda ») → on garde les termes univoques ci-dessus.
  ],

  // --- Homophobie / transphobie -------------------------------------------
  homophobia: [
    // en
    'faggot',
    'faggots',
    'tranny',
    'poofter',
    // fr
    'tapette',
    'tarlouze',
    // NB : PAS « pédé » — sa forme normalisée « pede » = mot PT/ES courant
    // (« pede » = « demande »). On couvre l'abréviation « pd » (frontière de mot,
    // n'attrape pas « rapide »/« pdf »/« speed » — vérifié), la plus écrite.
    'pd',
    'tantouze',
    'fiotte',
    // es
    'maricon',
    'maricones',
    'marica',
    'bollera',
    // de
    'schwuchtel',
    'schwuchteln',
    // it
    'frocio',
    'froci',
    'ricchione',
    // pt
    'paneleiro',
    'paneleiros',
  ],

  // --- Sexisme (slurs misogynes graves) -----------------------------------
  sexism: [
    // en
    'cunt', // court → n'attrape pas « scunthorpe »
    'twat',
    'slut',
    'whore',
    'skank',
    // fr
    'salope', // n'attrape pas « escalope » (…s-c-a-l-o-p-e ≠ s-a-l-o-p-e)
    'pute', // court → n'attrape pas « dispute »
    'connasse',
    'pouffiasse',
    // es
    'puta', // court → n'attrape pas « disputa »/« reputacion »
    'putas',
    // de
    'schlampe',
    'hure', // court
    'fotze',
    // it
    'puttana',
    'puttane',
    // pt
    'vagabunda',
  ],

  // --- Injures sexuelles graves (composées / très violentes) --------------
  sexual_slur: [
    // en
    'motherfucker',
    'cocksucker',
    // fr
    'encule', // « enculé » / « enculer »
    'filsdepute', // « fils de pute » (concaténé → matché sur version compacte)
    'niquetamere', // « nique ta mère »
    // es
    'hijodeputa', // « hijo de puta »
    'malparido',
    // it
    'figliodiputtana', // « figlio di puttana »
    // pt
    'filhodaputa', // « filho da puta »
  ],

  // --- Insultes courantes (politesse de l'app, décision 2026-07-17) --------
  // Curseur resserré à la demande d'Étienne/Benjamin : au-delà de la haine
  // grave, on bloque les insultes directes non ambiguës. EXCLUS volontairement
  // (faux positifs garantis, ne pas ajouter) :
  //   · « espèce de con » → compact « especedecon » matcherait « espèce de
  //     conCEPT/conCOURS/conCOMBRE » ;
  //   · « gros con »/« sale con » → « gros conCOURS », « sale conCURRENT » ;
  //   · « con » seul = ultra-ambigu ; « bâtard » = pain ; « tg » = sigle
  //     fréquent ; « ntm » = groupe de rap.
  insult: [
    // fr
    'connard',
    'connards',
    'ta gueule', // compact « tagueule » — couvre « ferme ta gueule », « ta gueule ! »
    'va te faire foutre',
    'va te faire enculer',
    'enfoire', // « enfoiré »
    'enfoires',
    // NB : PAS « ducon » — 5 lettres → sous-chaîne, matcherait « du CONtenu »,
    // « du CONcours » une fois les espaces compactés.
    'trou du cul', // compact « trouducul »
    'fdp', // abréviation « fils de pute » (court → frontière de mot)
    // en
    'asshole',
    'assholes',
    'dickhead',
    'shut the fuck up',
    'stfu',
    // es
    'gilipollas',
    'cabron', // « cabrón » (insulte directe ; pas de mot légitime « cabron »)
    // de
    'arschloch',
    'halt die fresse',
    // it
    'stronzo',
    'vaffanculo',
    // pt — NB : pas « arrombado » (aussi « cambriolé », légitime)
    'vai te foder',
  ],

  // --- Appels à la violence / déshumanisation -----------------------------
  violent_slur: [
    // en (toxicité grave : incitation au suicide / déshumanisation)
    'kys', // « kill yourself » (court → frontière de mot)
    'killyourself',
    'neckyourself',
    'subhuman',
    'untermensch', // déshumanisation nazie (loanword de)
    // de
    'vergasen', // « gazer » — incitation violente/nazie
  ],
};
