import React from 'react';
import { View, Text, Pressable, StyleSheet, Image } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import type { QueueItemDto } from '@/lib/types';
import { episodeCode } from '@/lib/format';
import { tmdbImage } from '@/lib/api';
import { COLORS, RADIUS, SHADOW } from '@/lib/theme';
import { ShowPill, Badge, CheckCircle } from './ui';

const BADGE_MAP: Record<string, { label: string; variant: 'black' | 'yellow' }> = {
  PREMIERE: { label: 'PREMIERE', variant: 'black' },
  NOUVEAU: { label: 'NOUVEAU', variant: 'yellow' },
  PLUS_RECENT: { label: 'PLUS RÉCENT', variant: 'black' },
};

export function EpisodeQueueCard({ item, onCheck }: { item: QueueItemDto; onCheck: () => void }) {
  const router = useRouter();
  const ep = item.nextEpisode;
  const openShow = () => router.push(`/show/${item.media.id}`);
  // Vignette : image de l'épisode à voir, sinon affiche de la série.
  const thumbUri = tmdbImage(ep?.stillPath, 'w300') ?? tmdbImage(item.media.posterPath, 'w342');

  return (
    <Pressable style={styles.card} onPress={openShow}>
      {thumbUri ? (
        <Image source={{ uri: thumbUri }} style={styles.thumb} resizeMode="cover" />
      ) : (
        <View style={[styles.thumb, styles.thumbEmpty]}>
          <Feather name="image" size={28} color="#9a9a9a" />
        </View>
      )}
      <View style={styles.body}>
        <ShowPill label={item.media.title} onPress={openShow} />
        {ep ? (
          <>
            <View style={styles.codeRow}>
              <Text style={styles.code}>{episodeCode(ep.seasonNumber, ep.episodeNumber)}</Text>
              {item.remainingCount > 0 ? <Text style={styles.plus}>+{item.remainingCount}</Text> : null}
            </View>
            <Text style={styles.epTitle} numberOfLines={1}>
              {ep.title}
            </Text>
          </>
        ) : (
          <Text style={styles.epTitle}>Aucun épisode à voir</Text>
        )}
        {item.badges.length > 0 ? (
          <View style={styles.badges}>
            {item.badges.map((b) => {
              const badge = BADGE_MAP[b];
              return badge ? <Badge key={b} label={badge.label} variant={badge.variant} /> : null;
            })}
          </View>
        ) : null}
      </View>
      {ep ? (
        <View style={styles.checkWrap}>
          <CheckCircle onPress={onCheck} />
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row', marginHorizontal: 12, marginBottom: 12, backgroundColor: COLORS.white,
    borderRadius: RADIUS.card, minHeight: 122, overflow: 'hidden', ...SHADOW.card,
  },
  thumb: { width: 96, backgroundColor: '#e5e5e5' },
  thumbEmpty: { alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, justifyContent: 'center', paddingHorizontal: 14, paddingVertical: 12, gap: 4 },
  codeRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  code: { fontSize: 26, fontWeight: '800' },
  plus: { fontSize: 15, fontWeight: '800' },
  epTitle: { fontSize: 18 },
  badges: { flexDirection: 'row', gap: 8, marginTop: 2 },
  checkWrap: { justifyContent: 'center', paddingRight: 16 },
});
