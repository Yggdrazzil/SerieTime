import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { goBack } from '@/lib/nav';
import { useBackClose } from '@/lib/useBackClose';
import { api, tmdbImage } from '@/lib/api';
import type { MediaDto } from '@/lib/types';
import {
  COLORS,
  FONTS,
  RADIUS,
  SHADOW,
  SIZES,
  SPACE,
  currentThemeColorMeta,
  setThemeColorMeta,
} from '@/lib/theme';
import { Loading, LoadError } from '@/components/ui';
import { AppearItem, Pop, PressableScale } from '@/components/anim';

const HERO_COLOR = '#201A24';
const TIER_COLORS: Record<number, string> = {
  0: COLORS.surfaceMuted,
  1: '#CD7F32',
  2: '#9AA2AA',
  3: '#D4A017',
  4: '#4EAFCE',
};

function safeFeatherIcon(icon: string): keyof typeof Feather.glyphMap {
  return icon in Feather.glyphMap ? (icon as keyof typeof Feather.glyphMap) : 'award';
}

type RecentShow = { id: string; title: string; posterPath: string | null; type: string };
type PublicBadge = { id: string; label: string; icon: string; tier: number; tierCount: number };
type PublicGamification = {
  level: number;
  levelTitle: string;
  xp: number;
  nextLevelXp: number;
  currentStreak: number;
  bestStreak: number;
  badges: PublicBadge[];
};
type UserProfile = {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  isFollowing: boolean;
  isBlocked: boolean;
  isSelf: boolean;
  isPrivate: boolean;
  followersCount: number;
  followingCount: number;
  restricted: boolean;
  gamification: PublicGamification | null;
  stats: { showsCount: number; moviesCount: number; episodesWatched: number; gamesCount: number } | null;
  recentShows: RecentShow[];
  favoriteShows: MediaDto[];
  favoriteMovies: MediaDto[];
  favoriteGames: MediaDto[];
};

function mediaHref(id: string, kind: string): Href {
  if (kind === 'game') return ('/game/' + id) as Href;
  return ('/show/' + id + (kind === 'movie' ? '?type=movie' : '')) as Href;
}

export default function UserProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const qc = useQueryClient();
  const focused = useIsFocused();
  const [busy, setBusy] = useState(false);
  const [blockConfirm, setBlockConfirm] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  useBackClose(blockConfirm, () => setBlockConfirm(false));

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined' || !focused) return;
    const previous = currentThemeColorMeta();
    setThemeColorMeta(HERO_COLOR);
    return () => setThemeColorMeta(previous);
  }, [focused]);

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['user', id],
    queryFn: () => api.get<UserProfile>('/api/users/' + id),
  });

  const toggleFollow = async () => {
    if (!data || busy) return;
    setBusy(true);
    setActionError(null);
    const wasFollowing = data.isFollowing;
    await qc.cancelQueries({ queryKey: ['user', id] });
    const previous = qc.getQueryData<UserProfile>(['user', id]);
    qc.setQueryData<UserProfile>(['user', id], (current) =>
      current
        ? {
            ...current,
            isFollowing: !wasFollowing,
            followersCount: Math.max(0, current.followersCount + (wasFollowing ? -1 : 1)),
          }
        : current,
    );
    try {
      if (wasFollowing) await api.del('/api/social/follow/' + data.id);
      else await api.post('/api/social/follow/' + data.id);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['user', id] }),
        qc.invalidateQueries({ queryKey: ['social'] }),
        qc.invalidateQueries({ queryKey: ['profile'] }),
      ]);
    } catch {
      if (previous) qc.setQueryData(['user', id], previous);
      setActionError("Le suivi n'a pas pu être synchronisé. Réessaie.");
    } finally {
      setBusy(false);
    }
  };

  const toggleBlock = async () => {
    if (!data || busy) return;
    setBusy(true);
    setActionError(null);
    setBlockConfirm(false);
    const wasBlocked = data.isBlocked;
    await qc.cancelQueries({ queryKey: ['user', id] });
    const previous = qc.getQueryData<UserProfile>(['user', id]);
    qc.setQueryData<UserProfile>(['user', id], (current) =>
      current
        ? {
            ...current,
            isBlocked: !wasBlocked,
            isFollowing: wasBlocked ? current.isFollowing : false,
            followersCount:
              !wasBlocked && current.isFollowing ? Math.max(0, current.followersCount - 1) : current.followersCount,
          }
        : current,
    );
    try {
      if (wasBlocked) await api.del('/api/users/' + data.id + '/block');
      else await api.post('/api/users/' + data.id + '/block');
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['user', id] }),
        qc.invalidateQueries({ queryKey: ['social'] }),
        qc.invalidateQueries({ queryKey: ['gamification'] }),
        qc.invalidateQueries({ queryKey: ['comments'] }),
      ]);
    } catch {
      if (previous) qc.setQueryData(['user', id], previous);
      setActionError("Le blocage n'a pas pu être synchronisé. Réessaie.");
    } finally {
      setBusy(false);
    }
  };

  if (isLoading) return <Loading />;
  if (!data) return <LoadError onRetry={refetch} busy={isRefetching} />;

  const gamification = data.gamification;
  const avatar = data.avatarUrl ? tmdbImage(data.avatarUrl, 'w342') ?? data.avatarUrl : null;

  return (
    <View style={styles.screen}>
      {focused ? <StatusBar style="light" /> : null}
      <Pop>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
          <View style={styles.canvas}>
            <View style={[styles.hero, { paddingTop: insets.top + SPACE.md }]}>
              <Pressable
                onPress={() => goBack('/social')}
                hitSlop={8}
                style={[styles.iconButton, styles.backButton, { top: insets.top + SPACE.xs }]}
                accessibilityRole="button"
                accessibilityLabel="Retour"
              >
                <Feather name="chevron-left" size={27} color="#FFFFFF" />
              </Pressable>
              {!data.isSelf ? (
                <Pressable
                  onPress={() => setBlockConfirm(true)}
                  hitSlop={8}
                  style={[styles.iconButton, styles.menuButton, { top: insets.top + SPACE.xs }]}
                  accessibilityRole="button"
                  accessibilityLabel="Options de confidentialité"
                >
                  <Feather name="more-horizontal" size={24} color="#FFFFFF" />
                </Pressable>
              ) : null}

              <View style={styles.avatarStage}>
                <View style={styles.avatar}>
                  {avatar ? (
                    <Image source={{ uri: avatar }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                  ) : (
                    <Text style={styles.avatarInitial}>{data.displayName.slice(0, 1).toUpperCase()}</Text>
                  )}
                </View>
                {gamification ? (
                  <View style={styles.levelPill}>
                    <Text style={styles.levelPillText}>{gamification.level}</Text>
                  </View>
                ) : null}
              </View>

              <Text style={styles.name} accessibilityRole="header">{data.displayName}</Text>
              {gamification ? (
                <View style={styles.levelRow}>
                  <Feather name="zap" size={14} color="#F3C54F" />
                  <Text style={styles.levelTitle}>
                    Niveau {gamification.level} · {gamification.levelTitle}
                  </Text>
                </View>
              ) : null}
              {gamification && gamification.currentStreak > 0 ? (
                <View style={styles.streakPill}>
                  <Feather name="activity" size={13} color="#FFFFFF" />
                  <Text style={styles.streakText}>
                    {gamification.currentStreak} jour{gamification.currentStreak > 1 ? 's' : ''} de série
                  </Text>
                </View>
              ) : null}

              <View style={styles.followRow}>
                <View style={styles.followMetric}>
                  <Text style={styles.followNumber}>{data.followersCount}</Text>
                  <Text style={styles.followLabel}>abonné{data.followersCount > 1 ? 's' : ''}</Text>
                </View>
                <View style={styles.followDivider} />
                <View style={styles.followMetric}>
                  <Text style={styles.followNumber}>{data.followingCount}</Text>
                  <Text style={styles.followLabel}>abonnement{data.followingCount > 1 ? 's' : ''}</Text>
                </View>
              </View>

              {!data.isSelf ? (
                <Pressable
                  style={({ pressed }) => [
                    styles.primaryAction,
                    (data.isFollowing || data.isBlocked) && styles.secondaryAction,
                    pressed && styles.pressed,
                  ]}
                  onPress={data.isBlocked ? toggleBlock : toggleFollow}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityLabel={
                    data.isBlocked
                      ? 'Débloquer ' + data.displayName
                      : data.isFollowing
                        ? 'Ne plus suivre ' + data.displayName
                        : 'Suivre ' + data.displayName
                  }
                  accessibilityState={{ disabled: busy, busy }}
                >
                  {busy ? (
                    <ActivityIndicator color={data.isFollowing || data.isBlocked ? HERO_COLOR : COLORS.onAccent} />
                  ) : (
                    <>
                      <Feather
                        name={data.isBlocked ? 'unlock' : data.isFollowing ? 'check' : 'plus'}
                        size={17}
                        color={data.isFollowing || data.isBlocked ? HERO_COLOR : COLORS.onAccent}
                      />
                      <Text style={[styles.primaryActionText, (data.isFollowing || data.isBlocked) && styles.secondaryActionText]}>
                        {data.isBlocked ? 'DÉBLOQUER' : data.isFollowing ? 'ABONNÉ' : 'SUIVRE'}
                      </Text>
                    </>
                  )}
                </Pressable>
              ) : null}

              {actionError ? (
                <View style={styles.heroError} accessibilityRole="alert">
                  <Feather name="alert-circle" size={16} color="#FFFFFF" />
                  <Text style={styles.heroErrorText}>{actionError}</Text>
                </View>
              ) : null}
            </View>

            {gamification ? (
              <View style={styles.sectionCard}>
                <SectionHeading icon="award" title="Trophées" />
                <View style={styles.progressSummary}>
                  <View>
                    <Text style={styles.progressLabel}>Progression</Text>
                    <Text style={styles.progressValue}>{gamification.xp} XP</Text>
                  </View>
                  <View style={styles.bestStreak}>
                    <Feather name="activity" size={15} color={COLORS.warning} />
                    <Text style={styles.bestStreakText}>Record {gamification.bestStreak} j</Text>
                  </View>
                </View>
                {gamification.badges.length > 0 ? (
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.badgesRow}
                  >
                    {gamification.badges.map((badge, index) => (
                      <AppearItem key={badge.id} index={index}>
                        <View style={styles.badgeCell}>
                          <View style={[styles.badgeCircle, { backgroundColor: TIER_COLORS[badge.tier] ?? TIER_COLORS[1] }]}>
                            <Feather name={safeFeatherIcon(badge.icon)} size={23} color="#FFFFFF" />
                          </View>
                          <Text style={styles.badgeLabel} numberOfLines={2}>{badge.label}</Text>
                          <Text style={styles.badgeTier}>
                            {badge.tierCount > 1 ? 'Palier ' + badge.tier + '/' + badge.tierCount : 'Débloqué'}
                          </Text>
                        </View>
                      </AppearItem>
                    ))}
                  </ScrollView>
                ) : (
                  <Text style={styles.mutedCopy}>Les trophées débloqués apparaîtront ici.</Text>
                )}
              </View>
            ) : null}

            {data.restricted ? (
              <View style={styles.lockedCard}>
                <View style={styles.lockedIcon}>
                  <Feather name="lock" size={25} color={COLORS.primary} />
                </View>
                <Text style={styles.lockedTitle}>Ce profil est privé</Text>
                <Text style={styles.lockedBody}>Abonne-toi pour voir son activité, ses statistiques et ses favoris.</Text>
              </View>
            ) : (
              <>
                {data.stats ? (
                  <View style={styles.sectionCard}>
                    <SectionHeading icon="bar-chart-2" title="Activité suivie" />
                    <View style={styles.statsGrid}>
                      <Counter icon="tv" value={data.stats.showsCount} label="Séries" />
                      <Counter icon="film" value={data.stats.moviesCount} label="Films" />
                      <Counter icon="check-circle" value={data.stats.episodesWatched} label="Épisodes" />
                      <Counter icon="target" value={data.stats.gamesCount} label="Jeux" />
                    </View>
                  </View>
                ) : null}

                <Pressable
                  style={({ pressed }) => [styles.libraryLink, pressed && styles.pressed]}
                  onPress={() =>
                    router.push({
                      pathname: '/user-library',
                      params: { id: data.id, name: data.displayName, type: 'show' },
                    })
                  }
                  accessibilityRole="button"
                  accessibilityLabel={'Voir toute la bibliothèque de ' + data.displayName}
                  accessibilityHint="Ouvre la liste complète de ses séries, films et jeux"
                >
                  <View style={styles.libraryIcon} accessible={false}>
                    <Feather name="grid" size={17} color={COLORS.primary} />
                  </View>
                  <View style={styles.libraryCopy}>
                    <Text style={styles.libraryTitle}>Bibliothèque complète</Text>
                  </View>
                  <Feather name="chevron-right" size={20} color={COLORS.textSoft} />
                </Pressable>

                <MediaRail title="Séries récentes" items={data.recentShows} kind="show" />
                <MediaRail title="Séries préférées" items={data.favoriteShows} kind="show" favorite />
                <MediaRail title="Films préférés" items={data.favoriteMovies} kind="movie" favorite />
                <MediaRail title="Jeux préférés" items={data.favoriteGames} kind="game" favorite />
              </>
            )}
          </View>
        </ScrollView>
      </Pop>

      <Modal visible={blockConfirm} transparent animationType="fade" onRequestClose={() => setBlockConfirm(false)}>
        <View style={styles.modalRoot}>
          <Pressable
            style={styles.modalOverlay}
            onPress={() => setBlockConfirm(false)}
            accessibilityRole="button"
            accessibilityLabel="Fermer"
          />
          <View style={[styles.modalCard, { paddingBottom: Math.max(insets.bottom, SPACE.md) }]}>
            <View style={styles.modalHandle} />
            <View style={styles.modalIcon}>
              <Feather name={data.isBlocked ? 'unlock' : 'slash'} size={23} color={COLORS.danger} />
            </View>
            <Text style={styles.modalTitle}>
              {data.isBlocked ? 'Débloquer ' + data.displayName + ' ?' : 'Bloquer ' + data.displayName + ' ?'}
            </Text>
            <Text style={styles.modalBody}>
              {data.isBlocked
                ? 'Ses commentaires et son activité seront de nouveau visibles.'
                : 'Ses commentaires et son activité seront masqués. Les abonnements entre vous seront retirés.'}
            </Text>
            <View style={styles.modalActions}>
              <Pressable
                style={({ pressed }) => [styles.modalButton, styles.cancelButton, pressed && styles.pressed]}
                onPress={() => setBlockConfirm(false)}
                accessibilityRole="button"
                accessibilityLabel="Annuler"
              >
                <Text style={styles.cancelText}>Annuler</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.modalButton, styles.dangerButton, pressed && styles.pressed]}
                onPress={toggleBlock}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel={(data.isBlocked ? 'Débloquer ' : 'Bloquer ') + data.displayName}
                accessibilityState={{ disabled: busy, busy }}
              >
                {busy ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.dangerText}>{data.isBlocked ? 'Débloquer' : 'Bloquer'}</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function SectionHeading({
  icon,
  title,
}: {
  icon: keyof typeof Feather.glyphMap;
  title: string;
}) {
  return (
    <View style={styles.headingRow}>
      <View style={styles.headingIcon}>
        <Feather name={icon} size={17} color={COLORS.primary} />
      </View>
      <Text style={styles.sectionTitle}>{title}</Text>
    </View>
  );
}

function Counter({
  icon,
  value,
  label,
}: {
  icon: keyof typeof Feather.glyphMap;
  value: number;
  label: string;
}) {
  return (
    <View style={styles.counter}>
      <Feather name={icon} size={17} color={COLORS.primary} />
      <Text style={styles.counterValue}>{value}</Text>
      <Text style={styles.counterLabel}>{label}</Text>
    </View>
  );
}

function MediaRail({
  title,
  items,
  kind,
  favorite,
}: {
  title: string;
  items: Array<MediaDto | RecentShow>;
  kind: 'show' | 'movie' | 'game';
  favorite?: boolean;
}) {
  const router = useRouter();
  if (items.length === 0) return null;
  return (
    <View style={styles.sectionCard}>
      <SectionHeading icon={favorite ? 'heart' : 'clock'} title={title} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.mediaRow}>
        {items.map((media, index) => {
          const poster = tmdbImage(media.posterPath, 'w342');
          return (
            <AppearItem key={media.id} index={index}>
              <PressableScale
                style={styles.mediaCard}
                onPress={() => router.push(mediaHref(media.id, kind))}
                accessibilityRole="button"
                accessibilityLabel={'Ouvrir ' + media.title}
              >
                <View style={styles.poster}>
                  {poster ? (
                    <Image source={{ uri: poster }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                  ) : (
                    <Feather name={kind === 'game' ? 'target' : kind === 'movie' ? 'film' : 'tv'} size={24} color={COLORS.textSoft} />
                  )}
                </View>
                <Text style={styles.mediaTitle} numberOfLines={2}>{media.title}</Text>
              </PressableScale>
            </AppearItem>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.pageMuted },
  scrollContent: { paddingBottom: SPACE.xl },
  canvas: { width: '100%', maxWidth: SIZES.contentMax, alignSelf: 'center', gap: SPACE.md },
  hero: {
    position: 'relative',
    alignItems: 'center',
    overflow: 'hidden',
    paddingHorizontal: SPACE.lg,
    paddingBottom: SPACE.lg,
    backgroundColor: HERO_COLOR,
    borderBottomLeftRadius: RADIUS.sheet,
    borderBottomRightRadius: RADIUS.sheet,
    ...SHADOW.card,
  },
  iconButton: {
    position: 'absolute',
    zIndex: 2,
    width: SIZES.touch,
    height: SIZES.touch,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 22,
  },
  backButton: { left: SPACE.sm },
  menuButton: { right: SPACE.sm },
  avatarStage: { marginTop: SPACE.sm },
  avatar: {
    width: 96,
    height: 96,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#514A57',
    borderWidth: 3,
    borderColor: '#FFFFFF',
    borderRadius: 48,
  },
  avatarInitial: { color: '#FFFFFF', fontSize: 36, lineHeight: 44, fontFamily: FONTS.extraBold },
  levelPill: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    minWidth: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
    backgroundColor: '#F3C54F',
    borderWidth: 3,
    borderColor: HERO_COLOR,
    borderRadius: 15,
  },
  levelPillText: { color: HERO_COLOR, fontSize: 13, lineHeight: 17, fontFamily: FONTS.extraBold },
  name: { marginTop: SPACE.sm, color: '#FFFFFF', fontSize: 23, lineHeight: 29, fontFamily: FONTS.bold, textAlign: 'center' },
  levelRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 },
  levelTitle: { color: 'rgba(255,255,255,0.88)', fontSize: 14, lineHeight: 19, fontFamily: FONTS.bold },
  streakPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: SPACE.xs,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: RADIUS.pill,
  },
  streakText: { color: '#FFFFFF', fontSize: 12, lineHeight: 16, fontFamily: FONTS.bold },
  followRow: { flexDirection: 'row', alignItems: 'center', marginTop: SPACE.md },
  followMetric: { minWidth: 104, alignItems: 'center' },
  followNumber: { color: '#FFFFFF', fontSize: 20, lineHeight: 25, fontFamily: FONTS.extraBold },
  followLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 12, lineHeight: 16, fontFamily: FONTS.regular },
  followDivider: { width: 1, height: 30, backgroundColor: 'rgba(255,255,255,0.2)' },
  primaryAction: {
    minWidth: 150,
    minHeight: SIZES.touch,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    marginTop: SPACE.md,
    paddingHorizontal: SPACE.lg,
    backgroundColor: '#F3C54F',
    borderRadius: RADIUS.pill,
  },
  secondaryAction: { backgroundColor: '#FFFFFF' },
  primaryActionText: { color: COLORS.onAccent, fontSize: 13, lineHeight: 17, fontFamily: FONTS.extraBold, letterSpacing: 0.5 },
  secondaryActionText: { color: HERO_COLOR },
  heroError: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.xs,
    marginTop: SPACE.sm,
    paddingHorizontal: SPACE.sm,
    paddingVertical: SPACE.xs,
    backgroundColor: 'rgba(200,63,96,0.42)',
    borderRadius: RADIUS.control,
  },
  heroErrorText: { flexShrink: 1, color: '#FFFFFF', fontSize: 12, lineHeight: 17, fontFamily: FONTS.bold, textAlign: 'center' },
  sectionCard: {
    marginHorizontal: SPACE.md,
    paddingVertical: SPACE.lg,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: RADIUS.card,
    ...SHADOW.card,
  },
  headingRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, paddingHorizontal: SPACE.lg },
  headingIcon: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primarySoft,
    borderRadius: 19,
  },
  sectionTitle: { flex: 1, color: COLORS.text, fontSize: 17, lineHeight: 22, fontFamily: FONTS.bold },
  progressSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: SPACE.lg,
    marginTop: SPACE.md,
    padding: SPACE.sm,
    backgroundColor: COLORS.surfaceMuted,
    borderRadius: RADIUS.control,
  },
  progressLabel: { color: COLORS.textMuted, fontSize: 11, lineHeight: 15, fontFamily: FONTS.regular },
  progressValue: { color: COLORS.text, fontSize: 17, lineHeight: 22, fontFamily: FONTS.extraBold },
  bestStreak: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  bestStreakText: { color: COLORS.text, fontSize: 12, lineHeight: 16, fontFamily: FONTS.bold },
  badgesRow: { gap: SPACE.md, paddingHorizontal: SPACE.lg, paddingTop: SPACE.md },
  badgeCell: { width: 82, alignItems: 'center' },
  badgeCircle: { width: 58, height: 58, alignItems: 'center', justifyContent: 'center', borderRadius: 29 },
  badgeLabel: { marginTop: 7, color: COLORS.text, fontSize: 11, lineHeight: 15, fontFamily: FONTS.bold, textAlign: 'center' },
  badgeTier: { marginTop: 2, color: COLORS.textSoft, fontSize: 9, lineHeight: 12, fontFamily: FONTS.regular, textAlign: 'center' },
  mutedCopy: { marginHorizontal: SPACE.lg, marginTop: SPACE.md, color: COLORS.textMuted, fontSize: 14, lineHeight: 20, fontFamily: FONTS.regular },
  lockedCard: {
    alignItems: 'center',
    marginHorizontal: SPACE.md,
    padding: SPACE.xl,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: RADIUS.card,
    ...SHADOW.card,
  },
  lockedIcon: { width: 58, height: 58, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.primarySoft, borderRadius: 29 },
  lockedTitle: { marginTop: SPACE.md, color: COLORS.text, fontSize: 20, lineHeight: 26, fontFamily: FONTS.extraBold, textAlign: 'center' },
  lockedBody: { marginTop: SPACE.xs, color: COLORS.textMuted, fontSize: 14, lineHeight: 21, fontFamily: FONTS.regular, textAlign: 'center' },
  libraryLink: {
    minHeight: SIZES.touchComfortable,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.sm,
    marginHorizontal: SPACE.md,
    paddingHorizontal: SPACE.md,
    paddingVertical: SPACE.sm,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: RADIUS.card,
    ...SHADOW.card,
  },
  libraryIcon: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primarySoft,
    borderRadius: 19,
  },
  libraryCopy: { flex: 1, minWidth: 0 },
  libraryTitle: { color: COLORS.text, fontSize: 15, lineHeight: 20, fontFamily: FONTS.extraBold },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.xs, paddingHorizontal: SPACE.lg, paddingTop: SPACE.md },
  counter: {
    minWidth: '46%',
    flexGrow: 1,
    alignItems: 'center',
    padding: SPACE.md,
    backgroundColor: COLORS.surfaceMuted,
    borderRadius: RADIUS.control,
  },
  counterValue: { marginTop: 4, color: COLORS.text, fontSize: 23, lineHeight: 29, fontFamily: FONTS.extraBold },
  counterLabel: { color: COLORS.textMuted, fontSize: 12, lineHeight: 16, fontFamily: FONTS.regular },
  mediaRow: { gap: SPACE.sm, paddingHorizontal: SPACE.lg, paddingTop: SPACE.md },
  mediaCard: { width: 108 },
  poster: {
    width: 108,
    aspectRatio: 2 / 3,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.imagePlaceholder,
    borderRadius: RADIUS.poster,
  },
  mediaTitle: { marginTop: 7, color: COLORS.text, fontSize: 12, lineHeight: 16, fontFamily: FONTS.bold },
  pressed: { opacity: 0.82 },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  modalOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: COLORS.overlay },
  modalCard: {
    padding: SPACE.lg,
    backgroundColor: COLORS.sheet,
    borderTopLeftRadius: RADIUS.sheet,
    borderTopRightRadius: RADIUS.sheet,
  },
  modalHandle: { width: 42, height: 4, alignSelf: 'center', marginBottom: SPACE.lg, backgroundColor: COLORS.border, borderRadius: 2 },
  modalIcon: { width: 52, height: 52, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.surfaceMuted, borderRadius: 26 },
  modalTitle: { marginTop: SPACE.md, color: COLORS.text, fontSize: 22, lineHeight: 28, fontFamily: FONTS.extraBold },
  modalBody: { marginTop: SPACE.xs, color: COLORS.textMuted, fontSize: 14, lineHeight: 21, fontFamily: FONTS.regular },
  modalActions: { flexDirection: 'row', gap: SPACE.sm, marginTop: SPACE.lg },
  modalButton: { minHeight: SIZES.touchComfortable, flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: SPACE.md, borderRadius: RADIUS.pill },
  cancelButton: { backgroundColor: COLORS.surfaceMuted },
  dangerButton: { backgroundColor: COLORS.danger },
  cancelText: { color: COLORS.text, fontSize: 14, lineHeight: 19, fontFamily: FONTS.bold },
  dangerText: { color: '#FFFFFF', fontSize: 14, lineHeight: 19, fontFamily: FONTS.extraBold },
});
