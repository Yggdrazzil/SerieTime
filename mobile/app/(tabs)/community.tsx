import React, { useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, type Href } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { usePullRefresh } from '@/lib/usePullRefresh';
import { COLORS, SIZES, SPACE } from '@/lib/theme';
import { IconAction, SegmentedFilter, TabHeader } from '@/components/prisme';
import { EmptyState, Loading, LoadError } from '@/components/ui';
import { FadeSwitch } from '@/components/anim';
import { useTabResetSeq } from '@/lib/tabReset';
import { WeeklyChallengeCard } from '@/components/community';
import { DiscussionsTab, FriendsHQTab } from '@/components/communityHQ';
import { LeaderboardBoard, type Leaderboard } from '../stats/leaderboard';

// Onglet Communauté (refonte V1, 2026-07-20) : trois segments — « Amis »
// (le QG : qui regarde quoi, visionnages récents + kudos, derniers badges,
// recommandations), « Défis » (défi hebdo + classement entre amis) et
// « Discussions » (fils de commentaires actifs chez les amis). La recherche
// de profils vit désormais sur l'écran poussé /friends (loupe en en-tête).
type CommunityTab = 'amis' | 'defis' | 'discussions';
const TAB_OPTIONS: { value: CommunityTab; label: string }[] = [
  { value: 'amis', label: 'Amis' },
  { value: 'defis', label: 'Défis' },
  { value: 'discussions', label: 'Discussions' },
];

export default function CommunityScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const resetSeq = useTabResetSeq('community');
  const [tab, setTab] = useState<CommunityTab>('amis');

  return (
    <View key={resetSeq} style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top }]}>
        <TabHeader
          title="Communauté"
          trailing={
            <IconAction
              icon="search"
              label="Trouver des amis"
              onPress={() => router.push('/friends' as Href)}
            />
          }
        />
        <SegmentedFilter
          options={TAB_OPTIONS}
          value={tab}
          onChange={setTab}
          accessibilityLabel="Choisir la vue communauté"
          style={styles.tabs}
        />
      </View>
      <FadeSwitch trigger={tab}>
        {tab === 'amis' ? (
          <FriendsHQTab />
        ) : tab === 'defis' ? (
          <ChallengesSection />
        ) : (
          <DiscussionsTab />
        )}
      </FadeSwitch>
    </View>
  );
}

// Segment « Défis » : défi hebdo + classement entre amis (temps séries /
// films) — même tableau que l'écran Stats, embarqué directement dans l'onglet.
function ChallengesSection() {
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<'series' | 'movies'>('series');
  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['stats', 'leaderboard'],
    queryFn: () => api.get<Leaderboard>('/api/stats/leaderboard'),
    staleTime: 5 * 60_000,
  });
  const entries = kind === 'movies' ? data?.movies : data?.series;
  // Tirer pour rafraîchir : leaderboard + défi hebdo (requête interne à
  // WeeklyChallengeCard, relancée via son queryKey).
  const { refreshing, onRefresh } = usePullRefresh([
    refetch,
    () => queryClient.refetchQueries({ queryKey: ['social', 'challenge', 'weekly'] }),
  ]);

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      contentContainerStyle={styles.challengesContent}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={COLORS.primary}
          colors={[COLORS.primary]}
        />
      }
    >
      <WeeklyChallengeCard />
      <SegmentedFilter
        options={[
          { value: 'series', label: 'Séries' },
          { value: 'movies', label: 'Films' },
        ]}
        value={kind}
        onChange={setKind}
        accessibilityLabel="Filtrer le classement"
        style={styles.challengesTabs}
      />
      {isLoading ? (
        <Loading />
      ) : isError || !entries ? (
        <LoadError onRetry={refetch} busy={isRefetching} />
      ) : entries.length <= 1 ? (
        <EmptyState
          title="Personne à comparer"
          message="Suis des amis (loupe en haut de l'onglet) pour lancer le classement."
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
  challengesContent: {
    padding: SPACE.md,
    paddingBottom: 120,
    width: '100%',
    maxWidth: SIZES.contentMax,
    alignSelf: 'center',
  },
  challengesTabs: { marginBottom: SPACE.sm },
});
