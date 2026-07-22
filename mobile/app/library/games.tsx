import React from 'react';
import { View, Text, StyleSheet, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import type { Href } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { api, tmdbImage } from '@/lib/api';
import { shortDateFr } from '@/lib/format';
import { COLORS, FONTS, SPACE, SIZES } from '@/lib/theme';
import { EmptyState, LoadError, Poster } from '@/components/ui';
import { ScreenShell, SectionHeader } from '@/components/prisme';
import { LibHeader } from '@/components/library';
import { AppearItem } from '@/components/anim';
import { PullToRefresh } from '@/components/PullToRefresh';
import { useFloatingSection, FloatingSectionPill } from '@/components/FloatingSection';
import { GridSkeleton } from '@/components/skeletons';
import { usePullRefresh } from '@/lib/usePullRefresh';

// Miroir de MediaDto (packages/types) pour les jeux : le serveur ne renvoie
// pas encore ce type dans lib/types.ts (endpoints ajoutés en tâche 4/5).
type GameDto = {
  id: string;
  title: string;
  posterPath: string | null;
  year: number | null;
  voteAverage: number | null;
  platforms: string | null;
  userStatus: string | null;
  playtimeMinutes: number | null;
};

type GamesLibraryResponse = {
  wishlist: GameDto[];
  owned: GameDto[];
  playing: GameDto[];
  completed: GameDto[];
  abandoned: GameDto[];
};

// Sorties (+ DLC) à venir des jeux suivis, groupées par mois — miroir de
// UpcomingItemDto (shows) mais à plat (pas de `media` imbriqué).
type GameUpcomingItemDto = { id: string; title: string; posterPath: string | null; releaseDate: string };
type GamesUpcomingResponse = { groups: { label: string; items: GameUpcomingItemDto[] }[] };

// « POSSÉDÉS » n'est plus un statut : c'est la vue « collection » (toutes les
// lignes isOwned côté serveur) — un jeu peut apparaître dans POSSÉDÉS ET dans
// son groupe de statut (ex. EN COURS), c'est voulu.
const SECTIONS: { key: keyof GamesLibraryResponse; label: string }[] = [
  { key: 'wishlist', label: 'Voulus' },
  { key: 'owned', label: 'Possédés' },
  { key: 'playing', label: 'En cours' },
  { key: 'completed', label: 'Terminés' },
  { key: 'abandoned', label: 'Abandonnés' },
];

// Bibliothèque de jeux : écran de PILE ouvert depuis le Profil (« voir tout »),
// comme Séries/Films (app/library/*). Écran de pile — et non onglet caché —
// pour que le retour (bouton ET swipe) revienne proprement ici depuis une
// fiche jeu, au lieu de retomber sur l'onglet voisin (Explorer).
export default function GamesLibraryScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const library = useQuery({
    queryKey: ['games', 'library'],
    queryFn: () => api.get<GamesLibraryResponse>('/api/games'),
  });
  const isEmpty =
    !!library.data &&
    library.data.wishlist.length === 0 &&
    library.data.owned.length === 0 &&
    library.data.playing.length === 0 &&
    library.data.completed.length === 0 &&
    library.data.abandoned.length === 0;
  // Sorties à venir des jeux suivis (miroir de « À voir » côté séries).
  const upcoming = useQuery({
    queryKey: ['games', 'upcoming'],
    queryFn: () => api.get<GamesUpcomingResponse>('/api/games/upcoming'),
  });

  const { refreshing, onRefresh } = usePullRefresh([library.refetch, upcoming.refetch]);
  // Pastille de statut FLOTTANTE (VOULUS, EN COURS…) : suit le défilement,
  // comme l'onglet Séries et les bibliothèques du profil.
  const { registerSection, onListScroll, floatLabel } = useFloatingSection();

  // Grille responsive (comme l'onglet Films) : 3 colonnes sur téléphone,
  // 4/5 sur tablette et desktop, contenu centré à `contentMax`.
  const availableWidth = Math.min(width, SIZES.contentMax) - SPACE.md * 2;
  const columns = availableWidth >= 640 ? 5 : availableWidth >= 480 ? 4 : 3;
  const posterWidth = Math.max(76, (availableWidth - SPACE.sm * (columns - 1)) / columns);

  const grid = (items: GameDto[], startIndex = 0) => (
    <View style={styles.grid}>
      {items.map((g, i) => (
        <AppearItem key={g.id} index={startIndex + i} style={{ width: posterWidth }}>
          <Poster title={g.title} uri={tmdbImage(g.posterPath)} width={posterWidth} onPress={() => router.push(`/game/${g.id}` as Href)} />
        </AppearItem>
      ))}
    </View>
  );

  // Sorties à venir (jeux déjà suivis) : même gabarit que les autres sections
  // de la bibliothèque (grille d'affiches), avec la DATE de sortie sous chaque
  // jaquette — cohérent avec les catégories voisines et l'Agenda (où « Sorties
  // à venir » affiche déjà la date). Taper ouvre la fiche.
  const upcomingGrid = (items: GameUpcomingItemDto[]) => (
    <View style={styles.grid}>
      {items.map((it) => (
        <View key={it.id} style={{ width: posterWidth }}>
          <Poster title={it.title} uri={tmdbImage(it.posterPath)} width={posterWidth} onPress={() => router.push(`/game/${it.id}` as Href)} />
          <Text style={styles.upcomingDate} numberOfLines={1}>{shortDateFr(it.releaseDate)}</Text>
        </View>
      ))}
    </View>
  );

  return (
    <ScreenShell safeTop={false} contentContainerStyle={styles.content}>
      {/* En-tête de pile « Ma collection » avec retour (comme Séries/Films) ;
          LibHeader gère lui-même le safe-area haut, d'où safeTop={false}. */}
      <LibHeader title="Jeux" />

      {library.isLoading ? (
        <GridSkeleton />
      ) : library.isError && !library.data ? (
        <LoadError onRetry={library.refetch} busy={library.isRefetching} />
      ) : (
        // Vue intermédiaire flex:1 : la pastille flottante se positionne par
        // rapport à elle (sous l'en-tête, pas dessus).
        <View style={styles.body}>
          {/* Tirer-pour-actualiser façon Instagram (le même que le Profil) —
              fonctionne web + natif, contrairement au RefreshControl RN. */}
          <PullToRefresh
            refreshing={refreshing}
            onRefresh={onRefresh}
            contentContainerStyle={styles.scrollContent}
            onScroll={onListScroll}
          >
            {library.data ? (
              <>
                {!isEmpty ? (
                  (() => {
                    const data = library.data;
                    let n = -1;
                    return SECTIONS.map(({ key, label }) => {
                      const items = data[key];
                      if (items.length === 0) return null;
                      const start = n + 1;
                      n += items.length;
                      return (
                        <View key={key} onLayout={registerSection(label)}>
                          <SectionHeader title={label} />
                          {grid(items, start)}
                        </View>
                      );
                    });
                  })()
                ) : (
                  <EmptyState title="Aucun jeu suivi" message="Ajoutez des jeux depuis l'Explorer." />
                )}

                {/* Sorties à venir : jeux suivis dont la sortie n'est pas encore
                    passée, groupés par mois (n'apparaît que si non vide, donc
                    jamais affiché quand la bibliothèque est vide). */}
                {upcoming.data && upcoming.data.groups.length > 0 ? (
                  <View onLayout={registerSection('Sorties à venir')}>
                    <SectionHeader title="Sorties à venir" />
                    {upcoming.data.groups.map((g) => (
                      <View key={g.label} style={styles.upcomingGroup}>
                        <Text style={styles.groupLabel}>{g.label.toUpperCase()}</Text>
                        {upcomingGrid(g.items)}
                      </View>
                    ))}
                  </View>
                ) : null}
              </>
            ) : null}
          </PullToRefresh>
          {/* Pastille de statut flottante (suit le scroll, comme l'onglet Séries). */}
          <FloatingSectionPill label={floatLabel} />
        </View>
      )}
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 0 },
  body: { flex: 1 },
  scrollContent: { paddingTop: SPACE.xs, paddingBottom: SIZES.tabBar + SPACE.lg },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.sm },
  upcomingGroup: { paddingBottom: SPACE.xs },
  // Sous-titre de groupe (mois) au-dessus d'une grille « Sorties à venir ».
  groupLabel: { fontFamily: FONTS.bold, fontSize: 13, color: COLORS.textMuted, marginBottom: 6, letterSpacing: 0.4 },
  // Date de sortie sous chaque jaquette « Sorties à venir ».
  upcomingDate: { fontFamily: FONTS.semiBold, fontSize: 11.5, color: COLORS.textMuted, marginTop: 4 },
});
