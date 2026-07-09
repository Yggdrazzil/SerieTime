import React, { useState } from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { api, tmdbImage } from '@/lib/api';
import type { MediaDto } from '@/lib/types';
import { COLORS } from '@/lib/theme';
import { PillHeader, TopTabs, EmptyState, Loading, LoadError, Poster } from '@/components/ui';
import { AppearItem, FadeSwitch } from '@/components/anim';
import { useTabResetSeq } from '@/lib/tabReset';

type MoviesResponse = { toWatch: MediaDto[]; upcoming: { media: MediaDto; releaseDate: string }[] };

export default function MoviesScreen() {
  // Re-clic sur l'onglet « Films » : remontage complet (état + scroll par défaut).
  const resetSeq = useTabResetSeq('movies');
  return <MoviesScreenInner key={resetSeq} />;
}

function MoviesScreenInner() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [tab, setTab] = useState('À VOIR');
  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['movies'],
    queryFn: () => api.get<MoviesResponse>('/api/movies'),
  });

  const grid = (items: MediaDto[]) => (
    <View style={styles.grid}>
      {items.map((m, i) => (
        // Cascade d'apparition des affiches (délai plafonné dans AppearItem).
        <AppearItem key={m.id} index={i} style={styles.cell}>
          <Poster title={m.title} uri={tmdbImage(m.posterPath)} onPress={() => router.push(`/show/${m.id}?type=movie`)} />
        </AppearItem>
      ))}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.white }}>
      <View style={{ paddingTop: insets.top, backgroundColor: COLORS.white }}>
        <TopTabs tabs={['À VOIR', 'À VENIR']} active={tab} onChange={setTab} />
      </View>
      {isLoading ? (
        <Loading />
      ) : isError && !data ? (
        <LoadError onRetry={refetch} busy={isRefetching} />
      ) : (
        <FadeSwitch trigger={tab}>
        <ScrollView contentContainerStyle={{ paddingBottom: 20 }}>
          {tab === 'À VOIR' ? (
            <>
              <PillHeader label="À VOIR" />
              {data && data.toWatch.length > 0 ? grid(data.toWatch) : <EmptyState title="Aucun film à voir" />}
            </>
          ) : (
            <>
              {data && data.upcoming.length > 0 ? (
                <>
                  <PillHeader label="À VENIR" />
                  {grid(data.upcoming.map((u) => u.media))}
                </>
              ) : (
                <EmptyState title="Aucun film à venir" />
              )}
            </>
          )}
        </ScrollView>
        </FadeSwitch>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 4, gap: 4 },
  cell: { width: '32.5%' },
});
