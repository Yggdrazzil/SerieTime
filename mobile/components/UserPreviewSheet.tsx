import React, { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, tmdbImage } from '@/lib/api';
import { COLORS, FONTS, RADIUS, SHADOW, SIZES, SPACE } from '@/lib/theme';
import { LoadError, Poster } from '@/components/ui';
import { useReduceMotion } from '@/lib/useReduceMotion';
import { useHideTabBar } from '@/lib/tabBarHidden';
import { useBackClose } from '@/lib/useBackClose';
import { useUserPreviewStore } from '@/lib/userPreview';

// Aperçu de profil en feuille basse (demande Benjamin) : résumé compact d'un
// profil public (réputation, compteurs, dernières affiches) + bouton vers le
// profil complet. Monté UNE fois au niveau racine (app/_layout.tsx) pour
// couvrir aussi les écrans poussés ; piloté par lib/userPreview.ts.
// Même clé react-query que app/user/[id].tsx (['user', id]) : cache partagé,
// l'ouverture du profil complet est instantanée après l'aperçu.

type PreviewMedia = { id: string; title: string; posterPath: string | null };
type PreviewProfile = {
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
  gamification: { level: number; levelTitle: string; currentStreak: number } | null;
  stats: { showsCount: number; moviesCount: number; episodesWatched: number; gamesCount: number } | null;
  recentShows: PreviewMedia[];
  favoriteShows: PreviewMedia[];
  favoriteMovies: PreviewMedia[];
  favoriteGames: PreviewMedia[];
};

// 4 à 6 affiches : récentes d'abord, complétées par les favoris (sans doublon).
function previewPosters(data: PreviewProfile): PreviewMedia[] {
  const seen = new Set<string>();
  const out: PreviewMedia[] = [];
  for (const media of [
    ...data.recentShows,
    ...data.favoriteShows,
    ...data.favoriteMovies,
    ...data.favoriteGames,
  ]) {
    if (seen.has(media.id)) continue;
    seen.add(media.id);
    out.push(media);
    if (out.length >= 6) break;
  }
  return out;
}

export function UserPreviewSheet() {
  const userId = useUserPreviewStore((s) => s.userId);
  const close = useUserPreviewStore((s) => s.close);
  const insets = useSafeAreaInsets();
  const reduce = useReduceMotion();
  // Tab bar flottante : masquée tant que la feuille est ouverte (cf. tabBarHidden).
  useHideTabBar(!!userId);
  // Le « retour » ferme l'aperçu au lieu de quitter l'app.
  const { beginNavigation } = useBackClose(!!userId, close);

  return (
    <Modal
      visible={!!userId}
      transparent
      animationType={reduce ? 'none' : 'slide'}
      onRequestClose={close}
    >
      <View style={styles.root}>
        <Pressable
          style={styles.overlay}
          onPress={close}
          accessibilityRole="button"
          accessibilityLabel="Fermer l'aperçu du profil"
        />
        <View
          style={[styles.sheet, { paddingBottom: insets.bottom + SPACE.md }]}
          accessibilityViewIsModal
          onAccessibilityEscape={close}
        >
          <View style={styles.handle} accessible={false} />
          {userId ? <PreviewContent userId={userId} onClose={close} onNavigateAway={beginNavigation} /> : null}
        </View>
      </View>
    </Modal>
  );
}

// Contenu monté seulement quand un userId est ouvert (query toujours réelle).
function PreviewContent({ userId, onClose, onNavigateAway }: { userId: string; onClose: () => void; onNavigateAway: () => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['user', userId],
    queryFn: () => api.get<PreviewProfile>('/api/users/' + userId),
  });

  // Suivre / ne plus suivre : mise à jour optimiste du cache ['user', id] +
  // invalidations identiques à FriendsTab (app/social.tsx).
  const toggleFollow = async () => {
    if (!data || busy) return;
    setBusy(true);
    setActionError(null);
    const wasFollowing = data.isFollowing;
    await qc.cancelQueries({ queryKey: ['user', userId] });
    const previous = qc.getQueryData<PreviewProfile>(['user', userId]);
    qc.setQueryData<PreviewProfile>(['user', userId], (current) =>
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
      void qc.invalidateQueries({ queryKey: ['social'] });
      void qc.invalidateQueries({ queryKey: ['profile'] });
      void qc.invalidateQueries({ queryKey: ['user', userId] });
      void qc.invalidateQueries({ queryKey: ['stats', 'leaderboard'] });
      void qc.invalidateQueries({ queryKey: ['gamification'] });
    } catch {
      if (previous) qc.setQueryData(['user', userId], previous);
      setActionError("L'abonnement n'a pas pu être modifié. Réessaie.");
    } finally {
      setBusy(false);
    }
  };

  const openFullProfile = () => {
    onNavigateAway();
    onClose();
    router.push(('/user/' + userId) as Href);
  };

  const openLibrary = () => {
    if (!data) return;
    onNavigateAway();
    onClose();
    router.push({
      pathname: '/user-library',
      params: { id: data.id, name: data.displayName, type: 'show' },
    });
  };

  if (isLoading) {
    return (
      <View style={styles.stateBox} accessibilityLabel="Chargement du profil">
        <ActivityIndicator color={COLORS.primary} />
      </View>
    );
  }
  if (isError || !data) {
    return <LoadError onRetry={() => void refetch()} busy={isRefetching} />;
  }

  const avatar = data.avatarUrl ? tmdbImage(data.avatarUrl, 'w342') ?? data.avatarUrl : null;
  const gamification = data.gamification;
  const metaLabel = gamification
    ? 'Nv. ' + gamification.level +
      (gamification.levelTitle ? ' · ' + gamification.levelTitle : '') +
      (gamification.currentStreak > 0 ? ' · 🔥 ' + gamification.currentStreak : '')
    : '';
  const posters = data.restricted ? [] : previewPosters(data);
  const counters: { value: number; label: string }[] = [
    { value: data.followersCount, label: data.followersCount > 1 ? 'abonnés' : 'abonné' },
    { value: data.followingCount, label: data.followingCount > 1 ? 'abonnements' : 'abonnement' },
    ...(data.stats
      ? [
          { value: data.stats.showsCount, label: data.stats.showsCount > 1 ? 'séries' : 'série' },
          { value: data.stats.moviesCount, label: data.stats.moviesCount > 1 ? 'films' : 'film' },
          { value: data.stats.gamesCount, label: data.stats.gamesCount > 1 ? 'jeux' : 'jeu' },
        ]
      : []),
  ];

  return (
    <View>
      <View style={styles.identityRow}>
        <View style={styles.avatar}>
          {avatar ? (
            <Image source={{ uri: avatar }} style={StyleSheet.absoluteFill} resizeMode="cover" accessible={false} />
          ) : (
            <Text style={styles.avatarInitial}>{data.displayName.slice(0, 1).toUpperCase()}</Text>
          )}
        </View>
        <View style={styles.identityCopy}>
          <Text accessibilityRole="header" style={styles.name} numberOfLines={1}>
            {data.displayName}
          </Text>
          {metaLabel ? <Text style={styles.meta}>{metaLabel}</Text> : null}
        </View>
      </View>

      <View style={styles.counters}>
        {counters.map((counter) => (
          <View
            key={counter.label}
            style={styles.counter}
            accessible
            accessibilityLabel={counter.value + ' ' + counter.label}
          >
            <Text style={styles.counterValue}>{counter.value}</Text>
            <Text style={styles.counterLabel}>{counter.label}</Text>
          </View>
        ))}
      </View>

      {data.restricted ? (
        <View style={styles.lockedRow}>
          <Feather name="lock" size={16} color={COLORS.textMuted} />
          <Text style={styles.lockedText}>Profil privé — abonne-toi pour voir son activité.</Text>
        </View>
      ) : posters.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.posterRow}
          accessibilityLabel={'Dernières séries, films et jeux de ' + data.displayName}
        >
          {posters.map((media) => (
            <Poster key={media.id} title={media.title} uri={tmdbImage(media.posterPath, 'w185')} width={62} />
          ))}
        </ScrollView>
      ) : null}

      {actionError ? (
        <Text style={styles.actionError} accessibilityRole="alert" accessibilityLiveRegion="polite">
          {actionError}
        </Text>
      ) : null}

      <View style={styles.actions}>
        {!data.isSelf && !data.isBlocked ? (
          <Pressable
            style={({ pressed }) => [
              styles.followButton,
              data.isFollowing && styles.followingButton,
              pressed && styles.pressed,
            ]}
            onPress={() => void toggleFollow()}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={
              (data.isFollowing ? 'Ne plus suivre ' : 'Suivre ') + data.displayName
            }
            accessibilityState={{ disabled: busy, busy, selected: data.isFollowing }}
          >
            {busy ? (
              <ActivityIndicator size="small" color={data.isFollowing ? COLORS.text : COLORS.onPrimary} />
            ) : (
              <>
                <Feather
                  name={data.isFollowing ? 'check' : 'plus'}
                  size={15}
                  color={data.isFollowing ? COLORS.text : COLORS.onPrimary}
                />
                <Text style={[styles.followText, data.isFollowing && styles.followingText]}>
                  {data.isFollowing ? 'SUIVI' : 'SUIVRE'}
                </Text>
              </>
            )}
          </Pressable>
        ) : null}
        <Pressable
          style={({ pressed }) => [styles.profileButton, pressed && styles.pressed]}
          onPress={openFullProfile}
          accessibilityRole="button"
          accessibilityLabel={'Voir le profil complet de ' + data.displayName}
        >
          <Text style={styles.profileText}>VOIR LE PROFIL</Text>
          <Feather name="arrow-right" size={16} color={COLORS.onPrimary} />
        </Pressable>
      </View>

      {/* Lien discret vers la bibliothèque intégrale (séries, films, jeux). */}
      {!data.restricted ? (
        <Pressable
          style={({ pressed }) => [styles.libraryLink, pressed && styles.pressed]}
          onPress={openLibrary}
          accessibilityRole="button"
          accessibilityLabel={'Voir la bibliothèque de ' + data.displayName}
          accessibilityHint="Ouvre la liste complète de ses séries, films et jeux"
        >
          <Feather name="grid" size={14} color={COLORS.primary} />
          <Text style={styles.libraryLinkText}>SA BIBLIOTHÈQUE</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: COLORS.overlay },
  sheet: {
    width: '100%',
    maxWidth: SIZES.contentMax,
    alignSelf: 'center',
    paddingHorizontal: SPACE.md,
    paddingTop: SPACE.xs,
    backgroundColor: COLORS.sheet,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderTopLeftRadius: RADIUS.sheet,
    borderTopRightRadius: RADIUS.sheet,
    ...SHADOW.season,
  },
  handle: {
    width: 42,
    height: 4,
    alignSelf: 'center',
    marginBottom: SPACE.sm,
    backgroundColor: COLORS.border,
    borderRadius: RADIUS.pill,
  },
  stateBox: { minHeight: 180, alignItems: 'center', justifyContent: 'center' },
  identityRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm },
  avatar: {
    width: 72,
    height: 72,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primarySoft,
    borderWidth: 2,
    borderColor: COLORS.surface,
    borderRadius: 36,
  },
  avatarInitial: { color: COLORS.primary, fontSize: 27, lineHeight: 34, fontFamily: FONTS.extraBold },
  identityCopy: { flex: 1, minWidth: 0 },
  name: { color: COLORS.text, fontSize: 21, lineHeight: 27, fontFamily: FONTS.extraBold },
  meta: { marginTop: 2, color: COLORS.textMuted, fontSize: 13, lineHeight: 18, fontFamily: FONTS.bold },
  counters: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACE.xs,
    marginTop: SPACE.md,
  },
  counter: {
    minWidth: 76,
    flexGrow: 1,
    alignItems: 'center',
    paddingVertical: SPACE.xs,
    paddingHorizontal: SPACE.xxs,
    backgroundColor: COLORS.surfaceMuted,
    borderRadius: RADIUS.control,
  },
  counterValue: { color: COLORS.text, fontSize: 17, lineHeight: 22, fontFamily: FONTS.extraBold },
  counterLabel: { color: COLORS.textMuted, fontSize: 11, lineHeight: 15, fontFamily: FONTS.regular },
  lockedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.xs,
    marginTop: SPACE.md,
    padding: SPACE.sm,
    backgroundColor: COLORS.surfaceMuted,
    borderRadius: RADIUS.control,
  },
  lockedText: {
    flexShrink: 1,
    color: COLORS.textMuted,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: FONTS.regular,
  },
  posterRow: { gap: SPACE.xs, marginTop: SPACE.md, paddingRight: SPACE.md },
  actionError: {
    marginTop: SPACE.sm,
    color: COLORS.danger,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: FONTS.bold,
  },
  actions: { flexDirection: 'row', gap: SPACE.sm, marginTop: SPACE.md },
  followButton: {
    minWidth: 116,
    minHeight: SIZES.touchComfortable,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACE.xxs,
    paddingHorizontal: SPACE.md,
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.pill,
  },
  followingButton: {
    backgroundColor: COLORS.surfaceMuted,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  followText: { color: COLORS.onPrimary, fontSize: 12, fontFamily: FONTS.extraBold, letterSpacing: 0.5 },
  followingText: { color: COLORS.text },
  profileButton: {
    flex: 1,
    minHeight: SIZES.touchComfortable,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACE.xs,
    paddingHorizontal: SPACE.md,
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.pill,
  },
  profileText: { color: COLORS.onPrimary, fontSize: 13, fontFamily: FONTS.extraBold, letterSpacing: 0.5 },
  libraryLink: {
    minHeight: SIZES.touch,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    gap: SPACE.xxs,
    marginTop: SPACE.xs,
    paddingHorizontal: SPACE.md,
  },
  libraryLinkText: { color: COLORS.primary, fontSize: 12, fontFamily: FONTS.extraBold, letterSpacing: 0.5 },
  pressed: { opacity: 0.78 },
});
