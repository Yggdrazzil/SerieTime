import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Modal, Image } from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { api, tmdbImage } from '@/lib/api';
import { useAppStore } from '@/lib/store';
import { COLORS, FONTS, RADIUS, SHADOW, SIZES, SPACE } from '@/lib/theme';
import { ScreenShell, ScreenHeader, SectionHeader, PrismeCard, ProgressBar, IconAction } from '@/components/prisme';
import { goBack } from '@/lib/nav';
import { LoadError, EmptyState } from '@/components/ui';
import { Skeleton, AnimatedFill, AppearItem } from '@/components/anim';
import type { BadgeDto, GamificationMeDto, LeaderboardRowDto } from '@/lib/types';

// Paliers bronze → argent → or → platine (spec 2026-07-16 §3/§10).
const TIER_COLORS: Record<number, string> = { 0: COLORS.surfaceMuted, 1: '#CD7F32', 2: '#9AA2AA', 3: '#D4A017', 4: '#7FDBFF' };
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
    <ScreenShell scroll>
      <ScreenHeader
        title="Trophées"
        leading={<IconAction icon="chevron-left" label="Retour" onPress={() => goBack('/profile')} />}
      />
      {me.isLoading ? (
        <TrophiesSkeleton />
      ) : me.isError || !me.data ? (
        <LoadError onRetry={me.refetch} busy={me.isRefetching} />
      ) : (
        <View style={styles.list}>
          <AppearItem index={0}><LevelCard data={me.data} /></AppearItem>
          <AppearItem index={1}><StreakCard data={me.data} /></AppearItem>
          <AppearItem index={2}><ChallengesCard data={me.data} /></AppearItem>
          <AppearItem index={3}><BadgesCard data={me.data} onOpenBadge={setOpenBadge} /></AppearItem>
          <AppearItem index={4}>
            <LeaderboardCard
              rows={leaderboard.data?.leaderboard}
              isLoading={leaderboard.isLoading}
              isError={leaderboard.isError}
              myId={myId}
            />
          </AppearItem>
        </View>
      )}
      <BadgeModal badge={openBadge} onClose={() => setOpenBadge(null)} />
    </ScreenShell>
  );
}

// --- Bloc niveau -----------------------------------------------------------

function LevelCard({ data }: { data: GamificationMeDto }) {
  // Palier XP de départ du niveau courant : cohérent avec `level = floor(sqrt(xp/50))`
  // et `nextLevelXp = 50*(level+1)^2` (packages/core/src/gamification/xp.ts).
  return (
    <PrismeCard style={styles.levelCard} elevated>
      <View style={styles.levelWrap}>
        <View style={styles.levelCircle}>
          <Text style={styles.levelNumber}>{data.level}</Text>
        </View>
        <Text style={styles.levelEyebrow}>Niveau {data.level}</Text>
        <Text style={styles.levelTitle}>{data.levelTitle}</Text>
      </View>
      <ProgressBar value={data.xp} max={data.nextLevelXp} label="Progression du niveau" style={styles.xpBar} height={10} />
      <Text style={styles.xpLabel}>
        {data.xp.toLocaleString('fr-FR')} / {data.nextLevelXp.toLocaleString('fr-FR')} XP
      </Text>
    </PrismeCard>
  );
}

// --- Bloc streak -------------------------------------------------------------

function StreakCard({ data }: { data: GamificationMeDto }) {
  const active = data.currentStreak > 0;
  return (
    <PrismeCard style={styles.streakCard} elevated>
      <View style={[styles.streakIcon, active && styles.streakIconActive]}>
        <Ionicons name="flame" size={26} color={active ? '#FF7A1A' : COLORS.textSoft} />
      </View>
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
    </PrismeCard>
  );
}

// --- Défis du mois -----------------------------------------------------------

function ChallengesCard({ data }: { data: GamificationMeDto }) {
  return (
    <PrismeCard elevated>
      <SectionHeader title="Défis du mois" style={styles.cardSectionHeader} />
      <View style={{ gap: SPACE.md }}>
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
                  color={c.completed ? COLORS.success : COLORS.yellow}
                  style={styles.challengeFill}
                />
              </View>
            </View>
          );
        })}
      </View>
    </PrismeCard>
  );
}

// --- Badges --------------------------------------------------------------

function BadgesCard({ data, onOpenBadge }: { data: GamificationMeDto; onOpenBadge: (b: BadgeDto) => void }) {
  return (
    <PrismeCard elevated>
      <SectionHeader title="Badges" style={styles.cardSectionHeader} />
      <View style={styles.badgeGrid}>
        {data.badges.map((b, i) => (
          <AppearItem key={b.id} index={i} style={styles.badgeCell}>
            <Pressable
              style={({ pressed }) => [styles.badgePressable, pressed && styles.badgePressed]}
              onPress={() => onOpenBadge(b)}
              accessibilityRole="button"
              accessibilityLabel={`Badge ${b.label}, ${b.tier > 0 ? TIER_LABELS[b.tier] : 'non débloqué'}`}
            >
              <View style={[styles.badgeCircle, { backgroundColor: TIER_COLORS[b.tier] }]}>
                <Feather name={safeFeatherIcon(b.icon)} size={24} color={b.tier > 0 ? '#fff' : COLORS.textSoft} />
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
    </PrismeCard>
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
                <Feather name={safeFeatherIcon(badge.icon)} size={30} color={badge.tier > 0 ? '#fff' : COLORS.textSoft} />
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
                style={({ pressed }) => [styles.modalClose, pressed && styles.modalClosePressed]}
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
    <PrismeCard elevated>
      <SectionHeader title="Classement de la semaine" style={styles.cardSectionHeader} />
      {isLoading ? (
        <View style={{ gap: SPACE.xs }}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} style={{ height: 44, borderRadius: RADIUS.control }} />
          ))}
        </View>
      ) : isError || !rows ? (
        <Text style={styles.leaderboardError}>Impossible de charger le classement.</Text>
      ) : rows.length <= 1 ? (
        <EmptyState title="Suis des amis pour te comparer !" />
      ) : (
        <View>
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
    </PrismeCard>
  );
}

// --- Squelette de chargement -------------------------------------------------

function TrophiesSkeleton() {
  return (
    <View style={styles.list}>
      <PrismeCard elevated>
        <View style={{ alignItems: 'center', gap: SPACE.xs }}>
          <Skeleton style={{ width: 96, height: 96, borderRadius: 48 }} />
          <Skeleton style={{ width: 140, height: 16, borderRadius: RADIUS.pill }} />
        </View>
        <Skeleton style={{ height: 10, borderRadius: RADIUS.pill, marginTop: SPACE.md }} />
      </PrismeCard>
      <PrismeCard elevated style={{ flexDirection: 'row', gap: SPACE.md, alignItems: 'center' }}>
        <Skeleton style={{ width: 44, height: 44, borderRadius: 22 }} />
        <Skeleton style={{ flex: 1, height: 16, borderRadius: RADIUS.pill }} />
      </PrismeCard>
      <PrismeCard elevated>
        <Skeleton style={{ width: 120, height: 18, borderRadius: RADIUS.pill, marginBottom: SPACE.sm }} />
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} style={{ height: 30, borderRadius: RADIUS.control, marginBottom: SPACE.xs }} />
        ))}
      </PrismeCard>
      <PrismeCard elevated>
        <Skeleton style={{ width: 90, height: 18, borderRadius: RADIUS.pill, marginBottom: SPACE.sm }} />
        <View style={styles.badgeGrid}>
          {Array.from({ length: 6 }).map((_, i) => (
            <View key={i} style={styles.badgeCell}>
              <Skeleton style={{ width: 58, height: 58, borderRadius: 29, alignSelf: 'center' }} />
            </View>
          ))}
        </View>
      </PrismeCard>
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: SPACE.sm, paddingBottom: SPACE.xl },
  cardSectionHeader: { marginTop: 0, marginBottom: SPACE.sm },

  levelCard: { alignItems: 'stretch' },
  levelWrap: { alignItems: 'center', gap: SPACE.xxs },
  levelCircle: {
    width: 96, height: 96, borderRadius: 48, backgroundColor: COLORS.yellow,
    alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: COLORS.onAccent,
    marginBottom: SPACE.xxs,
  },
  levelNumber: { fontSize: 36, fontFamily: FONTS.extraBold, color: COLORS.onAccent },
  levelEyebrow: { fontSize: 11, fontFamily: FONTS.bold, letterSpacing: 1, textTransform: 'uppercase', color: COLORS.primary },
  levelTitle: { fontSize: 17, fontFamily: FONTS.extraBold, color: COLORS.text },
  xpBar: { marginTop: SPACE.md },
  xpLabel: { fontSize: 13, fontFamily: FONTS.bold, color: COLORS.textMuted, marginTop: SPACE.xs, textAlign: 'center' },

  streakCard: { flexDirection: 'row', alignItems: 'center', gap: SPACE.md },
  streakIcon: {
    width: SIZES.touch, height: SIZES.touch, borderRadius: RADIUS.control, flexShrink: 0,
    backgroundColor: COLORS.surfaceMuted, alignItems: 'center', justifyContent: 'center',
  },
  streakIconActive: { backgroundColor: 'rgba(255,122,26,0.14)' },
  streakMain: { fontSize: 16, fontFamily: FONTS.bold, color: COLORS.text },
  streakSub: { fontSize: 13, fontFamily: FONTS.regular, color: COLORS.textMuted, marginTop: 2 },

  challengeHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SPACE.sm },
  challengeLabel: { flex: 1, fontSize: 14, fontFamily: FONTS.semiBold, color: COLORS.text },
  challengeCount: { fontSize: 13, fontFamily: FONTS.bold, color: COLORS.textMuted },
  challengeCheck: { width: 20, height: 20, borderRadius: 10, backgroundColor: COLORS.success, alignItems: 'center', justifyContent: 'center' },
  challengeTrack: { height: 8, borderRadius: RADIUS.pill, backgroundColor: COLORS.surfaceMuted, marginTop: SPACE.xs, overflow: 'hidden' },
  challengeFill: { height: 8, borderRadius: RADIUS.pill },

  badgeGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  badgeCell: { width: '33.333%', paddingVertical: SPACE.xs, paddingHorizontal: 4 },
  badgePressable: { alignItems: 'center', borderRadius: RADIUS.control, paddingVertical: SPACE.xxs },
  badgePressed: { opacity: 0.7, transform: [{ scale: 0.96 }] },
  badgeCircle: { width: 58, height: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center' },
  badgeLabel: { fontSize: 12, fontFamily: FONTS.bold, textAlign: 'center', marginTop: 6, color: COLORS.text },
  badgeProgress: { fontSize: 10.5, fontFamily: FONTS.regular, color: COLORS.textMuted, textAlign: 'center', marginTop: 2 },

  modalOverlay: { flex: 1, backgroundColor: COLORS.overlay, alignItems: 'center', justifyContent: 'center', padding: SPACE.xl },
  modalCard: { backgroundColor: COLORS.surface, borderRadius: RADIUS.sheet, padding: SPACE.lg, alignItems: 'center', width: '100%', maxWidth: 340, ...SHADOW.card },
  modalCircle: { width: 76, height: 76, borderRadius: 38, marginBottom: SPACE.sm },
  modalTitle: { fontSize: 19, fontFamily: FONTS.extraBold, textAlign: 'center', color: COLORS.text },
  modalTier: { fontSize: 13, fontFamily: FONTS.bold, color: COLORS.textMuted, marginTop: 4, textAlign: 'center' },
  modalDesc: { fontSize: 14, fontFamily: FONTS.regular, color: COLORS.text, marginTop: SPACE.sm, textAlign: 'center', lineHeight: 20 },
  modalProgress: { fontSize: 13, fontFamily: FONTS.bold, color: COLORS.textMuted, marginTop: SPACE.xs, textAlign: 'center' },
  modalClose: { minHeight: SIZES.touch, justifyContent: 'center', marginTop: SPACE.md, backgroundColor: COLORS.primary, borderRadius: RADIUS.pill, paddingVertical: SPACE.sm, paddingHorizontal: SPACE.lg },
  modalClosePressed: { opacity: 0.86 },
  modalCloseText: { fontSize: 13, fontFamily: FONTS.extraBold, letterSpacing: 0.5, color: COLORS.onPrimary },

  leaderboardError: { fontSize: 14, fontFamily: FONTS.regular, color: COLORS.textMuted },
  leaderRow: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, paddingVertical: SPACE.xs, paddingHorizontal: SPACE.xs,
    borderRadius: RADIUS.control, borderTopWidth: 1, borderTopColor: COLORS.borderLight,
  },
  leaderRowMe: { backgroundColor: COLORS.primarySoft, borderTopColor: 'transparent' },
  leaderRank: { width: 22, fontSize: 15, fontFamily: FONTS.extraBold, color: COLORS.textMuted },
  leaderAvatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: COLORS.primary },
  leaderAvatarEmpty: { alignItems: 'center', justifyContent: 'center' },
  leaderAvatarInit: { color: '#fff', fontSize: 15, fontFamily: FONTS.extraBold },
  leaderName: { flex: 1, fontSize: 15, fontFamily: FONTS.bold, color: COLORS.text },
  leaderXp: { fontSize: 14, fontFamily: FONTS.extraBold, color: COLORS.text },
});
