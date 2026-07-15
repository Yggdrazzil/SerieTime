import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  FlatList,
  Image as RNImage,
  ActivityIndicator,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ViewToken,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, tmdbImage } from '@/lib/api';
import { COLORS, FONTS } from '@/lib/theme';
import { EmptyState, Loading } from '@/components/ui';
import { TikTokCard } from './TikTokCard';
import { CommentsSheet } from './CommentsSheet';
import { PullToRefreshView } from './PullToRefreshView';
import { useResolveMedia } from './useResolveMedia';
import { FEED_CATEGORIES, catOf, type FeedCategory, type FeedItem } from './types';

const keyOf = (f: FeedItem) => `${f.type}:${f.tmdbId ?? f.id}`;

export function TikTokFeed() {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const resolveMedia = useResolveMedia();
  const listRef = useRef<FlatList<FeedItem>>(null);
  const scrollY = useRef(0); // offset vertical courant du flux (pour le pull-to-refresh web+natif)

  const [height, setHeight] = useState(0);
  const [cat, setCat] = useState<FeedCategory>('tout');
  const [extra, setExtra] = useState<FeedItem[]>([]); // pages ajoutées (flux infini)
  const [commentsFor, setCommentsFor] = useState<FeedItem | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0); // carte actuellement à l'écran
  const [commentBumps, setCommentBumps] = useState<Record<string, number>>({}); // +commentaires publiés par carte
  const dryRef = useRef(0); // nombre de fetchs consécutifs sans nouveauté

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['explore', 'feed'],
    queryFn: () => api.get<{ feed: FeedItem[] }>('/api/explore/feed'),
    staleTime: 30 * 60_000,
  });

  const all = useMemo(() => [...(data?.feed ?? []), ...extra], [data?.feed, extra]);
  const deck = useMemo(
    () => (cat === 'tout' ? all : all.filter((f) => catOf(f) === cat)),
    [all, cat],
  );
  // Le deck courant, lu par les callbacks stables (onViewable) sans closure périmée.
  const deckRef = useRef(deck);
  deckRef.current = deck;

  const invalidateLibrary = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['shows'] });
    queryClient.invalidateQueries({ queryKey: ['movies'] });
    queryClient.invalidateQueries({ queryKey: ['profile'] });
  }, [queryClient]);

  // Flux infini : re-tire une page et ajoute les nouveautés (dédup). 2 fetchs
  // secs consécutifs → on arrête d'essayer (garde-fou anti-boucle).
  const loadMore = useCallback(async () => {
    if (loadingMore || dryRef.current >= 2) return;
    setLoadingMore(true);
    try {
      const res = await api.get<{ feed: FeedItem[] }>('/api/explore/feed');
      const seen = new Set(all.map(keyOf));
      const fresh = res.feed.filter((f) => !seen.has(keyOf(f)));
      if (fresh.length === 0) dryRef.current += 1;
      else {
        dryRef.current = 0;
        setExtra((prev) => [...prev, ...fresh]);
      }
    } catch {
      /* best-effort */
    } finally {
      setLoadingMore(false);
    }
  }, [all, loadingMore]);

  // Suit la carte active + prefetch des 2 backdrops suivants pour un snap fluide.
  // Callback stable (RN interdit de le changer entre les rendus) : lit deckRef.
  const onViewable = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const idx = viewableItems[0]?.index ?? 0;
    setActiveIndex(idx);
    const d = deckRef.current;
    for (let i = idx + 1; i <= idx + 2; i++) {
      const it = d[i];
      const uri = it && (tmdbImage(it.backdropPath, 'w780') ?? tmdbImage(it.posterPath, 'w500'));
      if (uri) RNImage.prefetch(uri);
    }
  }).current;

  // Tirer-pour-actualiser : nouveau tirage complet, on repart du haut.
  const onRefresh = useCallback(async () => {
    dryRef.current = 0;
    setExtra([]);
    await refetch();
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
    setActiveIndex(0);
  }, [refetch]);

  const advance = useCallback(
    (index: number) => {
      const next = index + 1;
      if (next < deck.length) listRef.current?.scrollToIndex({ index: next, animated: true });
    },
    [deck.length],
  );

  if (isLoading) return <Loading />;

  return (
    <View style={styles.wrap} onLayout={(e) => setHeight(e.nativeEvent.layout.height)}>
      {height > 0 && deck.length > 0 ? (
        <PullToRefreshView refreshing={isRefetching} onRefresh={onRefresh} scrollYRef={scrollY}>
          <FlatList
            ref={listRef}
            data={deck}
            keyExtractor={keyOf}
            pagingEnabled
            showsVerticalScrollIndicator={false}
            decelerationRate="fast"
            getItemLayout={(_, index) => ({ length: height, offset: height * index, index })}
            initialNumToRender={2}
            maxToRenderPerBatch={3}
            windowSize={3}
            scrollEventThrottle={16}
            onScroll={(e: NativeSyntheticEvent<NativeScrollEvent>) => {
              scrollY.current = e.nativeEvent.contentOffset.y;
            }}
            onEndReachedThreshold={0.5}
            onEndReached={loadMore}
            onViewableItemsChanged={onViewable}
            viewabilityConfig={{ itemVisiblePercentThreshold: 60 }}
            renderItem={({ item, index }) => (
              <TikTokCard
                item={item}
                height={height}
                resolveMedia={resolveMedia}
                onOpenComments={setCommentsFor}
                onDisliked={() => advance(index)}
                onInvalidateLibrary={invalidateLibrary}
                commentBump={commentBumps[keyOf(item)] ?? 0}
              />
            )}
            ListFooterComponent={loadingMore ? <ActivityIndicator style={{ marginVertical: 20 }} color="#fff" /> : null}
          />
        </PullToRefreshView>
      ) : height > 0 ? (
        <View style={styles.emptyWrap}>
          <EmptyState title="Rien dans cette catégorie" message="Change de catégorie ou actualise." />
        </View>
      ) : null}

      {/* Filtres catégories, en surimpression haute (la barre de recherche est
          au-dessus dans la coquille explore.tsx et gère déjà la zone sûre). */}
      <View style={[styles.top, { paddingTop: 10 }]} pointerEvents="box-none">
        <FlatList
          data={FEED_CATEGORIES}
          keyExtractor={(c) => c.key}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8, paddingHorizontal: 14 }}
          renderItem={({ item: c }) => (
            <Pressable
              style={[styles.chip, cat === c.key && styles.chipOn]}
              onPress={() => {
                setCat(c.key);
                setActiveIndex(0);
                listRef.current?.scrollToOffset({ offset: 0, animated: false });
              }}
            >
              <Text style={[styles.chipText, cat === c.key && styles.chipTextOn]}>{c.label}</Text>
            </Pressable>
          )}
        />
      </View>

      {/* Barre « Ajouter un commentaire » (comme TikTok) : cible la carte active. */}
      {deck.length > 0 ? (
        <Pressable
          style={[styles.commentBar, { bottom: insets.bottom + 12 }]}
          onPress={() => {
            const current = deck[activeIndex];
            if (current) setCommentsFor(current);
          }}
        >
          <Feather name="message-circle" size={18} color="rgba(255,255,255,0.9)" />
          <Text style={styles.commentBarText}>Ajouter un commentaire…</Text>
        </Pressable>
      ) : null}

      <CommentsSheet
        item={commentsFor}
        onClose={() => setCommentsFor(null)}
        resolveMedia={resolveMedia}
        onCommentPosted={() => {
          if (!commentsFor) return;
          const k = keyOf(commentsFor);
          setCommentBumps((b) => ({ ...b, [k]: (b[k] ?? 0) + 1 }));
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#000' },
  emptyWrap: { flex: 1, backgroundColor: COLORS.white },
  top: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10 },
  chip: { backgroundColor: 'rgba(0,0,0,0.4)', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 },
  chipOn: { backgroundColor: COLORS.yellow },
  chipText: { fontFamily: FONTS.extraBold, fontSize: 13, letterSpacing: 0.4, color: '#fff' },
  chipTextOn: { color: COLORS.black },
  commentBar: {
    position: 'absolute',
    left: 14,
    right: 84,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 11,
  },
  commentBarText: { color: 'rgba(255,255,255,0.9)', fontFamily: FONTS.regular, fontSize: 14 },
});
