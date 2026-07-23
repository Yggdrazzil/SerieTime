import React, { useCallback, useState } from 'react';
import { FlatList, Image, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { api, tmdbImage } from '@/lib/api';
import type { MediaDto } from '@/lib/types';
import { shortDateFr } from '@/lib/format';
import { COLORS, FONTS, RADIUS, SHADOW, SIZES, SPACE } from '@/lib/theme';
import { SegmentedFilter, TabHeader } from '@/components/prisme';
import { EmptyState, LoadError, PillHeader } from '@/components/ui';
import { QueueSkeleton } from '@/components/skeletons';
import { usePullRefresh } from '@/lib/usePullRefresh';
import { useTabResetSeq } from '@/lib/tabReset';
import { PosterGrid, ViewModeToggle, useGridView } from '@/components/PosterGrid';
import { UpcomingView } from './index';

// Agenda coupé en trois (décision design 2026-07-20) : les sorties à venir de
// CE QUE L'UTILISATEUR SUIT, par type — séries (épisodes), films (dates de
// sortie de sa liste), jeux (sorties suivies).
type AgendaTab = 'series' | 'movies' | 'games';
const TAB_OPTIONS: { value: AgendaTab; label: string }[] = [
  { value: 'series', label: 'Séries' },
  { value: 'movies', label: 'Films' },
  { value: 'games', label: 'Jeux' },
];

export default function AgendaScreen() {
  const insets = useSafeAreaInsets();
  const resetSeq = useTabResetSeq('agenda');
  const [tab, setTab] = useState<AgendaTab>('series');

  return (
    <View key={resetSeq} style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top }]}>
        <TabHeader title="Agenda" leading={<ViewModeToggle tab="agenda" />} />
        <SegmentedFilter
          options={TAB_OPTIONS}
          value={tab}
          onChange={setTab}
          accessibilityLabel="Choisir le type de sorties"
          style={styles.tabs}
        />
      </View>
      {tab === 'series' ? <UpcomingView /> : tab === 'movies' ? <MoviesUpcoming /> : <GamesUpcoming />}
    </View>
  );
}

// --- Films à venir (dates de sortie des films de la liste de l'utilisateur) ---

type MoviesResponse = { toWatch: MediaDto[]; upcoming: { media: MediaDto; releaseDate: string }[] };

// Films à venir GROUPÉS par mois — mêmes badges de période que les Jeux (retour
// Étienne : éviter la longue liste « en vrac »). Groupage CÔTÉ CLIENT (l'API
// /api/movies renvoie une liste plate) ; libellé « mois année » (mois complet,
// tableau local — évite les Intl limités d'Hermes ; PillHeader met en capitales
// comme pour les Jeux) et périodes triées par ordre chronologique.
type MovieUpcoming = MoviesResponse['upcoming'][number];
const MONTHS_LONG = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
function groupMoviesByMonth(items: MovieUpcoming[]): { label: string; items: MovieUpcoming[] }[] {
  const sorted = [...items].sort((a, b) => new Date(a.releaseDate).getTime() - new Date(b.releaseDate).getTime());
  const groups = new Map<string, MovieUpcoming[]>();
  for (const it of sorted) {
    const d = new Date(it.releaseDate);
    const label = `${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}`;
    const arr = groups.get(label) ?? [];
    arr.push(it);
    groups.set(label, arr);
  }
  return [...groups.entries()].map(([label, items]) => ({ label, items }));
}

function MoviesUpcoming() {
  const router = useRouter();
  const gridView = useGridView('agenda');
  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['movies'],
    queryFn: () => api.get<MoviesResponse>('/api/movies'),
  });
  const { refreshing, onRefresh } = usePullRefresh([refetch]);
  // FlatList par GROUPE (période) : bloc PillHeader + rangées, comme les Jeux —
  // les groupes hors écran ne sont pas montés (virtualisation).
  const renderGroup = useCallback(
    ({ item: g }: { item: { label: string; items: MovieUpcoming[] } }) => (
      <View style={styles.group}>
        <PillHeader label={g.label} />
        {g.items.map(({ media, releaseDate }) => (
          <UpcomingRow
            key={media.id}
            title={media.title}
            sub={shortDateFr(releaseDate)}
            uri={tmdbImage(media.posterPath, 'w342')}
            onPress={() => router.push(`/show/${media.id}?type=movie`)}
            hint="Ouvre la fiche du film"
          />
        ))}
      </View>
    ),
    [router],
  );
  if (isLoading) return <QueueSkeleton />;
  if (isError && !data) return <LoadError onRetry={refetch} busy={isRefetching} />;
  const groups = groupMoviesByMonth(data?.upcoming ?? []);
  if (groups.length === 0)
    return <EmptyState title="Aucun film à venir" message="Les prochaines sorties des films de ta liste apparaîtront ici." />;
  if (gridView)
    return (
      <PosterGrid
        sections={groups.map((g) => ({
          key: g.label,
          header: <PillHeader label={g.label} />,
          cells: g.items.map(({ media, releaseDate }) => ({
            key: media.id,
            title: media.title,
            sub: shortDateFr(releaseDate),
            uri: tmdbImage(media.posterPath, 'w342'),
            onPress: () => router.push(`/show/${media.id}?type=movie`),
            accessibilityHint: 'Ouvre la fiche du film',
          })),
        }))}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} colors={[COLORS.primary]} />}
      />
    );
  return (
    <FlatList
      data={groups}
      keyExtractor={movieGroupKey}
      renderItem={renderGroup}
      initialNumToRender={10}
      windowSize={7}
      contentContainerStyle={styles.listContent}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} colors={[COLORS.primary]} />}
    />
  );
}

const movieGroupKey = (g: { label: string }) => g.label;

// --- Jeux à venir (sorties des jeux suivis, groupées par période) ---

type GameUpcomingItemDto = { id: string; title: string; posterPath: string | null; releaseDate: string };
type GamesUpcomingResponse = { groups: { label: string; items: GameUpcomingItemDto[] }[] };

function GamesUpcoming() {
  const router = useRouter();
  const gridView = useGridView('agenda');
  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['games', 'upcoming'],
    queryFn: () => api.get<GamesUpcomingResponse>('/api/games/upcoming'),
  });
  const { refreshing, onRefresh } = usePullRefresh([refetch]);
  // FlatList par GROUPE (période) : même rendu qu'avant (bloc PillHeader +
  // rangées), les groupes hors écran ne sont pas montés.
  const renderGroup = useCallback(
    ({ item: g }: { item: GamesUpcomingResponse['groups'][number] }) => (
      <View style={styles.group}>
        <PillHeader label={g.label} />
        {g.items.map((it) => (
          <UpcomingRow
            key={it.id}
            title={it.title}
            sub={shortDateFr(it.releaseDate)}
            uri={tmdbImage(it.posterPath, 'w342')}
            onPress={() => router.push(`/game/${it.id}`)}
            hint="Ouvre la fiche du jeu"
          />
        ))}
      </View>
    ),
    [router],
  );
  if (isLoading) return <QueueSkeleton />;
  if (isError && !data) return <LoadError onRetry={refetch} busy={isRefetching} />;
  const groups = data?.groups ?? [];
  if (groups.length === 0)
    return <EmptyState title="Aucun jeu à venir" message="Les sorties des jeux que tu suis apparaîtront ici." />;
  if (gridView)
    return (
      <PosterGrid
        sections={groups.map((g) => ({
          key: g.label,
          header: <PillHeader label={g.label} />,
          cells: g.items.map((it) => ({
            key: it.id,
            title: it.title,
            sub: shortDateFr(it.releaseDate),
            uri: tmdbImage(it.posterPath, 'w342'),
            onPress: () => router.push(`/game/${it.id}`),
            accessibilityHint: 'Ouvre la fiche du jeu',
          })),
        }))}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} colors={[COLORS.primary]} />}
      />
    );
  return (
    <FlatList
      data={groups}
      keyExtractor={gameGroupKey}
      renderItem={renderGroup}
      initialNumToRender={10}
      windowSize={7}
      contentContainerStyle={styles.listContent}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} colors={[COLORS.primary]} />}
    />
  );
}

const gameGroupKey = (g: GamesUpcomingResponse['groups'][number]) => g.label;

// --- Rangée commune films/jeux : affiche + titre + date de sortie ---

function UpcomingRow({
  title,
  sub,
  uri,
  onPress,
  hint,
}: {
  title: string;
  sub: string;
  uri: string | null;
  onPress: () => void;
  hint: string;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}, sortie le ${sub}`}
      accessibilityHint={hint}
    >
      {uri ? (
        <Image source={{ uri }} style={styles.poster} resizeMode="cover" accessible={false} />
      ) : (
        <View style={[styles.poster, styles.posterEmpty]} accessible={false}>
          <Feather name="image" size={22} color={COLORS.textSoft} />
        </View>
      )}
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle} numberOfLines={2}>{title}</Text>
        <Text style={styles.rowSub}>{sub}</Text>
      </View>
      <Feather name="chevron-right" size={20} color={COLORS.textSoft} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.pageMuted },
  header: {
    backgroundColor: COLORS.white,
    paddingHorizontal: SPACE.md,
    paddingBottom: SPACE.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.borderLight,
  },
  tabs: { width: '100%', maxWidth: SIZES.contentMax, alignSelf: 'center' },
  listContent: {
    padding: SPACE.md,
    paddingBottom: 120,
    width: '100%',
    maxWidth: SIZES.contentMax,
    alignSelf: 'center',
  },
  group: { marginBottom: SPACE.md },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.sm,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.card,
    padding: SPACE.sm,
    marginBottom: SPACE.sm,
    ...SHADOW.card,
  },
  rowPressed: { opacity: 0.85 },
  poster: { width: 52, height: 76, borderRadius: RADIUS.small, backgroundColor: COLORS.surfaceMuted },
  posterEmpty: { alignItems: 'center', justifyContent: 'center' },
  rowBody: { flex: 1, minWidth: 0 },
  rowTitle: { color: COLORS.text, fontFamily: FONTS.semiBold, fontSize: 15 },
  rowSub: { color: COLORS.textMuted, fontFamily: FONTS.regular, fontSize: 13, marginTop: 2 },
});
