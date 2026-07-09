import React, { useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Image } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, tmdbImage } from '@/lib/api';
import { COLORS, FONTS } from '@/lib/theme';
import { EmptyState, Loading, LoadError } from '@/components/ui';
import { AppearItem } from '@/components/anim';

type Notif = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  imageUrl: string | null;
  date: string;
  isRead: boolean;
  meta: { actorId?: string; mediaId?: string; mediaType?: 'show' | 'movie'; commentId?: string };
};

const ICON: Record<string, keyof typeof Feather.glyphMap> = {
  friend_comment: 'message-circle',
  comment_reply: 'corner-up-left',
  comment_reaction: 'heart',
  friend_favorite: 'star',
};

export default function Notifications() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get<{ notifications: Notif[]; unreadCount: number }>('/api/notifications'),
  });

  // Marque tout comme lu à l'ouverture, puis rafraîchit le badge.
  useEffect(() => {
    if (!data || data.unreadCount === 0) return;
    api.post('/api/notifications/read', {}).then(() => {
      qc.invalidateQueries({ queryKey: ['notifications', 'unread'] });
    });
  }, [data, qc]);

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.white, paddingTop: insets.top }}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Feather name="chevron-left" size={28} color={COLORS.black} />
        </Pressable>
        <Text style={styles.title}>Notifications</Text>
        <View style={{ width: 28 }} />
      </View>

      {isLoading ? (
        <Loading />
      ) : isError && !data ? (
        <LoadError onRetry={refetch} busy={isRefetching} />
      ) : (data?.notifications.length ?? 0) === 0 ? (
        <EmptyState title="Aucune notification" message="L’activité de vos amis apparaîtra ici." />
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
          {data!.notifications.map((n, i) => {
            const poster = tmdbImage(n.imageUrl, 'w185');
            return (
              <AppearItem key={n.id} index={i}>
              <Pressable
                style={[styles.row, !n.isRead && styles.unread]}
                onPress={() =>
                  n.meta.mediaId &&
                  router.push(`/show/${n.meta.mediaId}${n.meta.mediaType === 'movie' ? '?type=movie' : ''}`)
                }
              >
                <View style={styles.iconWrap}>
                  <Feather name={ICON[n.type] ?? 'bell'} size={20} color={COLORS.black} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>{n.title}</Text>
                  {n.body ? (
                    <Text style={styles.rowBody} numberOfLines={2}>
                      {n.body}
                    </Text>
                  ) : null}
                </View>
                {poster ? <Image source={{ uri: poster }} style={styles.poster} resizeMode="cover" /> : null}
              </Pressable>
              </AppearItem>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, height: 52 },
  title: { fontSize: 20, fontFamily: FONTS.extraBold },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: COLORS.borderLight },
  unread: { backgroundColor: COLORS.yellowSoft },
  iconWrap: { width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.chipGrey, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontSize: 15, fontFamily: FONTS.bold, lineHeight: 20 },
  rowBody: { fontFamily: FONTS.regular, fontSize: 14, color: COLORS.textMuted, marginTop: 2 },
  poster: { width: 40, aspectRatio: 2 / 3, borderRadius: 3, backgroundColor: '#e5e5e5' },
});
