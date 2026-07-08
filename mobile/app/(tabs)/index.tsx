import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Image } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, tmdbImage } from '@/lib/api';
import type { QueueItemDto, UpcomingItemDto } from '@/lib/types';
import { queueGroupLabel, episodeCode, timeHHMM } from '@/lib/format';
import { COLORS, RADIUS, SHADOW } from '@/lib/theme';
import { PillHeader, TopTabs, EmptyState, Loading, ShowPill, Badge, CheckCircle } from '@/components/ui';
import { EpisodeQueueCard } from '@/components/EpisodeQueueCard';

export default function ShowsScreen() {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState('À VOIR');
  return (
    <View style={{ flex: 1, backgroundColor: COLORS.pageMuted }}>
      <View style={{ paddingTop: insets.top, backgroundColor: COLORS.white }}>
        <TopTabs tabs={['À VOIR', 'À VENIR']} active={tab} onChange={setTab} />
      </View>
      {tab === 'À VOIR' ? <QueueView /> : <UpcomingView />}
    </View>
  );
}

function QueueView() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['shows', 'queue'],
    queryFn: () => api.get<{ items: QueueItemDto[] }>('/api/shows/queue'),
  });
  const mark = useMutation({
    mutationFn: (episodeId: string) => api.post(`/api/episodes/${episodeId}/watched`),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['shows'] });
      qc.invalidateQueries({ queryKey: ['profile'] });
    },
  });

  if (isLoading) return <Loading />;
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
    <ScrollView contentContainerStyle={{ paddingBottom: 16 }}>
      {[...groups.entries()].map(([group, items]) => (
        <View key={group}>
          <PillHeader label={queueGroupLabel(group)} />
          {items.map((item) => (
            <EpisodeQueueCard
              key={item.media.id}
              item={item}
              onCheck={() => item.nextEpisode && mark.mutate(item.nextEpisode.id)}
            />
          ))}
        </View>
      ))}
    </ScrollView>
  );
}

function UpcomingView() {
  const { data, isLoading } = useQuery({
    queryKey: ['shows', 'upcoming'],
    queryFn: () => api.get<{ groups: { label: string; items: UpcomingItemDto[] }[] }>('/api/shows/upcoming'),
  });
  if (isLoading) return <Loading />;
  if (!data || data.groups.length === 0)
    return <EmptyState title="Aucun épisode à venir" message="Les prochaines diffusions apparaîtront ici." />;

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 16 }}>
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
          <ShowPill label={item.media.title} onPress={() => router.push(`/show/${item.media.id}`)} />
          {ep.airDate ? (
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={styles.time}>{timeHHMM(ep.airDate)}</Text>
              <Text style={styles.ch}>{ep.network ?? ''}</Text>
            </View>
          ) : null}
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

const styles = StyleSheet.create({
  upcard: {
    flexDirection: 'row', marginHorizontal: 12, marginBottom: 12, backgroundColor: COLORS.white,
    borderRadius: RADIUS.card, minHeight: 122, overflow: 'hidden', ...SHADOW.card,
  },
  thumb: { width: 96, backgroundColor: '#e5e5e5', alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, justifyContent: 'center', paddingHorizontal: 14, paddingVertical: 12, gap: 4 },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' },
  time: { fontSize: 14, fontWeight: '700' },
  ch: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
  code: { fontSize: 26, fontWeight: '800' },
  epTitle: { fontSize: 18 },
  multi: { color: COLORS.blue, fontSize: 15, marginTop: 6 },
});
