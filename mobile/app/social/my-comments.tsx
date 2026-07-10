import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Image } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { api, tmdbImage } from '@/lib/api';
import { COLORS, FONTS } from '@/lib/theme';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState, Loading, LoadError } from '@/components/ui';

type MyComment = {
  id: string;
  body: string;
  createdAt: string;
  media: { id: string; type: 'show' | 'movie'; title: string; posterPath: string | null };
};

// Liste de mes commentaires — ouverte depuis le compteur « commentaires » du profil.
export default function MyCommentsScreen() {
  const router = useRouter();
  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['social', 'my-comments'],
    queryFn: () => api.get<{ comments: MyComment[] }>('/api/social/comments'),
  });

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.white }}>
      <PageHeader title="Mes commentaires" />
      {isLoading ? (
        <Loading />
      ) : isError && !data ? (
        <LoadError onRetry={refetch} busy={isRefetching} />
      ) : !data || data.comments.length === 0 ? (
        <EmptyState title="Aucun commentaire" message="Tes commentaires sur les séries et films apparaîtront ici." />
      ) : (
        <ScrollView contentContainerStyle={{ paddingVertical: 6 }}>
          {data.comments.map((c) => (
            <Pressable
              key={c.id}
              style={styles.row}
              onPress={() => router.push(`/show/${c.media.id}${c.media.type === 'movie' ? '?type=movie' : ''}`)}
            >
              {c.media.posterPath ? (
                <Image source={{ uri: tmdbImage(c.media.posterPath, 'w185') ?? '' }} style={styles.poster} resizeMode="cover" />
              ) : (
                <View style={[styles.poster, styles.posterEmpty]}>
                  <Feather name={c.media.type === 'movie' ? 'film' : 'tv'} size={18} color="#b4b4b4" />
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.title} numberOfLines={1}>{c.media.title}</Text>
                <Text style={styles.body} numberOfLines={3}>{c.body}</Text>
              </View>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 14, paddingHorizontal: 20, paddingVertical: 12, alignItems: 'flex-start' },
  poster: { width: 54, aspectRatio: 2 / 3, borderRadius: 6, backgroundColor: '#e5e5e5' },
  posterEmpty: { alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 16, fontFamily: FONTS.bold, marginBottom: 4 },
  body: { fontFamily: FONTS.regular, fontSize: 14, color: COLORS.textMuted, lineHeight: 20 },
});
