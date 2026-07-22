import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  FlatList,
  Image as RNImage,
  ActivityIndicator,
  Platform,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ViewToken,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { api, tmdbImage } from '@/lib/api';
import { COLORS, FONTS, RADIUS, SHADOW, SIZES, SPACE } from '@/lib/theme';
import { EmptyState, LoadError, Loading } from '@/components/ui';
import { useTabResetSeq } from '@/lib/tabReset';
import { TikTokCard } from './TikTokCard';
import { CommentsSheet } from './CommentsSheet';
import { PullToRefreshView } from './PullToRefreshView';
import { useResolveMedia } from './useResolveMedia';
import { feedItemKey as keyOf, useFeedSessionStore } from './feedSession';
import { FEED_CATEGORIES, catOf, type FeedCategory, type FeedItem } from './types';

// `scroll-snap-stop: always` : amélioration progressive du snap web. En théorie
// il force l'arrêt à CHAQUE carte ; en pratique Chromium l'ignore pendant
// l'inertie d'un fling (reproduit en local) — la vraie garde « 1 carte » est la
// borne JS plus bas. On le pose quand même : gratuit, et honoré par les moteurs
// qui le supportent (Safari, Firefox). Ciblé sur le sous-arbre du feed via le
// marqueur `data-feed-snap` (posé sur la vue racine).
let snapStopInjected = false;
function ensureSnapStopStyle(): void {
  if (snapStopInjected || typeof document === 'undefined') return;
  snapStopInjected = true;
  const el = document.createElement('style');
  el.setAttribute('data-feed-snap-stop', '');
  el.textContent = '[data-feed-snap] * { scroll-snap-stop: always; }';
  document.head.appendChild(el);
}

export function TikTokFeed({ topInset = 0 }: { topInset?: number }) {
  const queryClient = useQueryClient();
  const resolveMedia = useResolveMedia();
  const listRef = useRef<FlatList<FeedItem>>(null);
  const scrollY = useRef(0); // offset vertical courant du flux (pour le pull-to-refresh web+natif)

  // Garde « une seule carte par swipe » — WEB uniquement (retour Étienne
  // 2026-07-21). Le natif s'appuie sur pagingEnabled + disableIntervalMomentum ;
  // sur web, RNW n'émet QUE onScroll (pas de phase drag/momentum) et Chromium
  // ignore `scroll-snap-stop` pendant l'inertie → un fling fort saute plusieurs
  // cartes. On borne donc chaque geste à ±1 carte autour d'une « ancre » (carte
  // de départ) : dès que l'inertie dépasse la carte voisine, on la fige sur la
  // frontière. `anchorRef` est (re)calé au toucher et à la stabilisation ;
  // `suppressClampUntil` neutralise la garde pendant nos défilements
  // programmatiques (avance, tirage, restauration de position).
  const anchorRef = useRef(0);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressClampUntil = useRef(0);

  // Session d'onglet (position + choix optimistes), module-scope : survit aux
  // remontages (fiche, recherche, masquage d'onglet). Un re-tap de l'onglet
  // Explorer bump `resetSeq` → session d'un ancien tirage : on repart de zéro
  // AVANT d'initialiser cat/index (synchrone, idempotent).
  const resetSeq = useTabResetSeq('explore');
  if (useFeedSessionStore.getState().seq !== resetSeq) {
    useFeedSessionStore.getState().reset(resetSeq);
  }

  const [height, setHeight] = useState(0);
  const [cat, setCatState] = useState<FeedCategory>(() => useFeedSessionStore.getState().cat);
  const setCat = useCallback((c: FeedCategory) => {
    setCatState(c);
    useFeedSessionStore.getState().setCat(c); // nouvelle liste → position repart en haut
  }, []);
  const [extra, setExtra] = useState<FeedItem[]>([]); // pages ajoutées (flux infini)
  const [commentsFor, setCommentsFor] = useState<FeedItem | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [commentBumps, setCommentBumps] = useState<Record<string, number>>({}); // +commentaires publiés par carte
  const [endRefreshing, setEndRefreshing] = useState(false); // carte de fin atteinte → nouveau tirage
  const dryRef = useRef(0); // nombre de fetchs consécutifs sans nouveauté
  const endBusy = useRef(false); // anti double-déclenchement du tirage de fin

  // Deck FIGÉ tant que l'utilisateur ne demande pas de nouveau tirage
  // (pull-to-refresh, carte de fin, re-clic sur l'onglet Explorer) : chaque
  // refetch renvoie un deck ENTIÈREMENT NEUF (mémoire d'impressions côté
  // serveur) — un refetch silencieux (refocus fenêtre, remontage après 30 min)
  // ramenait donc l'utilisateur en haut d'un nouveau deck en perdant ses choix.
  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
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
  // Hauteur courante, lue par le repositionnement au refocus (callback stable).
  const heightRef = useRef(height);
  heightRef.current = height;

  // Position restaurée AU REFOCUS de l'onglet : sur web, enableScreens(true)
  // passe l'écran inactif en display:none — le conteneur de scroll perd son
  // scrollTop (remis à 0 par le navigateur) au retour d'une fiche ou d'un
  // autre onglet, alors que le composant reste monté. On resnappe la liste sur
  // la carte sauvegardée (index borné : le deck a pu changer). Inoffensif en
  // natif / quand la position est déjà bonne (scroll non animé, même offset).
  useFocusEffect(
    useCallback(() => {
      const raf = requestAnimationFrame(() => {
        const d = deckRef.current;
        const h = heightRef.current;
        if (d.length === 0 || h <= 0) return;
        const idx = Math.max(0, Math.min(useFeedSessionStore.getState().index, d.length - 1));
        scrollY.current = idx * h; // le pull-to-refresh ne doit capter qu'en haut
        anchorRef.current = idx; // recale l'ancre de la garde « 1 carte »
        suppressClampUntil.current = Date.now() + 500; // saut programmatique : ne pas brider
        listRef.current?.scrollToIndex({ index: idx, animated: false });
      });
      return () => cancelAnimationFrame(raf);
    }, []),
  );

  // Injection unique de la règle scroll-snap-stop (web only) + nettoyage du
  // minuteur de stabilisation de la garde « 1 carte ».
  useEffect(() => {
    if (Platform.OS === 'web') ensureSnapStopStyle();
    return () => {
      if (settleTimer.current) clearTimeout(settleTimer.current);
    };
  }, []);

  // Neutralise la garde « 1 carte » le temps d'un défilement programmatique et
  // recale l'ancre sur la carte visée (web only ; no-op ailleurs).
  const markProgrammatic = useCallback((index: number) => {
    anchorRef.current = index;
    suppressClampUntil.current = Date.now() + 500;
  }, []);

  // Cœur de la garde : appelée à chaque onScroll (web). Recale l'ancre à la
  // stabilisation ; tant qu'un geste est en cours, borne l'offset à ±1 carte.
  const clampOneCard = useCallback(
    (offsetY: number) => {
      if (Platform.OS !== 'web' || height <= 0) return;
      // Débounce de stabilisation : quand le défilement se calme (~140 ms sans
      // event), l'ancre devient la carte réellement affichée.
      if (settleTimer.current) clearTimeout(settleTimer.current);
      settleTimer.current = setTimeout(() => {
        anchorRef.current = Math.round(scrollY.current / height);
      }, 140);
      if (Date.now() < suppressClampUntil.current) return; // saut programmatique
      const hi = (anchorRef.current + 1) * height;
      const lo = (anchorRef.current - 1) * height;
      if (offsetY > hi + 1) {
        listRef.current?.scrollToOffset({ offset: hi, animated: false });
      } else if (offsetY < lo - 1) {
        listRef.current?.scrollToOffset({ offset: Math.max(0, lo), animated: false });
      }
    },
    [height],
  );

  const invalidateLibrary = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['shows'] });
    queryClient.invalidateQueries({ queryKey: ['movies'] });
    queryClient.invalidateQueries({ queryKey: ['profile'] });
    queryClient.invalidateQueries({ queryKey: ['games', 'library'] });
    // Fiches détaillées (clés SINGULIER : ['show', id] / ['movie', id] /
    // ['game', id]) : sans cette invalidation, une fiche déjà en cache gardait
    // l'ancien statut après un « Déjà vu »/« À voir » posé depuis l'Explorer.
    queryClient.invalidateQueries({ queryKey: ['show'] });
    queryClient.invalidateQueries({ queryKey: ['movie'] });
    queryClient.invalidateQueries({ queryKey: ['game'] });
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
    // Mémorise la carte courante (session module-scope) — restaurée au
    // remontage/refocus. `null` = carte de fin (footer hors data) : on garde
    // la dernière position connue.
    if (typeof viewableItems[0]?.index === 'number') {
      useFeedSessionStore.getState().setIndex(viewableItems[0].index);
    }
    const d = deckRef.current;
    for (let i = idx + 1; i <= idx + 2; i++) {
      const it = d[i];
      // On préchauffe l'affiche (ce que montre la carte) en taille correcte.
      const uri = it && (tmdbImage(it.posterPath, 'w780') ?? tmdbImage(it.backdropPath, 'w780'));
      if (uri) RNImage.prefetch(uri);
    }
  }).current;

  // Tirer-pour-actualiser : nouveau tirage complet, on repart du haut — la
  // session (position + overrides optimistes) est purgée : le nouveau deck
  // exclut ce qui vient d'entrer en bibliothèque, les overrides seraient orphelins.
  const onRefresh = useCallback(async () => {
    dryRef.current = 0;
    setExtra([]);
    useFeedSessionStore.getState().clearDeck();
    await (isGames ? gamesQuery.refetch() : refetch());
    markProgrammatic(0);
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, [refetch, isGames, gamesQuery, markProgrammatic]);

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
      if (next < deck.length) {
        markProgrammatic(next);
        listRef.current?.scrollToIndex({ index: next, animated: true });
      }
    },
    [deck.length, markProgrammatic],
  );

  const refreshing = isGames ? gamesQuery.isRefetching : isRefetching;
  const failed = isGames
    ? gamesQuery.isError && !gamesQuery.data
    : isError && !data;
  if (isGames ? gamesQuery.isLoading : isLoading) return <Loading />;

  return (
    <View
      style={styles.wrap}
      onLayout={(e) => setHeight(e.nativeEvent.layout.height)}
      {...(Platform.OS === 'web' ? { dataSet: { feedSnap: 'y' } } : {})}
    >
      {/* Arrière-plan FIGÉ (retour Étienne 2026-07-21) : le fond sombre + les
          formes Prisme vivent ici, derrière la liste — ils ne défilent jamais.
          Seules les affiches (dans chaque carte) glissent au-dessus. */}
      <View style={styles.fixedBg} pointerEvents="none">
        <View style={styles.prismPrimary} />
        <View style={styles.prismSecondary} />
      </View>
      {height > 0 && failed ? (
        <View style={styles.stateWrap}>
          <LoadError onRetry={() => void onRefresh()} busy={refreshing} />
        </View>
      ) : height > 0 && deck.length > 0 ? (
        <PullToRefreshView refreshing={refreshing} onRefresh={onRefresh} scrollYRef={scrollY}>
          <FlatList
            ref={listRef}
            data={deck}
            keyExtractor={keyOf}
            pagingEnabled
            // Natif : coupe le momentum au-delà d'une page → une seule carte par
            // swipe même lancé fort (pendant sur web = scroll-snap-stop, cf. haut).
            disableIntervalMomentum
            showsVerticalScrollIndicator={false}
            accessibilityLabel="Suggestions personnalisées"
            decelerationRate="fast"
            getItemLayout={(_, index) => ({ length: height, offset: height * index, index })}
            // Remontage complet (détour par la recherche — FadeSwitch — ou
            // re-tap de l'onglet) : on repart sur la carte sauvegardée (0 après
            // un reset volontaire). Index borné : le deck a pu raccourcir
            // (pages « extra » du flux infini perdues au remontage).
            initialScrollIndex={Math.max(0, Math.min(useFeedSessionStore.getState().index, deck.length - 1))}
            initialNumToRender={2}
            maxToRenderPerBatch={3}
            windowSize={3}
            scrollEventThrottle={16}
            // Web : un toucher démarre un geste → l'ancre de la garde « 1 carte »
            // devient la carte actuellement affichée (no-op en natif).
            onTouchStart={() => {
              if (Platform.OS === 'web' && height > 0) anchorRef.current = Math.round(scrollY.current / height);
            }}
            onScroll={(e: NativeSyntheticEvent<NativeScrollEvent>) => {
              scrollY.current = e.nativeEvent.contentOffset.y;
              maybeEndRefresh(e.nativeEvent.contentOffset.y);
              clampOneCard(e.nativeEvent.contentOffset.y);
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
                topInset={topInset}
                resolveMedia={resolveMedia}
                onOpenComments={setCommentsFor}
                onAdvance={() => advance(index)}
                onInvalidateLibrary={invalidateLibrary}
                commentBump={commentBumps[keyOf(item)] ?? 0}
              />
            )}
            ListFooterComponent={
              loadingMore ? (
                <ActivityIndicator style={styles.moreLoader} color={COLORS.primary} />
              ) : (
                // Carte de fin plein écran : y snapper déclenche un nouveau
                // tirage (maybeEndRefresh) et ramène en haut du flux.
                <View style={[styles.endCard, { height }]}>
                  <View style={styles.endGlowPrimary} pointerEvents="none" />
                  <View style={styles.endGlowSecondary} pointerEvents="none" />
                  <View style={styles.endIcon}>
                    {endRefreshing ? (
                      <ActivityIndicator color={COLORS.onPrimary} size="large" />
                    ) : (
                      <Feather name="refresh-cw" size={30} color={COLORS.onPrimary} />
                    )}
                  </View>
                  <Text style={styles.endEyebrow}>NOUVELLE SÉLECTION</Text>
                  <Text style={styles.endTitle}>Vous avez parcouru ce tirage.</Text>
                  <Text style={styles.endMsg}>
                    {endRefreshing ? 'Préparation de nouvelles idées…' : 'Continuez à glisser pour renouveler les suggestions.'}
                  </Text>
                </View>
              )
            }
          />
        </PullToRefreshView>
      ) : height > 0 ? (
        <View style={styles.emptyWrap}>
          <EmptyState
            title="Aucune suggestion pour le moment"
            message="Changez de catégorie ou lancez un nouveau tirage."
          />
          <Pressable
            style={({ pressed }) => [styles.refreshButton, pressed && styles.refreshButtonPressed]}
            onPress={() => void onRefresh()}
            disabled={refreshing}
            accessibilityRole="button"
            accessibilityLabel="Lancer un nouveau tirage"
            accessibilityState={{ busy: refreshing, disabled: refreshing }}
          >
            {refreshing ? (
              <ActivityIndicator size="small" color={COLORS.onPrimary} />
            ) : (
              <Feather name="refresh-cw" size={17} color={COLORS.onPrimary} />
            )}
            <Text style={styles.refreshButtonText}>NOUVEAU TIRAGE</Text>
          </Pressable>
        </View>
      ) : null}

      {/* Filtres catégories, en surimpression : posés SOUS la barre de recherche
          flottante (topInset = sa hauteur mesurée dans explore.tsx). */}
      <View style={[styles.top, { top: topInset }]} pointerEvents="box-none">
        <FlatList
          data={FEED_CATEGORIES}
          keyExtractor={(c) => c.key}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsContent}
          renderItem={({ item: c }) => (
            <Pressable
              style={({ pressed }) => [
                styles.chip,
                cat === c.key && styles.chipOn,
                pressed && styles.chipPressed,
              ]}
              onPress={() => {
                setCat(c.key);
                markProgrammatic(0);
                listRef.current?.scrollToOffset({ offset: 0, animated: false });
              }}
              accessibilityRole="tab"
              accessibilityLabel={`Afficher les suggestions ${c.label.toLocaleLowerCase('fr-FR')}`}
              accessibilityState={{ selected: cat === c.key }}
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
  wrap: { flex: 1, overflow: 'hidden', backgroundColor: '#0D0A14' },
  // Couche de fond FIXE (ne défile pas) : formes Prisme sur le noir du `wrap`.
  fixedBg: { ...StyleSheet.absoluteFillObject },
  prismPrimary: {
    position: 'absolute',
    top: 120,
    left: -48,
    width: 150,
    height: 150,
    backgroundColor: COLORS.primary,
    borderRadius: 34,
    opacity: 0.3,
    transform: [{ rotate: '24deg' }],
  },
  prismSecondary: {
    position: 'absolute',
    right: -46,
    bottom: 150,
    width: 138,
    height: 138,
    backgroundColor: COLORS.secondary,
    borderRadius: 69,
    opacity: 0.22,
  },
  stateWrap: {
    flex: 1,
    justifyContent: 'center',
    paddingTop: 48,
    backgroundColor: COLORS.pageMuted,
  },
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 48,
    paddingBottom: SPACE.lg,
    backgroundColor: COLORS.pageMuted,
  },
  top: {
    position: 'absolute',
    // `top` posé en ligne (= hauteur de la barre de recherche flottante).
    left: 0,
    right: 0,
    zIndex: 10,
    paddingTop: SPACE.xs,
    paddingBottom: SPACE.xs,
  },
  chipsContent: {
    gap: 6,
    paddingHorizontal: SPACE.sm,
  },
  chip: {
    minHeight: SIZES.touch,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACE.sm,
    backgroundColor: 'rgba(13,10,20,0.68)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.34)',
    borderRadius: RADIUS.pill,
  },
  chipOn: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  chipPressed: { opacity: 0.76 },
  chipText: {
    color: '#FFFFFF',
    fontFamily: FONTS.extraBold,
    fontSize: 11,
    letterSpacing: 0.45,
  },
  chipTextOn: { color: COLORS.onPrimary },
  moreLoader: { marginVertical: SPACE.lg },
  endCard: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACE.sm,
    overflow: 'hidden',
    paddingHorizontal: SPACE.xl,
    backgroundColor: '#0D0A14',
  },
  endGlowPrimary: {
    position: 'absolute',
    top: -80,
    right: -90,
    width: 280,
    height: 280,
    backgroundColor: COLORS.primary,
    borderRadius: 140,
    opacity: 0.2,
  },
  endGlowSecondary: {
    position: 'absolute',
    bottom: -100,
    left: -100,
    width: 260,
    height: 260,
    backgroundColor: COLORS.secondary,
    borderRadius: 130,
    opacity: 0.16,
  },
  endIcon: {
    width: 64,
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACE.xs,
    backgroundColor: COLORS.primary,
    borderRadius: 32,
    ...SHADOW.card,
  },
  endEyebrow: {
    color: COLORS.secondary,
    fontFamily: FONTS.extraBold,
    fontSize: 11,
    letterSpacing: 1.2,
  },
  endTitle: {
    maxWidth: 360,
    color: '#FFFFFF',
    fontSize: 25,
    lineHeight: 31,
    fontFamily: FONTS.extraBold,
    textAlign: 'center',
  },
  endMsg: {
    maxWidth: 360,
    color: 'rgba(255,255,255,0.76)',
    fontFamily: FONTS.regular,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
  },
  refreshButton: {
    minHeight: SIZES.touchComfortable,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACE.xs,
    paddingHorizontal: SPACE.lg,
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.pill,
    ...SHADOW.card,
  },
  refreshButtonPressed: { opacity: 0.8 },
  refreshButtonText: {
    color: COLORS.onPrimary,
    fontFamily: FONTS.extraBold,
    fontSize: 12,
    letterSpacing: 0.5,
  },
});
