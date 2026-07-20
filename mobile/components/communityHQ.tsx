import React from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter, type Href } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, tmdbImage } from '@/lib/api';
import { COLORS, FONTS, RADIUS, SHADOW, SIZES, SPACE } from '@/lib/theme';
import { PrismeCard, SectionHeader } from '@/components/prisme';
import { EmptyState, Loading, LoadError, Poster } from '@/components/ui';
import { MedalBadge, TIER_LABELS, type MedalTier } from '@/components/medals';
import { AppearItem } from '@/components/anim';
import { usePullRefresh } from '@/lib/usePullRefresh';
import { useOpenUserPreview } from '@/lib/userPreview';
import { FriendsLovedCarousel } from '@/components/community';
import { UserAvatar } from '@/app/social';

// QG « Amis » et segment « Discussions » de l'onglet Communauté (refonte
// 2026-07-20) : qui regarde quoi en ce moment, visionnages récents agrégés
// (+ kudos 👏), derniers badges des amis (+ kudos) et fils de commentaires
// actifs chez les amis.

type MediaRef = { id: string; title: string; posterPath: string | null; type: 'show' | 'movie' | 'game' };
type HQUser = {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  level?: number;
  streak?: number;
};
type Reactions = { total: number; mine: string[] };
type NowEntry = {
  user: HQUser;
  media: MediaRef;
  episode: { seasonNumber: number; episodeNumber: number } | null;
  lastAt: string;
};
type RecentEntry = {
  user: HQUser;
  media: MediaRef;
  day: string; // YYYY-MM-DD
  count: number;
  refId: string;
  reactions: Reactions;
};
type BadgeEntry = {
  user: HQUser;
  badge: { id: string; label: string; tier: number };
  unlockedAt: string;
  refId: string;
  reactions: Reactions;
};
type Overview = { now: NowEntry[]; recent: RecentEntry[]; badges: BadgeEntry[] };
type DiscussionThread = {
  media: MediaRef;
  commentCount: number;
  participants: { id: string; displayName: string; avatarUrl: string | null }[];
  lastAt: string;
};

const OVERVIEW_KEY = ['social', 'overview'] as const;
const DISCUSSIONS_KEY = ['social', 'discussions'] as const;
const CLAP = '👏';

function mediaHref(media: MediaRef): Href {
  if (media.type === 'game') return ('/game/' + media.id) as Href;
  return ('/show/' + media.id + (media.type === 'movie' ? '?type=movie' : '')) as Href;
}

function firstName(displayName: string): string {
  return displayName.trim().split(/\s+/)[0] || displayName;
}

// « il y a 2 h » / « il y a 12 min » / « il y a 3 j » — relatif simple.
function relTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const minutes = Math.max(0, Math.floor((Date.now() - t) / 60_000));
  if (minutes < 1) return 'à l’instant';
  if (minutes < 60) return 'il y a ' + minutes + ' min';
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return 'il y a ' + hours + ' h';
  return 'il y a ' + Math.floor(hours / 24) + ' j';
}

const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

// « aujourd'hui » / « hier » / « 12 juil. » à partir d'un jour local YYYY-MM-DD.
function dayLabel(day: string): string {
  const localDay = (d: Date) =>
    d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const today = new Date();
  if (day === localDay(today)) return 'aujourd’hui';
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (day === localDay(yesterday)) return 'hier';
  const d = new Date(day + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return day;
  return d.getDate() + ' ' + MONTHS[d.getMonth()];
}

// « S02E04 » (zéros non significatifs, format compact du QG).
function episodeCode(episode: NonNullable<NowEntry['episode']>): string {
  return (
    'S' + String(episode.seasonNumber).padStart(2, '0') + 'E' + String(episode.episodeNumber).padStart(2, '0')
  );
}

// « Léa a vu 3 épisodes de Dark » / « … a vu Dune » / « … a joué à Hades ».
function recentLabel(entry: RecentEntry): string {
  const name = entry.user.displayName;
  if (entry.media.type === 'show') {
    return (
      name + ' a vu ' + entry.count + ' épisode' + (entry.count > 1 ? 's' : '') + ' de ' + entry.media.title
    );
  }
  if (entry.media.type === 'game') return name + ' a joué à ' + entry.media.title;
  return name + ' a vu ' + entry.media.title;
}

// Bascule locale du 👏 (miroir du toggle serveur) pour la mise à jour optimiste.
function toggleClap(reactions: Reactions): Reactions {
  const mine = reactions.mine.includes(CLAP);
  return {
    total: Math.max(0, reactions.total + (mine ? -1 : 1)),
    mine: mine ? reactions.mine.filter((e) => e !== CLAP) : [...reactions.mine, CLAP],
  };
}

function medalTier(tier: number): MedalTier {
  return (tier >= 1 && tier <= 4 ? tier : 1) as MedalTier;
}

// --- Kudos 👏 ---------------------------------------------------------------

function KudosButton({
  active,
  count,
  ownerName,
  onPress,
}: {
  active: boolean;
  count: number;
  ownerName: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={active ? 'Retirer tes applaudissements' : 'Applaudir ' + ownerName}
      accessibilityState={{ selected: active }}
      style={({ pressed }) => [styles.kudos, active && styles.kudosActive, pressed && styles.pressed]}
    >
      <Text style={styles.kudosEmoji} accessible={false}>
        {CLAP}
      </Text>
      <Text style={[styles.kudosCount, active && styles.kudosCountActive]}>{count}</Text>
    </Pressable>
  );
}

// --- Segment « Amis » (QG, défaut) -----------------------------------------

export function FriendsHQTab() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const overview = useQuery({
    queryKey: OVERVIEW_KEY,
    queryFn: () => api.get<Overview>('/api/social/overview'),
  });
  // Même clé/endpoint que FriendsLovedCarousel (cache partagé) : sert ici à
  // savoir si TOUT le QG est vide (état vide global).
  const recos = useQuery({
    queryKey: ['social', 'recommendations'],
    queryFn: () => api.get<{ items: unknown[] }>('/api/social/recommendations'),
    staleTime: 5 * 60_000,
  });

  // Toggle 👏 : mise à jour OPTIMISTE du cache overview (l'entrée visée
  // seulement), rollback sur l'état précédent si le serveur refuse.
  const kudos = useMutation({
    mutationFn: (target: { kind: 'watch' | 'badge'; refId: string }) =>
      api.post<{ reacted: boolean; count: number }>('/api/social/feed/react', {
        kind: target.kind,
        refId: target.refId,
        emoji: CLAP,
      }),
    onMutate: async (target) => {
      await queryClient.cancelQueries({ queryKey: OVERVIEW_KEY });
      const previous = queryClient.getQueryData<Overview>(OVERVIEW_KEY);
      queryClient.setQueryData<Overview>(OVERVIEW_KEY, (old) =>
        old
          ? {
              ...old,
              recent:
                target.kind === 'watch'
                  ? old.recent.map((e) =>
                      e.refId === target.refId ? { ...e, reactions: toggleClap(e.reactions) } : e,
                    )
                  : old.recent,
              badges:
                target.kind === 'badge'
                  ? old.badges.map((e) =>
                      e.refId === target.refId ? { ...e, reactions: toggleClap(e.reactions) } : e,
                    )
                  : old.badges,
            }
          : old,
      );
      return { previous };
    },
    onError: (_error, _target, context) => {
      if (context?.previous) queryClient.setQueryData(OVERVIEW_KEY, context.previous);
    },
  });

  const { refreshing, onRefresh } = usePullRefresh([
    () => overview.refetch(),
    () => queryClient.refetchQueries({ queryKey: ['social', 'recommendations'] }),
  ]);

  const openFriends = () => router.push('/friends' as Href);

  if (overview.isLoading) return <Loading />;
  if (overview.isError && !overview.data) {
    return <LoadError onRetry={() => void overview.refetch()} busy={overview.isRefetching} />;
  }

  const now = overview.data?.now ?? [];
  const recent = overview.data?.recent ?? [];
  const badges = overview.data?.badges ?? [];
  const allEmpty =
    now.length === 0 && recent.length === 0 && badges.length === 0 && (recos.data?.items ?? []).length === 0;

  return (
    <ScrollView
      style={styles.fill}
      contentContainerStyle={styles.hqContent}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={COLORS.primary}
          colors={[COLORS.primary]}
        />
      }
    >
      {allEmpty ? (
        <>
          <EmptyState
            title="Suis des amis pour remplir ton QG"
            message="Leurs visionnages, badges et recommandations apparaîtront ici."
          />
          <Pressable
            onPress={openFriends}
            style={({ pressed }) => [styles.findFriendsButton, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Trouver des amis"
          >
            <Feather name="search" size={16} color={COLORS.onPrimary} />
            <Text style={styles.findFriendsText}>TROUVER DES AMIS</Text>
          </Pressable>
        </>
      ) : (
        <>
          {now.length > 0 ? (
            <View>
              <SectionHeader title="En ce moment" style={styles.firstSection} />
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.nowRow}
              >
                {now.map((entry) => (
                  <NowItem key={entry.user.id + '-' + entry.media.id} entry={entry} />
                ))}
              </ScrollView>
            </View>
          ) : null}

          {recent.length > 0 ? (
            <View>
              <SectionHeader title="Récemment vus" />
              {recent.map((entry, index) => (
                <AppearItem key={entry.refId} index={index}>
                  <RecentCard
                    entry={entry}
                    onKudos={() => kudos.mutate({ kind: 'watch', refId: entry.refId })}
                  />
                </AppearItem>
              ))}
            </View>
          ) : null}

          {badges.length > 0 ? (
            <View>
              <SectionHeader title="Derniers badges" />
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.badgeRow}
              >
                {badges.map((entry) => (
                  <BadgeCard
                    key={entry.refId}
                    entry={entry}
                    onKudos={() => kudos.mutate({ kind: 'badge', refId: entry.refId })}
                  />
                ))}
              </ScrollView>
            </View>
          ) : null}

          <FriendsLovedCarousel />
        </>
      )}
    </ScrollView>
  );
}

// Un ami « en ce moment » : avatar, prénom, mini-affiche et dernière activité.
// Le tap sur la carte ouvre la fiche du média ; le tap sur l'AVATAR ouvre
// l'aperçu du profil (popup, lib/userPreview.ts).
function NowItem({ entry }: { entry: NowEntry }) {
  const router = useRouter();
  const openUserPreview = useOpenUserPreview();
  const caption = (entry.episode ? episodeCode(entry.episode) + ' · ' : '') + relTime(entry.lastAt);
  return (
    <Pressable
      onPress={() => router.push(mediaHref(entry.media))}
      style={({ pressed }) => [styles.nowItem, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={
        entry.user.displayName +
        (entry.media.type === 'game' ? ' joue à ' : ' regarde ') +
        entry.media.title +
        (caption ? ', ' + caption : '')
      }
      accessibilityHint="Ouvre la fiche du média"
    >
      <UserAvatar user={entry.user} size={48} onPress={() => openUserPreview(entry.user.id)} />
      <Text style={styles.nowName} numberOfLines={1}>
        {firstName(entry.user.displayName)}
      </Text>
      <View pointerEvents="none" accessible={false} style={styles.nowPoster}>
        <Poster title={entry.media.title} uri={tmdbImage(entry.media.posterPath, 'w185')} width={56} />
      </View>
      <Text style={styles.nowCaption} numberOfLines={2}>
        {caption}
      </Text>
    </Pressable>
  );
}

// Carte « Récemment vus » : visionnages agrégés par jour + bouton kudos.
function RecentCard({ entry, onKudos }: { entry: RecentEntry; onKudos: () => void }) {
  const router = useRouter();
  const sub =
    dayLabel(entry.day) + (entry.user.streak && entry.user.streak > 0 ? ' · 🔥 ' + entry.user.streak : '');
  return (
    <PrismeCard
      onPress={() => router.push(mediaHref(entry.media))}
      accessibilityLabel={recentLabel(entry) + ', ' + sub}
      accessibilityHint="Ouvre la fiche du média"
      style={styles.recentCard}
    >
      <View pointerEvents="none" accessible={false}>
        <Poster title={entry.media.title} uri={tmdbImage(entry.media.posterPath, 'w185')} width={46} />
      </View>
      <View style={styles.recentCopy}>
        <Text style={styles.recentText}>
          <Text style={styles.recentName}>{entry.user.displayName}</Text>
          {entry.media.type === 'show'
            ? ' a vu ' + entry.count + ' épisode' + (entry.count > 1 ? 's' : '') + ' de '
            : entry.media.type === 'game'
              ? ' a joué à '
              : ' a vu '}
          <Text style={styles.recentMedia}>{entry.media.title}</Text>
        </Text>
        <Text style={styles.recentSub}>{sub}</Text>
      </View>
      <KudosButton
        active={entry.reactions.mine.includes(CLAP)}
        count={entry.reactions.total}
        ownerName={entry.user.displayName}
        onPress={onKudos}
      />
    </PrismeCard>
  );
}

// Petite carte badge : avatar de l'ami (tap → aperçu du profil), médaille du
// palier, label + kudos.
function BadgeCard({ entry, onKudos }: { entry: BadgeEntry; onKudos: () => void }) {
  const openUserPreview = useOpenUserPreview();
  const tier = medalTier(entry.badge.tier);
  return (
    <PrismeCard style={styles.badgeCard}>
      <View style={styles.badgeHead}>
        <UserAvatar user={entry.user} size={34} onPress={() => openUserPreview(entry.user.id)} />
        <Text style={styles.badgeUser} numberOfLines={1}>
          {firstName(entry.user.displayName)}
        </Text>
      </View>
      <MedalBadge tier={tier} icon="award" progress={0} size={56} style={styles.badgeMedal} />
      <Text style={styles.badgeLabel} numberOfLines={2}>
        {entry.badge.label}
      </Text>
      <Text style={styles.badgeTier}>{TIER_LABELS[tier].toUpperCase()}</Text>
      <KudosButton
        active={entry.reactions.mine.includes(CLAP)}
        count={entry.reactions.total}
        ownerName={entry.user.displayName}
        onPress={onKudos}
      />
    </PrismeCard>
  );
}

// --- Segment « Discussions » -----------------------------------------------

export function DiscussionsTab() {
  const router = useRouter();
  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: DISCUSSIONS_KEY,
    queryFn: () => api.get<{ threads: DiscussionThread[] }>('/api/social/discussions'),
  });

  if (isLoading) return <Loading />;
  if (isError && !data) return <LoadError onRetry={() => void refetch()} busy={isRefetching} />;

  const threads = data?.threads ?? [];
  return (
    <FlatList
      data={threads}
      style={styles.fill}
      contentContainerStyle={[styles.discussionsContent, threads.length === 0 && styles.contentEmpty]}
      keyExtractor={(thread) => thread.media.type + '-' + thread.media.id}
      renderItem={({ item: thread, index }) => (
        <AppearItem index={index}>
          <DiscussionCard
            thread={thread}
            onOpen={() =>
              router.push(
                ('/comments/' +
                  thread.media.id +
                  '?title=' +
                  encodeURIComponent(thread.media.title) +
                  '&type=' +
                  thread.media.type) as Href,
              )
            }
          />
        </AppearItem>
      )}
      ListEmptyComponent={
        <EmptyState
          title="Aucune discussion chez tes amis"
          message="Lance-en une depuis une fiche !"
        />
      }
      refreshControl={
        <RefreshControl
          refreshing={isRefetching}
          onRefresh={() => void refetch()}
          tintColor={COLORS.primary}
          colors={[COLORS.primary]}
        />
      }
      showsVerticalScrollIndicator={false}
    />
  );
}

function DiscussionCard({ thread, onOpen }: { thread: DiscussionThread; onOpen: () => void }) {
  const shown = thread.participants.slice(0, 3);
  return (
    <PrismeCard
      onPress={onOpen}
      accessibilityLabel={
        'Discussion sur ' +
        thread.media.title +
        ', ' +
        thread.commentCount +
        ' commentaire' +
        (thread.commentCount > 1 ? 's' : '') +
        ' récents, ' +
        relTime(thread.lastAt)
      }
      accessibilityHint="Ouvre le fil de commentaires du média"
      style={styles.discussionCard}
    >
      <View pointerEvents="none" accessible={false}>
        <Poster title={thread.media.title} uri={tmdbImage(thread.media.posterPath, 'w185')} width={46} />
      </View>
      <View style={styles.discussionCopy}>
        <Text style={styles.discussionTitle} numberOfLines={1}>
          {thread.media.title}
        </Text>
        <Text style={styles.discussionMeta}>
          {thread.commentCount} commentaire{thread.commentCount > 1 ? 's' : ''} récents
        </Text>
        <Text style={styles.discussionSub}>{relTime(thread.lastAt)}</Text>
      </View>
      {/* Avatars empilés des participants (décoratif : listés dans le label). */}
      <View style={styles.stack} pointerEvents="none" accessible={false}>
        {shown.map((participant, index) => (
          <View key={participant.id} style={[styles.stackItem, index > 0 && styles.stackOverlap]}>
            <UserAvatar user={participant} size={30} />
          </View>
        ))}
      </View>
    </PrismeCard>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  pressed: { opacity: 0.72 },
  // QG « Amis »
  hqContent: {
    padding: SPACE.md,
    paddingBottom: 120,
    width: '100%',
    maxWidth: SIZES.contentMax,
    alignSelf: 'center',
  },
  firstSection: { marginTop: 0 },
  findFriendsButton: {
    minHeight: SIZES.touch,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACE.xxs,
    alignSelf: 'center',
    marginTop: SPACE.xs,
    paddingHorizontal: SPACE.lg,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.primary,
    ...SHADOW.card,
  },
  findFriendsText: {
    color: COLORS.onPrimary,
    fontSize: 13,
    fontFamily: FONTS.extraBold,
    letterSpacing: 0.6,
  },
  // « En ce moment »
  nowRow: { gap: SPACE.sm, paddingRight: SPACE.md },
  nowItem: { width: 76, alignItems: 'center' },
  nowName: {
    maxWidth: 76,
    color: COLORS.text,
    fontSize: 12,
    fontFamily: FONTS.bold,
    marginTop: SPACE.xxs,
  },
  nowPoster: { marginTop: SPACE.xxs },
  nowCaption: {
    color: COLORS.textMuted,
    fontSize: 10.5,
    lineHeight: 14,
    fontFamily: FONTS.medium,
    textAlign: 'center',
    marginTop: 2,
  },
  // « Récemment vus »
  recentCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.sm,
    padding: SPACE.sm,
    marginBottom: SPACE.sm,
    ...SHADOW.card,
  },
  recentCopy: { flex: 1, minWidth: 0 },
  recentText: {
    color: COLORS.text,
    fontSize: 14,
    lineHeight: 19,
    fontFamily: FONTS.regular,
  },
  recentName: { fontFamily: FONTS.extraBold },
  recentMedia: { color: COLORS.primary, fontFamily: FONTS.bold },
  recentSub: {
    color: COLORS.textMuted,
    fontSize: 12,
    fontFamily: FONTS.medium,
    marginTop: 2,
  },
  // Kudos 👏
  kudos: {
    minWidth: SIZES.touch,
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACE.xxs,
    paddingHorizontal: SPACE.xs,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    backgroundColor: COLORS.surfaceMuted,
  },
  kudosActive: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primarySoft,
  },
  kudosEmoji: { fontSize: 14, fontFamily: FONTS.regular },
  kudosCount: { color: COLORS.textMuted, fontSize: 12.5, fontFamily: FONTS.bold },
  kudosCountActive: { color: COLORS.primary },
  // « Derniers badges »
  badgeRow: { gap: SPACE.sm, paddingRight: SPACE.md },
  badgeCard: {
    width: 150,
    alignItems: 'center',
    padding: SPACE.sm,
    ...SHADOW.card,
  },
  badgeHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.xxs,
    alignSelf: 'stretch',
  },
  badgeUser: {
    flex: 1,
    minWidth: 0,
    color: COLORS.text,
    fontSize: 12.5,
    fontFamily: FONTS.bold,
  },
  badgeMedal: { marginTop: SPACE.xs },
  badgeLabel: {
    color: COLORS.text,
    fontSize: 12.5,
    lineHeight: 16,
    fontFamily: FONTS.bold,
    textAlign: 'center',
    marginTop: SPACE.xs,
  },
  badgeTier: {
    color: COLORS.textMuted,
    fontSize: 10,
    fontFamily: FONTS.extraBold,
    letterSpacing: 0.6,
    marginTop: 2,
    marginBottom: SPACE.xs,
  },
  // Discussions
  discussionsContent: {
    padding: SPACE.md,
    paddingBottom: 120,
    width: '100%',
    maxWidth: SIZES.contentMax,
    alignSelf: 'center',
  },
  contentEmpty: { flexGrow: 1, justifyContent: 'center' },
  discussionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.sm,
    padding: SPACE.sm,
    marginBottom: SPACE.sm,
    ...SHADOW.card,
  },
  discussionCopy: { flex: 1, minWidth: 0 },
  discussionTitle: { color: COLORS.text, fontSize: 15, fontFamily: FONTS.extraBold },
  discussionMeta: {
    color: COLORS.textMuted,
    fontSize: 12.5,
    fontFamily: FONTS.regular,
    marginTop: 2,
  },
  discussionSub: {
    color: COLORS.textSoft,
    fontSize: 11,
    fontFamily: FONTS.medium,
    marginTop: 2,
  },
  stack: { flexDirection: 'row', alignItems: 'center' },
  stackItem: {},
  stackOverlap: { marginLeft: -10 },
});
