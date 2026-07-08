import React, { useState } from 'react';
import { View, Text, TextInput, ScrollView, StyleSheet, Pressable, Image, ActivityIndicator, Keyboard, RefreshControl } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, tmdbImage } from '@/lib/api';
import { useDebounced } from '@/lib/useDebounced';
import { COLORS, FONTS } from '@/lib/theme';
import { EmptyState, Loading } from '@/components/ui';

type FeedItem = {
  id: string | null;
  tmdbId: string | null;
  tvdbId: string | null;
  type: 'show' | 'movie';
  category?: 'serie' | 'film' | 'anime';
  title: string;
  year: number | null;
  posterPath: string | null;
  backdropPath: string | null;
  overview: string | null;
  inLibrary: boolean;
};

type FeedCategory = 'tout' | 'serie' | 'film' | 'anime';
const FEED_CATEGORIES: { key: FeedCategory; label: string }[] = [
  { key: 'tout', label: 'TOUT' },
  { key: 'serie', label: 'SÉRIES' },
  { key: 'film', label: 'FILMS' },
  { key: 'anime', label: 'ANIMÉS' },
];

type PublicUser = { id: string; displayName: string; avatarUrl: string | null; isFollowing?: boolean };

const PASTELS = ['#F5EFDC', '#DDE7EE', '#EFE0E0', '#E3EEDD'];

export default function ExploreScreen() {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<'media' | 'users'>('media');
  // Debounce : une requête quand l'utilisateur marque une pause, pas à chaque frappe.
  const debouncedQuery = useDebounced(query.trim(), 300);
  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['explore', 'feed'],
    queryFn: () => api.get<{ feed: FeedItem[] }>('/api/explore/feed'),
    staleTime: 30 * 60_000,
  });

  const searching = query.trim().length > 1;
  const cancel = () => {
    setQuery('');
    setTab('media');
    Keyboard.dismiss();
  };

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.white, paddingTop: insets.top }}>
      <View style={styles.searchbar}>
        <Feather name="search" size={24} color={searching ? COLORS.black : COLORS.textMuted} />
        <TextInput
          style={styles.input}
          placeholder="Rechercher des séries et films"
          placeholderTextColor={COLORS.textMuted}
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
        />
        {query ? (
          <Pressable onPress={cancel} hitSlop={8}>
            <Text style={styles.cancel}>Annuler</Text>
          </Pressable>
        ) : null}
      </View>

      {searching ? (
        <>
          <View style={styles.tabs}>
            <SearchTab label="SÉRIES ET FILMS" active={tab === 'media'} onPress={() => setTab('media')} />
            <SearchTab label="UTILISATEURS" active={tab === 'users'} onPress={() => setTab('users')} />
          </View>
          {tab === 'media' ? <MediaResults query={debouncedQuery} rawQuery={query} /> : <UserResults query={debouncedQuery} />}
        </>
      ) : (
        <Feed items={data?.feed} loading={isLoading} refreshing={isRefetching} onRefresh={refetch} />
      )}
    </View>
  );
}

function SearchTab({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.tab, active && styles.tabActive]} onPress={onPress}>
      <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
    </Pressable>
  );
}

// --- Résultats séries / films (façon TV Time) -------------------------------
// Taper une ligne OUVRE la fiche (sans rien ajouter) ; seul le bouton + suit
// la série (statut « Pas commencé ») ou ajoute le film à la watchlist.
function MediaResults({ query, rawQuery }: { query: string; rawQuery: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [openingKey, setOpeningKey] = useState<string | null>(null);
  const [addingKey, setAddingKey] = useState<string | null>(null);
  const [followed, setFollowed] = useState<Record<string, boolean>>({});

  const search = useQuery({
    queryKey: ['search', query],
    queryFn: () =>
      api.get<{ results: FeedItem[]; sources?: { tmdb: boolean; tvdb: boolean } }>(
        `/api/search?q=${encodeURIComponent(query)}&type=media`,
      ),
    enabled: query.length > 1,
    placeholderData: keepPreviousData, // garde les résultats affichés pendant la frappe
  });

  // Résout l'id local d'un résultat externe (sans suivre), puis ouvre la fiche.
  const open = async (r: FeedItem, key: string) => {
    if (openingKey || addingKey) return;
    if (r.id) {
      router.push(`/show/${r.id}${r.type === 'movie' ? '?type=movie' : ''}`);
      return;
    }
    setOpeningKey(key);
    try {
      const path =
        r.tvdbId ? '/api/shows/add-from-tvdb' : r.type === 'movie' ? '/api/movies/add-from-tmdb' : '/api/shows/add-from-tmdb';
      const body = r.tvdbId ? { tvdbId: r.tvdbId, follow: false } : { tmdbId: r.tmdbId, follow: false };
      const res = await api.post<{ mediaId: string }>(path, body);
      router.push(`/show/${res.mediaId}${r.type === 'movie' ? '?type=movie' : ''}`);
    } finally {
      setOpeningKey(null);
    }
  };

  // Le + : suit la série / ajoute le film, sans quitter la liste.
  const add = async (r: FeedItem, key: string) => {
    if (addingKey) return;
    setAddingKey(key);
    try {
      if (r.id) {
        await api.post(r.type === 'movie' ? `/api/movies/${r.id}/watchlist` : `/api/shows/${r.id}/follow`);
      } else if (r.tvdbId) {
        await api.post('/api/shows/add-from-tvdb', { tvdbId: r.tvdbId, follow: true });
      } else if (r.tmdbId) {
        await api.post(r.type === 'movie' ? '/api/movies/add-from-tmdb' : '/api/shows/add-from-tmdb', {
          tmdbId: r.tmdbId,
          follow: true,
        });
      }
      setFollowed((f) => ({ ...f, [key]: true }));
      queryClient.invalidateQueries({ queryKey: ['shows'] });
      queryClient.invalidateQueries({ queryKey: ['movies'] });
      queryClient.invalidateQueries({ queryKey: ['profile'] });
    } finally {
      setAddingKey(null);
    }
  };

  if (search.isLoading) return <Loading />;
  const results = search.data?.results;
  const sources = search.data?.sources;
  if (!results || results.length === 0) {
    if (sources && !sources.tmdb && !sources.tvdb) {
      return (
        <EmptyState
          title="Recherche externe non configurée"
          message={
            'Le serveur n’a aucune source de contenu active.\n' +
            'Renseignez TVDB_ENABLED=true et TVDB_API_KEY (ou une clé TMDb) dans apps/server/.env, puis redémarrez le serveur.'
          }
        />
      );
    }
    return <EmptyState title="Toutes nos excuses" message={`Nous n'avons trouvé aucun résultat pour « ${rawQuery.trim()} »`} />;
  }

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 24, paddingTop: 6 }} keyboardShouldPersistTaps="handled">
      {results.map((r) => {
        const key = `${r.type}-${r.id ?? r.tvdbId ?? r.tmdbId}`;
        const poster = tmdbImage(r.posterPath, 'w185');
        const isFollowed = followed[key] || r.inLibrary;
        return (
          <Pressable key={key} style={styles.resultRow} onPress={() => open(r, key)}>
            {poster ? (
              <Image source={{ uri: poster }} style={styles.resultPoster} resizeMode="cover" />
            ) : (
              <View style={[styles.resultPoster, styles.posterEmpty]}>
                <Feather name="image" size={18} color="#b4b4b4" />
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={styles.resultTitle} numberOfLines={1}>
                {r.title}
              </Text>
              <View style={styles.resultMetaRow}>
                <Feather name={r.type === 'show' ? 'tv' : 'film'} size={15} color={COLORS.textMuted} />
                <Text style={styles.resultMeta}>
                  {[r.type === 'show' ? 'Série' : 'Film', r.year].filter(Boolean).join(' · ')}
                </Text>
              </View>
            </View>
            {openingKey === key || addingKey === key ? (
              <View style={styles.addSquareGhost}>
                <ActivityIndicator color={COLORS.black} size="small" />
              </View>
            ) : isFollowed ? (
              <View style={styles.addedSquare}>
                <Feather name="check" size={22} color={COLORS.textMuted} />
              </View>
            ) : (
              <Pressable style={styles.addSquare} onPress={() => add(r, key)} hitSlop={6}>
                <Feather name="plus" size={24} color="#E6B800" />
              </Pressable>
            )}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

// --- Résultats utilisateurs (onglet UTILISATEURS, façon TV Time) ------------
function UserResults({ query }: { query: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});

  const search = useQuery({
    queryKey: ['users', 'search', query],
    queryFn: () => api.get<{ users: PublicUser[] }>(`/api/users/search?q=${encodeURIComponent(query)}`),
    enabled: query.length > 1,
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

  if (search.isLoading) return <Loading />;
  const users = search.data?.users ?? [];
  if (users.length === 0)
    return <EmptyState title="Toutes nos excuses" message={`Aucun utilisateur trouvé pour « ${query} »`} />;

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 24, paddingTop: 6 }} keyboardShouldPersistTaps="handled">
      {users.map((u) => {
        const following = overrides[u.id] ?? u.isFollowing ?? false;
        return (
          <View key={u.id} style={styles.userRow}>
            <Pressable style={styles.userTap} onPress={() => router.push(`/user/${u.id}`)}>
              <View style={styles.avatar}>
                <Text style={styles.avatarInit}>{u.displayName.slice(0, 1).toUpperCase()}</Text>
              </View>
              <Text style={styles.userName} numberOfLines={1}>
                {u.displayName}
              </Text>
            </Pressable>
            <Pressable style={[styles.followBtn, following && styles.followingBtn]} onPress={() => toggle(u)} disabled={busyId === u.id}>
              {busyId === u.id ? (
                <ActivityIndicator color={following ? COLORS.black : '#fff'} size="small" />
              ) : (
                <Text style={[styles.followText, following && styles.followingText]}>{following ? 'ABONNÉ' : 'SUIVRE'}</Text>
              )}
            </Pressable>
          </View>
        );
      })}
    </ScrollView>
  );
}

function Feed({
  items,
  loading,
  refreshing,
  onRefresh,
}: {
  items?: FeedItem[];
  loading: boolean;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [addingKey, setAddingKey] = useState<string | null>(null);
  const [openingKey, setOpeningKey] = useState<string | null>(null);
  const [cat, setCat] = useState<FeedCategory>('tout');
  // Éléments ajoutés depuis ce tirage : la carte passe en ✓ (persiste au retour de la fiche).
  const [followed, setFollowed] = useState<Record<string, boolean>>({});

  // Tap sur la carte : ouvre la fiche SANS suivre (consultation), comme dans la
  // recherche. La fiche locale est résolue (follow: false) puis affichée.
  const open = async (f: FeedItem, key: string) => {
    if (openingKey || addingKey || !f.tmdbId) return;
    setOpeningKey(key);
    try {
      const path = f.type === 'movie' ? '/api/movies/add-from-tmdb' : '/api/shows/add-from-tmdb';
      const res = await api.post<{ mediaId: string }>(path, { tmdbId: f.tmdbId, follow: false });
      router.push(`/show/${res.mediaId}${f.type === 'movie' ? '?type=movie' : ''}`);
    } finally {
      setOpeningKey(null);
    }
  };

  // Bouton + : ajoute la recommandation à la bibliothèque puis ouvre sa fiche.
  const add = async (f: FeedItem, key: string) => {
    if (addingKey || !f.tmdbId) return;
    setAddingKey(key);
    try {
      const path = f.type === 'movie' ? '/api/movies/add-from-tmdb' : '/api/shows/add-from-tmdb';
      const res = await api.post<{ mediaId: string }>(path, { tmdbId: f.tmdbId });
      setFollowed((prev) => ({ ...prev, [key]: true }));
      queryClient.invalidateQueries({ queryKey: ['shows'] });
      queryClient.invalidateQueries({ queryKey: ['movies'] });
      router.push(`/show/${res.mediaId}${f.type === 'movie' ? '?type=movie' : ''}`);
    } finally {
      setAddingKey(null);
    }
  };

  if (loading) return <Loading />;
  // Tirer vers le bas rafraîchit le flux (natif). Sur le web ce geste n'existe
  // pas : le bouton ↻ fait la même chose.
  const refreshControl = <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />;
  if (!items || items.length === 0)
    return (
      <ScrollView contentContainerStyle={{ flexGrow: 1 }} refreshControl={refreshControl}>
        <EmptyState
          title="Pas encore de recommandations"
          message="Configurez une clé TMDb sur le serveur et suivez des séries pour alimenter votre flux."
        />
      </ScrollView>
    );
  const catOf = (f: FeedItem) => f.category ?? (f.type === 'show' ? 'serie' : 'film');
  const filtered = cat === 'tout' ? items : items.filter((f) => catOf(f) === cat);
  return (
    <ScrollView
      contentContainerStyle={{ paddingBottom: 24 }}
      refreshControl={refreshControl}
      // La rangée catégories + ↻ reste visible pendant le défilement.
      stickyHeaderIndices={[0]}
    >
      <View style={styles.feedHead}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} style={{ flexGrow: 0, flexShrink: 1 }}>
          {FEED_CATEGORIES.map((c) => (
            <Pressable key={c.key} style={[styles.catChip, cat === c.key && styles.catChipSel]} onPress={() => setCat(c.key)}>
              <Text style={[styles.catChipText, cat === c.key && styles.catChipTextSel]}>{c.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
        <Pressable style={styles.refreshBtn} onPress={onRefresh} disabled={refreshing} hitSlop={6}>
          {refreshing ? (
            <ActivityIndicator size="small" color={COLORS.black} />
          ) : (
            <Feather name="refresh-cw" size={17} color={COLORS.black} />
          )}
        </Pressable>
      </View>
      {filtered.length === 0 ? (
        <EmptyState title="Rien dans cette catégorie" message="Actualise (bouton ↻) pour un nouveau tirage." />
      ) : null}
      {filtered.map((f, i) => {
        const key = `${f.type}-${f.tmdbId}`;
        const image = tmdbImage(f.backdropPath, 'w780') ?? tmdbImage(f.posterPath, 'w500');
        return (
          <View key={key} style={styles.hero}>
            <Pressable style={styles.heroImg} onPress={() => open(f, key)}>
              {image ? <Image source={{ uri: image }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
              <View style={styles.heroShade} />
              {openingKey === key ? (
                <View style={StyleSheet.absoluteFill} pointerEvents="none">
                  <ActivityIndicator style={{ flex: 1 }} color="#fff" />
                </View>
              ) : null}
              {followed[key] || f.inLibrary ? (
                <View style={styles.plus}>
                  <Feather name="check" size={26} color={COLORS.yellow} />
                </View>
              ) : (
                <Pressable style={styles.plus} onPress={() => add(f, key)}>
                  {addingKey === key ? (
                    <ActivityIndicator color={COLORS.yellow} />
                  ) : (
                    <Feather name="plus" size={26} color={COLORS.yellow} />
                  )}
                </Pressable>
              )}
              <View style={styles.heroCap}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Feather name={f.type === 'show' ? 'tv' : 'film'} size={22} color="#fff" />
                  <Text style={styles.heroTitle}>{f.title}</Text>
                </View>
                <Text style={styles.heroMeta}>{f.year ?? ''}</Text>
              </View>
            </Pressable>
            {f.overview ? (
              <Text style={[styles.heroDesc, { backgroundColor: PASTELS[i % PASTELS.length] }]} numberOfLines={2}>
                {f.overview}
              </Text>
            ) : null}
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  feedHead: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, gap: 10, backgroundColor: COLORS.white },
  catChip: { backgroundColor: COLORS.chipGrey, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  catChipSel: { backgroundColor: COLORS.yellow },
  catChipText: { fontSize: 13, fontWeight: '700', color: COLORS.textMuted, letterSpacing: 0.4 },
  catChipTextSel: { color: COLORS.black },
  refreshBtn: { width: 36, height: 36, borderRadius: 18, borderWidth: 2, borderColor: COLORS.black, alignItems: 'center', justifyContent: 'center', marginLeft: 'auto' },
  searchbar: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, height: 70 },
  input: { flex: 1, fontFamily: FONTS.regular, fontSize: 19, borderBottomWidth: 1, borderBottomColor: COLORS.border, paddingVertical: 8 },
  cancel: { color: COLORS.blue, fontFamily: FONTS.regular, fontSize: 17 },
  tabs: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: COLORS.borderLight },
  tab: { paddingHorizontal: 18, paddingVertical: 12, borderBottomWidth: 3, borderBottomColor: 'transparent', marginBottom: -1 },
  tabActive: { borderBottomColor: COLORS.black },
  tabText: { fontSize: 15, fontFamily: FONTS.extraBold, letterSpacing: 0.4, color: COLORS.textSoft },
  tabTextActive: { color: COLORS.black },
  resultRow: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 20, paddingVertical: 10 },
  resultPoster: { width: 74, aspectRatio: 2 / 3, borderRadius: 6, backgroundColor: '#e5e5e5' },
  posterEmpty: { alignItems: 'center', justifyContent: 'center' },
  resultTitle: { fontSize: 20, fontFamily: FONTS.bold },
  resultMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  resultMeta: { fontFamily: FONTS.regular, fontSize: 15, color: COLORS.textMuted },
  addSquare: { width: 44, height: 44, borderRadius: 10, borderWidth: 2.5, borderColor: COLORS.yellow, alignItems: 'center', justifyContent: 'center' },
  addSquareGhost: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  addedSquare: { width: 44, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  userRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingVertical: 10 },
  userTap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 14 },
  avatar: { width: 46, height: 46, borderRadius: 23, backgroundColor: '#20202a', alignItems: 'center', justifyContent: 'center' },
  avatarInit: { color: '#fff', fontSize: 18, fontFamily: FONTS.extraBold },
  userName: { flex: 1, fontSize: 18, fontFamily: FONTS.bold },
  followBtn: { minWidth: 96, paddingHorizontal: 16, paddingVertical: 9, borderRadius: 999, backgroundColor: COLORS.black, alignItems: 'center' },
  followingBtn: { backgroundColor: COLORS.chipGrey },
  followText: { color: '#fff', fontFamily: FONTS.extraBold, fontSize: 13, letterSpacing: 0.4 },
  followingText: { color: COLORS.black },
  hero: { marginHorizontal: 20, marginBottom: 24, borderRadius: 5, overflow: 'hidden', ...{ elevation: 3 } },
  heroImg: { aspectRatio: 16 / 11, backgroundColor: '#26262e', justifyContent: 'flex-end' },
  heroShade: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.25)' },
  plus: { position: 'absolute', right: 16, top: 16, width: 46, height: 46, borderRadius: 10, borderWidth: 2.5, borderColor: COLORS.yellow, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.25)' },
  heroCap: { padding: 14 },
  heroTitle: { color: '#fff', fontSize: 22, fontFamily: FONTS.extraBold, flexShrink: 1 },
  heroMeta: { color: 'rgba(255,255,255,0.9)', fontFamily: FONTS.regular, fontSize: 14, marginTop: 2 },
  heroDesc: { padding: 16, fontFamily: FONTS.regular, fontSize: 16, lineHeight: 22 },
});
