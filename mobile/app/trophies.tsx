import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, Modal, Image } from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useQuery } from '@tanstack/react-query';
import { api, tmdbImage } from '@/lib/api';
import { useAppStore } from '@/lib/store';
import { goBack } from '@/lib/nav';
import { useBackClose } from '@/lib/useBackClose';
import { COLORS, FONTS, RADIUS, SHADOW, SIZES, SPACE } from '@/lib/theme';
import { ScreenShell, ScreenHeader, SectionHeader, PrismeCard, ProgressBar, IconAction } from '@/components/prisme';
import { MedalBadge, LevelMedal, TIER_LABELS, type MedalTier } from '@/components/medals';
import { LoadError, EmptyState } from '@/components/ui';
import { Skeleton, AppearItem } from '@/components/anim';
import type { BadgeDto, GamificationMeDto, LeaderboardRowDto } from '@/lib/types';

// Le catalogue serveur mélange des noms Feather et Ionicons (« game-controller »,
// « flame ») — fallback sur « award » quand le nom n'existe pas dans Feather.
function safeFeatherIcon(icon: string): keyof typeof Feather.glyphMap {
  return icon in Feather.glyphMap ? (icon as keyof typeof Feather.glyphMap) : 'award';
}

const medalTier = (tier: number): MedalTier => Math.max(0, Math.min(4, tier)) as MedalTier;

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
    <ScreenShell scroll contentContainerStyle={styles.content}>
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
          <AppearItem index={0}>
            <LevelHero data={me.data} />
          </AppearItem>
          <AppearItem index={1}>
            <StreakCard data={me.data} />
          </AppearItem>
          <AppearItem index={2}>
            <ChallengesCard data={me.data} />
          </AppearItem>
          <AppearItem index={3}>
            <BadgesCard data={me.data} onOpenBadge={setOpenBadge} />
          </AppearItem>
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

// --- Héro niveau : médaillon or + anneau d'XP sur nuit violette --------------

function LevelHero({ data }: { data: GamificationMeDto }) {
  const pct = data.nextLevelXp > 0 ? Math.min(1, data.xp / data.nextLevelXp) : 0;
  return (
    <View style={styles.heroWrap}>
      <LinearGradient colors={['#241B3D', '#41288A']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      {/* Formes Prisme discrètes (identité PlotTime, pas un aplat morne). */}
      <View style={[styles.heroShape, { backgroundColor: COLORS.secondary, right: -34, top: -30 }]} />
      <View style={[styles.heroShape, styles.heroShapeSmall, { backgroundColor: '#FBAE00', right: 64, bottom: -26 }]} />
      <View
        style={styles.heroRow}
        accessible
        accessibilityLabel={`Niveau ${data.level}, ${data.levelTitle}, ${data.xp} XP sur ${data.nextLevelXp}`}
      >
        <LevelMedal level={data.level} progress={pct} />
        <View style={styles.heroCopy}>
          <Text style={styles.heroEyebrow}>NIVEAU {data.level}</Text>
          <Text style={styles.heroTitle} numberOfLines={2}>
            {data.levelTitle}
          </Text>
          <Text style={styles.heroXp}>
            {data.xp.toLocaleString('fr-FR')} / {data.nextLevelXp.toLocaleString('fr-FR')} XP
          </Text>
          <View style={styles.heroTrack}>
            <LinearGradient
              colors={[COLORS.secondary, '#FBAE00']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={[styles.heroFill, { width: `${Math.round(pct * 100)}%` }]}
            />
          </View>
        </View>
      </View>
    </View>
  );
}

// --- Streak -------------------------------------------------------------

function StreakCard({ data }: { data: GamificationMeDto }) {
  const active = data.currentStreak > 0;
  return (
    <PrismeCard elevated style={styles.streakCard}>
      <LinearGradient
        colors={active ? ['#FF7A1A', '#EF5BA8'] : [COLORS.surfaceMuted, COLORS.surfaceMuted]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.streakIcon}
      >
        <Ionicons name="flame" size={24} color={active ? '#FFFFFF' : COLORS.textSoft} />
      </LinearGradient>
      <View style={{ flex: 1 }}>
        <Text style={styles.streakMain}>
          {active ? `${data.currentStreak} jour${data.currentStreak > 1 ? 's' : ''} d'affilée` : 'Pas de série en cours'}
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
    <View>
      <SectionHeader title="Défis du mois" />
      <PrismeCard elevated>
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
                <ProgressBar
                  value={pct}
                  label={`Défi ${c.label}`}
                  color={c.completed ? COLORS.success : COLORS.yellow}
                  style={{ marginTop: SPACE.xs }}
                />
              </View>
            );
          })}
        </View>
      </PrismeCard>
    </View>
  );
}

// --- Badges (médailles) ------------------------------------------------------

function BadgesCard({ data, onOpenBadge }: { data: GamificationMeDto; onOpenBadge: (b: BadgeDto) => void }) {
  const unlocked = data.badges.filter((b) => b.tier > 0).length;
  return (
    <View>
      <SectionHeader title="Badges" trailing={<Text style={styles.sectionMeta}>{unlocked} / {data.badges.length}</Text>} />
      <PrismeCard elevated>
        <View style={styles.badgeGrid}>
          {data.badges.map((b, i) => {
            const ringPct = b.nextThreshold === null ? 1 : b.nextThreshold > 0 ? Math.min(1, b.progress / b.nextThreshold) : 0;
            return (
              <AppearItem key={b.id} index={i} style={styles.badgeCell}>
                <Pressable
                  style={({ pressed }) => [styles.badgePressable, pressed && styles.badgePressed]}
                  onPress={() => onOpenBadge(b)}
                  accessibilityRole="button"
                  accessibilityLabel={`Badge ${b.label}, ${b.tier > 0 ? TIER_LABELS[medalTier(b.tier)] : 'non débloqué'}`}
                >
                  <MedalBadge tier={medalTier(b.tier)} icon={safeFeatherIcon(b.icon)} progress={ringPct} />
                  <Text style={styles.badgeLabel} numberOfLines={2}>
                    {b.label}
                  </Text>
                  <Text style={styles.badgeProgress}>
                    {b.nextThreshold === null
                      ? 'Palier max'
                      : `${b.progress.toLocaleString('fr-FR')}/${b.nextThreshold.toLocaleString('fr-FR')}`}
                  </Text>
                </Pressable>
              </AppearItem>
            );
          })}
        </View>
      </PrismeCard>
    </View>
  );
}

function BadgeModal({ badge, onClose }: { badge: BadgeDto | null; onClose: () => void }) {
  const tier = badge ? medalTier(badge.tier) : 0;
  useBackClose(!!badge, onClose);
  return (
    <Modal visible={!!badge} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.modalOverlay} onPress={onClose}>
        <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
          {badge ? (
            <>
              <MedalBadge
                tier={tier}
                icon={safeFeatherIcon(badge.icon)}
                progress={badge.nextThreshold === null ? 1 : badge.nextThreshold > 0 ? Math.min(1, badge.progress / badge.nextThreshold) : 0}
                size={108}
              />
              <Text style={styles.modalTitle}>{badge.label}</Text>
              <View style={[styles.tierChip, tier > 0 && styles.tierChipOn]}>
                <Text style={[styles.tierChipText, tier > 0 && styles.tierChipTextOn]}>
                  {badge.tier > 0 ? `Palier ${badge.tier}/${badge.tierCount} — ${TIER_LABELS[tier]}` : `${badge.tierCount} paliers à débloquer`}
                </Text>
              </View>
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

const RANK_MEDAL: Record<number, string> = { 1: '#D4A017', 2: '#9AA2AA', 3: '#CD7F32' };

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
    <View>
      <SectionHeader title="Classement de la semaine" />
      <PrismeCard elevated>
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
              const medal = RANK_MEDAL[row.rank];
              return (
                <View key={row.user.id} style={[styles.leaderRow, isMe && styles.leaderRowMe]}>
                  <View style={[styles.leaderRank, medal ? { backgroundColor: medal } : null]}>
                    <Text style={[styles.leaderRankText, medal ? { color: '#FFFFFF' } : null]}>{row.rank}</Text>
                  </View>
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
    </View>
  );
}

// --- Squelette de chargement -------------------------------------------------

function TrophiesSkeleton() {
  return (
    <View style={styles.list}>
      <Skeleton style={{ height: 148, borderRadius: RADIUS.sheet }} />
      <Skeleton style={{ height: 74, borderRadius: RADIUS.card }} />
      <Skeleton style={{ height: 150, borderRadius: RADIUS.card }} />
      <Skeleton style={{ height: 280, borderRadius: RADIUS.card }} />
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: SPACE.xl },
  list: { gap: SPACE.sm, paddingTop: SPACE.xs },
  // Héro niveau.
  heroWrap: {
    borderRadius: RADIUS.sheet,
    overflow: 'hidden',
    ...SHADOW.card,
  },
  heroShape: { position: 'absolute', width: 130, height: 130, borderRadius: 65, opacity: 0.35 },
  heroShapeSmall: { width: 74, height: 74, borderRadius: 22, opacity: 0.3 },
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE.md, padding: SPACE.md },
  heroCopy: { flex: 1, minWidth: 0 },
  heroEyebrow: { color: '#FBC34B', fontFamily: FONTS.bold, fontSize: 11, letterSpacing: 1.2 },
  heroTitle: { color: '#FFFFFF', fontFamily: FONTS.bold, fontSize: 20, lineHeight: 26, marginTop: 2 },
  heroXp: { color: 'rgba(255,255,255,0.85)', fontFamily: FONTS.semiBold, fontSize: 13, marginTop: 6 },
  heroTrack: { height: 8, borderRadius: RADIUS.pill, backgroundColor: 'rgba(255,255,255,0.22)', overflow: 'hidden', marginTop: 7 },
  heroFill: { height: '100%', borderRadius: RADIUS.pill },
  // Streak.
  streakCard: { flexDirection: 'row', alignItems: 'center', gap: SPACE.md },
  streakIcon: { width: 46, height: 46, borderRadius: RADIUS.control, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  streakMain: { fontSize: 16, fontFamily: FONTS.bold, color: COLORS.text },
  streakSub: { fontSize: 13, fontFamily: FONTS.regular, color: COLORS.textMuted, marginTop: 2 },
  sectionMeta: { color: COLORS.textMuted, fontSize: 13, lineHeight: 18, fontFamily: FONTS.semiBold },
  // Défis.
  challengeHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SPACE.sm },
  challengeLabel: { flex: 1, fontSize: 14, fontFamily: FONTS.semiBold, color: COLORS.text },
  challengeCount: { fontSize: 13, fontFamily: FONTS.bold, color: COLORS.textMuted },
  challengeCheck: { width: 20, height: 20, borderRadius: 10, backgroundColor: COLORS.success, alignItems: 'center', justifyContent: 'center' },
  // Badges.
  badgeGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  badgeCell: { width: '33.333%', paddingVertical: SPACE.sm, paddingHorizontal: 4 },
  badgePressable: { alignItems: 'center', borderRadius: RADIUS.control, paddingVertical: SPACE.xxs },
  badgePressed: { opacity: 0.7, transform: [{ scale: 0.96 }] },
  badgeLabel: { fontSize: 12, fontFamily: FONTS.bold, textAlign: 'center', marginTop: 7, color: COLORS.text },
  badgeProgress: { fontSize: 10.5, fontFamily: FONTS.regular, color: COLORS.textMuted, textAlign: 'center', marginTop: 2 },
  // Modale badge.
  modalOverlay: { flex: 1, backgroundColor: COLORS.overlay, alignItems: 'center', justifyContent: 'center', padding: SPACE.xl },
  modalCard: {
    backgroundColor: COLORS.sheet,
    borderRadius: RADIUS.sheet,
    padding: SPACE.lg,
    alignItems: 'center',
    width: '100%',
    maxWidth: 340,
    ...SHADOW.card,
  },
  modalTitle: { fontSize: 20, fontFamily: FONTS.extraBold, textAlign: 'center', color: COLORS.text, marginTop: SPACE.sm },
  tierChip: {
    marginTop: SPACE.xs,
    paddingHorizontal: SPACE.sm,
    paddingVertical: 5,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.surfaceMuted,
  },
  tierChipOn: { backgroundColor: COLORS.primarySoft },
  tierChipText: { fontSize: 12, fontFamily: FONTS.bold, color: COLORS.textMuted },
  tierChipTextOn: { color: COLORS.primary },
  modalDesc: { fontSize: 14, fontFamily: FONTS.regular, color: COLORS.text, marginTop: SPACE.sm, textAlign: 'center', lineHeight: 20 },
  modalProgress: { fontSize: 13, fontFamily: FONTS.bold, color: COLORS.textMuted, marginTop: SPACE.xs, textAlign: 'center' },
  modalClose: {
    minHeight: SIZES.touch,
    justifyContent: 'center',
    marginTop: SPACE.md,
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.pill,
    paddingVertical: SPACE.sm,
    paddingHorizontal: SPACE.lg,
  },
  modalClosePressed: { opacity: 0.86 },
  modalCloseText: { fontSize: 13, fontFamily: FONTS.extraBold, letterSpacing: 0.5, color: COLORS.onPrimary },
  // Classement.
  leaderboardError: { fontSize: 14, fontFamily: FONTS.regular, color: COLORS.textMuted },
  leaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.sm,
    paddingVertical: SPACE.xs,
    paddingHorizontal: SPACE.xs,
    borderRadius: RADIUS.control,
    borderTopWidth: 1,
    borderTopColor: COLORS.borderLight,
  },
  leaderRowMe: { backgroundColor: COLORS.primarySoft, borderTopColor: 'transparent' },
  leaderRank: {
    width: 28,
    height: 28,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  leaderRankText: { fontSize: 13, fontFamily: FONTS.extraBold, color: COLORS.textMuted },
  leaderAvatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: COLORS.primary },
  leaderAvatarEmpty: { alignItems: 'center', justifyContent: 'center' },
  leaderAvatarInit: { color: '#fff', fontSize: 15, fontFamily: FONTS.extraBold },
  leaderName: { flex: 1, fontSize: 15, fontFamily: FONTS.bold, color: COLORS.text },
  leaderXp: { fontSize: 14, fontFamily: FONTS.extraBold, color: COLORS.text },
});
