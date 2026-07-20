import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { goBack } from '@/lib/nav';
import { COLORS, FONTS, RADIUS, SPACE } from '@/lib/theme';
import { ScreenShell, ScreenHeader, SectionHeader, PrismeCard, ProgressBar, IconAction } from '@/components/prisme';
import { MedalBadge } from '@/components/medals';
import { Loading, LoadError } from '@/components/ui';
import { AppearItem } from '@/components/anim';

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

// Succès (badges binaires) : médailles PlotTime — débloqué = médaille OR,
// verrouillé = étain + anneau de progression vers le déblocage.
export default function BadgesScreen() {
  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['stats', 'badges'],
    queryFn: () => api.get<BadgesResponse>('/api/stats/badges'),
    staleTime: 60_000,
  });

  return (
    <ScreenShell scroll contentContainerStyle={styles.content}>
      <ScreenHeader
        title="Badges"
        leading={<IconAction icon="chevron-left" label="Retour" onPress={() => goBack('/stats')} />}
      />
      {isLoading ? (
        <Loading />
      ) : isError || !data ? (
        <LoadError onRetry={refetch} busy={isRefetching} />
      ) : (
        <View style={styles.list}>
          <AppearItem index={0}>
            <PrismeCard elevated style={styles.summaryCard}>
              <MedalBadge tier={data.earned > 0 ? 3 : 0} icon="award" progress={data.total > 0 ? data.earned / data.total : 0} size={56} />
              <View style={{ flex: 1 }}>
                <Text style={styles.summaryN}>
                  {data.earned}
                  <Text style={styles.summaryTotal}> / {data.total}</Text>
                </Text>
                <Text style={styles.summaryLabel}>
                  badge{data.earned > 1 ? 's' : ''} débloqué{data.earned > 1 ? 's' : ''}
                </Text>
              </View>
              <View style={{ width: 120 }}>
                <ProgressBar value={data.total > 0 ? (data.earned / data.total) * 100 : 0} label="Badges débloqués" />
              </View>
            </PrismeCard>
          </AppearItem>
          {data.sections.map((s, si) => (
            <AppearItem key={s.title} index={si + 1}>
              <View>
                <SectionHeader title={s.title} eyebrow={`${s.badges.filter((b) => b.earned).length} / ${s.badges.length} débloqués`} />
                <PrismeCard elevated>
                  <View style={styles.grid}>
                    {s.badges.map((b) => {
                      const pct = b.earned ? 1 : b.progress.target > 0 ? Math.min(1, b.progress.current / b.progress.target) : 0;
                      return (
                        <View
                          key={b.id}
                          style={styles.badge}
                          accessible
                          accessibilityLabel={`${b.title}, ${b.earned ? 'débloqué' : `progression ${b.progress.current} sur ${b.progress.target}`}`}
                        >
                          <MedalBadge tier={b.earned ? 3 : 0} icon={b.icon} progress={pct} size={62} />
                          <Text style={[styles.badgeTitle, !b.earned && styles.lockedText]} numberOfLines={2}>
                            {b.title}
                          </Text>
                          <Text style={styles.badgeDesc} numberOfLines={2}>
                            {b.description}
                          </Text>
                          {!b.earned ? (
                            <Text style={styles.progress}>
                              {b.progress.current.toLocaleString('fr-FR')} / {b.progress.target.toLocaleString('fr-FR')}
                            </Text>
                          ) : null}
                        </View>
                      );
                    })}
                  </View>
                </PrismeCard>
              </View>
            </AppearItem>
          ))}
        </View>
      )}
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: SPACE.xl },
  list: { gap: SPACE.sm, paddingTop: SPACE.xs },
  summaryCard: { flexDirection: 'row', alignItems: 'center', gap: SPACE.md },
  summaryN: { color: COLORS.text, fontSize: 28, lineHeight: 33, fontFamily: FONTS.extraBold },
  summaryTotal: { color: COLORS.textMuted, fontSize: 19, fontFamily: FONTS.bold },
  summaryLabel: { color: COLORS.textMuted, fontSize: 13, fontFamily: FONTS.regular, marginTop: 2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: SPACE.lg },
  badge: { width: '33.333%', alignItems: 'center', paddingHorizontal: 4 },
  badgeTitle: { color: COLORS.text, fontSize: 12, fontFamily: FONTS.bold, textAlign: 'center', marginTop: 7 },
  lockedText: { color: COLORS.textMuted },
  badgeDesc: { fontSize: 10, fontFamily: FONTS.regular, color: COLORS.textSoft, textAlign: 'center', marginTop: 2 },
  progress: { fontSize: 10, fontFamily: FONTS.bold, color: COLORS.textMuted, marginTop: 3 },
});
