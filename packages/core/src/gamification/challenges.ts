export type ChallengeDef = {
  id: string;
  slug: string;
  label: string;
  target: number;
};

export type MonthStats = {
  episodesThisMonth: number;
  showsCompletedThisMonth: number;
  mediaAddedThisMonth: number;
};

// 3 défis fixes par mois calendaire (spec §5) ; `month` = "2026-07".
export function monthlyChallenges(month: string): ChallengeDef[] {
  return [
    { id: `${month}-marathon`, slug: 'marathon', label: 'Regarde 30 épisodes ce mois-ci', target: 30 },
    { id: `${month}-finisher`, slug: 'finisher', label: 'Termine une série ce mois-ci', target: 1 },
    { id: `${month}-discover`, slug: 'discover', label: 'Ajoute 3 nouveautés à ta bibliothèque', target: 3 },
  ];
}

function valueForSlug(slug: string, monthStats: MonthStats): number {
  switch (slug) {
    case 'marathon':
      return monthStats.episodesThisMonth;
    case 'finisher':
      return monthStats.showsCompletedThisMonth;
    case 'discover':
      return monthStats.mediaAddedThisMonth;
    default:
      return 0;
  }
}

export function evaluateChallenge(
  def: ChallengeDef,
  monthStats: MonthStats,
): { progress: number; completed: boolean } {
  const value = valueForSlug(def.slug, monthStats);
  return { progress: Math.min(value, def.target), completed: value >= def.target };
}
