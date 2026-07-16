// Objet plat de stats agrégées, calculé côté serveur (compte/select minimaux)
// et consommé par toutes les fonctions pures du moteur de gamification.
export type GamificationStats = {
  episodesWatched: number;
  dayOneEpisodes: number;
  moviesWatched: number;
  gamesCompleted: number;
  showsCompleted: number;
  maxEpisodes24h: number;
  distinctGenres: number;
  followers: number;
  comments: number;
  reactionsReceived: number;
  bestStreak: number;
  accountCreatedAt: string | null;
  challengesDone: number;
};
