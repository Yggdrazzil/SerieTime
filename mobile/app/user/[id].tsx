import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Image, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, tmdbImage } from '@/lib/api';
import { COLORS, FONTS } from '@/lib/theme';
import { Loading, LoadError } from '@/components/ui';
import { AppearItem, Pop, PressableScale } from '@/components/anim';

type RecentShow = { id: string; title: string; posterPath: string | null; type: string };
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
  stats: { showsCount: number; moviesCount: number; episodesWatched: number } | null;
  recentShows: RecentShow[];
};

export default function UserProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['user', id],
    queryFn: () => api.get<UserProfile>(`/api/users/${id}`),
  });

  const toggleFollow = async () => {
    if (!data) return;
    setBusy(true);
    try {
      if (data.isFollowing) await api.del(`/api/social/follow/${data.id}`);
      else await api.post(`/api/social/follow/${data.id}`);
      qc.invalidateQueries({ queryKey: ['user', id] });
      qc.invalidateQueries({ queryKey: ['social', 'feed'] });
    } finally {
      setBusy(false);
    }
  };

  if (isLoading) return <Loading />;
  if (!data) return <LoadError onRetry={refetch} busy={isRefetching} />;

  return (
    <Pop>
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.white }} contentContainerStyle={{ paddingBottom: 24 }}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.back}>
          <Feather name="chevron-left" size={28} color="#fff" />
        </Pressable>
        <View style={styles.avatar}>
          <Text style={styles.avatarInit}>{data.displayName.slice(0, 1).toUpperCase()}</Text>
        </View>
        <Text style={styles.name}>{data.displayName}</Text>
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
        </>
      )}
    </ScrollView>
    </Pop>
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
  name: { color: '#fff', fontSize: 24, fontFamily: FONTS.extraBold, marginTop: 12 },
  followRow: { flexDirection: 'row', gap: 20, marginTop: 8 },
  followCount: { color: 'rgba(255,255,255,0.85)', fontFamily: FONTS.regular, fontSize: 14 },
  followNum: { color: '#fff', fontFamily: FONTS.extraBold },
  followBtn: { marginTop: 16, minWidth: 140, paddingHorizontal: 24, paddingVertical: 11, borderRadius: 999, backgroundColor: COLORS.yellow, alignItems: 'center' },
  followingBtn: { backgroundColor: '#fff' },
  followText: { fontFamily: FONTS.extraBold, fontSize: 14, letterSpacing: 0.5, color: COLORS.black },
  followingText: { color: COLORS.black },
  counters: { flexDirection: 'row', marginTop: 20 },
  counter: { flex: 1, alignItems: 'center', paddingVertical: 6 },
  counterBorder: { borderLeftWidth: 1, borderLeftColor: COLORS.borderLight },
  counterN: { fontSize: 24, fontFamily: FONTS.extraBold },
  counterL: { fontFamily: FONTS.regular, fontSize: 13, color: COLORS.textMuted, marginTop: 2 },
  sectionTitle: { fontSize: 20, fontFamily: FONTS.extraBold, paddingHorizontal: 20, marginBottom: 12 },
  poster: { width: 108, aspectRatio: 2 / 3, borderRadius: 4, backgroundColor: '#e5e5e5' },
  posterEmpty: { alignItems: 'center', justifyContent: 'center' },
  locked: { alignItems: 'center', padding: 40, gap: 8 },
  lockedText: { fontSize: 18, fontFamily: FONTS.bold, marginTop: 8 },
  lockedSub: { fontFamily: FONTS.regular, fontSize: 15, color: COLORS.textMuted },
});
