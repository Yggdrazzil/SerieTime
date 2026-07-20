import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';
import { useRouter, type Href } from 'expo-router';
import { goBack } from '@/lib/nav';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, tmdbImage } from '@/lib/api';
import { useDebounced } from '@/lib/useDebounced';
import { useOpenUserPreview } from '@/lib/userPreview';
import { COLORS, FONTS, RADIUS, SHADOW, SIZES, SPACE } from '@/lib/theme';
import { EmptyState, Loading, LoadError } from '@/components/ui';
import { AppearItem, FadeSwitch, PressableScale } from '@/components/anim';

type MediaType = 'show' | 'movie' | 'game';
type PublicUser = {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  isFollowing?: boolean;
  level?: number;
  // Streak de visionnage : fourni par le fil et les listes following/followers
  // (PAS par la recherche d'utilisateurs) — affichage conditionnel.
  streak?: number;
};
type FeedReactions = { total: number; mine: string[]; counts: Record<string, number> };
type FeedItem = {
  kind: 'watch' | 'comment' | 'badge';
  id: string;
  date: string;
  eventType: string;
  user: PublicUser;
  media?: { id: string; title: string; posterPath: string | null; type: MediaType };
  episode?: { seasonNumber: number; episodeNumber: number; title: string } | null;
  body?: string;
  badge?: { id: string; label: string; tier: number };
  reactions?: FeedReactions;
};

const FEED_KEY = ['social', 'feed'] as const;
const HEART = '❤️';

// Bascule locale du cœur sur un item du fil (miroir du toggle serveur) —
// utilisée par la mise à jour optimiste du cache react-query.
function toggleHeart(item: FeedItem): FeedItem {
  const r = item.reactions ?? { total: 0, mine: [], counts: {} };
  const liked = r.mine.includes(HEART);
  return {
    ...item,
    reactions: {
      total: Math.max(0, r.total + (liked ? -1 : 1)),
      mine: liked ? r.mine.filter((e) => e !== HEART) : [...r.mine, HEART],
      counts: { ...r.counts, [HEART]: Math.max(0, (r.counts[HEART] ?? 0) + (liked ? -1 : 1)) },
    },
  };
}

const TIER_LABELS: Record<number, string> = {
  1: 'bronze',
  2: 'argent',
  3: 'or',
  4: 'platine',
};

function mediaHref(media: NonNullable<FeedItem['media']>): Href {
  if (media.type === 'game') return ('/game/' + media.id) as Href;
  return (
    '/show/' + media.id + (media.type === 'movie' ? '?type=movie' : '')
  ) as Href;
}

function actionText(item: FeedItem): string {
  if (item.kind === 'comment') return 'a commenté';
  if (item.eventType === 'favorited') return 'a ajouté aux favoris';
  if (item.eventType === 'added_to_watchlist') return 'a ajouté à sa liste';
  if (item.episode) {
    return (
      'a regardé S' +
      item.episode.seasonNumber +
      'E' +
      item.episode.episodeNumber
    );
  }
  return item.media?.type === 'game' ? 'a joué à' : 'a regardé';
}

function dateLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'short',
    year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
  });
}

// Exporté : réutilisé par le QG de l'onglet Communauté (components/communityHQ.tsx).
export function UserAvatar({
  user,
  onPress,
  size = 46,
}: {
  user: PublicUser;
  onPress?: () => void;
  size?: number;
}) {
  const uri = tmdbImage(user.avatarUrl, 'w185') ?? user.avatarUrl;
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={[
        styles.avatar,
        { width: size, height: size, borderRadius: size / 2 },
      ]}
      accessibilityRole={onPress ? 'button' : 'image'}
      accessibilityLabel={user.displayName}
      accessibilityHint={onPress ? 'Affiche un aperçu de son profil' : undefined}
    >
      {uri ? (
        <Image
          source={{ uri }}
          style={[StyleSheet.absoluteFill, { borderRadius: size / 2 - 2 }]}
          resizeMode="cover"
          accessible={false}
        />
      ) : (
        <Text style={styles.avatarInit}>
          {user.displayName.slice(0, 1).toUpperCase()}
        </Text>
      )}
      {user.level ? (
        <View style={styles.avatarLevel}>
          <Text style={styles.avatarLevelText}>{user.level}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

export default function Social() {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<'feed' | 'friends'>('feed');

  return (
    <View style={styles.screen}>
      <View style={styles.canvas}>
        <View style={[styles.hero, { paddingTop: insets.top + SPACE.xs }]}>
          <View style={styles.heroTop}>
            <Pressable
              onPress={() => goBack('/profile')}
              style={({ pressed }) => [
                styles.iconButton,
                pressed && styles.pressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Retour"
            >
              <Feather name="arrow-left" size={21} color={COLORS.text} />
            </Pressable>
            <View style={styles.heroCopy}>
              <Text style={styles.eyebrow}>COMMUNAUTÉ</Text>
              <Text accessibilityRole="header" style={styles.heroTitle}>
                Entre amis
              </Text>
            </View>
            <View style={styles.heroMark} accessible={false}>
              <Feather name="users" size={20} color={COLORS.onPrimary} />
            </View>
          </View>
          <Text style={styles.heroSubtitle}>
            Découvre les histoires que suit ta communauté.
          </Text>
          <View style={styles.tabs} accessibilityRole="tablist">
            <Tab
              label="ACTIVITÉ"
              active={tab === 'feed'}
              onPress={() => setTab('feed')}
            />
            <Tab
              label="TROUVER DES AMIS"
              active={tab === 'friends'}
              onPress={() => setTab('friends')}
            />
          </View>
        </View>

        <FadeSwitch trigger={tab}>
          {tab === 'feed' ? <FeedTab /> : <FriendsTab />}
        </FadeSwitch>
      </View>
    </View>
  );
}

function Tab({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.tab,
        active && styles.tabActive,
        pressed && styles.pressed,
      ]}
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
    >
      <Text style={[styles.tabText, active && styles.tabTextActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

// Exporté : un en-tête de liste peut être injecté par l'écran hôte. Depuis la
// refonte Communauté 2026-07-20, seul cet écran /social l'utilise encore.
export function FeedTab({ header }: { header?: React.ReactElement }) {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: FEED_KEY,
    queryFn: () => api.get<{ items: FeedItem[] }>('/api/social/feed'),
  });

  // Toggle ❤️ : mise à jour OPTIMISTE du cache (bascule immédiate), rollback
  // sur l'état précédent si le serveur refuse.
  const react = useMutation({
    mutationFn: (item: FeedItem) =>
      api.post<{ reacted: boolean; count: number }>('/api/social/feed/react', {
        kind: item.kind,
        refId: item.id,
        emoji: HEART,
      }),
    onMutate: async (item) => {
      await queryClient.cancelQueries({ queryKey: FEED_KEY });
      const previous = queryClient.getQueryData<{ items: FeedItem[] }>(FEED_KEY);
      queryClient.setQueryData<{ items: FeedItem[] }>(FEED_KEY, (old) =>
        old
          ? {
              ...old,
              items: old.items.map((it) =>
                it.kind === item.kind && it.id === item.id ? toggleHeart(it) : it,
              ),
            }
          : old,
      );
      return { previous };
    },
    onError: (_error, _item, context) => {
      if (context?.previous) queryClient.setQueryData(FEED_KEY, context.previous);
    },
  });

  // Référence stable passée aux cartes mémoïsées : évite de re-rendre les
  // ~50 cartes du fil à chaque toggle optimiste (`mutate` est stable en v5).
  const { mutate } = react;
  const onToggle = useCallback((target: FeedItem) => mutate(target), [mutate]);

  if (isLoading) return <Loading />;
  if (isError && !data) {
    return <LoadError onRetry={() => void refetch()} busy={isRefetching} />;
  }

  const items = data?.items ?? [];
  return (
    <FlatList
      data={items}
      style={styles.list}
      contentContainerStyle={[
        styles.listContent,
        items.length === 0 && styles.listContentEmpty,
      ]}
      keyExtractor={(item) => item.kind + '-' + item.id}
      renderItem={({ item, index }) => (
        <AppearItem index={index}>
          {item.kind === 'badge' && item.badge ? (
            <BadgeFeedCard item={item} onToggle={onToggle} />
          ) : item.media ? (
            <MediaFeedCard item={item} onToggle={onToggle} />
          ) : null}
        </AppearItem>
      )}
      ListHeaderComponent={header}
      refreshControl={
        <RefreshControl
          refreshing={isRefetching}
          onRefresh={() => void refetch()}
          tintColor={COLORS.primary}
          colors={[COLORS.primary]}
        />
      }
      ListEmptyComponent={
        <EmptyState
          title="Pas encore d’activité"
          message="Trouve des amis pour voir ici leurs visionnages, jeux, commentaires et trophées."
        />
      }
      showsVerticalScrollIndicator={false}
      initialNumToRender={8}
      maxToRenderPerBatch={8}
      windowSize={7}
    />
  );
}

// Cartes du fil : définies au niveau module + React.memo pour que le toggle
// optimiste d'un ❤️ ne remonte pas toutes les cartes (identité de composant
// stable ; seul l'item modifié change de référence dans le cache).
type FeedCardProps = { item: FeedItem; onToggle: (item: FeedItem) => void };

const BadgeFeedCard = React.memo(function BadgeFeedCard({ item, onToggle }: FeedCardProps) {
  const openUserPreview = useOpenUserPreview();
  const tierLabel =
    TIER_LABELS[item.badge?.tier ?? 0] ??
    'palier ' + String(item.badge?.tier ?? '');
  return (
    <View style={styles.feedCard}>
      <View style={styles.feedCardMain}>
        <UserAvatar
          user={item.user}
          onPress={() => openUserPreview(item.user.id)}
        />
        <View style={styles.feedCopy}>
          <Text style={styles.feedText}>
            <Text style={styles.feedName}>{item.user.displayName}</Text>
            {item.user.streak ? (
              <Text style={styles.streakInline}>{' 🔥 ' + item.user.streak}</Text>
            ) : null}
            {' a débloqué '}
            <Text style={styles.feedMedia}>{item.badge?.label}</Text>
          </Text>
          <View style={styles.metaRow}>
            <View style={[styles.kindBadge, styles.kindBadgeTrophy]}>
              <Feather name="award" size={12} color={COLORS.warning} />
              <Text style={styles.kindBadgeText}>PALIER {tierLabel.toUpperCase()}</Text>
            </View>
            <Text style={styles.dateText}>{dateLabel(item.date)}</Text>
          </View>
        </View>
        <View style={styles.trophyOrb} accessible={false}>
          <Feather name="award" size={23} color={COLORS.onAccent} />
        </View>
      </View>
      <ReactionBar item={item} onToggle={onToggle} />
    </View>
  );
});

const MediaFeedCard = React.memo(function MediaFeedCard({ item, onToggle }: FeedCardProps) {
  const router = useRouter();
  const openUserPreview = useOpenUserPreview();
  const media = item.media!;
  const poster = tmdbImage(media.posterPath, 'w185');
  return (
    <View style={styles.feedCard}>
      <View style={styles.feedCardMain}>
      <UserAvatar
        user={item.user}
        onPress={() => openUserPreview(item.user.id)}
      />
      <PressableScale
        style={styles.feedMainTap}
        scaleTo={0.985}
        onPress={() => router.push(mediaHref(media))}
        accessibilityRole="button"
        accessibilityLabel={item.user.displayName + ' ' + actionText(item) + ' ' + media.title}
        accessibilityHint="Ouvre la fiche du média"
      >
      <View style={styles.feedCopy}>
        <Text style={styles.feedText}>
          <Text style={styles.feedName}>{item.user.displayName}</Text>
          {item.user.streak ? (
            <Text style={styles.streakInline}>{' 🔥 ' + item.user.streak}</Text>
          ) : null}
          {' ' + actionText(item) + ' '}
          <Text style={styles.feedMedia}>{media.title}</Text>
        </Text>
        {item.kind === 'comment' && item.body ? (
          <Text style={styles.feedComment} numberOfLines={3}>
            « {item.body} »
          </Text>
        ) : item.episode ? (
          <Text style={styles.feedSub} numberOfLines={1}>
            {item.episode.title}
          </Text>
        ) : null}
        <View style={styles.metaRow}>
          <View style={styles.kindBadge}>
            <Feather
              name={
                media.type === 'game'
                  ? 'hexagon'
                  : media.type === 'movie'
                    ? 'film'
                    : 'tv'
              }
              size={12}
              color={COLORS.primary}
            />
            <Text style={styles.kindBadgeText}>
              {media.type === 'game'
                ? 'JEU'
                : media.type === 'movie'
                  ? 'FILM'
                  : 'SÉRIE'}
            </Text>
          </View>
          <Text style={styles.dateText}>{dateLabel(item.date)}</Text>
        </View>
      </View>
      <View style={styles.poster}>
        {poster ? (
          <Image
            source={{ uri: poster }}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
            accessible={false}
          />
        ) : (
          <Feather name="image" size={18} color={COLORS.textSoft} />
        )}
      </View>
      </PressableScale>
      </View>
      <ReactionBar item={item} onToggle={onToggle} />
    </View>
  );
});

// Pied de carte du fil : cœur (outline → plein teinté primaire quand j'ai
// réagi) + total des réactions.
function ReactionBar({
  item,
  onToggle,
}: {
  item: FeedItem;
  onToggle: (item: FeedItem) => void;
}) {
  const reactions = item.reactions ?? { total: 0, mine: [], counts: {} };
  const liked = reactions.mine.includes(HEART);
  return (
    <View style={styles.reactionRow}>
      <Pressable
        onPress={() => onToggle(item)}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel={liked ? 'Ne plus aimer' : 'Aimer'}
        accessibilityState={{ selected: liked }}
        style={({ pressed }) => [styles.reactionButton, pressed && styles.pressed]}
      >
        <Ionicons
          name={liked ? 'heart' : 'heart-outline'}
          size={18}
          color={liked ? COLORS.primary : COLORS.textMuted}
        />
        <Text style={[styles.reactionCount, liked && styles.reactionCountActive]}>
          {reactions.total}
        </Text>
      </Pressable>
    </View>
  );
}

// Exporté : réutilisé par l'écran poussé « Amis » (app/friends.tsx).
export function FriendsTab() {
  const openUserPreview = useOpenUserPreview();
  const queryClient = useQueryClient();
  const [q, setQ] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [mutationError, setMutationError] = useState<string | null>(null);

  const dq = useDebounced(q.trim(), 300);
  const search = useQuery({
    queryKey: ['users', 'search', dq],
    queryFn: () =>
      api.get<{ users: PublicUser[] }>(
        '/api/users/search?q=' + encodeURIComponent(dq),
      ),
    enabled: dq.length > 1,
    placeholderData: keepPreviousData,
  });
  // Mes abonnements (le serveur fournit ici streak + niveau) : liste affichée
  // quand aucune recherche n'est en cours, à la place de l'état vide.
  const followingQuery = useQuery({
    queryKey: ['social', 'following'],
    queryFn: () => api.get<{ users: PublicUser[] }>('/api/social/following'),
  });

  const toggle = async (user: PublicUser) => {
    if (busyId) return;
    const currently = overrides[user.id] ?? user.isFollowing ?? false;
    setBusyId(user.id);
    setMutationError(null);
    setOverrides((current) => ({ ...current, [user.id]: !currently }));
    try {
      if (currently) await api.del('/api/social/follow/' + user.id);
      else await api.post('/api/social/follow/' + user.id);
      void queryClient.invalidateQueries({ queryKey: ['social'] });
      void queryClient.invalidateQueries({ queryKey: ['profile'] });
      void queryClient.invalidateQueries({ queryKey: ['user', user.id] });
      // Les classements dépendent de la liste d'abonnements : leaderboard
      // Stats/Communauté + trophées/XP. Le défi hebdo (['social','challenge',
      // 'weekly']) est déjà couvert par l'invalidation du préfixe ['social'].
      void queryClient.invalidateQueries({ queryKey: ['stats', 'leaderboard'] });
      void queryClient.invalidateQueries({ queryKey: ['gamification'] });
    } catch {
      setOverrides((current) => ({ ...current, [user.id]: currently }));
      setMutationError(
        "L'abonnement n'a pas pu être modifié. Vérifie ta connexion et réessaie.",
      );
    } finally {
      setBusyId(null);
    }
  };

  const users = search.data?.users ?? [];
  const followedUsers = followingQuery.data?.users ?? [];

  // Rangée utilisateur partagée entre la recherche et « Mes abonnements ».
  // Streak/niveau ne sont affichés QUE si le serveur les fournit (listes
  // following/followers) — jamais inventés sur les résultats de recherche.
  const renderUserRow = (user: PublicUser, index: number) => {
    const following = overrides[user.id] ?? user.isFollowing ?? false;
    const rowBusy = busyId === user.id;
    const statsLabel =
      typeof user.streak === 'number'
        ? [
            user.streak > 0 ? '🔥 ' + user.streak : null,
            user.level ? 'Nv. ' + user.level : null,
          ]
            .filter(Boolean)
            .join(' · ')
        : '';
    return (
      <AppearItem index={index}>
        <View style={styles.userCard}>
          <Pressable
            style={styles.userTap}
            onPress={() => openUserPreview(user.id)}
            accessibilityRole="button"
            accessibilityLabel={'Aperçu du profil de ' + user.displayName}
          >
            <UserAvatar user={user} />
            <View style={styles.userCopy}>
              <Text style={styles.userName} numberOfLines={1}>
                {user.displayName}
              </Text>
              <Text style={styles.userHint}>
                {statsLabel ||
                  (following ? 'Déjà dans ta communauté' : 'Découvrir le profil')}
              </Text>
            </View>
          </Pressable>
          <Pressable
            style={({ pressed }) => [
              styles.followButton,
              following && styles.followingButton,
              busyId !== null && styles.disabled,
              pressed && busyId === null && styles.pressed,
            ]}
            onPress={() => void toggle(user)}
            disabled={busyId !== null}
            accessibilityRole="button"
            accessibilityLabel={
              following
                ? 'Ne plus suivre ' + user.displayName
                : 'Suivre ' + user.displayName
            }
            accessibilityState={{
              busy: rowBusy,
              disabled: busyId !== null,
              selected: following,
            }}
          >
            {rowBusy ? (
              <ActivityIndicator
                size="small"
                color={following ? COLORS.text : COLORS.onPrimary}
              />
            ) : (
              <>
                <Feather
                  name={following ? 'check' : 'plus'}
                  size={15}
                  color={following ? COLORS.text : COLORS.onPrimary}
                />
                <Text
                  style={[
                    styles.followButtonText,
                    following && styles.followingButtonText,
                  ]}
                >
                  {following ? 'SUIVI' : 'SUIVRE'}
                </Text>
              </>
            )}
          </Pressable>
        </View>
      </AppearItem>
    );
  };

  return (
    <View style={styles.friends}>
      <View style={styles.searchCard}>
        <Feather name="search" size={20} color={COLORS.primary} />
        <TextInput
          style={styles.input}
          placeholder="Rechercher un utilisateur"
          placeholderTextColor={COLORS.textSoft}
          value={q}
          onChangeText={(value) => {
            setQ(value);
            setMutationError(null);
          }}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel="Rechercher un utilisateur"
        />
        {search.isFetching ? (
          <ActivityIndicator size="small" color={COLORS.primary} />
        ) : q ? (
          <Pressable
            onPress={() => setQ('')}
            style={styles.clearButton}
            accessibilityRole="button"
            accessibilityLabel="Effacer la recherche"
          >
            <Feather name="x" size={18} color={COLORS.textMuted} />
          </Pressable>
        ) : null}
      </View>

      {mutationError ? (
        <Text
          style={styles.inlineError}
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
        >
          {mutationError}
        </Text>
      ) : null}

      {q.trim().length <= 1 ? (
        followedUsers.length > 0 ? (
          <FlatList
            data={followedUsers}
            style={styles.list}
            contentContainerStyle={styles.userListContent}
            keyExtractor={(user) => user.id}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item: user, index }) => renderUserRow(user, index)}
            ListHeaderComponent={
              <Text style={styles.listLabel} accessibilityRole="header">
                MES ABONNEMENTS
              </Text>
            }
            refreshControl={
              <RefreshControl
                refreshing={followingQuery.isRefetching}
                onRefresh={() => void followingQuery.refetch()}
                tintColor={COLORS.primary}
                colors={[COLORS.primary]}
              />
            }
            initialNumToRender={10}
            maxToRenderPerBatch={10}
            windowSize={7}
            showsVerticalScrollIndicator={false}
          />
        ) : (
          <View style={styles.flexState}>
            <EmptyState
              title="Trouve ta communauté"
              message="Saisis au moins deux caractères pour rechercher un profil."
            />
          </View>
        )
      ) : search.isLoading ? (
        <Loading />
      ) : search.isError && !search.data ? (
        <LoadError
          onRetry={() => void search.refetch()}
          busy={search.isRefetching}
        />
      ) : (
        <FlatList
          data={users}
          style={styles.list}
          contentContainerStyle={[
            styles.userListContent,
            users.length === 0 && styles.listContentEmpty,
          ]}
          keyExtractor={(user) => user.id}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item: user, index }) => renderUserRow(user, index)}
          ListEmptyComponent={
            <EmptyState
              title="Aucun utilisateur"
              message={'Aucun profil trouvé pour « ' + q.trim() + ' ».'}
            />
          }
          refreshControl={
            <RefreshControl
              refreshing={search.isRefetching}
              onRefresh={() => void search.refetch()}
              tintColor={COLORS.primary}
              colors={[COLORS.primary]}
            />
          }
          initialNumToRender={10}
          maxToRenderPerBatch={10}
          windowSize={7}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: COLORS.bg,
  },
  canvas: {
    flex: 1,
    width: '100%',
    maxWidth: SIZES.contentMax,
    backgroundColor: COLORS.pageMuted,
  },
  hero: {
    paddingHorizontal: SPACE.md,
    paddingBottom: SPACE.md,
    backgroundColor: COLORS.surface,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderLight,
  },
  heroTop: {
    minHeight: SIZES.header,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.sm,
  },
  iconButton: {
    width: SIZES.touch,
    height: SIZES.touch,
    borderRadius: RADIUS.control,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.surfaceMuted,
  },
  heroCopy: { flex: 1 },
  eyebrow: {
    color: COLORS.primary,
    fontSize: 10,
    lineHeight: 14,
    fontFamily: FONTS.extraBold,
    letterSpacing: 1.3,
  },
  heroTitle: {
    color: COLORS.text,
    fontSize: 27,
    lineHeight: 31,
    fontFamily: FONTS.extraBold,
  },
  heroMark: {
    width: SIZES.touch,
    height: SIZES.touch,
    borderRadius: RADIUS.control,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary,
  },
  heroSubtitle: {
    maxWidth: 520,
    color: COLORS.textMuted,
    fontSize: 14,
    lineHeight: 20,
    fontFamily: FONTS.regular,
    marginTop: SPACE.xxs,
  },
  tabs: {
    flexDirection: 'row',
    gap: SPACE.xs,
    padding: SPACE.xxs,
    marginTop: SPACE.md,
    borderRadius: RADIUS.control,
    backgroundColor: COLORS.surfaceMuted,
  },
  tab: {
    flex: 1,
    minHeight: SIZES.touch,
    borderRadius: RADIUS.small,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACE.xs,
  },
  tabActive: {
    backgroundColor: COLORS.surface,
    ...SHADOW.card,
  },
  tabText: {
    color: COLORS.textMuted,
    fontSize: 11,
    fontFamily: FONTS.extraBold,
    letterSpacing: 0.6,
    textAlign: 'center',
  },
  tabTextActive: { color: COLORS.primary },
  list: { flex: 1 },
  listContent: {
    padding: SPACE.md,
    gap: SPACE.sm,
    paddingBottom: SPACE.xxl,
  },
  listContentEmpty: { flexGrow: 1, justifyContent: 'center' },
  feedCard: {
    padding: SPACE.md,
    borderRadius: RADIUS.card,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    backgroundColor: COLORS.surface,
    ...SHADOW.card,
  },
  feedCardMain: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.sm,
  },
  streakInline: {
    color: COLORS.textMuted,
    fontSize: 12,
    fontFamily: FONTS.bold,
  },
  reactionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: SPACE.sm,
    paddingTop: SPACE.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.borderLight,
  },
  reactionButton: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.xxs,
    paddingHorizontal: SPACE.xs,
    borderRadius: RADIUS.pill,
  },
  reactionCount: {
    color: COLORS.textMuted,
    fontSize: 12.5,
    fontFamily: FONTS.bold,
  },
  reactionCountActive: { color: COLORS.primary },
  listLabel: {
    color: COLORS.textMuted,
    fontSize: 11,
    fontFamily: FONTS.extraBold,
    letterSpacing: 0.8,
    marginBottom: SPACE.xxs,
  },
  feedMainTap: { minWidth: 0, flex: 1, flexDirection: 'row', alignItems: 'center', gap: SPACE.sm },
  avatar: {
    overflow: 'visible',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primarySoft,
    borderWidth: 2,
    borderColor: COLORS.surface,
  },
  avatarInit: {
    color: COLORS.primary,
    fontSize: 17,
    fontFamily: FONTS.extraBold,
  },
  avatarLevel: {
    position: 'absolute',
    right: -4,
    bottom: -3,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.yellow,
    borderWidth: 2,
    borderColor: COLORS.surface,
  },
  avatarLevelText: {
    color: COLORS.onAccent,
    fontSize: 9,
    fontFamily: FONTS.extraBold,
  },
  feedCopy: { flex: 1, minWidth: 0 },
  feedText: {
    color: COLORS.text,
    fontSize: 14.5,
    lineHeight: 20,
    fontFamily: FONTS.regular,
  },
  feedName: { fontFamily: FONTS.extraBold },
  feedMedia: { color: COLORS.primary, fontFamily: FONTS.bold },
  feedComment: {
    color: COLORS.textMuted,
    fontSize: 13.5,
    lineHeight: 19,
    fontFamily: FONTS.regular,
    fontStyle: 'italic',
    marginTop: SPACE.xxs,
  },
  feedSub: {
    color: COLORS.textMuted,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: FONTS.regular,
    marginTop: SPACE.xxs,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.xs,
    marginTop: SPACE.xs,
  },
  kindBadge: {
    minHeight: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.xxs,
    paddingHorizontal: SPACE.xs,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.primarySoft,
  },
  kindBadgeTrophy: { backgroundColor: COLORS.yellowSoft },
  kindBadgeText: {
    color: COLORS.textMuted,
    fontSize: 9,
    fontFamily: FONTS.extraBold,
    letterSpacing: 0.5,
  },
  dateText: {
    color: COLORS.textSoft,
    fontSize: 11,
    fontFamily: FONTS.medium,
  },
  poster: {
    width: 44,
    aspectRatio: 2 / 3,
    overflow: 'hidden',
    borderRadius: RADIUS.small,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.imagePlaceholder,
  },
  trophyOrb: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.yellow,
  },
  friends: { flex: 1 },
  searchCard: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.sm,
    margin: SPACE.md,
    marginBottom: SPACE.xs,
    paddingHorizontal: SPACE.md,
    borderRadius: RADIUS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
    ...SHADOW.card,
  },
  input: {
    flex: 1,
    minWidth: 0,
    minHeight: SIZES.touch,
    color: COLORS.text,
    fontSize: 16,
    fontFamily: FONTS.regular,
    paddingVertical: SPACE.xs,
  },
  clearButton: {
    width: SIZES.touch,
    height: SIZES.touch,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inlineError: {
    color: COLORS.danger,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: FONTS.bold,
    paddingHorizontal: SPACE.lg,
    paddingBottom: SPACE.xs,
  },
  flexState: { flex: 1, justifyContent: 'center' },
  userListContent: {
    padding: SPACE.md,
    gap: SPACE.sm,
    paddingBottom: SPACE.xxl,
  },
  userCard: {
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.sm,
    padding: SPACE.sm,
    borderRadius: RADIUS.card,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    backgroundColor: COLORS.surface,
  },
  userTap: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.sm,
  },
  userCopy: { flex: 1, minWidth: 0 },
  userName: {
    color: COLORS.text,
    fontSize: 15,
    fontFamily: FONTS.extraBold,
  },
  userHint: {
    color: COLORS.textMuted,
    fontSize: 12.5,
    lineHeight: 17,
    fontFamily: FONTS.regular,
    marginTop: 2,
  },
  followButton: {
    minWidth: 104,
    minHeight: SIZES.touch,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACE.xxs,
    paddingHorizontal: SPACE.sm,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.primary,
  },
  followingButton: {
    backgroundColor: COLORS.surfaceMuted,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  followButtonText: {
    color: COLORS.onPrimary,
    fontSize: 11,
    fontFamily: FONTS.extraBold,
    letterSpacing: 0.5,
  },
  followingButtonText: { color: COLORS.text },
  pressed: { opacity: 0.72 },
  disabled: { opacity: 0.5 },
});
