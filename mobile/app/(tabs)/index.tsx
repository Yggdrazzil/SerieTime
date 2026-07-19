import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Image, ActivityIndicator, RefreshControl, Platform } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, tmdbImage } from '@/lib/api';
import type { EpisodeDto, MediaDto, QueueItemDto, UpcomingItemDto } from '@/lib/types';
import { queueGroupLabel, episodeCode, airTimeLabel } from '@/lib/format';
import { COLORS, SHADOW, FONTS, RADIUS, SPACE, SIZES } from '@/lib/theme';
import { PillHeader, EmptyState, LoadError, ShowPill, Badge, CheckCircle } from '@/components/ui';
import { EpisodeQueueCard } from '@/components/EpisodeQueueCard';
import { EpisodeSheet, type EpisodeSheetTarget } from '@/components/EpisodeSheet';
import { useTabResetSeq } from '@/lib/tabReset';
import { AppearItem } from '@/components/anim';
import { useFloatingSection, FloatingSectionPill } from '@/components/FloatingSection';
import { QueueSkeleton } from '@/components/skeletons';
import { usePullRefresh } from '@/lib/usePullRefresh';

export default function ShowsScreen() {
  const insets = useSafeAreaInsets();
  // Re-clic sur Accueil : le remontage rejoue le scroll initial de la file.
  const resetSeq = useTabResetSeq('index');
  return (
    <View key={resetSeq} style={{ flex: 1, backgroundColor: COLORS.pageMuted }}>
      <View style={[styles.homeHeader, { paddingTop: insets.top + 12 }]}>
        <Text style={styles.homeEyebrow}>AUJOURD'HUI</Text>
        <Text accessibilityRole="header" style={styles.homeTitle}>À voir</Text>
        <Text style={styles.homeSubtitle}>Reprenez exactement là où vous en étiez.</Text>
      </View>
      <QueueView />
    </View>
  );
}

type HistoryItem = { media: MediaDto; episode: EpisodeDto; watchedAt: string | null };

function QueueView() {
  const qc = useQueryClient();
  // L'historique est masqué au-dessus de la liste : on cale le scroll initial
  // juste en dessous, il se découvre en faisant défiler vers le haut (TV Time).
  const scrollRef = useRef<ScrollView>(null);
  const didInitialScroll = useRef(false);
  // Fenêtre « fiche épisode » (swipe latéral entre épisodes, façon TV Time).
  const [sheet, setSheet] = useState<EpisodeSheetTarget | null>(null);
  // Pastille de section FLOTTANTE (mécanique partagée, cf. FloatingSection).
  const { registerSection, onListScroll, floatLabel } = useFloatingSection();
  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['shows', 'queue'],
    queryFn: () => api.get<{ items: QueueItemDto[] }>('/api/shows/queue'),
  });
  const history = useQuery({
    queryKey: ['shows', 'history'],
    queryFn: () => api.get<{ items: HistoryItem[] }>('/api/shows/history'),
  });
  // Marquer l'épisode « à voir » comme vu : mise à jour optimiste — la carte
  // disparaît (ou avance) immédiatement, l'appel réseau suit (rollback si échec).
  const mark = useMutation({
    mutationFn: (episodeId: string) => api.post(`/api/episodes/${episodeId}/watched`),
    onMutate: async (episodeId: string) => {
      await qc.cancelQueries({ queryKey: ['shows', 'queue'] });
      const prev = qc.getQueryData<{ items: QueueItemDto[] }>(['shows', 'queue']);
      if (prev) {
        qc.setQueryData<{ items: QueueItemDto[] }>(['shows', 'queue'], {
          items: prev.items.filter((it) => it.nextEpisode?.id !== episodeId),
        });
      }
      return { prev };
    },
    onError: (_e: unknown, _id: string, ctx?: { prev?: { items: QueueItemDto[] } }) => {
      if (ctx?.prev) qc.setQueryData(['shows', 'queue'], ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['shows'] });
      qc.invalidateQueries({ queryKey: ['profile'] });
      qc.invalidateQueries({ queryKey: ['gamification'] }); // XP/badges/streak (spec 2026-07-16 §10)
    },
  });
  // Décocher depuis l'historique : l'épisode redevient « à voir ». Mise à jour
  // OPTIMISTE : la rangée disparaît de l'historique immédiatement.
  const unmark = useMutation({
    mutationFn: (episodeId: string) => api.post(`/api/episodes/${episodeId}/unwatched`),
    onMutate: async (episodeId: string) => {
      await qc.cancelQueries({ queryKey: ['shows', 'history'] });
      const prev = qc.getQueryData<{ items: HistoryItem[] }>(['shows', 'history']);
      if (prev) {
        qc.setQueryData<{ items: HistoryItem[] }>(['shows', 'history'], {
          items: prev.items.filter((it) => it.episode.id !== episodeId),
        });
      }
      return { prev };
    },
    onError: (_e: unknown, _id: string, ctx?: { prev?: { items: HistoryItem[] } }) => {
      if (ctx?.prev) qc.setQueryData(['shows', 'history'], ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['shows'] });
      qc.invalidateQueries({ queryKey: ['profile'] });
      qc.invalidateQueries({ queryKey: ['gamification'] }); // XP/badges/streak (spec 2026-07-16 §10)
    },
  });

  const { refreshing, onRefresh } = usePullRefresh([refetch, history.refetch]);

  // Anti-flash : l'historique est rendu AU-DESSUS de « À voir » puis le scroll
  // se cale en dessous — entre les deux, l'utilisateur voyait l'historique une
  // fraction de seconde (persistait en prod : l'historique peut arriver du
  // réseau APRÈS le premier rendu, l'ancien garde-fou 700 ms avait déjà
  // démasqué). Correctif racine, web : useLayoutEffect tourne APRÈS l'insertion
  // de l'historique dans le DOM mais AVANT la peinture du navigateur → le
  // scrollTop est posé avant qu'aucune frame ne montre l'historique, quel que
  // soit le moment où il arrive. Natif : onLayout + masque (comme avant).
  const [settled, setSettled] = useState(false);
  const historyWrapRef = useRef<View | null>(null);
  const historyCount = history.data?.items?.length ?? 0;
  useLayoutEffect(() => {
    if (Platform.OS !== 'web' || didInitialScroll.current) return;
    const node = historyWrapRef.current as unknown as HTMLElement | null;
    const scroller = (scrollRef.current as unknown as { getScrollableNode?: () => HTMLElement } | null)?.getScrollableNode?.();
    if (node && node.offsetHeight > 0) {
      didInitialScroll.current = true;
      if (scroller) scroller.scrollTop = node.offsetHeight;
      else scrollRef.current?.scrollTo({ y: node.offsetHeight, animated: false });
      setSettled(true); // flush synchrone avant la peinture (React 18)
    }
  }); // sans dépendances : rejoue à chaque commit tant que le calage n'est pas fait
  useEffect(() => {
    if (settled) return;
    if ((history.isSuccess && historyCount === 0) || history.isError) setSettled(true);
    // Ceinture et bretelles (surtout natif) : jamais masqué plus de 2,5 s.
    const t = setTimeout(() => setSettled(true), 2500);
    return () => clearTimeout(t);
  }, [settled, history.isSuccess, history.isError, historyCount]);

  if (isLoading) return <QueueSkeleton />;
  if (isError && !data) return <LoadError onRetry={refetch} busy={isRefetching} />;
  // Du plus ancien au plus récent : le dernier épisode coché juste au-dessus
  // de la section « À voir » (cf. TV Time).
  const historyItems = [...(history.data?.items ?? [])].reverse();
  if ((!data || data.items.length === 0) && historyItems.length === 0)
    return (
      <EmptyState
        title="Rien à voir pour le moment"
        message="Ajoutez des séries depuis Explorer ou importez vos données TV Time."
      />
    );

  const groups = new Map<string, QueueItemDto[]>();
  (data?.items ?? []).forEach((it) => groups.set(it.group, [...(groups.get(it.group) ?? []), it]));

  return (
    <View style={{ flex: 1 }}>
    <ScrollView
      ref={scrollRef}
      // Masqué SEULEMENT quand un historique est rendu sans être encore calé :
      // pendant son chargement, la file « À voir » s'affiche normalement.
      style={{ opacity: settled || historyItems.length === 0 ? 1 : 0 }}
      contentContainerStyle={styles.queueContent}
      onScroll={onListScroll}
      scrollEventThrottle={16}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} colors={[COLORS.primary]} />}
    >
      {historyItems.length > 0 ? (
        <View
          ref={historyWrapRef}
          style={styles.queueColumn}
          onLayout={(e) => {
            registerSection('Historique de visionnage')(e);
            // Une fois l'historique mesuré, on cale le scroll juste en dessous
            // pour ouvrir l'écran sur « À voir » (l'historique reste au-dessus) ;
            // la liste ne devient visible qu'une fois le scroll appliqué.
            const h = e.nativeEvent.layout.height;
            if (!didInitialScroll.current && h > 0) {
              didInitialScroll.current = true;
              scrollRef.current?.scrollTo({ y: h, animated: false });
              requestAnimationFrame(() => setSettled(true));
            }
          }}
        >
          <PillHeader label="Historique de visionnage" />
          {historyItems.map((it) => (
            <EpisodeQueueCard
              key={`h-${it.episode.id}`}
              item={{ group: 'a_voir', media: it.media, nextEpisode: it.episode, remainingCount: 0, badges: [] }}
              watched
              onCheck={() => unmark.mutate(it.episode.id)}
              onOpenEpisode={() =>
                setSheet({ mediaId: it.media.id, mediaTitle: it.media.title, posterPath: it.media.posterPath, episode: it.episode })
              }
            />
          ))}
        </View>
      ) : null}
      {(() => {
        // Index continu à travers les groupes pour une entrée en cascade.
        let n = -1;
        return [...groups.entries()].map(([group, items]) => (
          <View key={group} style={styles.queueColumn} onLayout={registerSection(queueGroupLabel(group))}>
            <PillHeader label={queueGroupLabel(group)} />
            {items.map((item) => {
              n += 1;
              return (
                <AppearItem key={item.media.id} index={n}>
                  <EpisodeQueueCard
                    item={item}
                    onCheck={() => item.nextEpisode && mark.mutate(item.nextEpisode.id)}
                    onOpenEpisode={
                      item.nextEpisode
                        ? () =>
                            setSheet({
                              mediaId: item.media.id,
                              mediaTitle: item.media.title,
                              posterPath: item.media.posterPath,
                              episode: item.nextEpisode!,
                            })
                        : undefined
                    }
                  />
                </AppearItem>
              );
            })}
          </View>
        ));
      })()}
    </ScrollView>

      {/* Pastille de section flottante (façon TV Time) : suit le défilement,
          change de libellé au passage d'une section, rebond à l'apparition. */}
      <FloatingSectionPill label={floatLabel} />

      <EpisodeSheet target={sheet} onClose={() => setSheet(null)} />
    </View>
  );
}

export function UpcomingView() {
  // Historique des sorties (HIER, AVANT-HIER…) masqué au-dessus de la liste,
  // comme l'historique de visionnage de « À voir » : le scroll initial se cale
  // sur AUJOURD'HUI, on remonte pour rattraper une sortie manquée.
  const scrollRef = useRef<ScrollView>(null);
  const didInitialScroll = useRef(false);
  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['shows', 'upcoming'],
    queryFn: () =>
      api.get<{
        groups: { label: string; items: UpcomingItemDto[] }[];
        past?: { label: string; items: UpcomingItemDto[] }[];
      }>('/api/shows/upcoming'),
  });
  const { refreshing, onRefresh } = usePullRefresh([refetch]);
  // Anti-flash (même mécanique que « À voir ») : web = scrollTop posé avant
  // la peinture (useLayoutEffect), natif = onLayout + masque.
  const [settled, setSettled] = useState(false);
  const pastWrapRef = useRef<View | null>(null);
  const pastCount = data?.past?.length ?? 0;
  useLayoutEffect(() => {
    if (Platform.OS !== 'web' || didInitialScroll.current) return;
    const node = pastWrapRef.current as unknown as HTMLElement | null;
    const scroller = (scrollRef.current as unknown as { getScrollableNode?: () => HTMLElement } | null)?.getScrollableNode?.();
    if (node && node.offsetHeight > 0) {
      didInitialScroll.current = true;
      if (scroller) scroller.scrollTop = node.offsetHeight;
      else scrollRef.current?.scrollTo({ y: node.offsetHeight, animated: false });
      setSettled(true);
    }
  });
  useEffect(() => {
    if (settled) return;
    if (data && pastCount === 0) setSettled(true);
    const t = setTimeout(() => setSettled(true), 2500);
    return () => clearTimeout(t);
  }, [settled, data, pastCount]);
  if (isLoading) return <QueueSkeleton />;
  if (isError && !data) return <LoadError onRetry={refetch} busy={isRefetching} />;
  const pastGroups = data?.past ?? [];
  if (!data || (data.groups.length === 0 && pastGroups.length === 0))
    return <EmptyState title="Aucun épisode à venir" message="Les prochaines diffusions apparaîtront ici." />;

  return (
    <ScrollView
      ref={scrollRef}
      style={{ opacity: settled || pastGroups.length === 0 ? 1 : 0 }}
      contentContainerStyle={styles.agendaContent}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} colors={[COLORS.primary]} />}
    >
      {pastGroups.length > 0 ? (
        <View
          ref={pastWrapRef}
          style={styles.agendaPastWrap}
          onLayout={(e) => {
            const h = e.nativeEvent.layout.height;
            if (!didInitialScroll.current && h > 0) {
              didInitialScroll.current = true;
              scrollRef.current?.scrollTo({ y: h, animated: false });
              requestAnimationFrame(() => setSettled(true));
            }
          }}
        >
          {pastGroups.map((g) => (
            <View key={`p-${g.label}`} style={styles.agendaGroup}>
              <PillHeader label={g.label} />
              {g.items.map((item) => (
                <UpcomingCard key={`${item.media.id}-${item.date}`} item={item} past />
              ))}
            </View>
          ))}
        </View>
      ) : null}
      {data.groups.map((g) => (
        <View key={g.label} style={styles.agendaGroup}>
          <PillHeader label={g.label} />
          {g.items.map((item) => (
            <UpcomingCard key={`${item.media.id}-${item.date}`} item={item} />
          ))}
        </View>
      ))}
    </ScrollView>
  );
}

function UpcomingCard({ item, past = false }: { item: UpcomingItemDto; past?: boolean }) {
  const router = useRouter();
  const ep = item.episodes[0];
  if (!ep) return null;
  const isPremiere = ep.seasonNumber >= 1 && ep.episodeNumber === 1;
  // Vignette : image de l'épisode si déjà publiée, sinon affiche de la série.
  const thumbUri = tmdbImage(ep.stillPath, 'w300') ?? tmdbImage(item.media.posterPath, 'w342');
  const air = airTimeLabel(ep.airDate);
  const accessibilityLabel = [
    item.media.title,
    episodeCode(ep.seasonNumber, ep.episodeNumber),
    ep.title,
    air ? `à ${air}` : null,
    ep.network ?? null,
    isPremiere ? 'Première' : null,
    item.episodes.length > 1 ? `${item.episodes.length} épisodes` : null,
  ].filter(Boolean).join(', ');

  return (
    <Pressable
      style={({ pressed }) => [styles.upcard, past && styles.upcardPast, pressed && styles.upcardPressed]}
      onPress={() => router.push(`/show/${item.media.id}`)}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={"Ouvre la fiche de la s\u00e9rie"}
    >
      {thumbUri ? (
        <Image source={{ uri: thumbUri }} style={[styles.thumb, past && styles.thumbPast]} resizeMode="cover" accessible={false} />
      ) : (
        <View style={[styles.thumb, past && styles.thumbPast]} accessible={false}>
          <Feather name="image" size={26} color={COLORS.textSoft} />
        </View>
      )}
      <View style={styles.body}>
        <View style={styles.topRow}>
          <View style={{ flexShrink: 1 }}>
            <ShowPill label={item.media.title} onPress={() => router.push(`/show/${item.media.id}`)} />
          </View>
          {air || ep.network ? (
            <View style={styles.schedule}>
              {air ? <Text style={styles.time}>{air}</Text> : null}
              {ep.network ? <Text style={styles.ch}>{ep.network}</Text> : null}
            </View>
          ) : null}
        </View>
        <Text style={styles.code}>{episodeCode(ep.seasonNumber, ep.episodeNumber)}</Text>
        <Text style={styles.epTitle} numberOfLines={1}>
          {ep.title}
        </Text>
        {isPremiere ? (
          <View style={styles.badgeRow}>
            <Badge label="PREMIERE" variant="black" />
          </View>
        ) : null}
        {item.episodes.length > 1 ? (
          <Text style={styles.multi}>{item.episodes.length} épisodes</Text>
        ) : null}
      </View>
    </Pressable>
  );
}

// Carte chronologique compacte : hiérarchie Studio dans le shell Prisme.
const styles = StyleSheet.create({
  homeHeader: {
    backgroundColor: COLORS.white,
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.borderLight,
  },
  homeEyebrow: {
    color: COLORS.primary,
    fontFamily: FONTS.bold,
    fontSize: 11,
    letterSpacing: 1.2,
  },
  homeTitle: { color: COLORS.text, fontFamily: FONTS.extraBold, fontSize: 30, lineHeight: 36 },
  homeSubtitle: { color: COLORS.textMuted, fontFamily: FONTS.regular, fontSize: 13, marginTop: 2 },
  // File « À voir » : contenu centré et borné à contentMax comme l'agenda et la
  // bibliothèque (les cartes ne s'étirent plus bord à bord sur web/tablette).
  queueContent: { alignItems: 'center', paddingBottom: 16 },
  queueColumn: { width: '100%', maxWidth: SIZES.contentMax },
  agendaContent: {
    alignItems: 'center',
    paddingTop: SPACE.xxs,
    paddingBottom: SPACE.lg,
  },
  agendaPastWrap: { width: '100%', maxWidth: SIZES.contentMax },
  agendaGroup: { width: '100%', maxWidth: SIZES.contentMax },
  upcard: {
    flexDirection: 'row',
    minHeight: 112,
    marginHorizontal: SPACE.md,
    marginBottom: SPACE.sm,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: RADIUS.card,
    overflow: 'hidden',
    ...SHADOW.card,
  },
  upcardPast: { backgroundColor: COLORS.surfaceMuted, borderColor: COLORS.border },
  upcardPressed: { opacity: 0.84 },
  thumb: {
    width: 112,
    minHeight: 112,
    backgroundColor: COLORS.imagePlaceholder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbPast: { opacity: 0.82 },
  body: { flex: 1, justifyContent: 'center', paddingHorizontal: SPACE.sm, paddingVertical: SPACE.sm, gap: SPACE.xxs },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', gap: SPACE.xs, alignItems: 'flex-start' },
  schedule: { alignItems: 'flex-end', flexShrink: 0, minHeight: SIZES.touch },
  time: { color: COLORS.text, fontSize: 13, lineHeight: 17, fontFamily: FONTS.extraBold },
  ch: {
    maxWidth: 96,
    color: COLORS.textMuted,
    fontSize: 10,
    lineHeight: 14,
    fontFamily: FONTS.bold,
    textTransform: 'uppercase',
    textAlign: 'right',
  },
  code: { color: COLORS.text, fontSize: 17, lineHeight: 22, fontFamily: FONTS.extraBold },
  epTitle: { color: COLORS.textMuted, fontFamily: FONTS.regular, fontSize: 13, lineHeight: 18 },
  badgeRow: { flexDirection: 'row', marginTop: 2 },
  multi: { color: COLORS.secondary, fontFamily: FONTS.bold, fontSize: 12, lineHeight: 16, marginTop: SPACE.xxs },
});
