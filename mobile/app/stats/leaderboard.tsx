import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Image, Pressable } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { api, tmdbImage } from '@/lib/api';
import { watchTime } from '@/lib/format';
import { goBack } from '@/lib/nav';
import { useOpenUserPreview } from '@/lib/userPreview';
import { COLORS, FONTS, RADIUS, SPACE } from '@/lib/theme';
import { ScreenShell, ScreenHeader, SegmentedFilter, PrismeCard, IconAction } from '@/components/prisme';
import { Loading, LoadError, EmptyState } from '@/components/ui';
import { AppearItem } from '@/components/anim';

export type LeaderboardEntry = {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  minutes: number;
  isMe: boolean;
};
type Entry = LeaderboardEntry;
export type Leaderboard = { series: Entry[]; movies: Entry[] };
type Tab = 'series' | 'movies';

const TAB_OPTIONS = [
  { value: 'series', label: 'SÉRIES' },
  { value: 'movies', label: 'FILMS' },
] as const;

// « 15 mois 10 j 21 h » (les zéros de tête sont omis).
function fmt(minutes: number): string {
  const t = watchTime(minutes);
  const parts: string[] = [];
  if (t.months) parts.push(`${t.months} mois`);
  if (t.days || t.months) parts.push(`${t.days} j`);
  parts.push(`${t.hours} h`);
  return parts.join(' ');
}

// Médaille des trois premiers rangs (or / argent / bronze).
const MEDAL: Record<number, string> = { 1: '#D4A017', 2: '#9AA2AA', 3: '#CD7F32' };

// Tableau de classement seul (carte + rangées) : partagé entre cet écran et
// l'onglet Communauté ((tabs)/community.tsx). Un tap sur la rangée d'un AMI
// ouvre l'aperçu de son profil (popup) — pas sur ma propre rangée.
export function LeaderboardBoard({ entries }: { entries: LeaderboardEntry[] }) {
  const openUserPreview = useOpenUserPreview();
  return (
    <PrismeCard elevated>
      <View style={styles.head}>
        <Text style={styles.headText}>CLASSEMENT</Text>
        <Text style={styles.headText}>TEMPS PASSÉ</Text>
      </View>
      {entries.map((e, i) => {
        const rank = i + 1;
        const medal = MEDAL[rank];
        return (
          <AppearItem key={e.userId} index={i}>
            <Pressable
              style={({ pressed }) => [styles.row, e.isMe && styles.rowMe, pressed && !e.isMe && styles.rowPressed]}
              onPress={() => openUserPreview(e.userId)}
              disabled={e.isMe}
              accessibilityRole={e.isMe ? undefined : 'button'}
              accessibilityLabel={
                e.isMe ? undefined : 'Aperçu du profil de ' + e.displayName + ', rang ' + rank + ', ' + fmt(e.minutes)
              }
            >
              <View style={[styles.rankWrap, medal ? { backgroundColor: medal } : null]}>
                <Text style={[styles.rank, medal ? styles.rankMedal : null]}>{rank}</Text>
              </View>
              {e.avatarUrl ? (
                <Image source={{ uri: tmdbImage(e.avatarUrl, 'w185') ?? e.avatarUrl }} style={styles.avatar} />
              ) : (
                <View style={[styles.avatar, styles.avatarEmpty]}>
                  <Text style={styles.avatarInit}>{e.displayName.slice(0, 1).toUpperCase()}</Text>
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.name} numberOfLines={1}>{e.displayName}</Text>
                {e.isMe ? <Text style={styles.me}>vous</Text> : null}
              </View>
              <Text style={styles.time}>{fmt(e.minutes)}</Text>
            </Pressable>
          </AppearItem>
        );
      })}
    </PrismeCard>
  );
}

// Classement entre amis (moi + mes abonnements) par temps de visionnage.
export default function LeaderboardScreen() {
  const { type } = useLocalSearchParams<{ type?: string }>();
  const [tab, setTab] = useState<Tab>(type === 'movies' ? 'movies' : 'series');
  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['stats', 'leaderboard'],
    queryFn: () => api.get<Leaderboard>('/api/stats/leaderboard'),
    staleTime: 5 * 60_000,
  });

  const entries = tab === 'movies' ? data?.movies : data?.series;

  return (
    <ScreenShell contentContainerStyle={styles.shellContent}>
      <ScreenHeader
        title={tab === 'movies' ? 'Temps passé devant des films' : 'Temps passé devant des séries'}
        leading={<IconAction icon="chevron-left" label="Retour" onPress={() => goBack('/stats')} />}
      />
      <SegmentedFilter
        options={TAB_OPTIONS}
        value={tab}
        onChange={setTab}
        accessibilityLabel="Filtrer le classement"
      />
      {isLoading ? (
        <Loading />
      ) : isError || !entries ? (
        <LoadError onRetry={refetch} busy={isRefetching} />
      ) : entries.length <= 1 ? (
        <EmptyState
          title="Personne à comparer"
          message="Abonne-toi à des amis depuis Explorer pour voir le classement."
        />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
          <LeaderboardBoard entries={entries} />
        </ScrollView>
      )}
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  shellContent: { paddingBottom: 0 },
  scrollContent: { paddingTop: SPACE.xs, paddingBottom: SPACE.xl },
  head: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: SPACE.xs },
  headText: { fontSize: 11, fontFamily: FONTS.bold, letterSpacing: 0.6, color: COLORS.textMuted },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE.sm,
    paddingVertical: SPACE.sm, paddingHorizontal: SPACE.xs,
    borderTopWidth: 1, borderTopColor: COLORS.borderLight, borderRadius: RADIUS.control,
  },
  rowMe: { backgroundColor: COLORS.primarySoft, borderTopColor: 'transparent' },
  rowPressed: { opacity: 0.72 },
  rankWrap: {
    width: 30, height: 30, borderRadius: RADIUS.pill, flexShrink: 0,
    alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.surfaceMuted,
  },
  rank: { color: COLORS.textMuted, fontSize: 15, fontFamily: FONTS.extraBold },
  rankMedal: { color: '#FFFFFF' },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: COLORS.primary },
  avatarEmpty: { alignItems: 'center', justifyContent: 'center' },
  avatarInit: { color: '#fff', fontSize: 19, fontFamily: FONTS.extraBold },
  name: { color: COLORS.text, fontSize: 16, fontFamily: FONTS.bold },
  me: { fontSize: 13, fontFamily: FONTS.regular, color: COLORS.primary, marginTop: 1 },
  time: { color: COLORS.text, fontSize: 15, fontFamily: FONTS.extraBold },
});
