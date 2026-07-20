import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Image, TextInput } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { goBack } from '@/lib/nav';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api, tmdbImage } from '@/lib/api';
import { useDebounced } from '@/lib/useDebounced';
import { useAppStore } from '@/lib/store';
import { COLORS, FONTS, RADIUS, SIZES, SPACE } from '@/lib/theme';
import { EmptyState, Loading } from '@/components/ui';
import { AppearItem } from '@/components/anim';
import { ScreenShell, ScreenHeader, IconAction } from '@/components/prisme';

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
    goBack('/profile/edit');
  };

  const onHeaderBack = () => (picked ? (setPicked(null), setMediaId(null)) : goBack('/profile/edit'));

  return (
    <ScreenShell contentContainerStyle={styles.content}>
      <ScreenHeader
        title={picked ? picked.title : 'Choisir une couverture'}
        leading={<IconAction icon="chevron-left" label="Retour" onPress={onHeaderBack} />}
      />

      {picked ? (
        banners.isLoading || resolving ? (
          <Loading />
        ) : (banners.data?.backdrops.length ?? 0) === 0 ? (
          <EmptyState title="Aucune bannière" message={`« ${picked.title} » n’a pas de bannière disponible.`} />
        ) : (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
            <View style={styles.bannerList}>
              {banners.data!.backdrops.map((uri, i) => (
                <AppearItem key={uri} index={i}>
                  <Pressable style={styles.bannerWrap} onPress={() => choose(uri)} accessibilityRole="button" accessibilityLabel="Choisir cette bannière">
                    <Image source={{ uri: tmdbImage(uri, 'w500') ?? uri }} style={styles.banner} resizeMode="cover" />
                  </Pressable>
                </AppearItem>
              ))}
            </View>
          </ScrollView>
        )
      ) : (
        <>
          <View style={styles.searchbar}>
            <Feather name="search" size={20} color={COLORS.textMuted} />
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
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
              {search.data!.results.map((r) => {
                const poster = tmdbImage(r.posterPath, 'w185');
                return (
                  <Pressable key={`${r.type}-${r.id ?? r.tvdbId ?? r.tmdbId}`} style={({ pressed }) => [styles.row, pressed && styles.rowPressed]} onPress={() => openBanners(r)}>
                    {poster ? (
                      <Image source={{ uri: poster }} style={styles.poster} resizeMode="cover" />
                    ) : (
                      <View style={[styles.poster, styles.posterEmpty]}>
                        <Feather name="image" size={18} color={COLORS.textSoft} />
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
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 0 },
  scrollContent: { paddingBottom: SPACE.xl },
  searchbar: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE.sm,
    paddingHorizontal: SPACE.md, minHeight: SIZES.touchComfortable,
    backgroundColor: COLORS.surfaceMuted, borderRadius: RADIUS.pill,
    borderWidth: 1, borderColor: COLORS.borderLight, marginBottom: SPACE.sm,
  },
  input: { color: COLORS.text, flex: 1, fontFamily: FONTS.regular, fontSize: 16, paddingVertical: 8 },
  row: { minHeight: SIZES.touch, flexDirection: 'row', alignItems: 'center', gap: SPACE.md, paddingVertical: SPACE.xs, borderRadius: RADIUS.control },
  rowPressed: { backgroundColor: COLORS.primarySoft },
  poster: { width: 46, aspectRatio: 2 / 3, borderRadius: RADIUS.small, backgroundColor: COLORS.imagePlaceholder },
  posterEmpty: { alignItems: 'center', justifyContent: 'center' },
  rowTitle: { color: COLORS.text, flex: 1, fontSize: 16, fontFamily: FONTS.bold },
  bannerList: { gap: SPACE.sm },
  bannerWrap: { width: '100%', aspectRatio: 16 / 9, borderRadius: RADIUS.card, overflow: 'hidden', backgroundColor: COLORS.imagePlaceholder },
  banner: { width: '100%', height: '100%' },
});
