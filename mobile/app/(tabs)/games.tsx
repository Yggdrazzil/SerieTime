import React, { useState } from 'react';
import { View, Text, TextInput, ScrollView, StyleSheet, Pressable, Image, ActivityIndicator, RefreshControl, Platform } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import type { Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, tmdbImage } from '@/lib/api';
import { useDebounced } from '@/lib/useDebounced';
import { COLORS, FONTS } from '@/lib/theme';
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
type GameSearchResultDto = { igdbId: string; title: string; year: number | null; posterPath: string | null };

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
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  // Debounce : une requête quand l'utilisateur marque une pause (cf. explore.tsx).
  const debouncedQuery = useDebounced(query.trim(), 300);
  const searching = query.trim().length > 1;
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
      {/* Barre de recherche (style repris de explore.tsx) : recherche IGDB, taper
          un résultat l'ajoute directement en « Voulus » et ouvre sa fiche. */}
      <View style={[styles.searchbar, { marginTop: insets.top + 10 }]}>
        <Feather name="search" size={20} color={searching ? COLORS.black : COLORS.textMuted} />
        <TextInput
          style={[styles.input, Platform.OS === 'web' && ({ outlineStyle: 'none' } as never)]}
          placeholder={focused || query ? 'Rechercher un jeu' : 'Rechercher'}
          placeholderTextColor={COLORS.textMuted}
          value={query}
          onChangeText={setQuery}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          autoCapitalize="none"
        />
        {query ? (
          <Pressable onPress={() => setQuery('')} hitSlop={8}>
            <Text style={styles.cancel}>Annuler</Text>
          </Pressable>
        ) : null}
      </View>

      {searching ? (
        <GameSearchResults query={debouncedQuery} rawQuery={query} />
      ) : library.isLoading ? (
        <Loading />
      ) : library.isError && !library.data ? (
        <LoadError onRetry={library.refetch} busy={library.isRefetching} />
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingTop: 12, paddingBottom: 20 }}
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

// Résultats de recherche IGDB : taper une ligne ajoute directement le jeu
// (statut « Voulus ») puis ouvre sa fiche — pas d'étape intermédiaire, à la
// différence de la recherche séries/films (pas de bouton + séparé ici).
function GameSearchResults({ query, rawQuery }: { query: string; rawQuery: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [addingKey, setAddingKey] = useState<string | null>(null);

  const search = useQuery({
    queryKey: ['games', 'search', query],
    queryFn: () => api.get<{ results: GameSearchResultDto[] }>(`/api/games/search?q=${encodeURIComponent(query)}`),
    enabled: query.length >= 2,
    placeholderData: keepPreviousData,
  });

  const add = async (r: GameSearchResultDto) => {
    if (addingKey) return;
    setAddingKey(r.igdbId);
    try {
      const res = await api.post<{ mediaId: string | null }>('/api/games/add-from-igdb', {
        igdbId: r.igdbId,
        status: 'wishlist',
      });
      qc.invalidateQueries({ queryKey: ['games', 'library'] });
      if (res.mediaId) router.push(('/game/' + res.mediaId) as Href);
    } finally {
      setAddingKey(null);
    }
  };

  if (search.isLoading) return <Loading />;
  const results = search.data?.results ?? [];
  if (results.length === 0) {
    return <EmptyState title="Toutes nos excuses" message={`Nous n'avons trouvé aucun résultat pour « ${rawQuery.trim()} »`} />;
  }

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 24, paddingTop: 6 }} keyboardShouldPersistTaps="handled">
      {results.map((r, i) => (
        <AppearItem key={r.igdbId} index={i}>
          <Pressable style={styles.resultRow} onPress={() => add(r)} disabled={!!addingKey}>
            {tmdbImage(r.posterPath, 'w185') ? (
              <Image source={{ uri: tmdbImage(r.posterPath, 'w185')! }} style={styles.resultPoster} resizeMode="cover" />
            ) : (
              <View style={[styles.resultPoster, styles.posterEmpty]}>
                <Feather name="image" size={18} color="#b4b4b4" />
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={styles.resultTitle} numberOfLines={1}>
                {r.title}
              </Text>
              {r.year ? <Text style={styles.resultMeta}>{r.year}</Text> : null}
            </View>
            {addingKey === r.igdbId ? (
              <ActivityIndicator color={COLORS.black} size="small" />
            ) : (
              <Feather name="plus" size={22} color="#E6B800" />
            )}
          </Pressable>
        </AppearItem>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 4, gap: 4 },
  cell: { width: '32.5%' },
  // Barre de recherche (mêmes cotes que explore.tsx).
  searchbar: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 18, height: 44, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  input: { flex: 1, fontFamily: FONTS.regular, fontSize: 15.5, borderWidth: 0, paddingVertical: 6 },
  cancel: { color: COLORS.blue, fontFamily: FONTS.regular, fontSize: 16 },
  resultRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.borderLight },
  resultPoster: { width: 56, aspectRatio: 2 / 3, borderRadius: 4, backgroundColor: '#e5e5e5' },
  posterEmpty: { alignItems: 'center', justifyContent: 'center' },
  resultTitle: { fontSize: 17, fontFamily: FONTS.bold },
  resultMeta: { fontFamily: FONTS.regular, fontSize: 14, color: COLORS.textMuted, marginTop: 3 },
});
