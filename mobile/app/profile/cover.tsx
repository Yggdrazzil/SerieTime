import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Image, TextInput, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api, tmdbImage } from '@/lib/api';
import { useDebounced } from '@/lib/useDebounced';
import { useAppStore } from '@/lib/store';
import { COLORS } from '@/lib/theme';
import { EmptyState, Loading } from '@/components/ui';

type Result = {
  id: string | null;
  tmdbId: string | null;
  tvdbId: string | null;
  type: 'show' | 'movie';
  title: string;
  year: number | null;
  posterPath: string | null;
};
type Picked = { title: string; type: 'show' | 'movie' };

export default function CoverPicker() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const setCoverPick = useAppStore((s) => s.setCoverPick);

  const [query, setQuery] = useState('');
  const dq = useDebounced(query.trim(), 300);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [mediaId, setMediaId] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);

  const search = useQuery({
    queryKey: ['cover-search', dq],
    queryFn: () => api.get<{ results: Result[] }>(`/api/search?q=${encodeURIComponent(dq)}&type=media`),
    enabled: dq.length > 1 && !picked,
    placeholderData: keepPreviousData,
  });

  const banners = useQuery({
    queryKey: ['cover-banners', mediaId, picked?.type],
    queryFn: () =>
      api.get<{ backdrops: string[] }>(`/api/${picked?.type === 'movie' ? 'movies' : 'shows'}/${mediaId}/images`),
    enabled: !!mediaId && !!picked,
  });

  // Résout l'id local de l'œuvre (crée la fiche sans la suivre) puis charge ses bannières.
  const openBanners = async (r: Result) => {
    if (resolving) return;
    setResolving(true);
    try {
      let id = r.id;
      if (!id) {
        const path = r.tvdbId ? '/api/shows/add-from-tvdb' : r.type === 'movie' ? '/api/movies/add-from-tmdb' : '/api/shows/add-from-tmdb';
        const body = r.tvdbId ? { tvdbId: r.tvdbId, follow: false } : { tmdbId: r.tmdbId, follow: false };
        const res = await api.post<{ mediaId: string }>(path, body);
        id = res.mediaId;
      }
      setMediaId(id);
      setPicked({ title: r.title, type: r.type });
    } finally {
      setResolving(false);
    }
  };

  const choose = (uri: string) => {
    setCoverPick(uri);
    router.back();
  };

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.white, paddingTop: insets.top }}>
      <View style={styles.header}>
        <Pressable
          onPress={() => (picked ? (setPicked(null), setMediaId(null)) : router.back())}
          hitSlop={12}
        >
          <Feather name="chevron-left" size={28} color={COLORS.black} />
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>
          {picked ? picked.title : 'Choisir une couverture'}
        </Text>
        <View style={{ width: 28 }} />
      </View>

      {picked ? (
        banners.isLoading || resolving ? (
          <Loading />
        ) : (banners.data?.backdrops.length ?? 0) === 0 ? (
          <EmptyState title="Aucune bannière" message={`« ${picked.title} » n’a pas de bannière disponible.`} />
        ) : (
          <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}>
            {banners.data!.backdrops.map((uri) => (
              <Pressable key={uri} style={styles.bannerWrap} onPress={() => choose(uri)}>
                <Image source={{ uri: tmdbImage(uri, 'w500') ?? uri }} style={styles.banner} resizeMode="cover" />
              </Pressable>
            ))}
          </ScrollView>
        )
      ) : (
        <>
          <View style={styles.searchbar}>
            <Feather name="search" size={22} color={COLORS.textMuted} />
            <TextInput
              style={styles.input}
              placeholder="Rechercher des séries et films"
              placeholderTextColor={COLORS.textMuted}
              value={query}
              onChangeText={setQuery}
              autoCapitalize="none"
              autoFocus
            />
          </View>
          {resolving ? <Loading /> : null}
          {dq.length <= 1 ? (
            <EmptyState title="Cherchez une œuvre" message="Sa bannière deviendra votre photo de couverture." />
          ) : search.isLoading ? (
            <Loading />
          ) : (search.data?.results.length ?? 0) === 0 ? (
            <EmptyState title="Aucun résultat" message={`Rien trouvé pour « ${query.trim()} ».`} />
          ) : (
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 24 }}>
              {search.data!.results.map((r) => {
                const poster = tmdbImage(r.posterPath, 'w185');
                return (
                  <Pressable key={`${r.type}-${r.id ?? r.tvdbId ?? r.tmdbId}`} style={styles.row} onPress={() => openBanners(r)}>
                    {poster ? (
                      <Image source={{ uri: poster }} style={styles.poster} resizeMode="cover" />
                    ) : (
                      <View style={[styles.poster, styles.posterEmpty]}>
                        <Feather name="image" size={18} color="#b4b4b4" />
                      </View>
                    )}
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {r.title}
                    </Text>
                    <Feather name="chevron-right" size={22} color={COLORS.textMuted} />
                  </Pressable>
                );
              })}
            </ScrollView>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, height: 52 },
  title: { fontSize: 18, fontWeight: '800', flex: 1, textAlign: 'center' },
  searchbar: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, height: 60 },
  input: { flex: 1, fontSize: 17, borderBottomWidth: 1, borderBottomColor: COLORS.border, paddingVertical: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 20, paddingVertical: 8 },
  poster: { width: 52, aspectRatio: 2 / 3, borderRadius: 4, backgroundColor: '#e5e5e5' },
  posterEmpty: { alignItems: 'center', justifyContent: 'center' },
  rowTitle: { flex: 1, fontSize: 18, fontWeight: '700' },
  bannerWrap: { width: '100%', aspectRatio: 16 / 9, borderRadius: 8, overflow: 'hidden', backgroundColor: '#e5e5e5' },
  banner: { width: '100%', height: '100%' },
});
