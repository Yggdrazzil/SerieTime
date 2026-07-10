import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { watchTime } from '@/lib/format';
import { COLORS, FONTS } from '@/lib/theme';
import { PageHeader } from '@/components/PageHeader';
import { TopTabs, Loading, LoadError } from '@/components/ui';

type Bar = { label: string };
type SeriesStats = {
  episodesWatched: number; episodesLast7d: number; minutes: number;
  showsAdded: number; showsInProduction: number;
  weekly: (Bar & { episodes: number; hours: number })[];
  genres: { name: string; count: number }[];
  networks: { name: string; count: number }[];
  marathons: { title: string; episodes: number; hours: number }[];
};
type MovieStats = {
  moviesWatched: number; moviesLast7d: number; minutes: number; moviesAdded: number;
  weekly: (Bar & { count: number; hours: number })[];
  genres: { name: string; count: number }[];
};
type Detailed = { series: SeriesStats; movies: MovieStats };

export default function StatsScreen() {
  const [tab, setTab] = useState('SÉRIES');
  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['stats', 'detailed'],
    queryFn: () => api.get<Detailed>('/api/stats/detailed'),
    staleTime: 5 * 60_000,
  });

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.pageMuted }}>
      <PageHeader title="Statistiques" />
      <View style={{ backgroundColor: COLORS.white }}>
        <TopTabs tabs={['SÉRIES', 'FILMS']} active={tab} onChange={setTab} />
      </View>
      {isLoading ? (
        <Loading />
      ) : isError || !data ? (
        <LoadError onRetry={refetch} busy={isRefetching} />
      ) : tab === 'SÉRIES' ? (
        <SeriesTab s={data.series} />
      ) : (
        <MoviesTab m={data.movies} />
      )}
    </View>
  );
}

function SeriesTab({ s }: { s: SeriesStats }) {
  const t = watchTime(s.minutes);
  return (
    <ScrollView contentContainerStyle={styles.list}>
      <BigCard title="Temps passé devant des épisodes" bigParts={[[t.months, 'MOIS'], [t.days, 'JOURS'], [t.hours, 'HEURES']]} />
      <Card title="Nombre total d'épisodes vus">
        <Text style={styles.huge}>{s.episodesWatched.toLocaleString('fr-FR')}</Text>
        <Text style={styles.sub}>{s.episodesLast7d} lors des 7 derniers jours</Text>
      </Card>
      <Card title="Épisodes vus (par semaine)">
        <BarChart data={s.weekly.map((w) => ({ label: w.label, value: w.episodes }))} unit="ÉPISODES" />
      </Card>
      <Card title="Temps passé (par semaine)">
        <BarChart data={s.weekly.map((w) => ({ label: w.label, value: w.hours }))} unit="HEURES" />
      </Card>
      <Card title="Séries ajoutées">
        <Text style={styles.huge}>{s.showsAdded}</Text>
        <Text style={styles.sub}>{s.showsInProduction} toujours en production</Text>
      </Card>
      <RankCard title="Meilleurs genres de séries" col="SÉRIES" rows={s.genres.map((g) => [g.name, g.count])} />
      <RankCard title="Meilleures chaînes de séries" col="SÉRIES" rows={s.networks.map((n) => [n.name, n.count])} />
      {s.marathons.length ? (
        <RankCard title="Plus longs marathons" col="ÉPISODES" rows={s.marathons.map((m) => [m.title, m.episodes])} />
      ) : null}
    </ScrollView>
  );
}

function MoviesTab({ m }: { m: MovieStats }) {
  const t = watchTime(m.minutes);
  return (
    <ScrollView contentContainerStyle={styles.list}>
      <BigCard title="Temps passé à regarder des films" bigParts={[[t.months, 'MOIS'], [t.days, 'JOURS'], [t.hours, 'HEURES']]} />
      <Card title="Nombre total de films vus">
        <Text style={styles.huge}>{m.moviesWatched.toLocaleString('fr-FR')}</Text>
        <Text style={styles.sub}>{m.moviesLast7d} lors des 7 derniers jours</Text>
      </Card>
      <Card title="Films vus (par semaine)">
        <BarChart data={m.weekly.map((w) => ({ label: w.label, value: w.count }))} unit="FILMS" />
      </Card>
      <Card title="Films ajoutés">
        <Text style={styles.huge}>{m.moviesAdded}</Text>
      </Card>
      <RankCard title="Meilleurs genres de films" col="FILMS" rows={m.genres.map((g) => [g.name, g.count])} />
    </ScrollView>
  );
}

// --- Composants ---

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      {children}
    </View>
  );
}

function BigCard({ title, bigParts }: { title: string; bigParts: [number, string][] }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6, marginTop: 4 }}>
        {bigParts.map(([v, l], i) => (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 4 }}>
            <Text style={styles.big}>{v}</Text>
            <Text style={styles.bigUnit}>{l.toLowerCase()}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

// Graphique en barres maison (pas de lib) — dernière barre en vert (semaine courante).
function BarChart({ data, unit }: { data: { label: string; value: number }[]; unit: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const H = 130;
  return (
    <View style={{ marginTop: 10 }}>
      <Text style={styles.axis}>{unit}</Text>
      <View style={styles.chartRow}>
        {data.map((d, i) => {
          const last = i === data.length - 1;
          return (
            <View key={i} style={styles.barCol}>
              <Text style={styles.barVal}>{d.value || ''}</Text>
              <View style={[styles.bar, { height: Math.max(2, (d.value / max) * H), backgroundColor: last ? COLORS.green : '#8a8a8a' }]} />
              <Text style={styles.barLabel}>{d.label}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function RankCard({ title, col, rows }: { title: string; col: string; rows: [string, number][] }) {
  if (rows.length === 0) return null;
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      <View style={styles.rankHead}>
        <Text style={styles.rankHeadText}>{title.includes('genre') ? 'GENRE' : title.includes('chaîne') ? 'CHAÎNE' : 'SÉRIE'}</Text>
        <Text style={styles.rankHeadText}>{col}</Text>
      </View>
      {rows.map(([name, count], i) => (
        <View key={i} style={styles.rankRow}>
          <Text style={styles.rankName} numberOfLines={1}>{name}</Text>
          <Text style={styles.rankVal}>{count}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { padding: 12, gap: 12, paddingBottom: 32 },
  card: { backgroundColor: COLORS.white, borderRadius: 12, padding: 18, borderWidth: 1, borderColor: COLORS.borderLight },
  cardTitle: { fontSize: 19, fontFamily: FONTS.extraBold, marginBottom: 6 },
  huge: { fontSize: 40, fontFamily: FONTS.extraBold, marginTop: 4 },
  big: { fontSize: 34, fontFamily: FONTS.extraBold },
  bigUnit: { fontSize: 15, fontFamily: FONTS.regular, color: COLORS.textMuted, marginBottom: 4 },
  sub: { fontFamily: FONTS.regular, fontSize: 14, color: COLORS.textMuted, textTransform: 'uppercase', marginTop: 2 },
  axis: { fontSize: 10, fontFamily: FONTS.bold, color: COLORS.textMuted, letterSpacing: 0.5, marginBottom: 6 },
  chartRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', height: 165, gap: 3 },
  barCol: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  barVal: { fontSize: 11, fontFamily: FONTS.bold, marginBottom: 3, color: COLORS.textMuted, height: 14 },
  bar: { width: '72%', borderRadius: 3 },
  barLabel: { fontSize: 10, fontFamily: FONTS.regular, color: COLORS.textMuted, marginTop: 5 },
  rankHead: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8, marginBottom: 4 },
  rankHeadText: { fontSize: 11, fontFamily: FONTS.bold, color: COLORS.textMuted, letterSpacing: 0.5 },
  rankRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 11, borderTopWidth: 1, borderTopColor: COLORS.borderLight, gap: 12 },
  rankName: { flex: 1, fontSize: 16, fontFamily: FONTS.regular },
  rankVal: { fontSize: 16, fontFamily: FONTS.bold },
});
