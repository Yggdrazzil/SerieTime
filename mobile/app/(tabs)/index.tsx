import React, { useState, useRef, useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Image, ActivityIndicator, RefreshControl } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, tmdbImage } from '@/lib/api';
import type { EpisodeDto, MediaDto, QueueItemDto, UpcomingItemDto } from '@/lib/types';
import { queueGroupLabel, episodeCode, airTimeLabel } from '@/lib/format';
import { COLORS, SHADOW, FONTS } from '@/lib/theme';
import { PillHeader, TopTabs, EmptyState, LoadError, ShowPill, Badge, CheckCircle } from '@/components/ui';
import { EpisodeQueueCard } from '@/components/EpisodeQueueCard';
import { EpisodeSheet, type EpisodeSheetTarget } from '@/components/EpisodeSheet';
import { useTabResetSeq } from '@/lib/tabReset';
import { AppearItem, FadeSwitch } from '@/components/anim';
import { useFloatingSection, FloatingSectionPill } from '@/components/FloatingSection';
import { QueueSkeleton } from '@/components/skeletons';
import { usePullRefresh } from '@/lib/usePullRefresh';

export default function ShowsScreen() {
  const insets = useSafeAreaInsets();
  // Re-clic sur l'onglet « Séries » (barre du bas) : le remontage par `key`
  // ramène l'onglet haut par défaut (À VOIR) et rejoue le scroll initial.
  const resetSeq = useTabResetSeq('index');
  return (
    <View key={resetSeq} style={{ flex: 1, backgroundColor: COLORS.pageMuted }}>
      <ShowsScreenInner insets={insets} />
    </View>
  );
}

function ShowsScreenInner({ insets }: { insets: { top: number } }) {
  const [tab, setTab] = useState('À VOIR');
  return (
    <>
      <View style={{ paddingTop: insets.top, backgroundColor: COLORS.white }}>
        <TopTabs tabs={['À VOIR', 'À VENIR']} active={tab} onChange={setTab} />
      </View>
      <FadeSwitch trigger={tab}>{tab === 'À VOIR' ? <QueueView /> : <UpcomingView />}</FadeSwitch>
    </>
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
  // se cale en dessous (onLayout) — entre les deux, l'utilisateur voyait
  // l'historique une fraction de seconde. On masque la liste jusqu'au calage
  // (pas d'historique → rien à caler, on affiche directement).
  const [settled, setSettled] = useState(false);
  const historyCount = history.data?.items?.length ?? 0;
  useEffect(() => {
    if (settled) return;
    if ((history.isSuccess && historyCount === 0) || history.isError) setSettled(true);
    // Ceinture et bretelles : jamais plus de 700 ms masqué, quoi qu'il arrive.
    const t = setTimeout(() => setSettled(true), 700);
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
      style={{ opacity: settled ? 1 : 0 }}
      contentContainerStyle={{ paddingBottom: 16 }}
      onScroll={onListScroll}
      scrollEventThrottle={16}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.yellow} colors={[COLORS.yellow]} />}
    >
      {historyItems.length > 0 ? (
        <View
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
          <View key={group} onLayout={registerSection(queueGroupLabel(group))}>
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

function UpcomingView() {
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
  // Anti-flash (même mécanique que « À voir ») : liste masquée jusqu'au
  // calage du scroll sous l'historique des sorties passées.
  const [settled, setSettled] = useState(false);
  const pastCount = data?.past?.length ?? 0;
  useEffect(() => {
    if (settled) return;
    if (data && pastCount === 0) setSettled(true);
    const t = setTimeout(() => setSettled(true), 700);
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
      style={{ opacity: settled ? 1 : 0 }}
      contentContainerStyle={{ paddingBottom: 16 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.yellow} colors={[COLORS.yellow]} />}
    >
      {pastGroups.length > 0 ? (
        <View
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
            <View key={`p-${g.label}`} style={{ opacity: 0.82 }}>
              <PillHeader label={g.label} />
              {g.items.map((item) => (
                <UpcomingCard key={`${item.media.id}-${item.date}`} item={item} />
              ))}
            </View>
          ))}
        </View>
      ) : null}
      {data.groups.map((g) => (
        <View key={g.label}>
          <PillHeader label={g.label} />
          {g.items.map((item) => (
            <UpcomingCard key={`${item.media.id}-${item.date}`} item={item} />
          ))}
        </View>
      ))}
    </ScrollView>
  );
}

function UpcomingCard({ item }: { item: UpcomingItemDto }) {
  const router = useRouter();
  const ep = item.episodes[0];
  if (!ep) return null;
  const isPremiere = ep.seasonNumber >= 1 && ep.episodeNumber === 1;
  // Vignette : image de l'épisode si déjà publiée, sinon affiche de la série.
  const thumbUri = tmdbImage(ep.stillPath, 'w300') ?? tmdbImage(item.media.posterPath, 'w342');
  return (
    <Pressable style={styles.upcard} onPress={() => router.push(`/show/${item.media.id}`)}>
      {thumbUri ? (
        <Image source={{ uri: thumbUri }} style={styles.thumb} resizeMode="cover" />
      ) : (
        <View style={styles.thumb}>
          <Feather name="image" size={28} color="#9a9a9a" />
        </View>
      )}
      <View style={styles.body}>
        <View style={styles.topRow}>
          <View style={{ flexShrink: 1 }}>
            <ShowPill label={item.media.title} onPress={() => router.push(`/show/${item.media.id}`)} />
          </View>
          {(() => {
            const air = airTimeLabel(ep.airDate);
            return air || ep.network ? (
              <View style={{ alignItems: 'flex-end', flexShrink: 0 }}>
                {air ? <Text style={styles.time}>{air}</Text> : null}
                {ep.network ? <Text style={styles.ch}>{ep.network}</Text> : null}
              </View>
            ) : null;
          })()}
        </View>
        <Text style={styles.code}>{episodeCode(ep.seasonNumber, ep.episodeNumber)}</Text>
        <Text style={styles.epTitle} numberOfLines={1}>
          {ep.title}
        </Text>
        {isPremiere ? (
          <View style={{ flexDirection: 'row', marginTop: 2 }}>
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

// Cotes TV Time, identiques à EpisodeQueueCard (code 20, titre 13, rayon 10).
const styles = StyleSheet.create({
  upcard: {
    flexDirection: 'row', marginHorizontal: 12, marginBottom: 12, backgroundColor: COLORS.white,
    borderRadius: 10, minHeight: 96, overflow: 'hidden', ...SHADOW.card,
  },
  thumb: { width: 92, backgroundColor: COLORS.imagePlaceholder, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, justifyContent: 'center', paddingHorizontal: 12, paddingVertical: 10, gap: 5 },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' },
  time: { color: COLORS.text, fontSize: 12.5, fontFamily: FONTS.bold },
  ch: { color: COLORS.text, fontSize: 10.5, fontFamily: FONTS.bold, textTransform: 'uppercase' },
  code: { color: COLORS.text, fontSize: 17, fontFamily: FONTS.bold },
  epTitle: { color: COLORS.text, fontFamily: FONTS.regular, fontSize: 12.5 },
  multi: { color: COLORS.blue, fontFamily: FONTS.regular, fontSize: 13, marginTop: 4 },
});
