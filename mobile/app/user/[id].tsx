import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Image, ActivityIndicator, Platform } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { goBack } from '@/lib/nav';
import { StatusBar } from 'expo-status-bar';
import { useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, tmdbImage } from '@/lib/api';
import type { MediaDto } from '@/lib/types';
import { COLORS, FONTS, setThemeColorMeta, currentThemeColorMeta } from '@/lib/theme';
import { Loading, LoadError } from '@/components/ui';
import { AppearItem, Pop, PressableScale } from '@/components/anim';

// Paliers bronze → argent → or → platine (aligné sur mobile/app/trophies.tsx).
const TIER_COLORS: Record<number, string> = { 0: '#E3E3E3', 1: '#CD7F32', 2: '#9AA2AA', 3: '#D4A017', 4: '#7FDBFF' };

// Le catalogue serveur mélange des noms Feather et Ionicons (« game-controller »,
// « flame ») — fallback sur « award » quand le nom n'existe pas dans Feather.
function safeFeatherIcon(icon: string): keyof typeof Feather.glyphMap {
  return icon in Feather.glyphMap ? (icon as keyof typeof Feather.glyphMap) : 'award';
}

type RecentShow = { id: string; title: string; posterPath: string | null; type: string };
// Sous-ensemble PUBLIC de la gamification (réputation) renvoyé par le serveur.
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

export default function UserProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const focused = useIsFocused();

  // Comme sur l'onglet Profil : en-tête sombre fondu avec la barre de statut
  // (icônes claires en natif, zone teintée via theme-color sur la web app).
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined' || !focused) return;
    const prev = currentThemeColorMeta();
    setThemeColorMeta('#20202a');
    return () => setThemeColorMeta(prev);
  }, [focused]);

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['user', id],
    queryFn: () => api.get<UserProfile>(`/api/users/${id}`),
  });

  // Bascule OPTIMISTE : le bouton et le compteur d'abonnés changent au doigt,
  // le serveur confirme derrière (rollback si échec).
  const toggleFollow = async () => {
    if (!data || busy) return;
    setBusy(true);
    const wasFollowing = data.isFollowing;
    await qc.cancelQueries({ queryKey: ['user', id] });
    const prev = qc.getQueryData<UserProfile>(['user', id]);
    qc.setQueryData<UserProfile>(['user', id], (d) =>
      d
        ? {
            ...d,
            isFollowing: !wasFollowing,
            followersCount: Math.max(0, d.followersCount + (wasFollowing ? -1 : 1)),
          }
        : d,
    );
    try {
      if (wasFollowing) await api.del(`/api/social/follow/${data.id}`);
      else await api.post(`/api/social/follow/${data.id}`);
      qc.invalidateQueries({ queryKey: ['user', id] });
      qc.invalidateQueries({ queryKey: ['social'] });
      qc.invalidateQueries({ queryKey: ['profile'] });
    } catch {
      if (prev) qc.setQueryData(['user', id], prev);
    } finally {
      setBusy(false);
    }
  };

  if (isLoading) return <Loading />;
  if (!data) return <LoadError onRetry={refetch} busy={isRefetching} />;

  const g = data.gamification;

  return (
    <Pop>
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.white }} contentContainerStyle={{ paddingBottom: 24 }}>
      {focused ? <StatusBar style="light" /> : null}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => goBack('/social')} hitSlop={12} style={styles.back} accessibilityRole="button" accessibilityLabel="Retour">
          <Feather name="chevron-left" size={28} color="#fff" />
        </Pressable>
        <View>
          <View style={styles.avatar}>
            <Text style={styles.avatarInit}>{data.displayName.slice(0, 1).toUpperCase()}</Text>
          </View>
          {/* Pastille de niveau (gamification) : coin bas-droit, jaune, bord blanc. */}
          {g ? (
            <View style={styles.levelPill}>
              <Text style={styles.levelPillText}>{g.level}</Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.name}>{data.displayName}</Text>
        {g ? (
          <Text style={styles.levelTitle}>
            Niveau {g.level} · {g.levelTitle}
          </Text>
        ) : null}
        {g && g.currentStreak > 0 ? (
          <Text style={styles.streak}>🔥 {g.currentStreak} jour{g.currentStreak > 1 ? 's' : ''}</Text>
        ) : null}
        <View style={styles.followRow}>
          <Text style={styles.followCount}>
            <Text style={styles.followNum}>{data.followersCount}</Text> abonnés
          </Text>
          <Text style={styles.followCount}>
            <Text style={styles.followNum}>{data.followingCount}</Text> abonnements
          </Text>
        </View>
        {!data.isSelf ? (
          <Pressable style={[styles.followBtn, data.isFollowing && styles.followingBtn]} onPress={toggleFollow} disabled={busy}>
            {busy ? (
              <ActivityIndicator color={data.isFollowing ? COLORS.black : '#fff'} />
            ) : (
              <Text style={[styles.followText, data.isFollowing && styles.followingText]}>
                {data.isFollowing ? 'ABONNÉ' : 'SUIVRE'}
              </Text>
            )}
          </Pressable>
        ) : null}
      </View>

      {/* Trophées : réputation publique, visible MÊME sur un profil privé. */}
      {g && g.badges.length > 0 ? (
        <View style={{ marginTop: 20 }}>
          <Text style={styles.sectionTitle}>Trophées</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, gap: 16 }}>
            {g.badges.map((b, i) => (
              <AppearItem key={b.id} index={i}>
                <View style={styles.badgeCell}>
                  <View style={[styles.badgeCircle, { backgroundColor: TIER_COLORS[b.tier] ?? TIER_COLORS[1] }]}>
                    <Feather name={safeFeatherIcon(b.icon)} size={24} color="#fff" />
                  </View>
                  <Text style={styles.badgeLabel} numberOfLines={2}>
                    {b.label}
                  </Text>
                </View>
              </AppearItem>
            ))}
          </ScrollView>
        </View>
      ) : null}

      {data.restricted ? (
        <View style={styles.locked}>
          <Feather name="lock" size={30} color={COLORS.textMuted} />
          <Text style={styles.lockedText}>Ce profil est privé.</Text>
          <Text style={styles.lockedSub}>Abonnez-vous pour voir son activité.</Text>
        </View>
      ) : (
        <>
          {data.stats ? (
            <View style={styles.counters}>
              <Counter n={data.stats.showsCount} label="Séries" />
              <Counter n={data.stats.moviesCount} label="Films" border />
              <Counter n={data.stats.episodesWatched} label="Épisodes" border />
              <Counter n={data.stats.gamesCount} label="Jeux" border />
            </View>
          ) : null}

          {data.recentShows.length > 0 ? (
            <View style={{ marginTop: 20 }}>
              <Text style={styles.sectionTitle}>Séries récentes</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, gap: 12 }}>
                {data.recentShows.map((s, i) => {
                  const poster = tmdbImage(s.posterPath, 'w342');
                  return (
                    <AppearItem key={s.id} index={i}>
                      <PressableScale onPress={() => router.push(`/show/${s.id}${s.type === 'movie' ? '?type=movie' : ''}`)}>
                        {poster ? (
                          <Image source={{ uri: poster }} style={styles.poster} resizeMode="cover" />
                        ) : (
                          <View style={[styles.poster, styles.posterEmpty]}>
                            <Feather name="image" size={22} color="#b4b4b4" />
                          </View>
                        )}
                      </PressableScale>
                    </AppearItem>
                  );
                })}
              </ScrollView>
            </View>
          ) : null}

          <FavoriteRow title="Séries préférées" items={data.favoriteShows} kind="show" />
          <FavoriteRow title="Films préférés" items={data.favoriteMovies} kind="movie" />
          <FavoriteRow title="Jeux préférés" items={data.favoriteGames} kind="game" />
        </>
      )}
    </ScrollView>
    </Pop>
  );
}

// Rangée d'affiches « préférés » — masquée si vide (profil d'autrui, non
// modifiable). Tap → fiche : /show/:id, /show/:id?type=movie, /game/:id.
function FavoriteRow({ title, items, kind }: { title: string; items: MediaDto[]; kind: 'show' | 'movie' | 'game' }) {
  const router = useRouter();
  if (items.length === 0) return null;
  const hrefFor = (id: string) =>
    (kind === 'game' ? `/game/${id}` : `/show/${id}${kind === 'movie' ? '?type=movie' : ''}`) as Href;
  return (
    <View style={{ marginTop: 20 }}>
      <View style={styles.favTitleRow}>
        <View style={styles.heartBadge}>
          <Feather name="heart" size={13} color="#fff" />
        </View>
        <Text style={styles.favTitle}>{title}</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, gap: 12 }}>
        {items.map((m, i) => {
          const poster = tmdbImage(m.posterPath, 'w342');
          return (
            <AppearItem key={m.id} index={i}>
              <PressableScale onPress={() => router.push(hrefFor(m.id))}>
                {poster ? (
                  <Image source={{ uri: poster }} style={styles.poster} resizeMode="cover" />
                ) : (
                  <View style={[styles.poster, styles.posterEmpty]}>
                    <Feather name="image" size={22} color="#b4b4b4" />
                  </View>
                )}
              </PressableScale>
            </AppearItem>
          );
        })}
      </ScrollView>
    </View>
  );
}

function Counter({ n, label, border }: { n: number; label: string; border?: boolean }) {
  return (
    <View style={[styles.counter, border && styles.counterBorder]}>
      <Text style={styles.counterN}>{n}</Text>
      <Text style={styles.counterL}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { backgroundColor: '#20202a', alignItems: 'center', paddingBottom: 22, paddingHorizontal: 20 },
  back: { position: 'absolute', left: 12, top: 0, paddingTop: 8, height: 60, justifyContent: 'center' },
  avatar: { width: 88, height: 88, borderRadius: 44, borderWidth: 2, borderColor: '#fff', backgroundColor: '#555', alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  avatarInit: { color: '#fff', fontSize: 34, fontFamily: FONTS.extraBold },
  // Pastille de niveau : coin bas-droit de l'avatar, jaune, bord blanc.
  levelPill: {
    position: 'absolute', bottom: -2, right: -2, minWidth: 26, height: 26, borderRadius: 13,
    backgroundColor: COLORS.yellow, borderWidth: 2, borderColor: '#fff',
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4,
  },
  levelPillText: { color: COLORS.black, fontSize: 13, fontFamily: FONTS.extraBold },
  name: { color: '#fff', fontSize: 24, fontFamily: FONTS.extraBold, marginTop: 12 },
  levelTitle: { color: 'rgba(255,255,255,0.9)', fontSize: 14, fontFamily: FONTS.bold, marginTop: 4 },
  streak: { color: 'rgba(255,255,255,0.9)', fontSize: 13, fontFamily: FONTS.bold, marginTop: 4 },
  followRow: { flexDirection: 'row', gap: 20, marginTop: 8 },
  followCount: { color: 'rgba(255,255,255,0.85)', fontFamily: FONTS.regular, fontSize: 14 },
  followNum: { color: '#fff', fontFamily: FONTS.extraBold },
  followBtn: { marginTop: 16, minWidth: 140, paddingHorizontal: 24, paddingVertical: 11, borderRadius: 999, backgroundColor: COLORS.yellow, alignItems: 'center' },
  followingBtn: { backgroundColor: '#FFFFFF' },
  followText: { fontFamily: FONTS.extraBold, fontSize: 14, letterSpacing: 0.5, color: COLORS.onAccent },
  followingText: { color: '#101014' },
  badgeCell: { width: 76, alignItems: 'center' },
  badgeCircle: { width: 58, height: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center' },
  badgeLabel: { fontSize: 12, fontFamily: FONTS.bold, textAlign: 'center', marginTop: 6, color: COLORS.text },
  counters: { flexDirection: 'row', marginTop: 20 },
  counter: { flex: 1, alignItems: 'center', paddingVertical: 6 },
  counterBorder: { borderLeftWidth: 1, borderLeftColor: COLORS.borderLight },
  counterN: { color: COLORS.text, fontSize: 21, fontFamily: FONTS.extraBold },
  counterL: { fontFamily: FONTS.regular, fontSize: 13, color: COLORS.textMuted, marginTop: 2 },
  sectionTitle: { color: COLORS.text, fontSize: 18, fontFamily: FONTS.extraBold, paddingHorizontal: 20, marginBottom: 12 },
  favTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 20, marginBottom: 12 },
  favTitle: { color: COLORS.text, fontSize: 18, fontFamily: FONTS.extraBold },
  heartBadge: { width: 24, height: 24, borderRadius: 12, backgroundColor: COLORS.red, alignItems: 'center', justifyContent: 'center' },
  poster: { width: 108, aspectRatio: 2 / 3, borderRadius: 4, backgroundColor: COLORS.imagePlaceholder },
  posterEmpty: { alignItems: 'center', justifyContent: 'center' },
  locked: { alignItems: 'center', padding: 40, gap: 8 },
  lockedText: { color: COLORS.text, fontSize: 17, fontFamily: FONTS.bold, marginTop: 8 },
  lockedSub: { fontFamily: FONTS.regular, fontSize: 15, color: COLORS.textMuted },
});
