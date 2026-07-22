import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Image, useWindowDimensions } from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';
import { useRouter, type Href } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { api, tmdbImage } from '@/lib/api';
import type { GamificationMeDto, MediaDto, ProfileStatsDto } from '@/lib/types';
import { watchTime } from '@/lib/format';
import { COLORS, FONTS, RADIUS, SHADOW, SIZES, SPACE } from '@/lib/theme';
import { Loading, LoadError, Poster } from '@/components/ui';
import { AppearItem } from '@/components/anim';
import { TabHeader } from '@/components/prisme';
import { useTabResetSeq } from '@/lib/tabReset';
import { usePullRefresh } from '@/lib/usePullRefresh';
import { PullToRefresh } from '@/components/PullToRefresh';
import { sortFavorites } from '@/components/favorites';
import { useAppStore } from '@/lib/store';

export type ProfileUser = {
  displayName: string;
  email?: string | null;
  avatarUrl?: string | null;
  coverUrl?: string | null;
  birthYear?: number | null;
  gender?: string | null;
  countryCode?: string;
};

type ProfileResponse = {
  user: ProfileUser;
  social?: { followingCount: number; followersCount: number; commentsCount: number };
  stats: ProfileStatsDto;
  lists: { id: string; title: string; posterPaths: string[] }[];
  shows: MediaDto[];
  favoriteShows: MediaDto[];
  movies: MediaDto[];
  favoriteMovies: MediaDto[];
  games: MediaDto[];
  favoriteGames: MediaDto[];
};

export default function ProfileScreen() {
  // Re-clic sur l'onglet « Profil » : remontage complet (scroll par défaut).
  const resetSeq = useTabResetSeq('profile');
  return <ProfileScreenInner key={resetSeq} />;
}

function ProfileScreenInner() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const contentWidth = Math.max(220, Math.min(width, SIZES.contentMax) - SPACE.md * 2);
  const [activeListIndex, setActiveListIndex] = useState(0);

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['profile'],
    queryFn: () => api.get<ProfileResponse>('/api/profile'),
  });
  // Gamification (spec 2026-07-16 §10) : niveau + titre sur la bannière, streak.
  const { data: gamification } = useQuery({
    queryKey: ['gamification', 'me'],
    queryFn: () => api.get<GamificationMeDto>('/api/gamification/me'),
    staleTime: 30_000,
  });

  const { refreshing, onRefresh } = usePullRefresh([refetch]);
  // Tri choisi sur les pages « préférés » (persisté) : appliqué aussi ici.
  const favSort = useAppStore((s) => s.favSort);

  if (isLoading)
    return (
      <View style={styles.screen}>
        <View style={[styles.header, { paddingTop: insets.top }]}>
          <TabHeader title="Profil" trailing={<HeaderActions />} />
        </View>
        <Loading />
      </View>
    );
  if (!data)
    return (
      <View style={styles.screen}>
        <View style={[styles.header, { paddingTop: insets.top }]}>
          <TabHeader title="Profil" trailing={<HeaderActions />} />
        </View>
        <LoadError onRetry={refetch} busy={isRefetching} />
      </View>
    );
  const { user, stats } = data;

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top }]}>
        <TabHeader title="Profil" trailing={<HeaderActions />} />
      </View>
      {/* Tirer-pour-actualiser façon Instagram (ressort) — le RefreshControl RN
          ne fonctionne pas sur la web app, notre PullToRefresh oui (web + natif). */}
      <PullToRefresh
        refreshing={refreshing}
        onRefresh={onRefresh}
        style={{ flex: 1 }}
        contentContainerStyle={styles.screenContent}
      >
        <View style={styles.canvas}>
          {/* Bannière en carte arrondie (maquette) : couverture, avatar incrusté,
              nom + niveau · titre de gamification, accès à l'édition. */}
          <View style={styles.banner}>
            {user.coverUrl ? (
              <Image
                source={{ uri: tmdbImage(user.coverUrl, 'w780') ?? user.coverUrl }}
                style={StyleSheet.absoluteFill}
                resizeMode="cover"
              />
            ) : (
              <View style={StyleSheet.absoluteFill} pointerEvents="none">
                <View style={[styles.prismShape, styles.prismShapePrimary]} />
                <View style={[styles.prismShape, styles.prismShapeSecondary]} />
                <View style={[styles.prismShape, styles.prismShapeTertiary]} />
              </View>
            )}
            <LinearGradient colors={['rgba(20, 13, 39, 0.10)', 'rgba(20, 13, 39, 0.86)']} style={StyleSheet.absoluteFill} />
            <Pressable
              style={({ pressed }) => [styles.editBtn, pressed && styles.editBtnPressed]}
              onPress={() => router.push('/profile/edit')}
              accessibilityRole="button"
              accessibilityLabel="Modifier le profil"
            >
              <Feather name="edit-3" size={16} color="#FFFFFF" />
            </Pressable>
            <View style={styles.bannerRow}>
              <View style={styles.avatarWrap}>
                {user.avatarUrl ? (
                  <Image
                    source={{ uri: tmdbImage(user.avatarUrl, 'w185') ?? user.avatarUrl }}
                    style={styles.avatar}
                    resizeMode="cover"
                  />
                ) : (
                  <View style={[styles.avatar, styles.avatarEmpty]}>
                    <Text style={styles.avatarInit}>{user.displayName.slice(0, 1).toUpperCase()}</Text>
                  </View>
                )}
              </View>
              <View style={styles.identityCopy}>
                <Text accessibilityRole="header" style={styles.name} numberOfLines={1}>
                  {user.displayName}
                </Text>
                {gamification ? (
                  <Text style={styles.levelLine} numberOfLines={1}>
                    Niveau {gamification.level} · {gamification.levelTitle}
                  </Text>
                ) : null}
              </View>
            </View>
          </View>

          {/* Compteurs sociaux — un tap ouvre l'écran social. */}
          <View style={styles.counters}>
            <Counter
              n={data.social?.followingCount ?? 0}
              label={(data.social?.followingCount ?? 0) > 1 ? 'Abonnements' : 'Abonnement'}
              onPress={() => router.push('/social/connections?type=following')}
            />
            <Counter
              n={data.social?.followersCount ?? 0}
              label={(data.social?.followersCount ?? 0) > 1 ? 'Abonnés' : 'Abonné'}
              border
              onPress={() => router.push('/social/connections?type=followers')}
            />
            <Counter
              n={data.social?.commentsCount ?? 0}
              label={(data.social?.commentsCount ?? 0) > 1 ? 'Commentaires' : 'Commentaire'}
              border
              onPress={() => router.push('/social/my-comments')}
            />
          </View>

          <View style={styles.body}>
            {/* Statistiques all-time en tuiles (maquette) — la page détaillée
                reste accessible via « Tout afficher ». */}
            <View style={styles.sectHead}>
              <Text accessibilityRole="header" style={styles.sectTitle}>Statistiques</Text>
              <Pressable
                onPress={() => router.push('/stats')}
                accessibilityRole="button"
                accessibilityLabel="Ouvrir les statistiques détaillées"
                hitSlop={4}
                style={({ pressed }) => [styles.sectAction, pressed && styles.sectActionPressed]}
              >
                <Text style={styles.sectActionText}>Tout afficher</Text>
                <Feather name="chevron-right" size={16} color={COLORS.primary} />
              </Pressable>
            </View>
            <StatsSummary stats={stats} />

            {/* Streak (gamification) : accès aux Trophées, façon maquette. */}
            <Pressable
              style={({ pressed }) => [styles.streakCard, pressed && styles.cardPressed]}
              onPress={() => router.push('/trophies' as Href)}
              accessibilityRole="button"
              accessibilityLabel={
                gamification
                  ? gamification.currentStreak > 0
                    ? `Trophées — série de ${gamification.currentStreak} jour${gamification.currentStreak > 1 ? 's' : ''}, record ${gamification.bestStreak}`
                    : `Trophées — record ${gamification.bestStreak} jour${gamification.bestStreak > 1 ? 's' : ''}`
                  : 'Trophées'
              }
            >
              <View style={styles.streakIcon}>
                <Feather name="award" size={20} color={COLORS.onAccent} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.streakTitle}>
                  {gamification && gamification.currentStreak > 0
                    ? `Série de ${gamification.currentStreak} jour${gamification.currentStreak > 1 ? 's' : ''}`
                    : 'Trophées & défis'}
                </Text>
                <Text style={styles.streakSub} numberOfLines={1}>
                  {gamification
                    ? gamification.currentStreak > 0
                      ? `Record : ${gamification.bestStreak} jour${gamification.bestStreak > 1 ? 's' : ''}`
                      : `Niveau ${gamification.level} · ${gamification.levelTitle}`
                    : 'Badges, défis du mois et classement'}
                </Text>
              </View>
              <Feather name="chevron-right" size={22} color={COLORS.primary} />
            </Pressable>

            {/* Collections (ordre produit 2026-07-20) : chaque média puis ses favoris. */}
            <PosterRow title="Séries" items={data.shows} emptyLabel="Aucune série suivie" href="/library/shows" />
            <PosterRow title="Séries favorites" items={sortFavorites(data.favoriteShows, favSort.show)} heart emptyLabel="Aucune série en favori" href="/library/favorite-shows" />
            <PosterRow title="Films" items={data.movies} isMovie emptyLabel="Aucun film ajouté" href="/library/movies" />
            <PosterRow title="Films favoris" items={sortFavorites(data.favoriteMovies, favSort.movie)} isMovie heart emptyLabel="Aucun film en favori" href="/library/favorite-movies" />
            <PosterRow title="Jeux" items={data.games ?? []} isGame emptyLabel="Aucun jeu joué" href="/games" />
            <PosterRow title="Jeux favoris" items={sortFavorites(data.favoriteGames ?? [], favSort.game)} isGame heart emptyLabel="Aucun jeu en favori" href="/library/favorite-games" />

            {data.lists.length > 0 ? (
              <View style={styles.section}>
                <View style={styles.sectHead}>
                  <Text accessibilityRole="header" style={styles.sectTitle}>Listes</Text>
                </View>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.listsContent}
                  snapToInterval={contentWidth + SPACE.sm}
                  snapToAlignment="start"
                  decelerationRate="fast"
                  onMomentumScrollEnd={(event) => {
                    const nextIndex = Math.round(event.nativeEvent.contentOffset.x / (contentWidth + SPACE.sm));
                    setActiveListIndex(Math.max(0, Math.min(data.lists.length - 1, nextIndex)));
                  }}
                >
                  {data.lists.map((l) => (
                    <ListCollageCard key={l.id} title={l.title} posterPaths={l.posterPaths} width={contentWidth} />
                  ))}
                </ScrollView>
                {data.lists.length > 1 ? (
                  <View style={styles.dotsRow}>
                    {data.lists.map((l, i) => (
                      <View key={l.id} style={[styles.dot, i === activeListIndex && styles.dotActive]} />
                    ))}
                  </View>
                ) : null}
              </View>
            ) : null}

          </View>
        </View>
      </PullToRefresh>
    </View>
  );
}

// Raccourci d'en-tête : les réglages, seuls en haut à droite (la cloche de
// notifications vit sur l'Accueil).
function HeaderActions() {
  const router = useRouter();
  return (
    <Pressable
      style={({ pressed }) => [styles.headerBtn, pressed && styles.headerBtnPressed]}
      onPress={() => router.push('/settings')}
      accessibilityRole="button"
      accessibilityLabel="Paramètres"
      accessibilityHint={'Ouvre les paramètres du compte et de l’application'}
    >
      <Feather name="settings" size={25} color={COLORS.text} />
    </Pressable>
  );
}

type DurationPart = { value: number; unit: 'mois' | 'j' | 'h' };

// « 15 mois 10 j 21 h » — zéros de tête omis, heures toujours affichées.
function durationParts(minutes: number): DurationPart[] {
  const t = watchTime(minutes);
  const parts: DurationPart[] = [];
  if (t.months) parts.push({ value: t.months, unit: 'mois' });
  if (t.days || t.months) parts.push({ value: t.days, unit: 'j' });
  parts.push({ value: t.hours, unit: 'h' });
  return parts;
}

// Les statistiques all-time sont regroupées par univers : le total reste
// immédiatement scannable et les unités de durée peuvent se réorganiser sans
// être tronquées sur les petits écrans.
function StatsSummary({ stats }: { stats: ProfileStatsDto }) {
  const groups: {
    key: string;
    title: string;
    icon?: keyof typeof Feather.glyphMap;
    ionicon?: keyof typeof Ionicons.glyphMap;
    count: string;
    countLabel: string;
    minutes: number;
    durationLabel: string;
  }[] = [
    {
      key: 'episodes',
      title: 'Épisodes',
      icon: 'tv',
      count: stats.episodesWatched.toLocaleString('fr-FR'),
      countLabel: 'Vus',
      minutes: stats.showMinutes,
      durationLabel: 'Temps de visionnage',
    },
    {
      key: 'movies',
      title: 'Films',
      icon: 'film',
      count: stats.moviesWatched.toLocaleString('fr-FR'),
      countLabel: 'Vus',
      minutes: stats.movieMinutes,
      durationLabel: 'Temps de visionnage',
    },
    {
      key: 'games',
      title: 'Jeux',
      ionicon: 'game-controller-outline',
      count: stats.gamesPlayed.toLocaleString('fr-FR'),
      countLabel: 'Joués',
      minutes: stats.gamePlaytimeMinutes ?? 0,
      durationLabel: 'Temps déclaré',
    },
  ];

  return (
    <View style={styles.statsSummary}>
      {groups.map((group, index) => {
        const time = durationParts(group.minutes);
        const spokenDuration = time.map(({ value, unit }) => value + ' ' + unit).join(' ');
        return (
          <AppearItem key={group.key} index={index}>
            <View
              style={[styles.statRow, index > 0 && styles.statRowBorder]}
              accessible
              accessibilityLabel={
                group.title +
                '. ' +
                group.count +
                ' ' +
                group.countLabel.toLowerCase() +
                '. ' +
                group.durationLabel +
                ' : ' +
                spokenDuration +
                '.'
              }
            >
              <View style={styles.statIcon}>
                {group.ionicon ? (
                  <Ionicons name={group.ionicon} size={17} color={COLORS.primary} />
                ) : (
                  <Feather name={group.icon ?? 'activity'} size={17} color={COLORS.primary} />
                )}
              </View>
              <View style={styles.statContent}>
                <Text style={styles.statTitle}>{group.title}</Text>
                <View style={styles.statMetrics}>
                  <View style={styles.statCount}>
                    <Text style={styles.statCountValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
                      {group.count}
                    </Text>
                    <Text style={styles.statMeta}>{group.countLabel}</Text>
                  </View>
                  <View style={styles.statDivider} />
                  <View style={styles.statDuration}>
                    <View style={styles.durationParts}>
                      {time.map(({ value, unit }) => (
                        <View key={unit} style={styles.durationPart}>
                          <Text style={styles.durationValue}>{value}</Text>
                          <Text style={styles.durationUnit}>{unit}</Text>
                        </View>
                      ))}
                    </View>
                    <Text style={styles.statMeta}>{group.durationLabel}</Text>
                  </View>
                </View>
              </View>
            </View>
          </AppearItem>
        );
      })}
    </View>
  );
}

function Counter({ n, label, border, onPress }: { n: number; label: string; border?: boolean; onPress?: () => void }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.counter, border && styles.counterBorder, pressed && styles.counterPressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${n} ${label}`}
      accessibilityHint={'Ouvre le détail de cette activité sociale'}
    >
      <Text style={styles.counterN}>{n}</Text>
      <Text style={styles.counterL}>{label}</Text>
    </Pressable>
  );
}

// Carte « Listes » : collage des affiches + titre en surimpression.
function ListCollageCard({ title, posterPaths, width }: { title: string; posterPaths: string[]; width: number }) {
  return (
    <View style={[styles.listcard, { width }]} accessible accessibilityLabel={`Liste ${title}`}>
      <View style={StyleSheet.absoluteFill}>
        <View style={{ flex: 1, flexDirection: 'row' }}>
          {(posterPaths.length ? posterPaths.slice(0, 4) : [null]).map((p, i) => (
            <View key={i} style={styles.listPosterSlot}>
              {p ? <Image source={{ uri: tmdbImage(p, 'w342') ?? p }} style={{ width: '100%', height: '100%' }} resizeMode="cover" /> : null}
            </View>
          ))}
        </View>
      </View>
      <LinearGradient colors={['transparent', 'rgba(13, 8, 28, 0.88)']} style={StyleSheet.absoluteFill} />
      <Text style={styles.listTitle}>{title}</Text>
    </View>
  );
}

function PosterRow({
  title,
  items,
  heart,
  isMovie,
  isGame,
  emptyLabel,
  href,
}: {
  title: string;
  items: MediaDto[];
  heart?: boolean;
  isMovie?: boolean;
  isGame?: boolean;
  emptyLabel: string;
  href: string;
}) {
  const router = useRouter();
  return (
    <View style={styles.posterCard}>
      {/* Toute la ligne de titre ouvre la page dédiée. */}
      <Pressable
        style={({ pressed }) => [styles.sectHead, pressed && styles.sectHeadPressed]}
        onPress={() => router.push(href as Parameters<typeof router.push>[0])}
        accessibilityRole="button"
        accessibilityLabel={`Ouvrir ${title}`}
        accessibilityHint="Affiche toute la collection"
      >
        <View style={styles.posterTitleRow}>
          {heart ? (
            <View style={styles.heartBadge}>
              <Feather name="heart" size={14} color="#FFFFFF" />
            </View>
          ) : null}
          <Text style={styles.sectTitle}>{title}</Text>
        </View>
        <View style={styles.sectAction}>
          <Text style={styles.sectActionText}>Tout afficher</Text>
          <Feather name="chevron-right" size={16} color={COLORS.primary} />
        </View>
      </Pressable>
      {items.length === 0 ? (
        // Section toujours visible, avec un état vide.
        <View style={styles.emptyRow}>
          <View style={styles.emptyPoster}>
            {isGame ? (
              <Ionicons name="game-controller-outline" size={26} color={COLORS.primary} />
            ) : (
              <Feather name={isMovie ? 'film' : 'tv'} size={26} color={COLORS.primary} />
            )}
          </View>
          <Text style={styles.emptyRowText}>{emptyLabel}</Text>
        </View>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.mediaContent}>
          {items.map((m) => (
            <Poster
              key={m.id}
              title={m.title}
              uri={tmdbImage(m.posterPath)}
              width={112}
              onPress={() => router.push((isGame ? `/game/${m.id}` : `/show/${m.id}${isMovie ? '?type=movie' : ''}`) as Href)}
            />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.pageMuted },
  header: {
    backgroundColor: COLORS.white,
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.borderLight,
  },
  // Icône nue, calée à droite (façon Instagram) : cible 44 px conservée.
  headerBtn: {
    width: SIZES.touch,
    height: SIZES.touch,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  headerBtnPressed: { opacity: 0.55, transform: [{ scale: 0.94 }] },
  screenContent: { flexGrow: 1, paddingBottom: SIZES.tabBar + SPACE.xl },
  canvas: { width: '100%', maxWidth: SIZES.contentMax, alignSelf: 'center' },
  body: { paddingHorizontal: SPACE.md, paddingTop: SPACE.xs },
  // Bannière en carte arrondie (maquette) — au-dessus des stats, pas pleine page.
  banner: {
    minHeight: 176,
    marginHorizontal: SPACE.md,
    marginTop: SPACE.md,
    borderRadius: RADIUS.sheet,
    overflow: 'hidden',
    justifyContent: 'flex-end',
    backgroundColor: '#241B3D',
    ...SHADOW.card,
  },
  prismShape: { position: 'absolute', opacity: 0.8 },
  prismShapePrimary: { width: 190, height: 190, borderRadius: 95, backgroundColor: COLORS.primary, right: -50, top: -18 },
  prismShapeSecondary: { width: 132, height: 132, borderRadius: 36, backgroundColor: COLORS.secondary, right: 104, top: 42 },
  prismShapeTertiary: { width: 92, height: 92, borderRadius: 46, backgroundColor: COLORS.tertiary, left: -20, bottom: 12 },
  // Bulle ronde, icône stylo seule (retour Étienne 2026-07-21 — texte retiré).
  editBtn: {
    position: 'absolute',
    top: SPACE.sm,
    right: SPACE.sm,
    zIndex: 2,
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: RADIUS.pill,
    backgroundColor: 'rgba(17,11,35,0.42)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.28)',
  },
  editBtnPressed: { backgroundColor: 'rgba(17,11,35,0.62)', transform: [{ scale: 0.97 }] },
  bannerRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE.md, padding: SPACE.md, paddingTop: 56 },
  avatarWrap: { flexShrink: 0 },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 3,
    borderColor: '#FFFFFF',
    backgroundColor: COLORS.primary,
  },
  avatarEmpty: { alignItems: 'center', justifyContent: 'center' },
  avatarInit: { color: '#FFFFFF', fontSize: 28, fontFamily: FONTS.extraBold },
  identityCopy: { flex: 1, minWidth: 0 },
  name: { color: '#FFFFFF', fontSize: 24, lineHeight: 30, fontFamily: FONTS.extraBold },
  levelLine: { color: 'rgba(255,255,255,0.82)', fontSize: 13.5, lineHeight: 18, fontFamily: FONTS.semiBold, marginTop: 2 },
  counters: {
    flexDirection: 'row',
    marginHorizontal: SPACE.md,
    marginTop: SPACE.sm,
    overflow: 'hidden',
    borderRadius: RADIUS.card,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    backgroundColor: COLORS.surface,
    ...SHADOW.card,
  },
  counter: { flex: 1, minHeight: 72, alignItems: 'center', justifyContent: 'center', paddingHorizontal: SPACE.xxs },
  counterPressed: { backgroundColor: COLORS.primarySoft },
  counterBorder: { borderLeftWidth: 1, borderLeftColor: COLORS.borderLight },
  counterN: { color: COLORS.text, fontSize: 20, lineHeight: 25, fontFamily: FONTS.extraBold },
  counterL: { color: COLORS.textMuted, fontFamily: FONTS.medium, fontSize: 11, textAlign: 'center' },
  // Résumé des statistiques : une seule surface, trois univers lisibles.
  statsSummary: {
    borderRadius: RADIUS.card,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    backgroundColor: COLORS.surface,
    ...SHADOW.card,
  },
  statRow: {
    minHeight: 100,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.sm,
    paddingHorizontal: SPACE.md,
    paddingVertical: SPACE.sm,
  },
  statRowBorder: { borderTopWidth: 1, borderTopColor: COLORS.borderLight },
  statIcon: {
    width: 36,
    height: 36,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statContent: { flex: 1, minWidth: 0 },
  statTitle: { color: COLORS.text, fontSize: 13, lineHeight: 17, fontFamily: FONTS.bold },
  statMetrics: { flexDirection: 'row', alignItems: 'stretch', marginTop: SPACE.xxs },
  statCount: { width: 78, minWidth: 0, justifyContent: 'center' },
  statCountValue: { color: COLORS.text, fontSize: 21, lineHeight: 25, fontFamily: FONTS.extraBold },
  statDivider: { width: 1, backgroundColor: COLORS.borderLight, marginHorizontal: SPACE.sm },
  statDuration: { flex: 1, minWidth: 0, justifyContent: 'center' },
  durationParts: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', columnGap: SPACE.xs, rowGap: 0 },
  durationPart: { flexDirection: 'row', alignItems: 'flex-end', gap: 2 },
  durationValue: { color: COLORS.text, fontSize: 17, lineHeight: 22, fontFamily: FONTS.extraBold },
  durationUnit: { color: COLORS.text, fontSize: 12, lineHeight: 18, fontFamily: FONTS.semiBold },
  statMeta: { color: COLORS.textMuted, fontSize: 11.5, lineHeight: 16, fontFamily: FONTS.medium, marginTop: 1 },
  // Encart streak → Trophées.
  streakCard: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.sm,
    padding: SPACE.md,
    marginTop: SPACE.sm,
    marginBottom: SPACE.xs,
    borderRadius: RADIUS.card,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    backgroundColor: COLORS.surface,
    ...SHADOW.card,
  },
  streakIcon: {
    width: 40, height: 40, flexShrink: 0, borderRadius: RADIUS.control, backgroundColor: COLORS.yellow,
    alignItems: 'center', justifyContent: 'center',
  },
  streakTitle: { fontSize: 16, lineHeight: 21, fontFamily: FONTS.extraBold, color: COLORS.text },
  streakSub: { fontSize: 13, lineHeight: 18, fontFamily: FONTS.regular, color: COLORS.textMuted, marginTop: 1 },
  cardPressed: { opacity: 0.86, transform: [{ scale: 0.99 }] },
  section: { paddingVertical: SPACE.sm },
  sectHead: { minHeight: SIZES.touch, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: SPACE.sm, marginBottom: SPACE.xs },
  sectHeadPressed: { opacity: 0.8 },
  sectTitle: { flexShrink: 1, color: COLORS.text, fontSize: 19, lineHeight: 25, fontFamily: FONTS.extraBold },
  sectAction: { flexDirection: 'row', alignItems: 'center', gap: 2, flexShrink: 0 },
  sectActionPressed: { opacity: 0.7 },
  sectActionText: { color: COLORS.primary, fontSize: 13, fontFamily: FONTS.bold },
  listsContent: { gap: SPACE.sm, paddingBottom: SPACE.xxs },
  listcard: { height: 148, borderRadius: RADIUS.card, backgroundColor: '#241B3D', justifyContent: 'flex-end', padding: SPACE.md, overflow: 'hidden', ...SHADOW.card },
  listPosterSlot: { flex: 1, backgroundColor: COLORS.imagePlaceholder },
  listTitle: { color: '#FFFFFF', fontSize: 19, lineHeight: 25, fontFamily: FONTS.extraBold },
  dotsRow: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: SPACE.sm },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.border },
  dotActive: { width: 18, backgroundColor: COLORS.primary },
  // Sections de collection en carte (raccord avec le reste du profil).
  posterCard: {
    marginVertical: SPACE.xs,
    padding: SPACE.sm,
    borderRadius: RADIUS.card,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    backgroundColor: COLORS.surface,
    ...SHADOW.card,
  },
  posterTitleRow: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: SPACE.xs },
  heartBadge: { width: 30, height: 30, borderRadius: RADIUS.pill, backgroundColor: COLORS.secondary, alignItems: 'center', justifyContent: 'center' },
  mediaContent: { gap: 10, paddingBottom: SPACE.xxs },
  emptyRow: { minHeight: 104, flexDirection: 'row', alignItems: 'center', gap: SPACE.md, padding: SPACE.sm, borderRadius: RADIUS.control, backgroundColor: COLORS.surfaceMuted },
  emptyPoster: { width: 56, height: 78, flexShrink: 0, borderRadius: RADIUS.poster, backgroundColor: COLORS.primarySoft, alignItems: 'center', justifyContent: 'center' },
  emptyRowText: { flex: 1, color: COLORS.textMuted, fontFamily: FONTS.regular, fontSize: 14, lineHeight: 20 },
});
