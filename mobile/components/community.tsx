import React from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter, type Href } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { api, tmdbImage } from '@/lib/api';
import { useOpenUserPreview } from '@/lib/userPreview';
import { COLORS, FONTS, RADIUS, SPACE } from '@/lib/theme';
import { PrismeCard, ProgressBar, SectionHeader } from '@/components/prisme';
import { Poster } from '@/components/ui';

// Briques de l'onglet Communauté ((tabs)/community.tsx) : carrousel « Ils
// recommandent » et carte « Défi de la semaine ». Les blocs du QG « Amis »
// et le segment Discussions vivent dans components/communityHQ.tsx.

type MediaRef = { id: string; title: string; posterPath: string | null; type: 'show' | 'movie' | 'game' };
type MiniUser = { userId: string; displayName: string; avatarUrl: string | null };
type Recommendation = { media: MediaRef; fans: MiniUser[]; avgRating: number; fanCount: number };
type ChallengeEntry = {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  minutes: number;
  isMe: boolean;
};

// Même or que les médailles du classement (stats/leaderboard.tsx).
const GOLD = '#D4A017';

function mediaHref(media: MediaRef): Href {
  if (media.type === 'game') return ('/game/' + media.id) as Href;
  return ('/show/' + media.id + (media.type === 'movie' ? '?type=movie' : '')) as Href;
}

function firstName(displayName: string): string {
  return displayName.trim().split(/\s+/)[0] || displayName;
}

// « Camille, Théo +2 » : max deux prénoms, le reste en compteur.
function fanLabel(fans: MiniUser[], fanCount: number): string {
  const names = fans.slice(0, 2).map((f) => firstName(f.displayName));
  const extra = fanCount - names.length;
  return names.join(', ') + (extra > 0 ? ' +' + extra : '');
}

// « 4 h 32 » / « 45 min » / « 0 min ».
function minutesLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h <= 0) return m + ' min';
  return m > 0 ? h + ' h ' + String(m).padStart(2, '0') : h + ' h';
}

// --- « Ils recommandent » (QG Amis) ----------------------------------------

export function FriendsLovedCarousel() {
  const router = useRouter();
  const { data } = useQuery({
    queryKey: ['social', 'recommendations'],
    queryFn: () => api.get<{ items: Recommendation[] }>('/api/social/recommendations'),
    staleTime: 5 * 60_000,
  });
  const items = data?.items ?? [];
  if (items.length === 0) return null;

  return (
    <View style={styles.lovedWrap}>
      <SectionHeader title="Ils recommandent" style={styles.lovedHeader} />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.lovedRow}
      >
        {items.map((item) => (
          <View key={item.media.id} style={styles.lovedItem}>
            <Poster
              title={item.media.title}
              uri={tmdbImage(item.media.posterPath, 'w342')}
              width={104}
              onPress={() => router.push(mediaHref(item.media))}
            />
            <Text style={styles.lovedRating} accessibilityLabel={'Note moyenne ' + item.avgRating}>
              ★ {String(item.avgRating).replace('.', ',')}
            </Text>
            <Text style={styles.lovedFans} numberOfLines={2}>
              Aimé par {fanLabel(item.fans, item.fanCount)}
            </Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

// --- Défi de la semaine (segment Défis) ------------------------------------

export function WeeklyChallengeCard() {
  const openUserPreview = useOpenUserPreview();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['social', 'challenge', 'weekly'],
    queryFn: () =>
      api.get<{ weekStart: string; entries: ChallengeEntry[] }>('/api/social/challenge/weekly'),
    staleTime: 60_000,
  });
  // En erreur, on s'efface : le classement en dessous garde ses propres états.
  if (isError) return null;

  const entries = data?.entries ?? [];
  const leaderMinutes = entries[0]?.minutes ?? 0;
  const allZero = entries.length > 0 && entries.every((e) => e.minutes === 0);

  return (
    <PrismeCard elevated style={styles.challengeCard}>
      <View style={styles.challengeHead}>
        <Feather name="zap" size={16} color={COLORS.primary} />
        <Text style={styles.challengeTitle} accessibilityRole="header">
          Défi de la semaine
        </Text>
      </View>
      {isLoading ? (
        <ActivityIndicator color={COLORS.primary} style={styles.challengeLoading} />
      ) : allZero ? (
        <Text style={styles.challengeEmpty}>
          Personne n’a encore regardé quoi que ce soit cette semaine — lance le défi !
        </Text>
      ) : (
        entries.map((entry, index) => (
          // Rangée d'un AMI : tap → aperçu de son profil (popup). Ma rangée
          // reste inerte (pas d'aperçu de soi-même).
          <Pressable
            key={entry.userId}
            style={({ pressed }) => [
              styles.challengeRow,
              entry.isMe && styles.challengeRowMe,
              pressed && !entry.isMe && styles.challengeRowPressed,
            ]}
            onPress={() => openUserPreview(entry.userId)}
            disabled={entry.isMe}
            accessibilityRole={entry.isMe ? undefined : 'button'}
            accessibilityLabel={
              entry.isMe
                ? undefined
                : 'Aperçu du profil de ' + entry.displayName + ', ' + minutesLabel(entry.minutes) + ' cette semaine'
            }
          >
            <Text style={styles.challengeRank}>{index + 1}</Text>
            {entry.avatarUrl ? (
              <Image
                source={{ uri: tmdbImage(entry.avatarUrl, 'w185') ?? entry.avatarUrl }}
                style={styles.challengeAvatar}
                accessible={false}
              />
            ) : (
              <View style={[styles.challengeAvatar, styles.challengeAvatarEmpty]}>
                <Text style={styles.challengeAvatarInit}>
                  {entry.displayName.slice(0, 1).toUpperCase()}
                </Text>
              </View>
            )}
            <View style={styles.challengeBody}>
              <View style={styles.challengeNameRow}>
                <Text style={styles.challengeName} numberOfLines={1}>
                  {entry.displayName}
                </Text>
                {index === 0 ? (
                  <Feather name="award" size={14} color={GOLD} accessibilityLabel="En tête" />
                ) : null}
                {entry.isMe ? <Text style={styles.challengeMe}>vous</Text> : null}
              </View>
              <ProgressBar
                value={entry.minutes}
                max={Math.max(1, leaderMinutes)}
                label={'Minutes vues par ' + entry.displayName + ' cette semaine'}
                height={5}
                style={styles.challengeBar}
              />
            </View>
            <Text style={styles.challengeMinutes}>{minutesLabel(entry.minutes)}</Text>
          </Pressable>
        ))
      )}
      <Text style={styles.challengeFoot}>Depuis lundi</Text>
    </PrismeCard>
  );
}

const styles = StyleSheet.create({
  // « Ils recommandent »
  lovedWrap: { marginBottom: SPACE.xs },
  lovedHeader: { marginTop: 0 },
  lovedRow: { gap: SPACE.sm, paddingRight: SPACE.md },
  lovedItem: { width: 104 },
  lovedRating: {
    color: COLORS.text,
    fontSize: 12.5,
    fontFamily: FONTS.extraBold,
    marginTop: SPACE.xxs,
  },
  lovedFans: {
    color: COLORS.textMuted,
    fontSize: 11.5,
    lineHeight: 15,
    fontFamily: FONTS.regular,
    marginTop: 2,
  },
  // Défi de la semaine
  challengeCard: { marginBottom: SPACE.sm },
  challengeHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.xs,
    marginBottom: SPACE.xs,
  },
  challengeTitle: { color: COLORS.text, fontSize: 17, fontFamily: FONTS.extraBold },
  challengeLoading: { paddingVertical: SPACE.lg },
  challengeEmpty: {
    color: COLORS.textMuted,
    fontSize: 13.5,
    lineHeight: 19,
    fontFamily: FONTS.regular,
    paddingVertical: SPACE.sm,
  },
  challengeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.sm,
    paddingVertical: SPACE.xs,
    paddingHorizontal: SPACE.xs,
    borderRadius: RADIUS.control,
  },
  challengeRowMe: { backgroundColor: COLORS.primarySoft },
  challengeRowPressed: { opacity: 0.72 },
  challengeRank: {
    width: 20,
    textAlign: 'center',
    color: COLORS.textMuted,
    fontSize: 13,
    fontFamily: FONTS.extraBold,
  },
  challengeAvatar: { width: 34, height: 34, borderRadius: 17, backgroundColor: COLORS.primarySoft },
  challengeAvatarEmpty: { alignItems: 'center', justifyContent: 'center' },
  challengeAvatarInit: { color: COLORS.primary, fontSize: 14, fontFamily: FONTS.extraBold },
  challengeBody: { flex: 1, minWidth: 0 },
  challengeNameRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE.xxs },
  challengeName: {
    flexShrink: 1,
    color: COLORS.text,
    fontSize: 14,
    fontFamily: FONTS.bold,
  },
  challengeMe: { color: COLORS.primary, fontSize: 12, fontFamily: FONTS.regular },
  challengeBar: { marginTop: SPACE.xxs },
  challengeMinutes: { color: COLORS.text, fontSize: 13, fontFamily: FONTS.extraBold },
  challengeFoot: {
    color: COLORS.textSoft,
    fontSize: 11,
    fontFamily: FONTS.medium,
    marginTop: SPACE.xs,
  },
});
