import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Image, Platform, useWindowDimensions } from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';
import { useRouter, type Href } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import { useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { api, tmdbImage } from '@/lib/api';
import type { GamificationMeDto, MediaDto, ProfileStatsDto } from '@/lib/types';
import { watchTime } from '@/lib/format';
import { COLORS, FONTS, RADIUS, SHADOW, SIZES, SPACE, setThemeColorMeta, currentThemeColorMeta } from '@/lib/theme';
import { Loading, LoadError, Poster } from '@/components/ui';
import { AppearItem, PopIn } from '@/components/anim';
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
  const focused = useIsFocused();
  const { width } = useWindowDimensions();
  const contentWidth = Math.max(220, Math.min(width, SIZES.contentMax) - SPACE.md * 2);
  const [activeListIndex, setActiveListIndex] = useState(0);

  // La couverture passe DERRIÈRE la barre de statut, comme TV Time. En natif
  // (edge-to-edge), l'en-tête s'étend sous la barre et les icônes passent en
  // clair tant que l'onglet est affiché. Sur la web app, l'OS réserve la zone
  // de statut : on la teinte de la couleur de l'en-tête (meta theme-color,
  // suivi dynamiquement par Android) pour la fondre avec la couverture.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined' || !focused) return;
    const prev = currentThemeColorMeta();
    setThemeColorMeta('#241B3D');
    return () => setThemeColorMeta(prev);
  }, [focused]);
  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['profile'],
    queryFn: () => api.get<ProfileResponse>('/api/profile'),
  });
  const { data: unreadData } = useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: () => api.get<{ unreadCount: number }>('/api/notifications/unread-count'),
    refetchInterval: 30_000,
  });
  const unread = unreadData?.unreadCount ?? 0;
  // Gamification (spec 2026-07-16 §10) : pastille de niveau sur l'avatar + rangée Trophées.
  const { data: gamification } = useQuery({
    queryKey: ['gamification', 'me'],
    queryFn: () => api.get<GamificationMeDto>('/api/gamification/me'),
    staleTime: 30_000,
  });

  const { refreshing, onRefresh } = usePullRefresh([refetch]);
  // Tri choisi sur les pages « préférés » (persisté) : appliqué aussi ici.
  const favSort = useAppStore((s) => s.favSort);

  if (isLoading) return <Loading />;
  if (!data) return <LoadError onRetry={refetch} busy={isRefetching} />;
  const { user, stats } = data;
  const st = watchTime(stats.showMinutes);
  const mt = watchTime(stats.movieMinutes);

  return (
    // Tirer-pour-actualiser façon Instagram (ressort) — le RefreshControl RN
    // ne fonctionne pas sur la web app, notre PullToRefresh oui (web + natif).
    <PullToRefresh
      refreshing={refreshing}
      onRefresh={onRefresh}
      style={styles.screen}
      contentContainerStyle={styles.screenContent}
    >
      <View style={styles.canvas}>
      {/* Icônes de la barre de statut en clair sur la couverture sombre (natif). */}
      {focused ? <StatusBar style="light" /> : null}
      {/* + insets.top : la zone visible de la couverture reste ~200dp une fois
          la barre de statut par-dessus. */}
      <View style={[styles.head, { minHeight: 232 + insets.top, paddingTop: insets.top }]}>
        {user.coverUrl ? (
          <Image source={{ uri: tmdbImage(user.coverUrl, 'w780') ?? user.coverUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        ) : null}
        {!user.coverUrl ? (
          <View style={StyleSheet.absoluteFill} pointerEvents="none">
            <View style={[styles.prismShape, styles.prismShapePrimary]} />
            <View style={[styles.prismShape, styles.prismShapeSecondary]} />
            <View style={[styles.prismShape, styles.prismShapeTertiary]} />
          </View>
        ) : null}
        <LinearGradient colors={['rgba(20, 13, 39, 0.12)', 'rgba(20, 13, 39, 0.94)']} style={StyleSheet.absoluteFill} />
        <Pressable
          style={({ pressed }) => [styles.bell, { top: insets.top + SPACE.sm }, pressed && styles.headerActionPressed]}
          onPress={() => router.push('/notifications')}
          accessibilityRole="button"
          accessibilityLabel={unread > 0 ? `Notifications, ${unread} non lue${unread > 1 ? 's' : ''}` : 'Notifications'}
          accessibilityHint="Ouvre le centre de notifications"
        >
          <Feather name="bell" size={20} color="#FFFFFF" />
          {unread > 0 ? (
            // La pastille de non-lus arrive avec un petit rebond.
            <PopIn style={styles.badge}>
              <Text style={styles.badgeText}>{unread > 9 ? '9+' : unread}</Text>
            </PopIn>
          ) : null}
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.dots, { top: insets.top + SPACE.sm }, pressed && styles.headerActionPressed]}
          onPress={() => router.push('/settings')}
          accessibilityRole="button"
          accessibilityLabel="Paramètres"
          accessibilityHint={'Ouvre les param\u00e8tres du compte et de l\u2019application'}
        >
          <Feather name="settings" size={20} color="#FFFFFF" />
        </Pressable>
        <View style={styles.headRow}>
          <View style={styles.avatarWrap}>
            {user.avatarUrl ? (
              <Image source={{ uri: tmdbImage(user.avatarUrl, 'w185') ?? user.avatarUrl }} style={styles.avatar} resizeMode="cover" />
            ) : (
              <View style={[styles.avatar, styles.avatarEmpty]}>
                <Text style={styles.avatarInit}>{user.displayName.slice(0, 1).toUpperCase()}</Text>
              </View>
            )}
            {gamification ? (
              <View style={styles.levelPill}>
                <Text style={styles.levelPillText}>{gamification.level}</Text>
              </View>
            ) : null}
          </View>
          <View style={styles.identityCopy}>
            <Text style={styles.profileEyebrow}>Mon espace</Text>
            <Text accessibilityRole="header" style={styles.name}>{user.displayName}</Text>
            <Pressable
              style={({ pressed }) => [styles.modif, pressed && styles.modifPressed]}
              onPress={() => router.push('/profile/edit')}
              accessibilityRole="button"
              accessibilityLabel="Modifier le profil"
            >
              <Feather name="edit-3" size={15} color="#FFFFFF" />
              <Text style={styles.modifText}>Modifier</Text>
            </Pressable>
          </View>
        </View>
      </View>

      {/* Compteurs sociaux (façon TV Time) — un tap ouvre l'écran social. */}
      <View style={styles.counters}>
        <Counter
          n={data.social?.followingCount ?? 0}
          label={(data.social?.followingCount ?? 0) > 1 ? 'abonnements' : 'abonnement'}
          onPress={() => router.push('/social/connections?type=following')}
        />
        <Counter
          n={data.social?.followersCount ?? 0}
          label={(data.social?.followersCount ?? 0) > 1 ? 'abonnés' : 'abonné'}
          border
          onPress={() => router.push('/social/connections?type=followers')}
        />
        <Counter
          n={data.social?.commentsCount ?? 0}
          label={(data.social?.commentsCount ?? 0) > 1 ? 'commentaires' : 'commentaire'}
          border
          onPress={() => router.push('/social/my-comments')}
        />
      </View>

      <View style={styles.body}>
      <Section title="Statistiques" onPress={() => router.push('/stats')}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.statsContent}>
          <AppearItem index={0}><StatCard icon="tv" title="Temps passé devant des séries" values={[[st.months, 'MOIS'], [st.days, 'JOURS'], [st.hours, 'HEURES']]} /></AppearItem>
          <AppearItem index={1}><StatCard icon="tv" title="Épisodes vus" values={[[stats.episodesWatched, 'ÉPISODES']]} /></AppearItem>
          <AppearItem index={2}><StatCard icon="film" title="Temps passé devant des films" values={[[mt.months, 'MOIS'], [mt.days, 'JOURS'], [mt.hours, 'HEURES']]} /></AppearItem>
          <AppearItem index={3}><StatCard icon="film" title="Films regardés" values={[[stats.moviesWatched, 'FILMS']]} /></AppearItem>
          <AppearItem index={4}><StatCard ionicon="game-controller-outline" title="Jeux joués" values={[[stats.gamesPlayed ?? 0, 'JEUX']]} /></AppearItem>
        </ScrollView>
      </Section>

      <Pressable
        style={({ pressed }) => [styles.trophiesRow, pressed && styles.cardPressed]}
        onPress={() => router.push('/trophies' as Href)}
        accessibilityRole="button"
        accessibilityLabel={gamification ? `Troph\u00e9es, niveau ${gamification.level}, ${gamification.levelTitle}` : 'Troph\u00e9es'}
      >
        <View style={styles.trophiesIconWrap}>
          <Feather name="award" size={21} color={COLORS.onAccent} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.trophiesTitle}>Trophées</Text>
          {gamification ? (
            <Text style={styles.trophiesSub}>
              Niveau {gamification.level} · {gamification.levelTitle}
            </Text>
          ) : null}
        </View>
        <Feather name="chevron-right" size={22} color={COLORS.primary} />
      </Pressable>

      {data.lists.length > 0 ? (
        <Section title="Listes">
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
        </Section>
      ) : null}

      <PosterRow title="Séries" items={data.shows} emptyLabel="Aucune série suivie" href="/library/shows" />
      {/* Les sections « préférés » respectent le TRI choisi sur leurs pages
          (Trier par : ordre utilisateur, derniers ajouts, A-Z…) — avant, le
          profil restait figé sur l'ordre utilisateur. */}
      <PosterRow title="Séries préférées" items={sortFavorites(data.favoriteShows, favSort.show)} heart emptyLabel="Aucune série en favori" href="/library/favorite-shows" />
      <PosterRow title="Films" items={data.movies} isMovie emptyLabel="Aucun film ajouté" href="/library/movies" />
      <PosterRow title="Films préférés" items={sortFavorites(data.favoriteMovies, favSort.movie)} isMovie heart emptyLabel="Aucun film en favori" href="/library/favorite-movies" />
      <PosterRow title="Jeux" items={data.games ?? []} isGame emptyLabel="Aucun jeu joué" href="/games" />
      <PosterRow title="Jeux préférés" items={sortFavorites(data.favoriteGames ?? [], favSort.game)} isGame heart emptyLabel="Aucun jeu en favori" href="/library/favorite-games" />
      </View>
      </View>
    </PullToRefresh>
  );
}

function Counter({ n, label, border, onPress }: { n: number; label: string; border?: boolean; onPress?: () => void }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.counter, border && styles.counterBorder, pressed && styles.counterPressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${n} ${label}`}
      accessibilityHint={'Ouvre le d\u00e9tail de cette activit\u00e9 sociale'}
    >
      <Text style={styles.counterN}>{n}</Text>
      <Text style={styles.counterL}>{label}</Text>
    </Pressable>
  );
}

// Carte « Listes » façon TV Time : collage des affiches + titre en surimpression.
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

// Le chevron n'apparaît que si la section mène quelque part (onPress). Sinon
// (Statistiques, Listes), pas de faux « cliquable ».
function Section({ title, children, onPress }: { title: string; children: React.ReactNode; onPress?: () => void }) {
  const head = (
    <View style={styles.sectHead}>
      <Text accessibilityRole="header" style={styles.sectTitle}>{title}</Text>
      {onPress ? (
        <View style={styles.sectionActionIcon}>
          <Feather name="chevron-right" size={19} color={COLORS.primary} />
        </View>
      ) : null}
    </View>
  );
  return (
    <View style={styles.section}>
      {onPress ? (
        <Pressable
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={`Ouvrir ${title}`}
          style={({ pressed }) => [styles.sectionHeaderButton, pressed && styles.sectionHeaderPressed]}
        >
          {head}
        </Pressable>
      ) : head}
      {children}
    </View>
  );
}

function StatCard({ icon, ionicon, title, values }: { icon?: keyof typeof Feather.glyphMap; ionicon?: keyof typeof Ionicons.glyphMap; title: string; values: [number, string][] }) {
  return (
    <View style={styles.statcard} accessible accessibilityLabel={`${title}, ${values.map(([value, label]) => `${value} ${label.toLowerCase()}`).join(', ')}`}>
      <View style={styles.statTop}>
        <View style={styles.statIcon}>
          {ionicon ? (
            <Ionicons name={ionicon} size={18} color={COLORS.primary} />
          ) : (
            <Feather name={icon ?? 'activity'} size={18} color={COLORS.primary} />
          )}
        </View>
        <Text style={styles.statTitle}>{title}</Text>
      </View>
      <View style={styles.statVals}>
        {values.map(([v, l]) => (
          <View key={l} style={styles.statValue}>
            <Text style={styles.statV}>{v}</Text>
            <Text style={styles.statL}>{l}</Text>
          </View>
        ))}
      </View>
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
    <View style={styles.posterSection}>
      {/* Toute la ligne de titre ouvre la page dédiée (façon TV Time). */}
      <Pressable
        style={({ pressed }) => [styles.sectHead, styles.posterSectionHead, pressed && styles.sectionHeaderPressed]}
        onPress={() => router.push(href as Parameters<typeof router.push>[0])}
        accessibilityRole="button"
        accessibilityLabel={`Ouvrir ${title}`}
        accessibilityHint="Affiche toute la collection"
      >
        <View style={styles.posterTitleRow}>
          {heart ? (
            // Pastille rouge + cœur blanc AVANT le titre, comme TV Time.
            <View style={styles.heartBadge}>
              <Feather name="heart" size={14} color="#FFFFFF" />
            </View>
          ) : null}
          <Text style={styles.sectTitle}>{title}</Text>
        </View>
        <View style={styles.sectionActionIcon}><Feather name="chevron-right" size={19} color={COLORS.primary} /></View>
      </Pressable>
      {items.length === 0 ? (
        // Section toujours visible façon TV Time, avec un état vide.
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

// Densité recalée sur TV Time (captures profil Etienne vs Boloss, 2026-07-15) :
// tout était ~15 % trop gros → moins d'infos visibles. Nom 20, compteurs 18/13,
// titres de section 18, stats 19, en-tête 180, marges resserrées.
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bg },
  screenContent: { flexGrow: 1, paddingBottom: SPACE.xl },
  canvas: { width: '100%', maxWidth: SIZES.contentMax, alignSelf: 'center' },
  body: { paddingHorizontal: SPACE.md, paddingTop: SPACE.sm },
  head: {
    backgroundColor: '#241B3D',
    justifyContent: 'flex-end',
    overflow: 'hidden',
    borderBottomLeftRadius: RADIUS.sheet,
    borderBottomRightRadius: RADIUS.sheet,
  },
  prismShape: { position: 'absolute', opacity: 0.8 },
  prismShapePrimary: { width: 190, height: 190, borderRadius: 95, backgroundColor: COLORS.primary, right: -50, top: -18 },
  prismShapeSecondary: { width: 132, height: 132, borderRadius: 36, backgroundColor: COLORS.secondary, right: 104, top: 42 },
  prismShapeTertiary: { width: 92, height: 92, borderRadius: 46, backgroundColor: COLORS.tertiary, left: -20, bottom: 12 },
  bell: {
    position: 'absolute',
    right: SPACE.md + SIZES.touch + SPACE.xs,
    width: SIZES.touch,
    height: SIZES.touch,
    zIndex: 2,
    borderRadius: RADIUS.control,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.24)',
    backgroundColor: 'rgba(17,11,35,0.42)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 19,
    height: 19,
    borderRadius: RADIUS.pill,
    borderWidth: 2,
    borderColor: '#241B3D',
    backgroundColor: COLORS.notif,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  badgeText: { color: '#FFFFFF', fontSize: 10, fontFamily: FONTS.extraBold },
  dots: {
    position: 'absolute',
    right: SPACE.md,
    width: SIZES.touch,
    height: SIZES.touch,
    zIndex: 2,
    borderRadius: RADIUS.control,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.24)',
    backgroundColor: 'rgba(17,11,35,0.42)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerActionPressed: { opacity: 0.72, transform: [{ scale: 0.96 }] },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE.md, paddingHorizontal: SPACE.lg, paddingTop: 72, paddingBottom: SPACE.lg },
  avatarWrap: { flexShrink: 0 },
  avatar: {
    width: 82,
    height: 82,
    borderRadius: 41,
    borderWidth: 3,
    borderColor: '#FFFFFF',
    backgroundColor: COLORS.primary,
  },
  avatarEmpty: { alignItems: 'center', justifyContent: 'center' },
  avatarInit: { color: '#FFFFFF', fontSize: 32, fontFamily: FONTS.extraBold },
  identityCopy: { flex: 1, minWidth: 0, alignItems: 'flex-start' },
  profileEyebrow: { color: 'rgba(255,255,255,0.72)', fontSize: 10, letterSpacing: 1.3, textTransform: 'uppercase', fontFamily: FONTS.bold },
  name: { color: '#FFFFFF', fontSize: 26, lineHeight: 32, fontFamily: FONTS.extraBold },
  modif: {
    minHeight: SIZES.touch,
    marginTop: SPACE.xxs,
    paddingHorizontal: SPACE.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderRadius: RADIUS.pill,
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.28)',
  },
  modifPressed: { backgroundColor: 'rgba(255,255,255,0.24)', transform: [{ scale: 0.98 }] },
  modifText: { color: '#FFFFFF', fontSize: 13, fontFamily: FONTS.bold },
  // Pastille de niveau (gamification) : coin bas-droit de l'avatar, jaune, bord blanc.
  levelPill: {
    position: 'absolute',
    bottom: -3,
    right: -3,
    minWidth: 27,
    height: 27,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.yellow,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  levelPillText: { color: COLORS.onAccent, fontSize: 11, fontFamily: FONTS.extraBold },
  counters: {
    flexDirection: 'row',
    marginHorizontal: SPACE.md,
    marginTop: -SPACE.md,
    zIndex: 3,
    overflow: 'hidden',
    borderRadius: RADIUS.card,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    backgroundColor: COLORS.surface,
    ...SHADOW.card,
  },
  counter: { flex: 1, minHeight: 76, alignItems: 'center', justifyContent: 'center', paddingHorizontal: SPACE.xxs },
  counterPressed: { backgroundColor: COLORS.primarySoft },
  counterBorder: { borderLeftWidth: 1, borderLeftColor: COLORS.borderLight },
  counterN: { color: COLORS.text, fontSize: 21, lineHeight: 26, fontFamily: FONTS.extraBold },
  counterL: { color: COLORS.textMuted, fontFamily: FONTS.medium, fontSize: 11, textAlign: 'center' },
  trophiesRow: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.sm,
    padding: SPACE.md,
    marginBottom: SPACE.sm,
    borderRadius: RADIUS.card,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    backgroundColor: COLORS.surface,
    ...SHADOW.card,
  },
  trophiesIconWrap: {
    width: SIZES.touch, height: SIZES.touch, borderRadius: RADIUS.control, backgroundColor: COLORS.yellow,
    alignItems: 'center', justifyContent: 'center',
  },
  trophiesTitle: { fontSize: 17, lineHeight: 22, fontFamily: FONTS.extraBold, color: COLORS.text },
  trophiesSub: { fontSize: 13, lineHeight: 18, fontFamily: FONTS.regular, color: COLORS.textMuted, marginTop: 2 },
  cardPressed: { opacity: 0.86, transform: [{ scale: 0.99 }] },
  section: { paddingVertical: SPACE.sm },
  sectionHeaderButton: { borderRadius: RADIUS.control },
  sectionHeaderPressed: { backgroundColor: COLORS.primarySoft },
  sectHead: { minHeight: SIZES.touch, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: SPACE.sm, marginBottom: SPACE.xs },
  sectTitle: { flexShrink: 1, color: COLORS.text, fontSize: 19, lineHeight: 25, fontFamily: FONTS.extraBold },
  sectionActionIcon: { width: 36, height: 36, flexShrink: 0, borderRadius: RADIUS.control, backgroundColor: COLORS.primarySoft, alignItems: 'center', justifyContent: 'center' },
  statsContent: { gap: SPACE.sm, paddingBottom: SPACE.xxs },
  statcard: {
    width: 276,
    minHeight: 132,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: RADIUS.card,
    backgroundColor: COLORS.surface,
    ...SHADOW.card,
  },
  statTop: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, padding: SPACE.sm, borderBottomWidth: 1, borderBottomColor: COLORS.borderLight },
  statIcon: { width: 34, height: 34, flexShrink: 0, borderRadius: RADIUS.control, backgroundColor: COLORS.primarySoft, alignItems: 'center', justifyContent: 'center' },
  statTitle: { flex: 1, color: COLORS.text, fontSize: 14, lineHeight: 19, fontFamily: FONTS.semiBold },
  statVals: { flex: 1, minHeight: 66, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', padding: SPACE.sm },
  statValue: { flex: 1, alignItems: 'center' },
  statV: { color: COLORS.text, fontSize: 22, lineHeight: 27, fontFamily: FONTS.extraBold },
  statL: { color: COLORS.textMuted, fontSize: 10, fontFamily: FONTS.bold, letterSpacing: 0.5 },
  listsContent: { gap: SPACE.sm, paddingBottom: SPACE.xxs },
  listcard: { height: 148, borderRadius: RADIUS.card, backgroundColor: '#241B3D', justifyContent: 'flex-end', padding: SPACE.md, overflow: 'hidden', ...SHADOW.card },
  listPosterSlot: { flex: 1, backgroundColor: COLORS.imagePlaceholder },
  listTitle: { color: '#FFFFFF', fontSize: 19, lineHeight: 25, fontFamily: FONTS.extraBold },
  dotsRow: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: SPACE.sm },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.border },
  dotActive: { width: 18, backgroundColor: COLORS.primary },
  posterSection: { paddingVertical: SPACE.sm },
  posterSectionHead: { borderRadius: RADIUS.control },
  posterTitleRow: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: SPACE.xs },
  heartBadge: { width: 30, height: 30, borderRadius: RADIUS.pill, backgroundColor: COLORS.secondary, alignItems: 'center', justifyContent: 'center' },
  mediaContent: { gap: 10, paddingBottom: SPACE.xxs },
  emptyRow: { minHeight: 112, flexDirection: 'row', alignItems: 'center', gap: SPACE.md, padding: SPACE.md, borderRadius: RADIUS.card, borderWidth: 1, borderColor: COLORS.borderLight, backgroundColor: COLORS.surface },
  emptyPoster: { width: 56, height: 78, flexShrink: 0, borderRadius: RADIUS.poster, backgroundColor: COLORS.primarySoft, alignItems: 'center', justifyContent: 'center' },
  emptyRowText: { flex: 1, color: COLORS.textMuted, fontFamily: FONTS.regular, fontSize: 14, lineHeight: 20 },
});
