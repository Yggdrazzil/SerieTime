import React, { useState } from 'react';
import { View, Text, TextInput, ScrollView, StyleSheet, Pressable, Image, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, tmdbImage } from '@/lib/api';
import { useDebounced } from '@/lib/useDebounced';
import { COLORS } from '@/lib/theme';
import { EmptyState, Loading } from '@/components/ui';

type PublicUser = { id: string; displayName: string; avatarUrl: string | null; isFollowing?: boolean };
type FeedItem = {
  kind: 'watch' | 'comment';
  id: string;
  date: string;
  eventType: string;
  user: PublicUser;
  media: { id: string; title: string; posterPath: string | null; type: string };
  episode: { seasonNumber: number; episodeNumber: number; title: string } | null;
  body?: string;
};

function actionText(item: FeedItem): string {
  if (item.kind === 'comment') return 'a commenté';
  if (item.eventType === 'favorited') return 'a ajouté aux favoris';
  if (item.eventType === 'added_to_watchlist') return 'a ajouté à sa liste';
  if (item.episode) return `a regardé S${item.episode.seasonNumber}E${item.episode.episodeNumber}`;
  return 'a regardé';
}

export default function Social() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [tab, setTab] = useState<'feed' | 'friends'>('feed');

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.white, paddingTop: insets.top }}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Feather name="chevron-left" size={28} color={COLORS.black} />
        </Pressable>
        <Text style={styles.title}>Amis</Text>
        <View style={{ width: 28 }} />
      </View>

      <View style={styles.tabs}>
        <Tab label="Fil d’actualité" active={tab === 'feed'} onPress={() => setTab('feed')} />
        <Tab label="Trouver des amis" active={tab === 'friends'} onPress={() => setTab('friends')} />
      </View>

      {tab === 'feed' ? <FeedTab /> : <FriendsTab />}
    </View>
  );
}

function Tab({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.tab, active && styles.tabActive]} onPress={onPress}>
      <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
    </Pressable>
  );
}

function FeedTab() {
  const router = useRouter();
  const { data, isLoading } = useQuery({
    queryKey: ['social', 'feed'],
    queryFn: () => api.get<{ items: FeedItem[] }>('/api/social/feed'),
  });
  if (isLoading) return <Loading />;
  const items = data?.items ?? [];
  if (items.length === 0)
    return (
      <EmptyState
        title="Pas encore d’activité"
        message="Abonnez-vous à des amis depuis « Trouver des amis » pour voir ce qu’ils regardent."
      />
    );
  return (
    <ScrollView contentContainerStyle={{ paddingVertical: 8, paddingBottom: 24 }}>
      {items.map((it) => {
        const poster = tmdbImage(it.media.posterPath, 'w185');
        return (
          <Pressable
            key={`${it.kind}-${it.id}`}
            style={styles.feedRow}
            onPress={() => router.push(`/show/${it.media.id}${it.media.type === 'movie' ? '?type=movie' : ''}`)}
          >
            <Pressable style={styles.avatar} onPress={() => router.push(`/user/${it.user.id}`)}>
              <Text style={styles.avatarInit}>{it.user.displayName.slice(0, 1).toUpperCase()}</Text>
            </Pressable>
            <View style={{ flex: 1 }}>
              <Text style={styles.feedText}>
                <Text style={styles.feedName}>{it.user.displayName}</Text> {actionText(it)}{' '}
                <Text style={styles.feedMedia}>{it.media.title}</Text>
              </Text>
              {it.kind === 'comment' && it.body ? (
                <Text style={styles.feedComment} numberOfLines={3}>
                  « {it.body} »
                </Text>
              ) : it.episode ? (
                <Text style={styles.feedSub} numberOfLines={1}>
                  {it.episode.title}
                </Text>
              ) : null}
            </View>
            {poster ? (
              <Image source={{ uri: poster }} style={styles.poster} resizeMode="cover" />
            ) : (
              <View style={styles.poster}>
                <Feather name="image" size={16} color="#b4b4b4" />
              </View>
            )}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function FriendsTab() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [q, setQ] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});

  const dq = useDebounced(q.trim(), 300);
  const search = useQuery({
    queryKey: ['users', 'search', dq],
    queryFn: () => api.get<{ users: PublicUser[] }>(`/api/users/search?q=${encodeURIComponent(dq)}`),
    enabled: dq.length > 1,
    placeholderData: keepPreviousData,
  });

  const toggle = async (u: PublicUser) => {
    const currently = overrides[u.id] ?? u.isFollowing ?? false;
    setBusyId(u.id);
    try {
      if (currently) await api.del(`/api/social/follow/${u.id}`);
      else await api.post(`/api/social/follow/${u.id}`);
      setOverrides((o) => ({ ...o, [u.id]: !currently }));
      queryClient.invalidateQueries({ queryKey: ['social', 'feed'] });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.searchbar}>
        <Feather name="search" size={22} color={COLORS.textMuted} />
        <TextInput
          style={styles.input}
          placeholder="Rechercher un utilisateur"
          placeholderTextColor={COLORS.textMuted}
          value={q}
          onChangeText={setQ}
          autoCapitalize="none"
        />
        {q ? (
          <Pressable onPress={() => setQ('')}>
            <Feather name="x" size={20} color={COLORS.textMuted} />
          </Pressable>
        ) : null}
      </View>

      {q.trim().length <= 1 ? (
        <EmptyState title="Trouvez vos amis" message="Cherchez par nom pour vous abonner et suivre leur activité." />
      ) : search.isLoading ? (
        <Loading />
      ) : (search.data?.users.length ?? 0) === 0 ? (
        <EmptyState title="Aucun utilisateur" message={`Rien trouvé pour « ${q} ».`} />
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
          {search.data!.users.map((u) => {
            const following = overrides[u.id] ?? u.isFollowing ?? false;
            return (
              <View key={u.id} style={styles.userRow}>
                <Pressable
                  style={styles.userTap}
                  onPress={() => router.push(`/user/${u.id}`)}
                >
                  <View style={styles.avatar}>
                    <Text style={styles.avatarInit}>{u.displayName.slice(0, 1).toUpperCase()}</Text>
                  </View>
                  <Text style={styles.userName} numberOfLines={1}>
                    {u.displayName}
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.followBtn, following && styles.followingBtn]}
                  onPress={() => toggle(u)}
                  disabled={busyId === u.id}
                >
                  {busyId === u.id ? (
                    <ActivityIndicator color={following ? COLORS.black : '#fff'} />
                  ) : (
                    <Text style={[styles.followText, following && styles.followingText]}>
                      {following ? 'ABONNÉ' : 'SUIVRE'}
                    </Text>
                  )}
                </Pressable>
              </View>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, height: 52 },
  title: { fontSize: 20, fontWeight: '800' },
  tabs: { flexDirection: 'row', paddingHorizontal: 16, gap: 8, marginBottom: 4 },
  tab: { flex: 1, paddingVertical: 10, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: COLORS.yellow },
  tabText: { fontSize: 15, fontWeight: '700', color: COLORS.textMuted },
  tabTextActive: { color: COLORS.black },
  feedRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingVertical: 12 },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#20202a', alignItems: 'center', justifyContent: 'center' },
  avatarInit: { color: '#fff', fontSize: 18, fontWeight: '800' },
  feedText: { fontSize: 15, lineHeight: 21, color: COLORS.black },
  feedName: { fontWeight: '800' },
  feedMedia: { fontWeight: '700', color: COLORS.blue },
  feedSub: { fontSize: 13, color: COLORS.textMuted, marginTop: 2 },
  feedComment: { fontSize: 14, color: COLORS.text, marginTop: 4, fontStyle: 'italic' },
  poster: { width: 40, aspectRatio: 2 / 3, borderRadius: 3, backgroundColor: '#e5e5e5', alignItems: 'center', justifyContent: 'center' },
  searchbar: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, height: 62 },
  input: { flex: 1, fontSize: 17, borderBottomWidth: 1, borderBottomColor: COLORS.border, paddingVertical: 8 },
  userRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingVertical: 10 },
  userTap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 14 },
  userName: { flex: 1, fontSize: 17, fontWeight: '700' },
  followBtn: { minWidth: 96, paddingHorizontal: 16, paddingVertical: 9, borderRadius: 999, backgroundColor: COLORS.black, alignItems: 'center' },
  followingBtn: { backgroundColor: COLORS.chipGrey },
  followText: { color: '#fff', fontWeight: '800', fontSize: 13, letterSpacing: 0.4 },
  followingText: { color: COLORS.black },
});
