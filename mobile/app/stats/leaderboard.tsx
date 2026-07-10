import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Image } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { api, tmdbImage } from '@/lib/api';
import { watchTime } from '@/lib/format';
import { COLORS, FONTS } from '@/lib/theme';
import { PageHeader } from '@/components/PageHeader';
import { TopTabs, Loading, LoadError, EmptyState } from '@/components/ui';

type Entry = {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  minutes: number;
  isMe: boolean;
};
type Leaderboard = { series: Entry[]; movies: Entry[] };

// « 15 mois 10 j 21 h » façon TV Time (les zéros de tête sont omis).
function fmt(minutes: number): string {
  const t = watchTime(minutes);
  const parts: string[] = [];
  if (t.months) parts.push(`${t.months} mois`);
  if (t.days || t.months) parts.push(`${t.days} j`);
  parts.push(`${t.hours} h`);
  return parts.join(' ');
}

// Classement entre amis (moi + mes abonnements) par temps de visionnage.
export default function LeaderboardScreen() {
  const { type } = useLocalSearchParams<{ type?: string }>();
  const [tab, setTab] = useState(type === 'movies' ? 'FILMS' : 'SÉRIES');
  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['stats', 'leaderboard'],
    queryFn: () => api.get<Leaderboard>('/api/stats/leaderboard'),
    staleTime: 5 * 60_000,
  });

  const entries = tab === 'FILMS' ? data?.movies : data?.series;

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.white }}>
      <PageHeader title={tab === 'FILMS' ? 'Temps passé devant des films' : 'Temps passé devant des séries'} />
      <TopTabs tabs={['SÉRIES', 'FILMS']} active={tab} onChange={setTab} />
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
        <ScrollView>
          <View style={styles.head}>
            <Text style={styles.headText}>CLASSEMENT</Text>
            <Text style={styles.headText}>TEMPS PASSÉ</Text>
          </View>
          {entries.map((e, i) => (
            <View key={e.userId} style={[styles.row, e.isMe && styles.rowMe]}>
              <Text style={styles.rank}>{i + 1}.</Text>
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
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: COLORS.borderLight },
  headText: { fontSize: 12, fontFamily: FONTS.bold, letterSpacing: 0.6, color: COLORS.textMuted },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingVertical: 14 },
  rowMe: { backgroundColor: '#F4F4F4' },
  rank: { width: 28, fontSize: 17, fontFamily: FONTS.bold },
  avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#20202a' },
  avatarEmpty: { alignItems: 'center', justifyContent: 'center' },
  avatarInit: { color: '#fff', fontSize: 20, fontFamily: FONTS.extraBold },
  name: { fontSize: 17, fontFamily: FONTS.bold },
  me: { fontSize: 14, fontFamily: FONTS.regular, color: COLORS.textMuted },
  time: { fontSize: 16, fontFamily: FONTS.extraBold },
});
