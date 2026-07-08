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

// `watched` : variante « Historique de visionnage » (façon TV Time) — carte
// fondue (opacité réduite) avec coche verte ; le clic sur la coche décoche.
export function EpisodeQueueCard({
  item,
  onCheck,
  watched,
}: {
  item: QueueItemDto;
  onCheck: () => void;
  watched?: boolean;
}) {
  const router = useRouter();
  const ep = item.nextEpisode;
  const openShow = () => router.push(`/show/${item.media.id}`);
  // Vignette : image de l'épisode à voir, sinon affiche de la série.
  const thumbUri = tmdbImage(ep?.stillPath, 'w300') ?? tmdbImage(item.media.posterPath, 'w342');

  return (
    <Pressable style={[styles.card, watched && styles.cardWatched]} onPress={openShow}>
      {thumbUri ? (
        <Image source={{ uri: thumbUri }} style={styles.thumb} resizeMode="cover" />
      ) : (
        <View style={[styles.thumb, styles.thumbEmpty]}>
          <Feather name="image" size={26} color="#9a9a9a" />
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
        {!watched && item.badges.length > 0 ? (
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
          <CheckCircle
            onPress={onCheck}
            size={38}
            checked={watched}
            checkedBg={COLORS.green}
            checkedFg="#fff"
          />
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Cotes calquées sur TV Time (captures 393dp) : vignette 96, coche 38,
  // code 20, titre 13, carte ~130dp avec badge, rayon 10, ~5 cartes visibles.
  card: {
    flexDirection: 'row', marginHorizontal: 12, marginBottom: 12, backgroundColor: COLORS.white,
    borderRadius: 10, minHeight: 104, overflow: 'hidden', ...SHADOW.card,
  },
  cardWatched: { opacity: 0.45 },
  thumb: { width: 96, backgroundColor: '#e5e5e5' },
  thumbEmpty: { alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, justifyContent: 'center', paddingHorizontal: 14, paddingVertical: 13, gap: 7 },
  // Le code (S03 | E02) reste sur UNE ligne ; « +N » (restants) ne le pousse jamais.
  codeRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  code: { fontSize: 20, fontFamily: FONTS.bold, flexShrink: 1 },
  plus: { fontSize: 13, fontFamily: FONTS.bold, color: COLORS.textMuted, flexShrink: 0 },
  epTitle: { fontFamily: FONTS.regular, fontSize: 13 },
  badges: { flexDirection: 'row', gap: 6 },
  checkWrap: { justifyContent: 'center', paddingRight: 14 },
});
