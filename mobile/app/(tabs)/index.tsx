import React, { useState } from 'react';
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
import { useTabResetSeq } from '@/lib/tabReset';
import { AppearItem, FadeSwitch } from '@/components/anim';
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
        <TopTabs tabs={['À VOIR', 'À VENIR', 'HISTORIQUE']} active={tab} onChange={setTab} />
      </View>
      <FadeSwitch trigger={tab}>
        {tab === 'À VOIR' ? <QueueView /> : tab === 'À VENIR' ? <UpcomingView /> : <HistoryView />}
      </FadeSwitch>
    </>
  );
}

type HistoryItem = { media: MediaDto; episode: EpisodeDto; watchedAt: string | null };

function QueueView() {
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['shows', 'queue'],
    queryFn: () => api.get<{ items: QueueItemDto[] }>('/api/shows/queue'),
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
    },
  });

  const { refreshing, onRefresh } = usePullRefresh([refetch]);

  if (isLoading) return <QueueSkeleton />;
  if (isError && !data) return <LoadError onRetry={refetch} busy={isRefetching} />;
  if (!data || data.items.length === 0)
    return (
      <EmptyState
        title="Rien à voir pour le moment"
        message="Ajoutez des séries depuis Explorer ou importez vos données TV Time."
      />
    );

  const groups = new Map<string, QueueItemDto[]>();
  data.items.forEach((it) => groups.set(it.group, [...(groups.get(it.group) ?? []), it]));

  return (
    <ScrollView
      contentContainerStyle={{ paddingBottom: 16 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.yellow} colors={[COLORS.yellow]} />}
    >
      {(() => {
        // Index continu à travers les groupes pour une entrée en cascade.
        let n = -1;
        return [...groups.entries()].map(([group, items]) => (
          <View key={group}>
            <PillHeader label={queueGroupLabel(group)} />
            {items.map((item) => {
              n += 1;
              return (
                <AppearItem key={item.media.id} index={n}>
                  <EpisodeQueueCard
                    item={item}
                    onCheck={() => item.nextEpisode && mark.mutate(item.nextEpisode.id)}
                  />
                </AppearItem>
              );
            })}
          </View>
        ));
      })()}
    </ScrollView>
  );
}

// Onglet HISTORIQUE : les épisodes déjà vus (les plus récents en haut). Décocher
// un épisode le renvoie dans « À voir ». Sorti de « À voir » pour ne plus la
// polluer, surtout après un gros import.
function HistoryView() {
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['shows', 'history'],
    queryFn: () => api.get<{ items: HistoryItem[] }>('/api/shows/history'),
  });
  const unmark = useMutation({
    mutationFn: (episodeId: string) => api.post(`/api/episodes/${episodeId}/unwatched`),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['shows'] });
      qc.invalidateQueries({ queryKey: ['profile'] });
    },
  });
  const { refreshing, onRefresh } = usePullRefresh([refetch]);

  if (isLoading) return <QueueSkeleton />;
  if (isError && !data) return <LoadError onRetry={refetch} busy={isRefetching} />;
  const items = data?.items ?? [];
  if (items.length === 0)
    return <EmptyState title="Aucun épisode vu" message="Les épisodes que tu coches apparaîtront ici." />;

  return (
    <ScrollView
      contentContainerStyle={{ paddingBottom: 16 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.yellow} colors={[COLORS.yellow]} />}
    >
      <PillHeader label="Historique de visionnage" />
      {items.map((it, i) => (
        <AppearItem key={`h-${it.episode.id}`} index={i}>
          <EpisodeQueueCard
            item={{ group: 'a_voir', media: it.media, nextEpisode: it.episode, remainingCount: 0, badges: [] }}
            watched
            onCheck={() => unmark.mutate(it.episode.id)}
          />
        </AppearItem>
      ))}
    </ScrollView>
  );
}

function UpcomingView() {
  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['shows', 'upcoming'],
    queryFn: () => api.get<{ groups: { label: string; items: UpcomingItemDto[] }[] }>('/api/shows/upcoming'),
  });
  const { refreshing, onRefresh } = usePullRefresh([refetch]);
  if (isLoading) return <QueueSkeleton />;
  if (isError && !data) return <LoadError onRetry={refetch} busy={isRefetching} />;
  if (!data || data.groups.length === 0)
    return <EmptyState title="Aucun épisode à venir" message="Les prochaines diffusions apparaîtront ici." />;

  return (
    <ScrollView
      contentContainerStyle={{ paddingBottom: 16 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.yellow} colors={[COLORS.yellow]} />}
    >
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
    borderRadius: 10, minHeight: 104, overflow: 'hidden', ...SHADOW.card,
  },
  thumb: { width: 96, backgroundColor: '#e5e5e5', alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, justifyContent: 'center', paddingHorizontal: 14, paddingVertical: 13, gap: 7 },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' },
  time: { fontSize: 12.5, fontFamily: FONTS.bold },
  ch: { fontSize: 10.5, fontFamily: FONTS.bold, textTransform: 'uppercase' },
  code: { fontSize: 20, fontFamily: FONTS.bold },
  epTitle: { fontFamily: FONTS.regular, fontSize: 13 },
  multi: { color: COLORS.blue, fontFamily: FONTS.regular, fontSize: 13, marginTop: 4 },
});
