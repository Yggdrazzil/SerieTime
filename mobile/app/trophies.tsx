import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Modal, Image } from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { api, tmdbImage } from '@/lib/api';
import { useAppStore } from '@/lib/store';
import { COLORS, FONTS } from '@/lib/theme';
import { PageHeader } from '@/components/PageHeader';
import { LoadError, EmptyState } from '@/components/ui';
import { Skeleton, AnimatedFill, AppearItem } from '@/components/anim';
import type { BadgeDto, GamificationMeDto, LeaderboardRowDto } from '@/lib/types';

// Paliers bronze → argent → or → platine (spec 2026-07-16 §3/§10).
const TIER_COLORS: Record<number, string> = { 0: '#E3E3E3', 1: '#CD7F32', 2: '#9AA2AA', 3: '#D4A017', 4: '#7FDBFF' };
const TIER_LABELS: Record<number, string> = { 0: 'Non débloqué', 1: 'Bronze', 2: 'Argent', 3: 'Or', 4: 'Platine' };

// Le catalogue serveur mélange des noms Feather et Ionicons (« game-controller »,
// « flame ») — fallback sur « award » quand le nom n'existe pas dans Feather.
function safeFeatherIcon(icon: string): keyof typeof Feather.glyphMap {
  return icon in Feather.glyphMap ? (icon as keyof typeof Feather.glyphMap) : 'award';
}

export default function TrophiesScreen() {
  const myId = useAppStore((s) => s.user?.id);
  const me = useQuery({
    queryKey: ['gamification', 'me'],
    queryFn: () => api.get<GamificationMeDto>('/api/gamification/me'),
    staleTime: 30_000,
  });
  const leaderboard = useQuery({
    queryKey: ['gamification', 'leaderboard'],
    queryFn: () => api.get<{ leaderboard: LeaderboardRowDto[] }>('/api/gamification/leaderboard'),
    staleTime: 60_000,
  });
  const [openBadge, setOpenBadge] = useState<BadgeDto | null>(null);

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.pageMuted }}>
      <PageHeader title="Trophées" />
      {me.isLoading ? (
        <TrophiesSkeleton />
      ) : me.isError || !me.data ? (
        <LoadError onRetry={me.refetch} busy={me.isRefetching} />
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          <LevelCard data={me.data} />
          <StreakCard data={me.data} />
          <ChallengesCard data={me.data} />
          <BadgesCard data={me.data} onOpenBadge={setOpenBadge} />
          <LeaderboardCard
            rows={leaderboard.data?.leaderboard}
            isLoading={leaderboard.isLoading}
            isError={leaderboard.isError}
            myId={myId}
          />
        </ScrollView>
      )}
      <BadgeModal badge={openBadge} onClose={() => setOpenBadge(null)} />
    </View>
  );
}

// --- Bloc niveau -----------------------------------------------------------

function LevelCard({ data }: { data: GamificationMeDto }) {
  // Palier XP de départ du niveau courant : cohérent avec `level = floor(sqrt(xp/50))`
  // et `nextLevelXp = 50*(level+1)^2` (packages/core/src/gamification/xp.ts).
  const pct = data.nextLevelXp > 0 ? Math.min(100, (data.xp / data.nextLevelXp) * 100) : 0;
  return (
    <View style={styles.card}>
      <View style={styles.levelWrap}>
        <View style={styles.levelCircle}>
          <Text style={styles.levelNumber}>{data.level}</Text>
        </View>
        <Text style={styles.levelTitle}>{data.levelTitle}</Text>
      </View>
      <View style={styles.xpTrack}>
        <AnimatedFill pct={pct} color={COLORS.yellow} style={styles.xpFill} />
      </View>
      <Text style={styles.xpLabel}>
        {data.xp.toLocaleString('fr-FR')} / {data.nextLevelXp.toLocaleString('fr-FR')} XP
      </Text>
    </View>
  );
}

// --- Bloc streak -------------------------------------------------------------

function StreakCard({ data }: { data: GamificationMeDto }) {
  const active = data.currentStreak > 0;
  return (
    <View style={[styles.card, styles.streakCard]}>
      <Ionicons name="flame" size={34} color={active ? '#FF7A1A' : COLORS.textSoft} />
      <View style={{ flex: 1 }}>
        <Text style={styles.streakMain}>
          {data.currentStreak > 0
            ? `${data.currentStreak} jour${data.currentStreak > 1 ? 's' : ''} d'affilée`
            : "Pas de série en cours"}
        </Text>
        <Text style={styles.streakSub}>
          Record : {data.bestStreak} jour{data.bestStreak > 1 ? 's' : ''}
        </Text>
      </View>
    </View>
  );
}

// --- Défis du mois -----------------------------------------------------------

function ChallengesCard({ data }: { data: GamificationMeDto }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Défis du mois</Text>
      <View style={{ gap: 14, marginTop: 10 }}>
        {data.challenges.map((c) => {
          const pct = c.target > 0 ? Math.min(100, (c.progress / c.target) * 100) : 0;
          return (
            <View key={c.id}>
              <View style={styles.challengeHead}>
                <Text style={styles.challengeLabel} numberOfLines={2}>
                  {c.label}
                </Text>
                {c.completed ? (
                  <View style={styles.challengeCheck}>
                    <Feather name="check" size={13} color="#fff" />
                  </View>
                ) : (
                  <Text style={styles.challengeCount}>
                    {c.progress}/{c.target}
                  </Text>
                )}
              </View>
              <View style={styles.challengeTrack}>
                <AnimatedFill
                  pct={pct}
                  color={c.completed ? COLORS.green : COLORS.yellow}
                  style={styles.challengeFill}
                />
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

// --- Badges --------------------------------------------------------------

function BadgesCard({ data, onOpenBadge }: { data: GamificationMeDto; onOpenBadge: (b: BadgeDto) => void }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Badges</Text>
      <View style={styles.badgeGrid}>
        {data.badges.map((b, i) => (
          <AppearItem key={b.id} index={i} style={styles.badgeCell}>
            <Pressable
              style={styles.badgePressable}
              onPress={() => onOpenBadge(b)}
              accessibilityRole="button"
              accessibilityLabel={`Badge ${b.label}, ${b.tier > 0 ? TIER_LABELS[b.tier] : 'non débloqué'}`}
            >
              <View style={[styles.badgeCircle, { backgroundColor: TIER_COLORS[b.tier] }]}>
                <Feather name={safeFeatherIcon(b.icon)} size={24} color={b.tier > 0 ? '#fff' : '#9a9a9a'} />
              </View>
              <Text style={styles.badgeLabel} numberOfLines={2}>
                {b.label}
              </Text>
              <Text style={styles.badgeProgress}>
                {b.nextThreshold === null
                  ? 'Max !'
                  : `${b.progress.toLocaleString('fr-FR')}/${b.nextThreshold.toLocaleString('fr-FR')}`}
              </Text>
            </Pressable>
          </AppearItem>
        ))}
      </View>
    </View>
  );
}

function BadgeModal({ badge, onClose }: { badge: BadgeDto | null; onClose: () => void }) {
  return (
    <Modal visible={!!badge} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.modalOverlay} onPress={onClose}>
        <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
          {badge ? (
            <>
              <View style={[styles.badgeCircle, styles.modalCircle, { backgroundColor: TIER_COLORS[badge.tier] }]}>
                <Feather name={safeFeatherIcon(badge.icon)} size={30} color={badge.tier > 0 ? '#fff' : '#9a9a9a'} />
              </View>
              <Text style={styles.modalTitle}>{badge.label}</Text>
              <Text style={styles.modalTier}>
                {badge.tier > 0 ? `Palier ${badge.tier}/${badge.tierCount} — ${TIER_LABELS[badge.tier]}` : `Non débloqué — ${badge.tierCount} paliers`}
              </Text>
              <Text style={styles.modalDesc}>{badge.description}</Text>
              <Text style={styles.modalProgress}>
                {badge.nextThreshold === null
                  ? 'Palier maximum atteint !'
                  : `Progression : ${badge.progress.toLocaleString('fr-FR')} / ${badge.nextThreshold.toLocaleString('fr-FR')}`}
              </Text>
              <Pressable
                style={styles.modalClose}
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel="Fermer"
              >
                <Text style={styles.modalCloseText}>FERMER</Text>
              </Pressable>
            </>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// --- Classement hebdo -------------------------------------------------------

function LeaderboardCard({
  rows,
  isLoading,
  isError,
  myId,
}: {
  rows?: LeaderboardRowDto[];
  isLoading: boolean;
  isError: boolean;
  myId?: string;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Classement de la semaine</Text>
      {isLoading ? (
        <View style={{ gap: 10, marginTop: 12 }}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} style={{ height: 44, borderRadius: 8 }} />
          ))}
        </View>
      ) : isError || !rows ? (
        <Text style={styles.leaderboardError}>Impossible de charger le classement.</Text>
      ) : rows.length <= 1 ? (
        <EmptyState title="Suis des amis pour te comparer !" />
      ) : (
        <View style={{ marginTop: 6 }}>
          {rows.map((row) => {
            const isMe = row.user.id === myId;
            const avatar = tmdbImage(row.user.avatarUrl, 'w185');
            return (
              <View key={row.user.id} style={[styles.leaderRow, isMe && styles.leaderRowMe]}>
                <Text style={styles.leaderRank}>{row.rank}</Text>
                {avatar ? (
                  <Image source={{ uri: avatar }} style={styles.leaderAvatar} />
                ) : (
                  <View style={[styles.leaderAvatar, styles.leaderAvatarEmpty]}>
                    <Text style={styles.leaderAvatarInit}>{row.user.displayName.slice(0, 1).toUpperCase()}</Text>
                  </View>
                )}
                <Text style={styles.leaderName} numberOfLines={1}>
                  {row.user.displayName}
                </Text>
                <Text style={styles.leaderXp}>{row.weeklyXp.toLocaleString('fr-FR')} XP</Text>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

// --- Squelette de chargement -------------------------------------------------

function TrophiesSkeleton() {
  return (
    <View style={styles.list}>
      <View style={styles.card}>
        <View style={{ alignItems: 'center', gap: 10 }}>
          <Skeleton style={{ width: 96, height: 96, borderRadius: 48 }} />
          <Skeleton style={{ width: 140, height: 16, borderRadius: 999 }} />
        </View>
        <Skeleton style={{ height: 10, borderRadius: 999, marginTop: 18 }} />
      </View>
      <View style={[styles.card, { flexDirection: 'row', gap: 14, alignItems: 'center' }]}>
        <Skeleton style={{ width: 34, height: 34, borderRadius: 17 }} />
        <Skeleton style={{ flex: 1, height: 16, borderRadius: 999 }} />
      </View>
      <View style={styles.card}>
        <Skeleton style={{ width: 120, height: 18, borderRadius: 999, marginBottom: 14 }} />
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} style={{ height: 30, borderRadius: 8, marginBottom: 10 }} />
        ))}
      </View>
      <View style={styles.card}>
        <Skeleton style={{ width: 90, height: 18, borderRadius: 999, marginBottom: 14 }} />
        <View style={styles.badgeGrid}>
          {Array.from({ length: 6 }).map((_, i) => (
            <View key={i} style={styles.badgeCell}>
              <Skeleton style={{ width: 58, height: 58, borderRadius: 29, alignSelf: 'center' }} />
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  list: { padding: 12, gap: 12, paddingBottom: 32 },
  card: { backgroundColor: COLORS.white, borderRadius: 12, padding: 18, borderWidth: 1, borderColor: COLORS.borderLight },
  cardTitle: { fontSize: 19, fontFamily: FONTS.extraBold },

  levelWrap: { alignItems: 'center', gap: 6 },
  levelCircle: {
    width: 96, height: 96, borderRadius: 48, backgroundColor: COLORS.yellow,
    alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: COLORS.black,
  },
  levelNumber: { fontSize: 36, fontFamily: FONTS.extraBold, color: COLORS.black },
  levelTitle: { fontSize: 16, fontFamily: FONTS.bold, color: COLORS.black },
  xpTrack: { height: 10, borderRadius: 999, backgroundColor: COLORS.chipGrey, marginTop: 18, overflow: 'hidden' },
  xpFill: { height: 10, borderRadius: 999 },
  xpLabel: { fontSize: 13, fontFamily: FONTS.bold, color: COLORS.textMuted, marginTop: 8, textAlign: 'center' },

  streakCard: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  streakMain: { fontSize: 16, fontFamily: FONTS.bold },
  streakSub: { fontSize: 13, fontFamily: FONTS.regular, color: COLORS.textMuted, marginTop: 2 },

  challengeHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  challengeLabel: { flex: 1, fontSize: 14, fontFamily: FONTS.semiBold },
  challengeCount: { fontSize: 13, fontFamily: FONTS.bold, color: COLORS.textMuted },
  challengeCheck: { width: 20, height: 20, borderRadius: 10, backgroundColor: COLORS.green, alignItems: 'center', justifyContent: 'center' },
  challengeTrack: { height: 8, borderRadius: 999, backgroundColor: COLORS.chipGrey, marginTop: 8, overflow: 'hidden' },
  challengeFill: { height: 8, borderRadius: 999 },

  badgeGrid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 14 },
  badgeCell: { width: '33.333%', paddingVertical: 10, paddingHorizontal: 4 },
  badgePressable: { alignItems: 'center' },
  badgeCircle: { width: 58, height: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center' },
  badgeLabel: { fontSize: 12, fontFamily: FONTS.bold, textAlign: 'center', marginTop: 6 },
  badgeProgress: { fontSize: 10.5, fontFamily: FONTS.regular, color: COLORS.textMuted, textAlign: 'center', marginTop: 2 },

  modalOverlay: { flex: 1, backgroundColor: COLORS.overlay, alignItems: 'center', justifyContent: 'center', padding: 30 },
  modalCard: { backgroundColor: COLORS.white, borderRadius: 16, padding: 24, alignItems: 'center', width: '100%', maxWidth: 340 },
  modalCircle: { width: 76, height: 76, borderRadius: 38, marginBottom: 12 },
  modalTitle: { fontSize: 19, fontFamily: FONTS.extraBold, textAlign: 'center' },
  modalTier: { fontSize: 13, fontFamily: FONTS.bold, color: COLORS.textMuted, marginTop: 4, textAlign: 'center' },
  modalDesc: { fontSize: 14, fontFamily: FONTS.regular, color: COLORS.text, marginTop: 12, textAlign: 'center' },
  modalProgress: { fontSize: 13, fontFamily: FONTS.bold, color: COLORS.textMuted, marginTop: 10, textAlign: 'center' },
  modalClose: { marginTop: 20, borderWidth: 2, borderColor: COLORS.black, borderRadius: 999, paddingVertical: 10, paddingHorizontal: 26 },
  modalCloseText: { fontSize: 13, fontFamily: FONTS.extraBold, letterSpacing: 0.5 },

  leaderboardError: { fontSize: 14, fontFamily: FONTS.regular, color: COLORS.textMuted, marginTop: 10 },
  leaderRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 8,
    borderRadius: 8, borderTopWidth: 1, borderTopColor: COLORS.borderLight,
  },
  leaderRowMe: { backgroundColor: '#FFFBE0', borderTopColor: 'transparent' },
  leaderRank: { width: 22, fontSize: 15, fontFamily: FONTS.extraBold, color: COLORS.textMuted },
  leaderAvatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#20202a' },
  leaderAvatarEmpty: { alignItems: 'center', justifyContent: 'center' },
  leaderAvatarInit: { color: '#fff', fontSize: 15, fontFamily: FONTS.extraBold },
  leaderName: { flex: 1, fontSize: 15, fontFamily: FONTS.bold },
  leaderXp: { fontSize: 14, fontFamily: FONTS.extraBold },
});
