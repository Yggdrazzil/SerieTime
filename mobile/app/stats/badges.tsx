import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { COLORS, FONTS } from '@/lib/theme';
import { PageHeader } from '@/components/PageHeader';
import { Loading, LoadError } from '@/components/ui';

type Badge = {
  id: string;
  title: string;
  description: string;
  icon: keyof typeof Feather.glyphMap;
  color: string;
  earned: boolean;
  progress: { current: number; target: number };
};
type BadgesResponse = { earned: number; total: number; sections: { title: string; badges: Badge[] }[] };

// Badges / succès (façon TV Time, icônes maison). Débloqué = pastille colorée ;
// verrouillé = grisé avec progression.
export default function BadgesScreen() {
  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['stats', 'badges'],
    queryFn: () => api.get<BadgesResponse>('/api/stats/badges'),
    staleTime: 60_000,
  });

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.pageMuted }}>
      <PageHeader title="Badges" />
      {isLoading ? (
        <Loading />
      ) : isError || !data ? (
        <LoadError onRetry={refetch} busy={isRefetching} />
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          <View style={styles.card}>
            <Text style={styles.summary}>
              <Text style={styles.summaryN}>{data.earned}</Text> badge{data.earned > 1 ? 's' : ''} sur {data.total}
            </Text>
          </View>
          {data.sections.map((s) => (
            <View key={s.title} style={styles.card}>
              <Text style={styles.cardTitle}>{s.title}</Text>
              <Text style={styles.cardCount}>{s.badges.filter((b) => b.earned).length}</Text>
              <View style={styles.grid}>
                {s.badges.map((b) => (
                  <View key={b.id} style={styles.badge}>
                    <View style={[styles.circle, b.earned ? { backgroundColor: b.color } : styles.circleLocked]}>
                      <Feather name={b.icon} size={26} color={b.earned ? '#fff' : '#9a9a9a'} />
                    </View>
                    <Text style={[styles.badgeTitle, !b.earned && styles.lockedText]} numberOfLines={2}>
                      {b.title}
                    </Text>
                    <Text style={styles.badgeDesc} numberOfLines={2}>{b.description}</Text>
                    {!b.earned ? (
                      <Text style={styles.progress}>
                        {b.progress.current.toLocaleString('fr-FR')} / {b.progress.target.toLocaleString('fr-FR')}
                      </Text>
                    ) : null}
                  </View>
                ))}
              </View>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { padding: 12, gap: 12, paddingBottom: 32 },
  card: { backgroundColor: COLORS.white, borderRadius: 12, padding: 18, borderWidth: 1, borderColor: COLORS.borderLight },
  summary: { fontSize: 18, fontFamily: FONTS.regular },
  summaryN: { fontSize: 26, fontFamily: FONTS.extraBold },
  cardTitle: { fontSize: 19, fontFamily: FONTS.extraBold },
  cardCount: { fontSize: 32, fontFamily: FONTS.extraBold, marginTop: 2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 14, rowGap: 20 },
  badge: { width: '25%', alignItems: 'center', paddingHorizontal: 4 },
  circle: { width: 58, height: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center' },
  circleLocked: { backgroundColor: '#ECECEC' },
  badgeTitle: { fontSize: 12, fontFamily: FONTS.bold, textAlign: 'center', marginTop: 6 },
  lockedText: { color: COLORS.textMuted },
  badgeDesc: { fontSize: 10, fontFamily: FONTS.regular, color: COLORS.textSoft, textAlign: 'center', marginTop: 2 },
  progress: { fontSize: 10, fontFamily: FONTS.bold, color: COLORS.textMuted, marginTop: 3 },
});
