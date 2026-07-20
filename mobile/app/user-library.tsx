import React, { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useInfiniteQuery } from '@tanstack/react-query';
import { goBack } from '@/lib/nav';
import { api, ApiError, tmdbImage } from '@/lib/api';
import type { MediaType, UserMediaState } from '@/lib/types';
import { COLORS, FONTS, RADIUS, SIZES, SPACE } from '@/lib/theme';
import { EmptyState, LoadError, Loading, Poster } from '@/components/ui';
import { IconAction, ScreenHeader, ScreenShell, SegmentedFilter } from '@/components/prisme';
import { Pop } from '@/components/anim';

// Bibliothèque intégrale d'un ami (séries / films / jeux) — écran poussé
// depuis le profil public (app/user/[id].tsx) ou l'aperçu (UserPreviewSheet).
// Route plate avec params (?id=&name=&type=) : `app/user/[id].tsx` est un
// fichier plat, un dossier `app/user/[id]/library.tsx` ne peut pas coexister
// avec lui en expo-router sans déplacer la route du profil.

type LibraryItem = {
  media: { id: string; title: string; posterPath: string | null; type: string; year: number | null };
  status: UserMediaState;
  rating: number | null;
  isFavorite: boolean;
};
type LibraryPage = { items: LibraryItem[]; nextCursor: string | null; total: number };

const TYPE_OPTIONS = [
  { value: 'show', label: 'Séries' },
  { value: 'movie', label: 'Films' },
  { value: 'game', label: 'Jeux' },
] as const;

const STATUS_LABEL: Record<UserMediaState, string> = {
  watching: 'En cours',
  completed: 'Terminé',
  watchlist: 'À voir',
  paused: 'En pause',
  abandoned: 'Arrêté',
  not_started: 'Pas commencé',
};

const EMPTY_COPY: Record<MediaType, string> = {
  show: 'Aucune série dans sa bibliothèque pour le moment.',
  movie: 'Aucun film dans sa bibliothèque pour le moment.',
  game: 'Aucun jeu dans sa bibliothèque pour le moment.',
};

function mediaHref(id: string, kind: string): Href {
  if (kind === 'game') return ('/game/' + id) as Href;
  return ('/show/' + id + (kind === 'movie' ? '?type=movie' : '')) as Href;
}

function isType(value: string | undefined): value is MediaType {
  return value === 'show' || value === 'movie' || value === 'game';
}

export default function UserLibraryScreen() {
  const params = useLocalSearchParams<{ id: string; name?: string; type?: string }>();
  const userId = params.id;
  const displayName = params.name ?? '';
  const [type, setType] = useState<MediaType>(isType(params.type) ? params.type : 'show');
  const router = useRouter();
  const { width } = useWindowDimensions();

  // 3 colonnes dans le canevas Prisme (même géométrie que les grilles de
  // library/shows.tsx, en version FlatList pour la pagination infinie).
  const canvasWidth = Math.min(width, SIZES.contentMax);
  const cellWidth = Math.max(72, (canvasWidth - SPACE.md * 2 - GRID_GAP * 2) / 3);

  const query = useInfiniteQuery({
    queryKey: ['user', userId, 'library', type],
    queryFn: ({ pageParam }) =>
      api.get<LibraryPage>(
        '/api/users/' + userId + '/library?type=' + type + '&take=30' + (pageParam ? '&cursor=' + pageParam : ''),
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: !!userId,
    retry: (failureCount, error) =>
      // Un refus (profil privé) ou un 404 ne se règle pas en réessayant.
      failureCount < 2 && !(error instanceof ApiError && (error.status === 403 || error.status === 404)),
  });

  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  const total = query.data?.pages[0]?.total;
  const restricted = query.error instanceof ApiError && query.error.status === 403;

  return (
    <Pop style={styles.pop}>
      <ScreenShell contentContainerStyle={styles.content}>
        <ScreenHeader
          title={displayName ? 'Bibliothèque de ' + displayName : 'Bibliothèque'}
          subtitle={typeof total === 'number' ? total + (total > 1 ? ' titres' : ' titre') : undefined}
          leading={
            <IconAction
              icon="chevron-left"
              label="Retour au profil"
              onPress={() => goBack(userId ? (('/user/' + userId) as Href) : '/social')}
            />
          }
        />
        <SegmentedFilter
          options={TYPE_OPTIONS}
          value={type}
          onChange={setType}
          accessibilityLabel="Type de médias affichés"
          style={styles.filter}
        />
        {query.isLoading ? (
          <Loading />
        ) : restricted ? (
          <View style={styles.locked} accessibilityRole="summary">
            <View style={styles.lockedIcon} accessible={false}>
              <Feather name="lock" size={24} color={COLORS.primary} />
            </View>
            <Text style={styles.lockedTitle} accessibilityRole="header">Profil privé</Text>
            <Text style={styles.lockedBody}>Abonne-toi pour voir sa bibliothèque.</Text>
          </View>
        ) : query.isError && items.length === 0 ? (
          <LoadError onRetry={() => void query.refetch()} busy={query.isRefetching} />
        ) : items.length === 0 ? (
          <EmptyState title="Sa bibliothèque est vide" message={EMPTY_COPY[type]} />
        ) : (
          <FlatList
            data={items}
            key={type} // repart en haut de liste quand on change de segment
            keyExtractor={(item) => item.media.id}
            numColumns={3}
            columnWrapperStyle={styles.gridRow}
            contentContainerStyle={styles.gridContent}
            showsVerticalScrollIndicator={false}
            onEndReached={() => {
              if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
            }}
            onEndReachedThreshold={0.4}
            ListFooterComponent={
              query.isFetchingNextPage ? (
                <ActivityIndicator style={styles.footerSpinner} color={COLORS.primary} />
              ) : null
            }
            renderItem={({ item }) => (
              <View style={{ width: cellWidth }}>
                <View style={styles.posterFrame}>
                  <Poster
                    title={
                      item.media.title +
                      ', ' + STATUS_LABEL[item.status] +
                      (item.isFavorite ? ', favori' : '')
                    }
                    uri={tmdbImage(item.media.posterPath, 'w342')}
                    width={cellWidth}
                    onPress={() => router.push(mediaHref(item.media.id, item.media.type))}
                  />
                  {item.isFavorite ? (
                    <View style={styles.heart} accessible={false}>
                      <Feather name="heart" size={11} color="#FFFFFF" />
                    </View>
                  ) : null}
                  <View style={styles.statusBadge} accessible={false}>
                    <Text style={styles.statusText} numberOfLines={1}>
                      {STATUS_LABEL[item.status]}
                    </Text>
                  </View>
                </View>
              </View>
            )}
          />
        )}
      </ScreenShell>
    </Pop>
  );
}

const GRID_GAP = SPACE.sm;

const styles = StyleSheet.create({
  pop: { flex: 1 },
  content: { paddingBottom: 0 },
  filter: { marginBottom: SPACE.md },
  gridRow: { gap: GRID_GAP },
  gridContent: { gap: GRID_GAP, paddingBottom: SPACE.xl },
  footerSpinner: { paddingVertical: SPACE.md },
  posterFrame: { position: 'relative' },
  heart: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(20,16,24,0.62)',
    borderRadius: 11,
  },
  statusBadge: {
    position: 'absolute',
    left: 6,
    bottom: 6,
    maxWidth: '80%',
    paddingHorizontal: 7,
    paddingVertical: 2,
    backgroundColor: 'rgba(20,16,24,0.62)',
    borderRadius: RADIUS.pill,
  },
  statusText: { color: '#FFFFFF', fontSize: 9, lineHeight: 13, fontFamily: FONTS.extraBold, letterSpacing: 0.4 },
  locked: {
    alignItems: 'center',
    marginTop: SPACE.md,
    paddingVertical: SPACE.xl,
    paddingHorizontal: SPACE.lg,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: RADIUS.card,
  },
  lockedIcon: {
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACE.md,
    backgroundColor: COLORS.primarySoft,
    borderRadius: 26,
  },
  lockedTitle: { color: COLORS.text, fontSize: 20, lineHeight: 26, fontFamily: FONTS.extraBold, textAlign: 'center' },
  lockedBody: {
    marginTop: SPACE.xs,
    color: COLORS.textMuted,
    fontSize: 14,
    lineHeight: 21,
    fontFamily: FONTS.regular,
    textAlign: 'center',
  },
});
