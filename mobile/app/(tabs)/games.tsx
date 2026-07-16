import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import type { Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, tmdbImage } from '@/lib/api';
import { COLORS, FONTS, RADIUS } from '@/lib/theme';
import { PillHeader, EmptyState, Loading, LoadError, Poster } from '@/components/ui';
import { AppearItem } from '@/components/anim';
import { PullToRefresh } from '@/components/PullToRefresh';
import { useFloatingSection, FloatingSectionPill } from '@/components/FloatingSection';
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

// Sorties (+ DLC) à venir des jeux suivis, groupées par mois — miroir de
// UpcomingItemDto (shows) mais à plat (pas de `media` imbriqué).
type GameUpcomingItemDto = { id: string; title: string; posterPath: string | null; releaseDate: string };
type GamesUpcomingResponse = { groups: { label: string; items: GameUpcomingItemDto[] }[] };

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
  const qc = useQueryClient();
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
  // Découverte IGDB (Populaires / À venir) : toujours affichée sous la
  // bibliothèque, et seul contenu de l'écran quand la bibliothèque est vide.
  const discover = useQuery({
    queryKey: ['games', 'discover'],
    queryFn: () => api.get<GamesDiscoverResponse>('/api/games/discover'),
  });
  // Sorties à venir des jeux suivis (miroir de « À voir » côté séries).
  const upcoming = useQuery({
    queryKey: ['games', 'upcoming'],
    queryFn: () => api.get<GamesUpcomingResponse>('/api/games/upcoming'),
  });

  const { refreshing, onRefresh } = usePullRefresh([library.refetch, upcoming.refetch, discover.refetch]);
  // Pastille de statut FLOTTANTE (VOULUS, EN COURS…) : suit le défilement,
  // comme l'onglet Séries et les bibliothèques du profil.
  const { registerSection, onListScroll, floatLabel } = useFloatingSection();

  // Ajout depuis la découverte : ajoute (statut « Voulus ») puis ouvre la
  // fiche (recherche déplacée dans l'Explorer, cf. app/(tabs)/explore.tsx).
  const [addingDiscoverId, setAddingDiscoverId] = useState<string | null>(null);
  // Consultation ≠ suivi (règle produit) : taper une jaquette de la découverte
  // OUVRE la fiche sans rien ajouter — le suivi se choisit ensuite sur la fiche.
  const addDiscover = async (g: DiscoverGameDto) => {
    if (addingDiscoverId) return;
    setAddingDiscoverId(g.igdbId);
    try {
      const res = await api.post<{ mediaId: string | null }>('/api/games/add-from-igdb', {
        igdbId: g.igdbId,
      });
      if (res.mediaId) router.push(('/game/' + res.mediaId) as Href);
    } finally {
      setAddingDiscoverId(null);
    }
  };

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

  // Carrousel horizontal de découverte (taper ajoute puis ouvre la fiche) —
  // même gabarit que PosterRow (profile.tsx) : Poster width={118}.
  const discoverRow = (items: DiscoverGameDto[]) => (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 6 }}>
      {items.map((g) => (
        <View key={g.igdbId} style={{ width: 118 }}>
          <Poster title={g.title} uri={tmdbImage(g.posterPath)} width={118} onPress={() => addDiscover(g)} />
          {addingDiscoverId === g.igdbId ? (
            <View style={styles.posterBusy}>
              <ActivityIndicator color={COLORS.white} size="small" />
            </View>
          ) : null}
        </View>
      ))}
    </ScrollView>
  );

  // Carrousel horizontal des sorties à venir (jeux déjà suivis) : ouvre
  // directement la fiche, pas d'ajout.
  const upcomingRow = (items: GameUpcomingItemDto[]) => (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 6 }}>
      {items.map((it) => (
        <Poster key={it.id} title={it.title} uri={tmdbImage(it.posterPath)} width={118} onPress={() => router.push(`/game/${it.id}` as Href)} />
      ))}
    </ScrollView>
  );

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.white, paddingTop: insets.top }}>
      {library.isLoading ? (
        <Loading />
      ) : library.isError && !library.data ? (
        <LoadError onRetry={library.refetch} busy={library.isRefetching} />
      ) : (
        // Vue intermédiaire flex:1 : la pastille flottante se positionne par
        // rapport à elle (sous la barre de statut, pas dessus).
        <View style={{ flex: 1 }}>
        {/* Tirer-pour-actualiser façon Instagram (le même que le Profil) —
            fonctionne web + natif, contrairement au RefreshControl RN. */}
        <PullToRefresh
          refreshing={refreshing}
          onRefresh={onRefresh}
          contentContainerStyle={{ paddingTop: 12, paddingBottom: 20 }}
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
                        <PillHeader label={label} />
                        {grid(items, start)}
                      </View>
                    );
                  });
                })()
              ) : (
                <EmptyState title="Aucun jeu suivi" message="Ajoutez des jeux depuis la découverte ci-dessous." />
              )}

              {/* Sorties à venir : jeux suivis dont la sortie n'est pas encore
                  passée, groupés par mois (n'apparaît que si non vide, donc
                  jamais affiché quand la bibliothèque est vide). */}
              {upcoming.data && upcoming.data.groups.length > 0 ? (
                <View onLayout={registerSection('Sorties à venir')}>
                  <PillHeader label="SORTIES À VENIR" />
                  {upcoming.data.groups.map((g) => (
                    <View key={g.label} style={{ paddingBottom: 8 }}>
                      <Text style={styles.groupLabel}>{g.label.toUpperCase()}</Text>
                      {upcomingRow(g.items)}
                    </View>
                  ))}
                </View>
              ) : null}

              {/* Découverte IGDB : toujours sous la bibliothèque, seul contenu
                  visible (avec l'EmptyState ci-dessus) quand elle est vide —
                  jamais affichée deux fois. */}
              {discover.isLoading && !discover.data ? (
                <Loading />
              ) : discover.data ? (
                <>
                  {discover.data.popular.length > 0 ? (
                    <View onLayout={registerSection('Populaires')}>
                      <PillHeader label="POPULAIRES" />
                      {discoverRow(discover.data.popular)}
                    </View>
                  ) : null}
                  {discover.data.upcoming.length > 0 ? (
                    <View onLayout={registerSection('À venir')}>
                      <PillHeader label="À VENIR" />
                      {discoverRow(discover.data.upcoming)}
                    </View>
                  ) : null}
                </>
              ) : null}
            </>
          ) : null}
        </PullToRefresh>
        {/* Pastille de statut flottante (suit le scroll, comme l'onglet Séries). */}
        <FloatingSectionPill label={floatLabel} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 4, gap: 4 },
  cell: { width: '32.5%' },
  // Sous-titre de groupe (mois) au-dessus d'un carrousel « Sorties à venir ».
  groupLabel: { fontFamily: FONTS.bold, fontSize: 13, color: COLORS.textMuted, marginHorizontal: 16, marginBottom: 6, letterSpacing: 0.4 },
  // Overlay « en cours d'ajout » posé sur une jaquette de découverte.
  posterBusy: {
    position: 'absolute', top: 0, left: 0, right: 0, aspectRatio: 2 / 3,
    borderRadius: RADIUS.poster, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center',
  },
});
