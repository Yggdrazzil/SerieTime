import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Image, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, tmdbImage } from '@/lib/api';
import { COLORS, FONTS } from '@/lib/theme';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState, Loading, LoadError } from '@/components/ui';

type PublicUser = { id: string; displayName: string; avatarUrl: string | null; isFollowing?: boolean };

// Liste des abonnements (type=following) ou des abonnés (type=followers) —
// ouverte depuis les compteurs du profil.
export default function ConnectionsScreen() {
  const { type } = useLocalSearchParams<{ type?: string }>();
  const followers = type === 'followers';
  const path = followers ? '/api/social/followers' : '/api/social/following';
  const router = useRouter();
  const qc = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['social', 'connections', followers ? 'followers' : 'following'],
    queryFn: () => api.get<{ users: PublicUser[] }>(path),
  });

  const toggle = async (u: PublicUser) => {
    const currently = overrides[u.id] ?? u.isFollowing ?? false;
    setBusyId(u.id);
    try {
      if (currently) await api.del(`/api/social/follow/${u.id}`);
      else await api.post(`/api/social/follow/${u.id}`);
      setOverrides((o) => ({ ...o, [u.id]: !currently }));
      qc.invalidateQueries({ queryKey: ['social'] });
      qc.invalidateQueries({ queryKey: ['profile'] });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.white }}>
      <PageHeader title={followers ? 'Abonnés' : 'Abonnements'} />
      {isLoading ? (
        <Loading />
      ) : isError && !data ? (
        <LoadError onRetry={refetch} busy={isRefetching} />
      ) : !data || data.users.length === 0 ? (
        <EmptyState
          title={followers ? 'Aucun abonné' : 'Aucun abonnement'}
          message={followers ? "Personne ne te suit pour l'instant." : "Tu ne suis personne pour l'instant."}
        />
      ) : (
        <ScrollView contentContainerStyle={{ paddingVertical: 6 }}>
          {data.users.map((u) => {
            const following = overrides[u.id] ?? u.isFollowing ?? false;
            return (
              <View key={u.id} style={styles.row}>
                <Pressable style={styles.tap} onPress={() => router.push(`/user/${u.id}`)}>
                  {u.avatarUrl ? (
                    <Image source={{ uri: tmdbImage(u.avatarUrl, 'w185') ?? u.avatarUrl }} style={styles.avatar} resizeMode="cover" />
                  ) : (
                    <View style={[styles.avatar, styles.avatarEmpty]}>
                      <Text style={styles.avatarInit}>{u.displayName.slice(0, 1).toUpperCase()}</Text>
                    </View>
                  )}
                  <Text style={styles.name} numberOfLines={1}>{u.displayName}</Text>
                </Pressable>
                <Pressable style={[styles.btn, following && styles.btnOn]} onPress={() => toggle(u)} disabled={busyId === u.id}>
                  {busyId === u.id ? (
                    <ActivityIndicator color={following ? COLORS.black : '#fff'} size="small" />
                  ) : (
                    <Text style={[styles.btnText, following && styles.btnTextOn]}>{following ? 'ABONNÉ' : 'SUIVRE'}</Text>
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
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingVertical: 10 },
  tap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 14 },
  avatar: { width: 46, height: 46, borderRadius: 23, backgroundColor: '#20202a' },
  avatarEmpty: { alignItems: 'center', justifyContent: 'center' },
  avatarInit: { color: '#fff', fontSize: 18, fontFamily: FONTS.extraBold },
  name: { flex: 1, fontSize: 18, fontFamily: FONTS.bold },
  btn: { minWidth: 96, paddingHorizontal: 16, paddingVertical: 9, borderRadius: 999, backgroundColor: COLORS.black, alignItems: 'center' },
  btnOn: { backgroundColor: COLORS.chipGrey },
  btnText: { color: '#fff', fontFamily: FONTS.extraBold, fontSize: 13, letterSpacing: 0.4 },
  btnTextOn: { color: COLORS.black },
});
