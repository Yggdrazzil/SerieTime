import React, { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { COLORS, SIZES, SPACE } from '@/lib/theme';
import { SegmentedFilter, TabHeader } from '@/components/prisme';
import { EmptyState, Loading, LoadError } from '@/components/ui';
import { FadeSwitch } from '@/components/anim';
import { useTabResetSeq } from '@/lib/tabReset';
import { FeedTab, FriendsTab } from '../social';
import { LeaderboardBoard, type Leaderboard } from '../stats/leaderboard';

// Onglet Communauté (décision équipe 2026-07-20) : remplace l'ex-onglet
// Bibliothèque (doublon du Profil). Regroupe le fil d'activité des
// abonnements (épisodes vus, notes, badges débloqués), le classement entre
// amis et la recherche de profils.
type CommunityTab = 'feed' | 'ranking' | 'friends';
const TAB_OPTIONS: { value: CommunityTab; label: string }[] = [
  { value: 'feed', label: 'Fil' },
  { value: 'ranking', label: 'Classement' },
  { value: 'friends', label: 'Amis' },
];

export default function CommunityScreen() {
  const insets = useSafeAreaInsets();
  const resetSeq = useTabResetSeq('community');
  const [tab, setTab] = useState<CommunityTab>('feed');

  return (
    <View key={resetSeq} style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top }]}>
        <TabHeader title="Communauté" />
        <SegmentedFilter
          options={TAB_OPTIONS}
          value={tab}
          onChange={setTab}
          accessibilityLabel="Choisir la vue communauté"
          style={styles.tabs}
        />
      </View>
      <FadeSwitch trigger={tab}>
        {tab === 'feed' ? <FeedTab /> : tab === 'ranking' ? <RankingSection /> : <FriendsTab />}
      </FadeSwitch>
    </View>
  );
}

// Classement entre amis (temps séries / films) — même tableau que l'écran
// Stats, embarqué directement dans l'onglet.
function RankingSection() {
  const [kind, setKind] = useState<'series' | 'movies'>('series');
  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['stats', 'leaderboard'],
    queryFn: () => api.get<Leaderboard>('/api/stats/leaderboard'),
    staleTime: 5 * 60_000,
  });
  const entries = kind === 'movies' ? data?.movies : data?.series;

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.rankingContent}>
      <SegmentedFilter
        options={[
          { value: 'series', label: 'Séries' },
          { value: 'movies', label: 'Films' },
        ]}
        value={kind}
        onChange={setKind}
        accessibilityLabel="Filtrer le classement"
        style={styles.rankingTabs}
      />
      {isLoading ? (
        <Loading />
      ) : isError || !entries ? (
        <LoadError onRetry={refetch} busy={isRefetching} />
      ) : entries.length <= 1 ? (
        <EmptyState
          title="Personne à comparer"
          message="Abonne-toi à des amis (onglet Amis) pour lancer le classement."
        />
      ) : (
        <LeaderboardBoard entries={entries} />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.pageMuted },
  header: {
    backgroundColor: COLORS.white,
    paddingHorizontal: SPACE.md,
    paddingBottom: SPACE.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.borderLight,
  },
  tabs: { width: '100%', maxWidth: SIZES.contentMax, alignSelf: 'center' },
  rankingContent: {
    padding: SPACE.md,
    paddingBottom: 120,
    width: '100%',
    maxWidth: SIZES.contentMax,
    alignSelf: 'center',
  },
  rankingTabs: { marginBottom: SPACE.sm },
});
