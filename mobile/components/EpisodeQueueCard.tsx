import React from 'react';
import { View, Text, Pressable, StyleSheet, Image } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import type { QueueItemDto } from '@/lib/types';
import { episodeCode } from '@/lib/format';
import { tmdbImage } from '@/lib/api';
import { COLORS, SHADOW, FONTS } from '@/lib/theme';
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
              <Text style={styles.code} numberOfLines={1}>
                {episodeCode(ep.seasonNumber, ep.episodeNumber)}
              </Text>
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
          <CheckCircle onPress={onCheck} size={44} />
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Dimensions calquées sur TV Time (carte compacte : ~5 visibles à l'écran).
  card: {
    flexDirection: 'row', marginHorizontal: 12, marginBottom: 12, backgroundColor: COLORS.white,
    borderRadius: 14, minHeight: 112, overflow: 'hidden', ...SHADOW.card,
  },
  thumb: { width: 96, backgroundColor: '#e5e5e5' },
  thumbEmpty: { alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, justifyContent: 'center', paddingHorizontal: 14, paddingVertical: 12, gap: 5 },
  // Le code (S03 | E02) reste sur UNE ligne ; « +N » (restants) ne le pousse jamais.
  codeRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  code: { fontSize: 22, fontFamily: FONTS.bold, flexShrink: 1 },
  plus: { fontSize: 14, fontFamily: FONTS.bold, color: COLORS.textMuted, flexShrink: 0 },
  epTitle: { fontFamily: FONTS.regular, fontSize: 16 },
  badges: { flexDirection: 'row', gap: 6, marginTop: 2 },
  checkWrap: { justifyContent: 'center', paddingRight: 14 },
});
