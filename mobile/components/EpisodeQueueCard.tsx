import React from 'react';
import { View, Text, Pressable, StyleSheet, Image } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import type { QueueItemDto } from '@/lib/types';
import { episodeCodeCompact } from '@/lib/format';
import { tmdbImage } from '@/lib/api';
import { COLORS, SHADOW, FONTS, RADIUS, SPACE } from '@/lib/theme';
import { Badge, CheckCircle } from './ui';

const BADGE_MAP: Record<string, { label: string; variant: 'black' | 'yellow' }> = {
  PREMIERE: { label: 'PREMIERE', variant: 'black' },
  NOUVEAU: { label: 'NOUVEAU', variant: 'yellow' },
  PLUS_RECENT: { label: 'PLUS RÉCENT', variant: 'black' },
};

// Barre de progression de série (maquette Prisme) : dégradé rose → violet sur
// piste discrète. Rendue uniquement si le serveur fournit la progression.
export function SeriesProgressBar({ watched, total }: { watched: number; total: number }) {
  if (!(total > 0)) return null;
  const pct = Math.max(0, Math.min(100, (watched / total) * 100));
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={`${watched} épisode${watched > 1 ? 's' : ''} vu${watched > 1 ? 's' : ''} sur ${total}`}
      accessibilityValue={{ min: 0, max: total, now: watched }}
      style={styles.progressTrack}
    >
      <LinearGradient
        colors={[COLORS.secondary, COLORS.primary]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={[styles.progressFill, { width: `${pct}%` }]}
      />
    </View>
  );
}

// Rangée de la file « À voir » (disposition maquette : vignette arrondie,
// titre, « S2 · E4 — Titre », barre de progression, coche ronde à droite).
// `watched` distingue l'historique avec une surface apaisée et une coche verte.
// Le titre ouvre la fiche de la série ; un appui ailleurs sur la carte ouvre
// la fiche de l'épisode (`onOpenEpisode`).
export function EpisodeQueueCard({
  item,
  onCheck,
  watched,
  onOpenEpisode,
}: {
  item: QueueItemDto;
  onCheck: () => void;
  watched?: boolean;
  onOpenEpisode?: () => void;
}) {
  const router = useRouter();
  const ep = item.nextEpisode;
  const openShow = () => router.push(`/show/${item.media.id}`);
  const thumbUri = tmdbImage(item.media.posterPath, 'w342') ?? tmdbImage(ep?.stillPath, 'w300');
  const accessibilityLabel = ep
    ? `${item.media.title}, ${episodeCodeCompact(ep.seasonNumber, ep.episodeNumber)}, ${ep.title}${
        item.remainingCount > 0 ? `, plus ${item.remainingCount} épisode${item.remainingCount > 1 ? 's' : ''}` : ''
      }`
    : `${item.media.title}, aucun épisode à voir`;

  return (
    <Pressable
      style={({ pressed }) => [styles.card, watched && styles.cardWatched, pressed && styles.cardPressed]}
      onPress={ep && onOpenEpisode ? onOpenEpisode : openShow}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={ep && onOpenEpisode ? "Ouvre le détail de l'épisode" : 'Ouvre la fiche de la série'}
    >
      {thumbUri ? (
        <Image source={{ uri: thumbUri }} style={[styles.thumb, watched && styles.thumbWatched]} resizeMode="cover" />
      ) : (
        <View style={[styles.thumb, styles.thumbEmpty]}>
          <Feather name="image" size={20} color={COLORS.textSoft} />
        </View>
      )}
      <View style={styles.body}>
        <Pressable
          onPress={(event) => {
            event.stopPropagation();
            openShow();
          }}
          hitSlop={4}
          accessibilityRole="button"
          accessibilityLabel={`Ouvrir ${item.media.title}`}
        >
          <Text style={styles.title} numberOfLines={1}>
            {item.media.title}
          </Text>
        </Pressable>
        {ep ? (
          <View style={styles.codeRow}>
            <Text style={styles.epLine} numberOfLines={1}>
              {episodeCodeCompact(ep.seasonNumber, ep.episodeNumber)} — {ep.title}
            </Text>
            {item.remainingCount > 0 ? (
              <Text
                style={styles.plus}
                accessibilityLabel={`${item.remainingCount} épisode${item.remainingCount > 1 ? 's' : ''} supplémentaire${
                  item.remainingCount > 1 ? 's' : ''
                }`}
              >
                +{item.remainingCount}
              </Text>
            ) : null}
          </View>
        ) : (
          <Text style={styles.epLine}>Aucun épisode à voir</Text>
        )}
        {!watched && item.progress ? (
          <SeriesProgressBar watched={item.progress.watched} total={item.progress.total} />
        ) : null}
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
            size={40}
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
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 104,
    marginHorizontal: SPACE.md,
    marginBottom: SPACE.sm,
    padding: SPACE.sm,
    gap: SPACE.sm,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: RADIUS.card,
    ...SHADOW.card,
  },
  cardPressed: { opacity: 0.9 },
  cardWatched: { backgroundColor: COLORS.surfaceMuted, borderColor: COLORS.success },
  thumb: {
    width: 60,
    height: 80,
    flexShrink: 0,
    borderRadius: RADIUS.poster,
    backgroundColor: COLORS.imagePlaceholder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbWatched: { opacity: 0.68 },
  thumbEmpty: { alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, minWidth: 0, gap: 5 },
  title: { color: COLORS.text, fontSize: 16, lineHeight: 21, fontFamily: FONTS.extraBold },
  codeRow: { flexDirection: 'row', alignItems: 'baseline', gap: SPACE.xs },
  epLine: { flexShrink: 1, color: COLORS.textMuted, fontFamily: FONTS.medium, fontSize: 13, lineHeight: 18 },
  plus: { fontSize: 12, lineHeight: 18, fontFamily: FONTS.extraBold, color: COLORS.plusCount, flexShrink: 0 },
  progressTrack: {
    height: 6,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.surfaceMuted,
    overflow: 'hidden',
    marginTop: 2,
  },
  progressFill: { height: '100%', borderRadius: RADIUS.pill },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.xxs, marginTop: 2 },
  checkWrap: { flexShrink: 0, justifyContent: 'center', alignItems: 'center' },
});
