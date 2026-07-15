import React from 'react';
import { View, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import type { Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { api, tmdbImage } from '@/lib/api';
import { COLORS } from '@/lib/theme';
import { PillHeader, EmptyState, Loading, LoadError, Poster } from '@/components/ui';
import { AppearItem } from '@/components/anim';
import { useTabResetSeq } from '@/lib/tabReset';
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
  playing: GameDto[];
  completed: GameDto[];
  abandoned: GameDto[];
};

type DiscoverGameDto = { igdbId: string; title: string; year: number | null; posterPath: string | null };
type GamesDiscoverResponse = { popular: DiscoverGameDto[]; upcoming: DiscoverGameDto[] };

const SECTIONS: { key: keyof GamesLibraryResponse; label: string }[] = [
  { key: 'wishlist', label: 'VOULUS' },
  { key: 'playing', label: 'EN COURS' },
  { key: 'completed', label: 'TERMINÉS' },
  { key: 'abandoned', label: 'ABANDONNÉS' },
];

export default function GamesScreen() {
  // Re-clic sur l'onglet « Jeux » : remontage complet (état + scroll par défaut).
  const resetSeq = useTabResetSeq('games');
  return <GamesScreenInner key={resetSeq} />;
}

function GamesScreenInner() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const library = useQuery({
    queryKey: ['games', 'library'],
    queryFn: () => api.get<GamesLibraryResponse>('/api/games'),
  });
  const isEmpty =
    !!library.data &&
    library.data.wishlist.length === 0 &&
    library.data.playing.length === 0 &&
    library.data.completed.length === 0 &&
    library.data.abandoned.length === 0;
  // Bibliothèque vide → repli sur la découverte (Populaires / À venir) pour
  // que l'écran ne reste pas vide (règle produit de la tâche).
  const discover = useQuery({
    queryKey: ['games', 'discover'],
    queryFn: () => api.get<GamesDiscoverResponse>('/api/games/discover'),
    enabled: isEmpty,
  });

  const { refreshing, onRefresh } = usePullRefresh(
    isEmpty ? [library.refetch, discover.refetch] : [library.refetch],
  );

  const grid = (items: GameDto[], startIndex = 0) => (
    <View style={styles.grid}>
      {items.map((g, i) => (
        <AppearItem key={g.id} index={startIndex + i} style={styles.cell}>
          {/* Route détail jeu créée en tâche 8 ; référencée ici par avance. */}
          <Poster title={g.title} uri={tmdbImage(g.posterPath)} onPress={() => router.push(`/game/${g.id}` as Href)} />
        </AppearItem>
      ))}
    </View>
  );

  const discoverGrid = (items: DiscoverGameDto[], startIndex = 0) => (
    <View style={styles.grid}>
      {items.map((g, i) => (
        <AppearItem key={g.igdbId} index={startIndex + i} style={styles.cell}>
          <Poster title={g.title} uri={tmdbImage(g.posterPath)} />
        </AppearItem>
      ))}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.white }}>
      {library.isLoading ? (
        <View style={{ paddingTop: insets.top }}>
          <Loading />
        </View>
      ) : library.isError && !library.data ? (
        <View style={{ paddingTop: insets.top }}>
          <LoadError onRetry={library.refetch} busy={library.isRefetching} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingTop: insets.top, paddingBottom: 20 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.yellow} colors={[COLORS.yellow]} />
          }
        >
          {library.data && !isEmpty ? (
            (() => {
              const data = library.data;
              let n = -1;
              return SECTIONS.map(({ key, label }) => {
                const items = data[key];
                if (items.length === 0) return null;
                const start = n + 1;
                n += items.length;
                return (
                  <View key={key}>
                    <PillHeader label={label} />
                    {grid(items, start)}
                  </View>
                );
              });
            })()
          ) : (
            <>
              <EmptyState title="Aucun jeu suivi" message="Ajoutez des jeux depuis la découverte ci-dessous." />
              {discover.isLoading ? (
                <Loading />
              ) : discover.data ? (
                <>
                  {discover.data.popular.length > 0 ? (
                    <>
                      <PillHeader label="POPULAIRES" />
                      {discoverGrid(discover.data.popular)}
                    </>
                  ) : null}
                  {discover.data.upcoming.length > 0 ? (
                    <>
                      <PillHeader label="À VENIR" />
                      {discoverGrid(discover.data.upcoming, discover.data.popular.length)}
                    </>
                  ) : null}
                </>
              ) : null}
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 4, gap: 4 },
  cell: { width: '32.5%' },
});
