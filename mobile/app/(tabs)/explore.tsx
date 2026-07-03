import React, { useState } from 'react';
import { View, Text, TextInput, ScrollView, StyleSheet, Pressable, Image, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, tmdbImage } from '@/lib/api';
import { COLORS } from '@/lib/theme';
import { EmptyState, Loading } from '@/components/ui';

type FeedItem = {
  id: string | null;
  tmdbId: string | null;
  tvdbId: string | null;
  type: 'show' | 'movie';
  title: string;
  year: number | null;
  posterPath: string | null;
  backdropPath: string | null;
  overview: string | null;
  inLibrary: boolean;
};

const PASTELS = ['#F5EFDC', '#DDE7EE', '#EFE0E0', '#E3EEDD'];

export default function ExploreScreen() {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const { data, isLoading } = useQuery({
    queryKey: ['explore', 'feed'],
    queryFn: () => api.get<{ feed: FeedItem[] }>('/api/explore/feed'),
    staleTime: 30 * 60_000,
  });
  const search = useQuery({
    queryKey: ['search', query],
    queryFn: () => api.get<{ results: FeedItem[] }>(`/api/search?q=${encodeURIComponent(query)}&type=media`),
    enabled: query.trim().length > 1,
  });

  const searching = query.trim().length > 1;

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.white, paddingTop: insets.top }}>
      <View style={styles.searchbar}>
        <Feather name="search" size={24} color={searching ? COLORS.black : COLORS.textMuted} />
        <TextInput
          style={styles.input}
          placeholder="Rechercher"
          placeholderTextColor={COLORS.textMuted}
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
        />
        {query ? (
          <Pressable onPress={() => setQuery('')}>
            <Feather name="x" size={20} color={COLORS.textMuted} />
          </Pressable>
        ) : null}
      </View>

      {searching ? (
        <SearchResults results={search.data?.results} loading={search.isLoading} query={query} />
      ) : (
        <Feed items={data?.feed} loading={isLoading} />
      )}
    </View>
  );
}

function Feed({ items, loading }: { items?: FeedItem[]; loading: boolean }) {
  const router = useRouter();
  if (loading) return <Loading />;
  if (!items || items.length === 0)
    return (
      <EmptyState
        title="Pas encore de recommandations"
        message="Configurez une clé TMDb sur le serveur et suivez des séries pour alimenter votre flux."
      />
    );
  return (
    <ScrollView contentContainerStyle={{ paddingVertical: 8, paddingBottom: 24 }}>
      {items.map((f, i) => (
        <View key={`${f.type}-${f.tmdbId}`} style={styles.hero}>
          <View style={styles.heroImg}>
            <View style={styles.plus}>
              <Feather name="plus" size={26} color={COLORS.yellow} />
            </View>
            {f.type === 'movie' ? (
              <View style={styles.play}>
                <View style={styles.playRing}>
                  <Feather name="play" size={22} color="#fff" />
                </View>
              </View>
            ) : null}
            <View style={styles.heroCap}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Feather name={f.type === 'show' ? 'tv' : 'film'} size={22} color="#fff" />
                <Text style={styles.heroTitle}>{f.title}</Text>
              </View>
              <Text style={styles.heroMeta}>{f.year ?? ''}</Text>
            </View>
          </View>
          {f.overview ? (
            <Text style={[styles.heroDesc, { backgroundColor: PASTELS[i % PASTELS.length] }]} numberOfLines={2}>
              {f.overview}
            </Text>
          ) : null}
        </View>
      ))}
    </ScrollView>
  );
}

function SearchResults({ results, loading, query }: { results?: FeedItem[]; loading: boolean; query: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [addingKey, setAddingKey] = useState<string | null>(null);

  // Ouvre un résultat : local -> détail direct ; externe (TheTVDB/TMDb) -> ajout puis détail.
  const open = async (r: FeedItem, key: string) => {
    if (r.id) {
      router.push(`/show/${r.id}${r.type === 'movie' ? '?type=movie' : ''}`);
      return;
    }
    if (addingKey) return;
    setAddingKey(key);
    try {
      let mediaId: string | null = null;
      if (r.tvdbId) {
        const res = await api.post<{ mediaId: string }>('/api/shows/add-from-tvdb', { tvdbId: r.tvdbId });
        mediaId = res.mediaId;
      } else if (r.tmdbId && r.type === 'show') {
        const res = await api.post<{ mediaId: string }>('/api/shows/add-from-tmdb', { tmdbId: r.tmdbId });
        mediaId = res.mediaId;
      } else if (r.tmdbId && r.type === 'movie') {
        const res = await api.post<{ mediaId: string }>('/api/movies/add-from-tmdb', { tmdbId: r.tmdbId });
        mediaId = res.mediaId;
      }
      if (mediaId) {
        queryClient.invalidateQueries({ queryKey: ['shows'] });
        queryClient.invalidateQueries({ queryKey: ['movies'] });
        router.push(`/show/${mediaId}${r.type === 'movie' ? '?type=movie' : ''}`);
      }
    } finally {
      setAddingKey(null);
    }
  };

  if (loading) return <Loading />;
  if (!results || results.length === 0)
    return <EmptyState title="Toutes nos excuses" message={`Nous n'avons trouvé aucun résultat pour « ${query} »`} />;
  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
      {results.map((r) => {
        const key = `${r.type}-${r.id ?? r.tvdbId ?? r.tmdbId}`;
        const poster = tmdbImage(r.posterPath, 'w185');
        return (
          <Pressable key={key} style={styles.resultRow} onPress={() => open(r, key)}>
            {poster ? (
              <Image source={{ uri: poster }} style={styles.resultPoster} resizeMode="cover" />
            ) : (
              <View style={styles.resultPoster}>
                <Feather name="image" size={18} color="#b4b4b4" />
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={styles.resultTitle} numberOfLines={1}>
                {r.title}
              </Text>
              <Text style={styles.resultMeta}>
                {[r.type === 'show' ? 'Série' : 'Film', r.year].filter(Boolean).join(' · ')}
              </Text>
            </View>
            {addingKey === key ? (
              <ActivityIndicator color={COLORS.black} />
            ) : r.inLibrary ? (
              <Text style={styles.followed}>SUIVI</Text>
            ) : r.id ? null : (
              <Feather name="plus" size={22} color={COLORS.black} />
            )}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  searchbar: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, height: 70 },
  input: { flex: 1, fontSize: 19, borderBottomWidth: 1, borderBottomColor: COLORS.border, paddingVertical: 8 },
  hero: { marginHorizontal: 20, marginBottom: 24, borderRadius: 5, overflow: 'hidden', ...{ elevation: 3 } },
  heroImg: { aspectRatio: 16 / 11, backgroundColor: '#26262e', justifyContent: 'flex-end' },
  plus: { position: 'absolute', right: 16, top: 16, width: 46, height: 46, borderRadius: 10, borderWidth: 2.5, borderColor: COLORS.yellow, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.25)' },
  play: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  playRing: { width: 58, height: 58, borderRadius: 29, borderWidth: 3, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  heroCap: { padding: 14 },
  heroTitle: { color: '#fff', fontSize: 22, fontWeight: '800', flexShrink: 1 },
  heroMeta: { color: 'rgba(255,255,255,0.9)', fontSize: 14, marginTop: 2 },
  heroDesc: { padding: 16, fontSize: 16, lineHeight: 22 },
  resultRow: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 20, paddingVertical: 8 },
  resultPoster: { width: 52, aspectRatio: 2 / 3, borderRadius: 3, backgroundColor: '#e5e5e5', alignItems: 'center', justifyContent: 'center' },
  resultTitle: { fontSize: 18, fontWeight: '700' },
  resultMeta: { fontSize: 14, color: COLORS.textMuted, marginTop: 2 },
  followed: { fontSize: 11, fontWeight: '800', color: COLORS.textMuted },
});
