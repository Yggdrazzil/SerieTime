import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { goBack } from '@/lib/nav';
import { COLORS, FONTS, RADIUS, SIZES, SPACE } from '@/lib/theme';
import { ScreenShell, ScreenHeader, SectionHeader, PrismeCard, ProgressBar, IconAction } from '@/components/prisme';
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

// Badges / succès (icônes maison Prisme). Débloqué = pastille colorée (couleur
// propre au badge, fournie par l'API) ; verrouillé = grisé avec progression.
export default function BadgesScreen() {
  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['stats', 'badges'],
    queryFn: () => api.get<BadgesResponse>('/api/stats/badges'),
    staleTime: 60_000,
  });

  return (
    <ScreenShell scroll>
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
              <View style={styles.summaryIcon}>
                <Feather name="award" size={22} color={COLORS.onAccent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.summaryN}>
                  {data.earned}
                  <Text style={styles.summaryTotal}> / {data.total}</Text>
                </Text>
                <Text style={styles.summaryLabel}>badge{data.earned > 1 ? 's' : ''} débloqué{data.earned > 1 ? 's' : ''}</Text>
              </View>
            </PrismeCard>
          </AppearItem>
          {data.sections.map((s, si) => (
            <AppearItem key={s.title} index={si + 1}>
              <PrismeCard elevated>
                <SectionHeader
                  title={s.title}
                  eyebrow={`${s.badges.filter((b) => b.earned).length} / ${s.badges.length} débloqués`}
                  style={styles.cardSectionHeader}
                />
                <View style={styles.grid}>
                  {s.badges.map((b) => (
                    <View key={b.id} style={styles.badge}>
                      <View style={[styles.circle, b.earned ? { backgroundColor: b.color } : styles.circleLocked]}>
                        <Feather name={b.icon} size={26} color={b.earned ? '#fff' : COLORS.textSoft} />
                      </View>
                      <Text style={[styles.badgeTitle, !b.earned && styles.lockedText]} numberOfLines={2}>
                        {b.title}
                      </Text>
                      <Text style={styles.badgeDesc} numberOfLines={2}>{b.description}</Text>
                      {!b.earned ? (
                        <View style={styles.progressWrap}>
                          <ProgressBar
                            value={b.progress.current}
                            max={Math.max(1, b.progress.target)}
                            label={`${b.title} — progression`}
                            height={5}
                          />
                          <Text style={styles.progress}>
                            {b.progress.current.toLocaleString('fr-FR')} / {b.progress.target.toLocaleString('fr-FR')}
                          </Text>
                        </View>
                      ) : null}
                    </View>
                  ))}
                </View>
              </PrismeCard>
            </AppearItem>
          ))}
        </View>
      )}
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  list: { gap: SPACE.sm, paddingBottom: SPACE.xl },
  cardSectionHeader: { marginTop: 0, marginBottom: SPACE.sm },
  summaryCard: { flexDirection: 'row', alignItems: 'center', gap: SPACE.md },
  summaryIcon: {
    width: SIZES.touch, height: SIZES.touch, borderRadius: RADIUS.control,
    backgroundColor: COLORS.yellow, alignItems: 'center', justifyContent: 'center',
  },
  summaryN: { color: COLORS.text, fontSize: 30, lineHeight: 34, fontFamily: FONTS.extraBold },
  summaryTotal: { color: COLORS.textMuted, fontSize: 20, fontFamily: FONTS.bold },
  summaryLabel: { color: COLORS.textMuted, fontSize: 14, fontFamily: FONTS.regular, marginTop: 2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: SPACE.lg },
  badge: { width: '25%', alignItems: 'center', paddingHorizontal: 4 },
  circle: { width: 58, height: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center' },
  circleLocked: { backgroundColor: COLORS.surfaceMuted, borderWidth: 1, borderColor: COLORS.borderLight },
  badgeTitle: { color: COLORS.text, fontSize: 12, fontFamily: FONTS.bold, textAlign: 'center', marginTop: 6 },
  lockedText: { color: COLORS.textMuted },
  badgeDesc: { fontSize: 10, fontFamily: FONTS.regular, color: COLORS.textSoft, textAlign: 'center', marginTop: 2 },
  progressWrap: { width: '100%', marginTop: 6 },
  progress: { fontSize: 10, fontFamily: FONTS.bold, color: COLORS.textMuted, marginTop: 4, textAlign: 'center' },
});
