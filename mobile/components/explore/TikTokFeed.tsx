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

const keyOf = (f: FeedItem) => (f.igdbId ? `game:${f.igdbId}` : `${f.type}:${f.tmdbId ?? f.id}`);

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
  const [endRefreshing, setEndRefreshing] = useState(false); // carte de fin atteinte → nouveau tirage
  const dryRef = useRef(0); // nombre de fetchs consécutifs sans nouveauté
  const endBusy = useRef(false); // anti double-déclenchement du tirage de fin

  // Deck FIGÉ tant que l'utilisateur ne demande pas de nouveau tirage
  // (pull-to-refresh, carte de fin, re-clic sur l'onglet Explorer) : chaque
  // refetch renvoie un deck ENTIÈREMENT NEUF (mémoire d'impressions côté
  // serveur) — un refetch silencieux (refocus fenêtre, remontage après 30 min)
  // ramenait donc l'utilisateur en haut d'un nouveau deck en perdant ses choix.
  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['explore', 'feed'],
    queryFn: () => api.get<{ feed: FeedItem[] }>('/api/explore/feed'),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
  });

  // Catégorie JEUX : source séparée (IGDB), pas le feed séries/films.
  const isGames = cat === 'jeux';
  const gamesQuery = useQuery({
    queryKey: ['explore', 'games'],
    queryFn: () => api.get<{ feed: FeedItem[] }>('/api/explore/games'),
    enabled: isGames,
    // Même règle que le feed : deck stable, renouvelé uniquement à la demande.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
  });

  const all = useMemo(() => [...(data?.feed ?? []), ...extra], [data?.feed, extra]);
  const deck = useMemo(
    () =>
      isGames
        ? gamesQuery.data?.feed ?? []
        : cat === 'tout'
          ? all
          : all.filter((f) => catOf(f) === cat),
    [all, cat, isGames, gamesQuery.data],
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
    if (isGames || loadingMore || dryRef.current >= 2) return; // pool jeux fini : pas d'infini
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
  }, [all, loadingMore, isGames]);

  // Suit la carte active + prefetch des affiches suivantes pour un snap fluide.
  // Callback stable (RN interdit de le changer entre les rendus) : lit deckRef.
  const onViewable = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const idx = viewableItems[0]?.index ?? 0;
    setActiveIndex(idx);
    const d = deckRef.current;
    for (let i = idx + 1; i <= idx + 2; i++) {
      const it = d[i];
      // On préchauffe l'affiche (ce que montre la carte) en taille correcte.
      const uri = it && (tmdbImage(it.posterPath, 'w780') ?? tmdbImage(it.backdropPath, 'w780'));
      if (uri) RNImage.prefetch(uri);
    }
  }).current;

  // Tirer-pour-actualiser : nouveau tirage complet, on repart du haut.
  const onRefresh = useCallback(async () => {
    dryRef.current = 0;
    setExtra([]);
    await (isGames ? gamesQuery.refetch() : refetch());
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
    setActiveIndex(0);
  }, [refetch, isGames, gamesQuery]);

  // Arrivé sur la CARTE DE FIN (page après la dernière proposition) : nouveau
  // tirage complet et retour en haut — « tu as tout vu, on t'en ressert ».
  const maybeEndRefresh = useCallback(
    (offsetY: number) => {
      const d = deckRef.current;
      if (!height || d.length === 0) return;
      if (offsetY < d.length * height - 2) return; // pas encore sur la carte de fin
      if (endBusy.current) return;
      endBusy.current = true;
      setEndRefreshing(true);
      void (async () => {
        try {
          await onRefresh();
        } finally {
          endBusy.current = false;
          setEndRefreshing(false);
        }
      })();
    },
    [height, onRefresh],
  );

  const advance = useCallback(
    (index: number) => {
      const next = index + 1;
      if (next < deck.length) listRef.current?.scrollToIndex({ index: next, animated: true });
    },
    [deck.length],
  );

  const refreshing = isGames ? gamesQuery.isRefetching : isRefetching;
  if (isGames ? gamesQuery.isLoading : isLoading) return <Loading />;

  return (
    <View style={styles.wrap} onLayout={(e) => setHeight(e.nativeEvent.layout.height)}>
      {height > 0 && deck.length > 0 ? (
        <PullToRefreshView refreshing={refreshing} onRefresh={onRefresh} scrollYRef={scrollY}>
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
              maybeEndRefresh(e.nativeEvent.contentOffset.y);
            }}
            // Position finale fiable après snap/momentum (onScroll throttlé peut
            // rater la dernière frame → le pull-to-refresh volait des swipes).
            onMomentumScrollEnd={(e: NativeSyntheticEvent<NativeScrollEvent>) => {
              scrollY.current = e.nativeEvent.contentOffset.y;
              maybeEndRefresh(e.nativeEvent.contentOffset.y);
            }}
            onScrollEndDrag={(e: NativeSyntheticEvent<NativeScrollEvent>) => {
              scrollY.current = e.nativeEvent.contentOffset.y;
              maybeEndRefresh(e.nativeEvent.contentOffset.y);
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
                onAdvance={() => advance(index)}
                onInvalidateLibrary={invalidateLibrary}
                commentBump={commentBumps[keyOf(item)] ?? 0}
              />
            )}
            ListFooterComponent={
              loadingMore ? (
                <ActivityIndicator style={{ marginVertical: 20 }} color="#fff" />
              ) : (
                // Carte de fin plein écran : y snapper déclenche un nouveau
                // tirage (maybeEndRefresh) et ramène en haut du flux.
                <View style={[styles.endCard, { height }]}>
                  {endRefreshing ? (
                    <ActivityIndicator color={COLORS.yellow} size="large" />
                  ) : (
                    <Feather name="refresh-cw" size={40} color={COLORS.yellow} />
                  )}
                  <Text style={styles.endTitle}>Tu as tout vu !</Text>
                  <Text style={styles.endMsg}>
                    {endRefreshing ? 'Nouveau tirage en cours…' : 'Continue à glisser pour un nouveau tirage.'}
                  </Text>
                </View>
              )
            }
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
          contentContainerStyle={{ gap: 6, paddingHorizontal: 10 }}
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

      {/* La barre « Ajouter un commentaire » a été retirée : redondante avec le
          bouton Avis du rail (retour utilisateur 2026-07-16), elle chargeait le bas
          de l'écran et chevauchait l'overlay détails. */}

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
  // Compact : les 5 catégories (dont JEUX) tiennent sur un écran 360dp sans coupure.
  chip: { backgroundColor: 'rgba(0,0,0,0.4)', borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6 },
  chipOn: { backgroundColor: COLORS.yellow },
  chipText: { fontFamily: FONTS.extraBold, fontSize: 12, letterSpacing: 0.2, color: '#fff' },
  chipTextOn: { color: COLORS.onAccent },
  endCard: { alignItems: 'center', justifyContent: 'center', gap: 14, backgroundColor: '#0d0d12', paddingHorizontal: 40 },
  endTitle: { color: '#fff', fontSize: 22, fontFamily: FONTS.extraBold },
  endMsg: { color: 'rgba(255,255,255,0.7)', fontFamily: FONTS.regular, fontSize: 14, textAlign: 'center' },
});
