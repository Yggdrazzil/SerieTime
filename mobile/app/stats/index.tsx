import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, Image } from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';
import { useRouter, type Href } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useQuery } from '@tanstack/react-query';
import { api, tmdbImage } from '@/lib/api';
import { goBack } from '@/lib/nav';
import { watchTime } from '@/lib/format';
import { COLORS, FONTS, RADIUS, SHADOW, SIZES, SPACE } from '@/lib/theme';
import { ScreenShell, ScreenHeader, SectionHeader, SegmentedFilter, PrismeCard, ProgressBar, IconAction } from '@/components/prisme';
import { Loading, LoadError, EmptyState } from '@/components/ui';
import { AppearItem, FadeSwitch } from '@/components/anim';

// ---------------------------------------------------------------------------
// Statistiques — composition PlotTime originale (refonte 2026-07-20) :
// héro « temps » en dégradé, tuiles, barres arrondies dégradées, genres en
// barres proportionnelles, chaînes en chips. Trois univers : Séries / Films /
// Jeux (le temps de jeu est 100 % déclaratif, modifiable sur chaque fiche).
// ---------------------------------------------------------------------------

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
type GameStats = {
  tracked: number; playing: number; completed: number; abandoned: number;
  wishlist: number; owned: number; minutes: number;
  topByPlaytime: { id: string; title: string; posterPath: string | null; minutes: number }[];
  genres: { name: string; count: number }[];
};
// `games` optionnel : absent tant que le serveur de prod n'est pas redéployé.
type Detailed = { series: SeriesStats; movies: MovieStats; games?: GameStats };

type StatTab = 'series' | 'movies' | 'games';
const TAB_OPTIONS = [
  { value: 'series', label: 'Séries' },
  { value: 'movies', label: 'Films' },
  { value: 'games', label: 'Jeux' },
] as const;

// « 3 mois 12 j 8 h » — zéros de tête omis, heures toujours affichées.
function durParts(minutes: number): [number, string][] {
  const t = watchTime(minutes);
  const parts: [number, string][] = [];
  if (t.months) parts.push([t.months, t.months > 1 ? 'mois' : 'mois']);
  if (t.days || t.months) parts.push([t.days, 'j']);
  parts.push([t.hours, 'h']);
  return parts;
}

export default function StatsScreen() {
  const [tab, setTab] = useState<StatTab>('series');
  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['stats', 'detailed'],
    queryFn: () => api.get<Detailed>('/api/stats/detailed'),
    staleTime: 5 * 60_000,
  });

  return (
    <ScreenShell scroll contentContainerStyle={styles.content}>
      <ScreenHeader
        title="Statistiques"
        leading={<IconAction icon="chevron-left" label="Retour" onPress={() => goBack('/profile')} />}
      />
      <SegmentedFilter options={TAB_OPTIONS} value={tab} onChange={setTab} accessibilityLabel="Choisir l'univers des statistiques" />
      {isLoading ? (
        <Loading />
      ) : isError || !data ? (
        <LoadError onRetry={refetch} busy={isRefetching} />
      ) : (
        <FadeSwitch trigger={tab}>
          <View style={styles.list}>
            {tab === 'series' ? <SeriesTab s={data.series} /> : tab === 'movies' ? <MoviesTab m={data.movies} /> : <GamesTab g={data.games} />}
          </View>
        </FadeSwitch>
      )}
    </ScreenShell>
  );
}

// ===== SÉRIES ================================================================

function SeriesTab({ s }: { s: SeriesStats }) {
  return (
    <>
      <AppearItem index={0}>
        <HeroTime
          colors={['#41288A', '#6D4ED1', '#EF5BA8']}
          icon="tv"
          eyebrow="Temps devant des séries"
          minutes={s.minutes}
          subline={`${s.episodesWatched.toLocaleString('fr-FR')} épisodes vus · ${s.episodesLast7d} ces 7 derniers jours`}
        />
      </AppearItem>
      <AppearItem index={1}>
        <View style={styles.duoRow}>
          <DuoTile value={s.showsAdded.toLocaleString('fr-FR')} label="séries suivies" />
          <DuoTile value={s.showsInProduction.toLocaleString('fr-FR')} label="toujours en production" />
        </View>
      </AppearItem>
      <AppearItem index={2}>
        <WeeklyChart title="Rythme des 12 dernières semaines" unit="épisodes / semaine" data={s.weekly.map((w) => ({ label: w.label, value: w.episodes }))} />
      </AppearItem>
      <AppearItem index={3}>
        <RankBars title="Genres favoris" eyebrow="Ta bibliothèque séries" rows={s.genres} unit="séries" />
      </AppearItem>
      <AppearItem index={4}>
        <ChipCloud title="Chaînes & plateformes" rows={s.networks} />
      </AppearItem>
      {s.marathons.length ? (
        <AppearItem index={5}>
          <Marathons rows={s.marathons} />
        </AppearItem>
      ) : null}
      <AppearItem index={6}>
        <CompareButton href="/stats/leaderboard?type=series" />
      </AppearItem>
      <AppearItem index={7}>
        <BadgesLink />
      </AppearItem>
    </>
  );
}

// ===== FILMS =================================================================

function MoviesTab({ m }: { m: MovieStats }) {
  return (
    <>
      <AppearItem index={0}>
        <HeroTime
          colors={['#2D65A8', '#6D4ED1', '#EF5BA8']}
          icon="film"
          eyebrow="Temps devant des films"
          minutes={m.minutes}
          subline={`${m.moviesWatched.toLocaleString('fr-FR')} films vus · ${m.moviesLast7d} ces 7 derniers jours`}
        />
      </AppearItem>
      <AppearItem index={1}>
        <View style={styles.duoRow}>
          <DuoTile value={m.moviesWatched.toLocaleString('fr-FR')} label="films vus" />
          <DuoTile value={m.moviesAdded.toLocaleString('fr-FR')} label="films dans ta bibliothèque" />
        </View>
      </AppearItem>
      <AppearItem index={2}>
        <WeeklyChart title="Rythme des 12 dernières semaines" unit="films / semaine" data={m.weekly.map((w) => ({ label: w.label, value: w.count }))} />
      </AppearItem>
      <AppearItem index={3}>
        <RankBars title="Genres favoris" eyebrow="Ta bibliothèque films" rows={m.genres} unit="films" />
      </AppearItem>
      <AppearItem index={4}>
        <CompareButton href="/stats/leaderboard?type=movies" />
      </AppearItem>
    </>
  );
}

// ===== JEUX ==================================================================

function GamesTab({ g }: { g?: GameStats }) {
  const router = useRouter();
  if (!g) {
    return (
      <EmptyState
        title="Statistiques jeux indisponibles"
        message="Le serveur doit être mis à jour pour exposer les statistiques de jeu. Reviens après le prochain déploiement."
      />
    );
  }
  return (
    <>
      <AppearItem index={0}>
        <HeroTime
          colors={['#B4690E', '#FBAE00', '#EF5BA8']}
          ionicon="game-controller-outline"
          eyebrow="Temps de jeu déclaré"
          minutes={g.minutes}
          subline={
            g.minutes > 0
              ? `${g.tracked.toLocaleString('fr-FR')} jeux suivis — temps déclaré par toi (et Steam)`
              : 'Déclare tes heures depuis la fiche d’un jeu pour remplir ce compteur.'
          }
        />
      </AppearItem>
      <AppearItem index={1}>
        <View style={styles.duoRow}>
          <DuoTile value={g.playing.toLocaleString('fr-FR')} label="en cours" />
          <DuoTile value={g.completed.toLocaleString('fr-FR')} label="terminés" />
        </View>
      </AppearItem>
      <AppearItem index={2}>
        <View style={styles.duoRow}>
          <DuoTile value={g.abandoned.toLocaleString('fr-FR')} label="abandonnés" />
          <DuoTile value={g.owned.toLocaleString('fr-FR')} label="possédés" />
        </View>
      </AppearItem>
      <AppearItem index={3}>
        <View style={styles.duoRow}>
          <DuoTile value={g.wishlist.toLocaleString('fr-FR')} label="voulus" />
          <DuoTile value={g.tracked.toLocaleString('fr-FR')} label="suivis en tout" />
        </View>
      </AppearItem>
      {g.topByPlaytime.length ? (
        <AppearItem index={4}>
          <View>
            <SectionHeader title="Tes plus grosses sessions" eyebrow="Temps déclaré par jeu — modifiable sur chaque fiche" />
            <PrismeCard elevated>
              {g.topByPlaytime.map((row, i) => (
                <Pressable
                  key={row.id}
                  style={({ pressed }) => [styles.topRow, i > 0 && styles.topRowBorder, pressed && styles.topRowPressed]}
                  onPress={() => router.push(`/game/${row.id}` as Href)}
                  accessibilityRole="button"
                  accessibilityLabel={`${row.title}, ${Math.round(row.minutes / 60)} heures — ouvrir la fiche pour modifier`}
                >
                  {tmdbImage(row.posterPath, 'w185') ? (
                    <Image source={{ uri: tmdbImage(row.posterPath, 'w185')! }} style={styles.topPoster} resizeMode="cover" />
                  ) : (
                    <View style={[styles.topPoster, styles.topPosterEmpty]}>
                      <Ionicons name="game-controller-outline" size={16} color={COLORS.textSoft} />
                    </View>
                  )}
                  <Text style={styles.topTitle} numberOfLines={1}>
                    {row.title}
                  </Text>
                  <Text style={styles.topHours}>{Math.round(row.minutes / 60)} h</Text>
                  <Feather name="chevron-right" size={17} color={COLORS.textMuted} />
                </Pressable>
              ))}
            </PrismeCard>
          </View>
        </AppearItem>
      ) : null}
      <AppearItem index={5}>
        <RankBars title="Genres favoris" eyebrow="Ta bibliothèque jeux" rows={g.genres} unit="jeux" />
      </AppearItem>
    </>
  );
}

// ===== Composants de composition ============================================

// Carte héro « temps » : dégradé, durée décomposée mois / j / h.
function HeroTime({
  colors,
  icon,
  ionicon,
  eyebrow,
  minutes,
  subline,
}: {
  colors: [string, string, string];
  icon?: keyof typeof Feather.glyphMap;
  ionicon?: keyof typeof Ionicons.glyphMap;
  eyebrow: string;
  minutes: number;
  subline: string;
}) {
  const parts = durParts(minutes);
  return (
    <View
      style={styles.hero}
      accessible
      accessibilityLabel={`${eyebrow} : ${parts.map(([v, u]) => `${v} ${u}`).join(' ')}. ${subline}`}
    >
      <LinearGradient colors={colors} start={{ x: 0, y: 0 }} end={{ x: 1.1, y: 1.2 }} style={StyleSheet.absoluteFill} />
      <View style={styles.heroBlob} />
      <View style={styles.heroHead}>
        <View style={styles.heroIcon}>
          {ionicon ? <Ionicons name={ionicon} size={17} color="#FFFFFF" /> : <Feather name={icon ?? 'clock'} size={17} color="#FFFFFF" />}
        </View>
        <Text style={styles.heroEyebrow}>{eyebrow.toUpperCase()}</Text>
      </View>
      <View style={styles.heroParts}>
        {parts.map(([v, u], i) => (
          <View key={i} style={styles.heroPart}>
            <Text style={styles.heroValue}>{v}</Text>
            <Text style={styles.heroUnit}>{u}</Text>
          </View>
        ))}
      </View>
      <Text style={styles.heroSub}>{subline}</Text>
    </View>
  );
}

function DuoTile({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.tile} accessible accessibilityLabel={`${value} ${label}`}>
      <Text style={styles.tileValue} numberOfLines={1}>
        {value}
      </Text>
      <Text style={styles.tileLabel} numberOfLines={2}>
        {label}
      </Text>
    </View>
  );
}

// Barres hebdo arrondies en dégradé — la semaine courante est pleine, les
// précédentes adoucies.
function WeeklyChart({ title, unit, data }: { title: string; unit: string; data: { label: string; value: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const H = 110;
  return (
    <View>
      <SectionHeader title={title} eyebrow={unit} />
      <PrismeCard elevated>
        <View style={styles.chartRow} accessible accessibilityLabel={`${title} : ${data.map((d) => `${d.label} ${d.value}`).join(', ')}`}>
          {data.map((d, i) => {
            const last = i === data.length - 1;
            const h = Math.max(4, (d.value / max) * H);
            return (
              <View key={i} style={styles.barCol}>
                <Text style={[styles.barVal, last && styles.barValNow]}>{d.value || ''}</Text>
                <View style={[styles.barTrack, { height: H }]}>
                  <LinearGradient
                    colors={[COLORS.secondary, COLORS.primary]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 0, y: 1 }}
                    style={[styles.barFill, { height: h, opacity: last ? 1 : 0.45 }]}
                  />
                </View>
                <Text style={styles.barLabel}>{d.label}</Text>
              </View>
            );
          })}
        </View>
      </PrismeCard>
    </View>
  );
}

// Classement en barres proportionnelles (remplace les tableaux à deux colonnes).
function RankBars({ title, eyebrow, rows, unit }: { title: string; eyebrow: string; rows: { name: string; count: number }[]; unit: string }) {
  if (rows.length === 0) return null;
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <View>
      <SectionHeader title={title} eyebrow={eyebrow} />
      <PrismeCard elevated>
        <View style={{ gap: SPACE.sm }}>
          {rows.map((r, i) => (
            <View key={r.name} accessible accessibilityLabel={`${r.name}, ${r.count} ${unit}`}>
              <View style={styles.rankHead}>
                <Text style={styles.rankName} numberOfLines={1}>
                  {r.name}
                </Text>
                <Text style={styles.rankVal}>{r.count}</Text>
              </View>
              <View style={styles.rankTrack}>
                <LinearGradient
                  colors={[COLORS.secondary, COLORS.primary]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={[styles.rankFill, { width: `${Math.max(6, (r.count / max) * 100)}%`, opacity: 1 - i * 0.09 }]}
                />
              </View>
            </View>
          ))}
        </View>
      </PrismeCard>
    </View>
  );
}

// Chaînes & plateformes en chips comptées.
function ChipCloud({ title, rows }: { title: string; rows: { name: string; count: number }[] }) {
  if (rows.length === 0) return null;
  return (
    <View>
      <SectionHeader title={title} eyebrow="Là où tu regardes" />
      <PrismeCard elevated>
        <View style={styles.chips}>
          {rows.map((r) => (
            <View key={r.name} style={styles.chip} accessible accessibilityLabel={`${r.name}, ${r.count} séries`}>
              <Text style={styles.chipName} numberOfLines={1}>
                {r.name}
              </Text>
              <View style={styles.chipCount}>
                <Text style={styles.chipCountText}>{r.count}</Text>
              </View>
            </View>
          ))}
        </View>
      </PrismeCard>
    </View>
  );
}

const RANK_MEDAL = ['#D4A017', '#9AA2AA', '#CD7F32'];

function Marathons({ rows }: { rows: { title: string; episodes: number; hours: number }[] }) {
  return (
    <View>
      <SectionHeader title="Plus gros marathons" eyebrow="Max d'épisodes d'une série en un jour" />
      <PrismeCard elevated>
        {rows.map((m, i) => (
          <View key={`${m.title}-${i}`} style={[styles.maraRow, i > 0 && styles.topRowBorder]} accessible accessibilityLabel={`${m.title}, ${m.episodes} épisodes, ${m.hours} heures`}>
            <View style={[styles.maraRank, { backgroundColor: RANK_MEDAL[i] ?? COLORS.surfaceMuted }]}>
              <Text style={[styles.maraRankText, i < 3 && { color: '#FFFFFF' }]}>{i + 1}</Text>
            </View>
            <Text style={styles.topTitle} numberOfLines={1}>
              {m.title}
            </Text>
            <Text style={styles.maraMeta}>
              {m.episodes} ép. · {m.hours} h
            </Text>
          </View>
        ))}
      </PrismeCard>
    </View>
  );
}

function CompareButton({ href }: { href: string }) {
  const router = useRouter();
  return (
    <Pressable
      style={({ pressed }) => [styles.compareBtn, pressed && styles.comparePressed]}
      onPress={() => router.push(href as Href)}
      accessibilityRole="button"
      accessibilityLabel="Comparer avec les personnes que tu suis"
    >
      <Feather name="users" size={17} color={COLORS.onPrimary} />
      <Text style={styles.compareText}>Comparer avec mes abonnements</Text>
    </Pressable>
  );
}

// Accès aux succès, avec progression.
function BadgesLink() {
  const router = useRouter();
  const { data } = useQuery({
    queryKey: ['stats', 'badges'],
    queryFn: () => api.get<{ earned: number; total: number }>('/api/stats/badges'),
    staleTime: 60_000,
  });
  return (
    <PrismeCard
      elevated
      onPress={() => router.push('/stats/badges')}
      accessibilityLabel={data ? `Badges : ${data.earned} sur ${data.total} débloqués` : 'Badges'}
      accessibilityHint="Ouvre la page des succès"
    >
      <View style={styles.badgesRow}>
        <View style={styles.badgesIcon}>
          <Feather name="award" size={19} color={COLORS.onAccent} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.badgesTitle}>Badges</Text>
          {data ? <Text style={styles.badgesSub}>{data.earned} sur {data.total} débloqués</Text> : null}
        </View>
        <Feather name="chevron-right" size={20} color={COLORS.primary} />
      </View>
      {data && data.total > 0 ? <ProgressBar value={(data.earned / data.total) * 100} label="Badges débloqués" style={{ marginTop: SPACE.sm }} /> : null}
    </PrismeCard>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: SPACE.xl },
  list: { gap: SPACE.sm, paddingTop: SPACE.sm },
  // Héro temps.
  hero: { borderRadius: RADIUS.sheet, overflow: 'hidden', padding: SPACE.md, ...SHADOW.card },
  heroBlob: {
    position: 'absolute',
    width: 170,
    height: 170,
    borderRadius: 85,
    backgroundColor: 'rgba(255,255,255,0.14)',
    right: -48,
    top: -58,
  },
  heroHead: { flexDirection: 'row', alignItems: 'center', gap: SPACE.xs },
  heroIcon: {
    width: 30,
    height: 30,
    borderRadius: RADIUS.control,
    backgroundColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroEyebrow: { flex: 1, color: 'rgba(255,255,255,0.85)', fontFamily: FONTS.bold, fontSize: 11, letterSpacing: 1.1 },
  heroParts: { flexDirection: 'row', alignItems: 'flex-end', gap: SPACE.md, marginTop: SPACE.sm },
  heroPart: { flexDirection: 'row', alignItems: 'flex-end', gap: 4 },
  heroValue: { color: '#FFFFFF', fontFamily: FONTS.extraBold, fontSize: 40, lineHeight: 44 },
  heroUnit: { color: 'rgba(255,255,255,0.85)', fontFamily: FONTS.semiBold, fontSize: 16, marginBottom: 5 },
  heroSub: { color: 'rgba(255,255,255,0.88)', fontFamily: FONTS.regular, fontSize: 13, lineHeight: 18, marginTop: SPACE.xs },
  // Tuiles duo.
  duoRow: { flexDirection: 'row', gap: SPACE.sm },
  tile: {
    flex: 1,
    minHeight: 84,
    justifyContent: 'center',
    paddingHorizontal: SPACE.md,
    paddingVertical: SPACE.sm,
    borderRadius: RADIUS.card,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    backgroundColor: COLORS.surface,
    ...SHADOW.card,
  },
  tileValue: { color: COLORS.text, fontSize: 24, lineHeight: 30, fontFamily: FONTS.extraBold },
  tileLabel: { color: COLORS.textMuted, fontSize: 13, lineHeight: 17, fontFamily: FONTS.regular, marginTop: 1 },
  // Graphique hebdo.
  chartRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 4 },
  barCol: { flex: 1, alignItems: 'center' },
  barVal: { fontSize: 10, fontFamily: FONTS.bold, color: COLORS.textSoft, height: 14 },
  barValNow: { color: COLORS.primary },
  barTrack: { width: '68%', justifyContent: 'flex-end' },
  barFill: { width: '100%', borderRadius: RADIUS.pill },
  barLabel: { fontSize: 9.5, fontFamily: FONTS.regular, color: COLORS.textMuted, marginTop: 5 },
  // Barres proportionnelles.
  rankHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: SPACE.sm, marginBottom: 5 },
  rankName: { flexShrink: 1, color: COLORS.text, fontSize: 14, fontFamily: FONTS.semiBold },
  rankVal: { color: COLORS.textMuted, fontSize: 13, fontFamily: FONTS.extraBold },
  rankTrack: { height: 8, borderRadius: RADIUS.pill, backgroundColor: COLORS.surfaceMuted, overflow: 'hidden' },
  rankFill: { height: '100%', borderRadius: RADIUS.pill },
  // Chips.
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.xs },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.xs,
    maxWidth: '100%',
    paddingLeft: SPACE.sm,
    paddingRight: 5,
    paddingVertical: 5,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.surfaceMuted,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
  },
  chipName: { flexShrink: 1, color: COLORS.text, fontSize: 13, fontFamily: FONTS.semiBold },
  chipCount: { minWidth: 24, height: 24, borderRadius: 12, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  chipCountText: { color: COLORS.onPrimary, fontSize: 11, fontFamily: FONTS.extraBold },
  // Top jeux / marathons.
  topRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, paddingVertical: SPACE.xs, minHeight: SIZES.touch },
  topRowBorder: { borderTopWidth: 1, borderTopColor: COLORS.borderLight },
  topRowPressed: { opacity: 0.7 },
  topPoster: { width: 34, height: 46, borderRadius: RADIUS.small, backgroundColor: COLORS.imagePlaceholder },
  topPosterEmpty: { alignItems: 'center', justifyContent: 'center' },
  topTitle: { flex: 1, color: COLORS.text, fontSize: 14.5, fontFamily: FONTS.semiBold },
  topHours: { color: COLORS.primary, fontSize: 14, fontFamily: FONTS.extraBold },
  maraRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, paddingVertical: SPACE.xs, minHeight: SIZES.touch },
  maraRank: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  maraRankText: { fontSize: 12.5, fontFamily: FONTS.extraBold, color: COLORS.textMuted },
  maraMeta: { color: COLORS.textMuted, fontSize: 13, fontFamily: FONTS.bold },
  // Comparer.
  compareBtn: {
    minHeight: SIZES.touchComfortable,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACE.xs,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.primary,
  },
  comparePressed: { opacity: 0.86, transform: [{ scale: 0.99 }] },
  compareText: { color: COLORS.onPrimary, fontSize: 14, fontFamily: FONTS.extraBold },
  // Badges.
  badgesRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm },
  badgesIcon: { width: 38, height: 38, borderRadius: RADIUS.control, backgroundColor: COLORS.yellow, alignItems: 'center', justifyContent: 'center' },
  badgesTitle: { color: COLORS.text, fontSize: 16, fontFamily: FONTS.extraBold },
  badgesSub: { color: COLORS.textMuted, fontSize: 13, fontFamily: FONTS.regular, marginTop: 1 },
});
