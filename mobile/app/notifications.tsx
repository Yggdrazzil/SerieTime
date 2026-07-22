import React, { useEffect, useRef, useState } from 'react';
import { FlatList, Image, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter, type Href } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, tmdbImage } from '@/lib/api';
import { COLORS, FONTS, RADIUS, SIZES, SPACE } from '@/lib/theme';
import { EmptyState, Loading, LoadError } from '@/components/ui';
import { PageHeader } from '@/components/PageHeader';
import { AppearItem } from '@/components/anim';

type NotificationMediaType = 'show' | 'movie' | 'game';
type NotificationItem = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  imageUrl: string | null;
  date: string;
  isRead: boolean;
  meta: { actorId?: string; mediaId?: string; mediaType?: NotificationMediaType; commentId?: string };
};
type NotificationsPayload = { notifications: NotificationItem[]; unreadCount: number };

const ICON: Record<string, keyof typeof Feather.glyphMap> = {
  friend_comment: 'message-circle',
  comment_reply: 'corner-up-left',
  comment_reaction: 'heart',
  friend_favorite: 'star',
  level_up: 'trending-up',
  badge_unlocked: 'award',
  challenge_completed: 'check-circle',
};

function notificationDestination(notification: NotificationItem): Href | null {
  const { mediaId, mediaType, actorId } = notification.meta;
  if (mediaId) {
    if (mediaType === 'game') return ('/game/' + mediaId) as Href;
    return ('/show/' + mediaId + (mediaType === 'movie' ? '?type=movie' : '')) as Href;
  }
  if (notification.type === 'badge_unlocked') return '/stats/badges' as Href;
  if (notification.type === 'level_up' || notification.type === 'challenge_completed') return '/stats' as Href;
  if (actorId) return ('/user/' + actorId) as Href;
  return null;
}

function categoryLabel(type: string) {
  if (type === 'badge_unlocked') return 'BADGE';
  if (type === 'level_up') return 'NIVEAU';
  if (type === 'challenge_completed') return 'DÉFI';
  if (type === 'friend_favorite') return 'FAVORI';
  return 'SOCIAL';
}

function dateLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}

export default function NotificationsScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const markingRef = useRef(false);
  const [readError, setReadError] = useState(false);
  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get<NotificationsPayload>('/api/notifications'),
  });

  useEffect(() => {
    if (!data || data.unreadCount === 0 || markingRef.current) return;
    markingRef.current = true;
    setReadError(false);
    api.post('/api/notifications/read', {})
      .then(() => {
        qc.setQueryData<NotificationsPayload>(['notifications'], (current) =>
          current
            ? {
                unreadCount: 0,
                notifications: current.notifications.map((notification) => ({ ...notification, isRead: true })),
              }
            : current,
        );
        return qc.invalidateQueries({ queryKey: ['notifications', 'unread'] });
      })
      .catch(() => {
        setReadError(true);
        markingRef.current = false;
      });
  }, [data, qc]);

  return (
    <View style={styles.screen}>
      <PageHeader title="Notifications" />
      <View style={styles.canvas}>
        {isLoading ? (
          <Loading />
        ) : isError && !data ? (
          <LoadError onRetry={refetch} busy={isRefetching} />
        ) : (
          <FlatList
            data={data?.notifications ?? []}
            keyExtractor={(notification) => notification.id}
            showsVerticalScrollIndicator={false}
            refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={COLORS.primary} />}
            contentContainerStyle={styles.list}
            ListHeaderComponent={
              readError ? (
                <View style={styles.errorBanner} accessibilityRole="alert">
                  <Feather name="alert-circle" size={16} color={COLORS.danger} />
                  <Text style={styles.errorText}>La lecture n'a pas pu être synchronisée. Tire pour réessayer.</Text>
                </View>
              ) : null
            }
            ListEmptyComponent={
              <EmptyState title="Aucune notification" message="L'activité de tes amis et tes nouveaux succès apparaîtront ici." />
            }
            renderItem={({ item: notification, index }) => {
              const poster = tmdbImage(notification.imageUrl, 'w185');
              const destination = notificationDestination(notification);
              return (
                <AppearItem index={index}>
                  <Pressable
                    style={({ pressed }) => [
                      styles.card,
                      !notification.isRead && styles.cardUnread,
                      pressed && destination && styles.pressed,
                    ]}
                    onPress={() => destination && router.push(destination)}
                    disabled={!destination}
                    accessibilityRole={destination ? 'button' : undefined}
                    accessibilityLabel={destination ? notification.title : undefined}
                    accessibilityHint={destination ? 'Ouvre le contenu associé' : undefined}
                  >
                    <View style={[styles.iconWrap, !notification.isRead && styles.iconWrapUnread]}>
                      <Feather
                        name={ICON[notification.type] ?? 'bell'}
                        size={20}
                        color={!notification.isRead ? COLORS.primary : COLORS.textMuted}
                      />
                    </View>
                    <View style={styles.copy}>
                      <View style={styles.metaRow}>
                        <View style={styles.categoryPill}>
                          <Text style={styles.categoryText}>{categoryLabel(notification.type)}</Text>
                        </View>
                        <Text style={styles.date}>{dateLabel(notification.date)}</Text>
                      </View>
                      <Text style={styles.title}>{notification.title}</Text>
                      {notification.body ? (
                        <Text style={styles.body} numberOfLines={3}>{notification.body}</Text>
                      ) : null}
                      {destination ? (
                        <View style={styles.openRow}>
                          <Text style={styles.openText}>Voir le détail</Text>
                          <Feather name="arrow-up-right" size={15} color={COLORS.primary} />
                        </View>
                      ) : null}
                    </View>
                    {poster ? (
                      <View style={styles.poster}>
                        <Image source={{ uri: poster }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                      </View>
                    ) : null}
                    {!notification.isRead ? <View style={styles.sideMark} /> : null}
                  </Pressable>
                </AppearItem>
              );
            }}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.pageMuted },
  canvas: { flex: 1, width: '100%', maxWidth: SIZES.contentMax, alignSelf: 'center' },
  list: { flexGrow: 1, paddingHorizontal: SPACE.md, paddingTop: SPACE.md, paddingBottom: SPACE.xl, gap: SPACE.sm },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.xs,
    marginBottom: SPACE.xxs,
    padding: SPACE.sm,
    backgroundColor: COLORS.surfaceMuted,
    borderRadius: RADIUS.control,
  },
  errorText: { flex: 1, color: COLORS.danger, fontSize: 12, lineHeight: 17, fontFamily: FONTS.bold },
  card: {
    position: 'relative',
    minHeight: 116,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACE.sm,
    overflow: 'hidden',
    padding: SPACE.md,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: RADIUS.card,
  },
  cardUnread: { borderColor: COLORS.primary, backgroundColor: COLORS.primarySoft },
  pressed: { opacity: 0.82 },
  iconWrap: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.surfaceMuted,
    borderRadius: 21,
  },
  iconWrapUnread: { backgroundColor: COLORS.surface },
  copy: { minWidth: 0, flex: 1 },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SPACE.xs },
  categoryPill: { paddingHorizontal: 8, paddingVertical: 3, backgroundColor: COLORS.surfaceMuted, borderRadius: RADIUS.pill },
  categoryText: { color: COLORS.primary, fontSize: 9, lineHeight: 12, fontFamily: FONTS.extraBold, letterSpacing: 0.65 },
  date: { flexShrink: 1, color: COLORS.textSoft, fontSize: 11, lineHeight: 15, fontFamily: FONTS.regular, textAlign: 'right' },
  title: { marginTop: 6, color: COLORS.text, fontSize: 15, lineHeight: 20, fontFamily: FONTS.extraBold },
  body: { marginTop: 3, color: COLORS.textMuted, fontSize: 13, lineHeight: 19, fontFamily: FONTS.regular },
  openRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: SPACE.xs },
  openText: { color: COLORS.primary, fontSize: 12, lineHeight: 16, fontFamily: FONTS.bold },
  poster: {
    width: 48,
    aspectRatio: 2 / 3,
    overflow: 'hidden',
    backgroundColor: COLORS.imagePlaceholder,
    borderRadius: RADIUS.small,
  },
  sideMark: { position: 'absolute', left: 0, top: 18, bottom: 18, width: 4, backgroundColor: COLORS.primary, borderRadius: 4 },
});
