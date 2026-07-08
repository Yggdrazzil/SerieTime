import React, { useState, useRef, useEffect, useMemo } from 'react';
import { View, Text, TextInput, ScrollView, StyleSheet, Pressable, Image, ActivityIndicator, Keyboard, RefreshControl, Animated, PanResponder, Dimensions } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, tmdbImage } from '@/lib/api';
import { useDebounced } from '@/lib/useDebounced';
import { COLORS, FONTS, SHADOW } from '@/lib/theme';
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

const { width: WIN_W } = Dimensions.get('window');
const SWIPE_X = Math.min(140, WIN_W * 0.28); // seuil swipe horizontal
const SWIPE_Y = 90; // seuil swipe vertical

// Infos détaillées récupérées à l'ouverture du panneau (genres, casting, etc.).
type DetailInfo = {
  media?: { genres?: string | null; year?: number | null; overview?: string | null };
  show?: { network?: string | null; platform?: string | null } | null;
  cast?: { name: string }[];
  providers?: { name: string }[];
  creators?: string[];
};

type FeedMode = 'browse' | 'discover';

// Rangée de bascule PARCOURIR (liste classique) / DÉCOUVRIR (plein écran TikTok).
function ModeBar({ mode, setMode, dark }: { mode: FeedMode; setMode: (m: FeedMode) => void; dark?: boolean }) {
  return (
    <View style={styles.modeBar}>
      {([['browse', 'PARCOURIR', 'list'], ['discover', 'DÉCOUVRIR', 'zap']] as const).map(([m, label, icon]) => {
        const on = mode === m;
        return (
          <Pressable key={m} style={[styles.modeChip, on && styles.modeChipOn, dark && !on && styles.modeChipDark]} onPress={() => setMode(m)}>
            <Feather name={icon} size={14} color={on ? COLORS.black : dark ? '#fff' : COLORS.textMuted} />
            <Text style={[styles.modeChipText, { color: on ? COLORS.black : dark ? '#fff' : COLORS.textMuted }]}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// Explorer : PARCOURIR (liste classique) ou DÉCOUVRIR (plein écran façon
// TikTok/Tinder — swipe ↑ suivante, → À voir, ← Pas intéressé, tap = panneau
// détails avec actions dont « Déjà vu »). Chaque geste a son équivalent bouton.
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
  const [mode, setMode] = useState<FeedMode>('browse');
  const [cat, setCat] = useState<FeedCategory>('tout');
  const [idx, setIdx] = useState(0);
  const [detail, setDetail] = useState(false);
  const [busy, setBusy] = useState(false);
  const [openingKey, setOpeningKey] = useState<string | null>(null);
  const [addingKey, setAddingKey] = useState<string | null>(null);
  const [followed, setFollowed] = useState<Record<string, boolean>>({});
  const [info, setInfo] = useState<DetailInfo | null>(null);
  const [infoLoading, setInfoLoading] = useState(false);
  const pos = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;

  const catOf = (f: FeedItem) => f.category ?? (f.type === 'show' ? 'serie' : 'film');
  const deck = useMemo(
    () => (cat === 'tout' ? items ?? [] : (items ?? []).filter((f) => catOf(f) === cat)),
    [items, cat],
  );
  // Nouveau tirage ou changement de catégorie : on repart de la 1re carte.
  useEffect(() => {
    setIdx(0);
    setDetail(false);
    pos.setValue({ x: 0, y: 0 });
  }, [cat, items, pos]);

  const current = deck[idx];
  const upcoming = deck[idx + 1];

  // À l'ouverture du panneau détails : récupère les infos complètes de la carte
  // courante (genres, casting, chaîne, où regarder). Chargement paresseux.
  useEffect(() => {
    if (!detail || !current?.tmdbId) return;
    let cancelled = false;
    setInfo(null);
    setInfoLoading(true);
    (async () => {
      try {
        const path = current.type === 'movie' ? '/api/movies/add-from-tmdb' : '/api/shows/add-from-tmdb';
        const { mediaId } = await api.post<{ mediaId: string }>(path, { tmdbId: current.tmdbId, follow: false });
        const d = await api.get<DetailInfo>(current.type === 'movie' ? `/api/movies/${mediaId}` : `/api/shows/${mediaId}`);
        if (!cancelled) setInfo(d);
      } catch {
        if (!cancelled) setInfo(null);
      } finally {
        if (!cancelled) setInfoLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [detail, current?.tmdbId, current?.type]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['shows'] });
    queryClient.invalidateQueries({ queryKey: ['movies'] });
    queryClient.invalidateQueries({ queryKey: ['profile'] });
  };
  const resolve = async (f: FeedItem) => {
    const path = f.type === 'movie' ? '/api/movies/add-from-tmdb' : '/api/shows/add-from-tmdb';
    const res = await api.post<{ mediaId: string }>(path, { tmdbId: f.tmdbId, follow: false });
    return res.mediaId;
  };
  const openFiche = async (f: FeedItem) => {
    if (busy || !f.tmdbId) return;
    setBusy(true);
    try {
      const id = await resolve(f);
      router.push(`/show/${id}${f.type === 'movie' ? '?type=movie' : ''}`);
    } finally {
      setBusy(false);
    }
  };
  const doAVoir = async (f: FeedItem) => {
    if (!f.tmdbId) return;
    try {
      const id = await resolve(f);
      await api.post(f.type === 'movie' ? `/api/movies/${id}/watchlist` : `/api/shows/${id}/watchlater`);
      invalidate();
    } catch {
      /* best-effort */
    }
  };
  const doPasInteresse = async (f: FeedItem) => {
    if (!f.tmdbId) return;
    try {
      const id = await resolve(f);
      await api.post(`/api/disliked/${id}`, { hidden: true });
    } catch {
      /* best-effort */
    }
  };
  const doDejaVu = async (f: FeedItem) => {
    if (!f.tmdbId) return;
    try {
      const id = await resolve(f);
      await api.post(f.type === 'movie' ? `/api/movies/${id}/watched` : `/api/shows/${id}/mark-all-watched`, {});
      invalidate();
    } catch {
      /* best-effort */
    }
  };

  // --- Mode PARCOURIR : liste classique (tap = fiche, + = ajouter) ---
  const browseOpen = async (f: FeedItem, key: string) => {
    if (openingKey || addingKey || !f.tmdbId) return;
    setOpeningKey(key);
    try {
      const id = await resolve(f);
      router.push(`/show/${id}${f.type === 'movie' ? '?type=movie' : ''}`);
    } finally {
      setOpeningKey(null);
    }
  };
  const browseAdd = async (f: FeedItem, key: string) => {
    if (addingKey || !f.tmdbId) return;
    setAddingKey(key);
    try {
      const path = f.type === 'movie' ? '/api/movies/add-from-tmdb' : '/api/shows/add-from-tmdb';
      const res = await api.post<{ mediaId: string }>(path, { tmdbId: f.tmdbId });
      setFollowed((prev) => ({ ...prev, [key]: true }));
      invalidate();
      router.push(`/show/${res.mediaId}${f.type === 'movie' ? '?type=movie' : ''}`);
    } finally {
      setAddingKey(null);
    }
  };

  const advance = () => {
    setDetail(false);
    pos.setValue({ x: 0, y: 0 });
    setIdx((i) => i + 1);
  };
  const springBack = () => Animated.spring(pos, { toValue: { x: 0, y: 0 }, useNativeDriver: false, friction: 6 }).start();
  const fling = (toX: number, action: (f: FeedItem) => void) => {
    const f = current;
    if (!f) return;
    Animated.timing(pos, { toValue: { x: toX, y: 0 }, duration: 220, useNativeDriver: false }).start(() => {
      action(f);
      advance();
    });
  };
  // Glisser vers le haut = suggestion suivante (sans action).
  const swipeUp = () =>
    Animated.timing(pos, { toValue: { x: 0, y: -900 }, duration: 200, useNativeDriver: false }).start(() => advance());
  // Glisser vers le bas = « Déjà vu » (marque comme vu) puis suivante.
  const swipeDown = () => {
    const f = current;
    if (!f) return springBack();
    Animated.timing(pos, { toValue: { x: 0, y: 900 }, duration: 220, useNativeDriver: false }).start(() => {
      doDejaVu(f);
      advance();
    });
  };

  const pan = PanResponder.create({
    // Capte aussi le simple toucher (sans mouvement) : sinon `onPanResponderRelease`
    // ne se déclenche jamais et le tap « détails » ne s'ouvre pas.
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 6 || Math.abs(g.dy) > 6,
    onPanResponderMove: Animated.event([null, { dx: pos.x, dy: pos.y }], { useNativeDriver: false }),
    onPanResponderRelease: (_, g) => {
      if (Math.abs(g.dx) < 6 && Math.abs(g.dy) < 6) {
        setDetail(true); // tap = ouvre le panneau détails (façon TikTok)
        return springBack();
      }
      if (Math.abs(g.dx) > SWIPE_X && Math.abs(g.dx) > Math.abs(g.dy)) {
        if (g.dx > 0) fling(WIN_W * 1.5, doAVoir);
        else fling(-WIN_W * 1.5, doPasInteresse);
      } else if (g.dy < -SWIPE_Y) swipeUp();
      else if (g.dy > SWIPE_Y) swipeDown();
      else springBack();
    },
  });

  if (loading) return <Loading />;
  if (!items || items.length === 0)
    return (
      <ScrollView contentContainerStyle={{ flexGrow: 1 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
        <EmptyState
          title="Pas encore de recommandations"
          message="Configurez une clé TMDb sur le serveur et suivez des séries pour alimenter votre flux."
        />
      </ScrollView>
    );

  // ===== Mode PARCOURIR : liste classique =====
  if (mode === 'browse') {
    const filtered = cat === 'tout' ? items : items.filter((f) => catOf(f) === cat);
    return (
      <ScrollView
        style={{ backgroundColor: COLORS.white }}
        contentContainerStyle={{ paddingBottom: 24 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        stickyHeaderIndices={[0]}
      >
        <View style={{ backgroundColor: COLORS.white }}>
          <ModeBar mode={mode} setMode={setMode} />
          <View style={styles.feedHead}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} style={{ flexGrow: 0, flexShrink: 1 }}>
              {FEED_CATEGORIES.map((c) => (
                <Pressable key={c.key} style={[styles.catChip, cat === c.key && styles.catChipSel]} onPress={() => setCat(c.key)}>
                  <Text style={[styles.catChipText, cat === c.key && styles.catChipTextSel]}>{c.label}</Text>
                </Pressable>
              ))}
            </ScrollView>
            <Pressable style={styles.refreshBtn} onPress={onRefresh} disabled={refreshing} hitSlop={6}>
              {refreshing ? <ActivityIndicator size="small" color={COLORS.black} /> : <Feather name="refresh-cw" size={17} color={COLORS.black} />}
            </Pressable>
          </View>
        </View>
        {filtered.length === 0 ? <EmptyState title="Rien dans cette catégorie" message="Actualise pour un nouveau tirage." /> : null}
        {filtered.map((f, i) => {
          const key = `${f.type}-${f.tmdbId}`;
          const image = tmdbImage(f.backdropPath, 'w780') ?? tmdbImage(f.posterPath, 'w500');
          return (
            <View key={key} style={styles.hero}>
              <Pressable style={styles.heroImg} onPress={() => browseOpen(f, key)}>
                {image ? <Image source={{ uri: image }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
                <View style={styles.heroShade} />
                {openingKey === key ? (
                  <View style={StyleSheet.absoluteFill} pointerEvents="none"><ActivityIndicator style={{ flex: 1 }} color="#fff" /></View>
                ) : null}
                {followed[key] || f.inLibrary ? (
                  <View style={styles.plus}><Feather name="check" size={26} color={COLORS.yellow} /></View>
                ) : (
                  <Pressable style={styles.plus} onPress={() => browseAdd(f, key)}>
                    {addingKey === key ? <ActivityIndicator color={COLORS.yellow} /> : <Feather name="plus" size={26} color={COLORS.yellow} />}
                  </Pressable>
                )}
                <View style={styles.heroCap}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Feather name={f.type === 'show' ? 'tv' : 'film'} size={22} color="#fff" />
                    <Text style={styles.heroTitle} numberOfLines={1}>{f.title}</Text>
                  </View>
                  <Text style={styles.heroMeta}>{f.year ?? ''}</Text>
                </View>
              </Pressable>
              {f.overview ? (
                <Text style={[styles.heroDesc, { backgroundColor: PASTELS[i % PASTELS.length] }]} numberOfLines={2}>{f.overview}</Text>
              ) : null}
            </View>
          );
        })}
      </ScrollView>
    );
  }

  const rotate = pos.x.interpolate({ inputRange: [-WIN_W, 0, WIN_W], outputRange: ['-9deg', '0deg', '9deg'] });
  const likeOp = pos.x.interpolate({ inputRange: [0, SWIPE_X], outputRange: [0, 1], extrapolate: 'clamp' });
  const nopeOp = pos.x.interpolate({ inputRange: [-SWIPE_X, 0], outputRange: [1, 0], extrapolate: 'clamp' });
  const dejaOp = pos.y.interpolate({ inputRange: [0, SWIPE_Y], outputRange: [0, 1], extrapolate: 'clamp' });
  const cardImg = (f: FeedItem) => tmdbImage(f.backdropPath, 'w780') ?? tmdbImage(f.posterPath, 'w500');

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.pageMuted }}>
      <View style={styles.deckTop}>
        <ModeBar mode={mode} setMode={setMode} />
        <View style={styles.deckHead}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} style={{ flexGrow: 0, flexShrink: 1 }}>
            {FEED_CATEGORIES.map((c) => (
              <Pressable key={c.key} style={[styles.catChip, cat === c.key && styles.catChipSel]} onPress={() => setCat(c.key)}>
                <Text style={[styles.catChipText, cat === c.key && styles.catChipTextSel]}>{c.label}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <Pressable style={styles.refreshBtn} onPress={() => { setIdx(0); onRefresh(); }} disabled={refreshing} hitSlop={6}>
            {refreshing ? <ActivityIndicator size="small" color={COLORS.black} /> : <Feather name="refresh-cw" size={17} color={COLORS.black} />}
          </Pressable>
        </View>
      </View>

      <View style={{ flex: 1 }}>
        {current ? (
          <>
            {/* carte suivante en dessous (effet de pile) */}
            {upcoming ? (
              <View style={[styles.deckCard, { transform: [{ scale: 0.96 }] }]} pointerEvents="none">
                {cardImg(upcoming) ? <Image source={{ uri: cardImg(upcoming)! }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
                <View style={styles.deckShade} />
              </View>
            ) : null}

            {/* carte courante, déplaçable */}
            <Animated.View
              style={[styles.deckCard, { transform: [{ translateX: pos.x }, { translateY: pos.y }, { rotate }] }]}
              {...pan.panHandlers}
            >
              {cardImg(current) ? (
                <Image source={{ uri: cardImg(current)! }} style={StyleSheet.absoluteFill} resizeMode="cover" />
              ) : (
                <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
                  <Feather name="image" size={48} color="#555" />
                </View>
              )}
              <View style={styles.deckShade} />

              <Animated.View style={[styles.tagLike, { opacity: likeOp }]}>
                <Text style={styles.tagLikeText}>À VOIR</Text>
              </Animated.View>
              <Animated.View style={[styles.tagNope, { opacity: nopeOp }]}>
                <Text style={styles.tagNopeText}>PAS INTÉRESSÉ</Text>
              </Animated.View>
              <Animated.View style={[styles.tagDeja, { opacity: dejaOp }]}>
                <Text style={styles.tagDejaText}>DÉJÀ VU</Text>
              </Animated.View>

              <View style={styles.deckInfo}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Feather name={current.type === 'show' ? 'tv' : 'film'} size={20} color="#fff" />
                  <Text style={styles.deckTitle} numberOfLines={2}>{current.title}</Text>
                </View>
                <Text style={styles.deckMeta}>
                  {[current.year, current.category === 'anime' ? 'Animé' : current.type === 'show' ? 'Série' : 'Film'].filter(Boolean).join(' · ')}
                </Text>
                {current.overview ? (
                  <Text style={styles.deckOverview} numberOfLines={2}>{current.overview}</Text>
                ) : null}
              </View>
            </Animated.View>
          </>
        ) : (
          <View style={styles.deckEnd}>
            <Feather name="check-circle" size={44} color={COLORS.textMuted} />
            <Text style={styles.deckEndTitle}>Fin des suggestions</Text>
            <Text style={styles.deckEndMsg}>Actualise pour un nouveau tirage.</Text>
            <Pressable style={styles.deckEndBtn} onPress={() => { setIdx(0); onRefresh(); }}>
              <Feather name="refresh-cw" size={16} color={COLORS.black} />
              <Text style={styles.deckEndBtnText}>NOUVELLES SUGGESTIONS</Text>
            </Pressable>
          </View>
        )}
      </View>

      {/* Boutons (équivalents des swipes) */}
      {current ? (
        <View style={styles.deckActions}>
          <Pressable style={[styles.actBtn, styles.actNope]} onPress={() => fling(-WIN_W * 1.5, doPasInteresse)} hitSlop={8}>
            <Feather name="x" size={30} color={COLORS.red} />
          </Pressable>
          <Pressable style={[styles.actBtn, styles.actInfo]} onPress={() => openFiche(current)} hitSlop={8}>
            {busy ? <ActivityIndicator color="#fff" /> : <Feather name="info" size={24} color="#fff" />}
          </Pressable>
          <Pressable style={[styles.actBtn, styles.actLike]} onPress={() => fling(WIN_W * 1.5, doAVoir)} hitSlop={8}>
            <Feather name="heart" size={28} color={COLORS.black} />
          </Pressable>
        </View>
      ) : null}

      {/* Panneau détails (tap) : posé sur l'image comme TikTok (image visible au-dessus) */}
      {detail && current ? (
        <View style={styles.detailSheet}>
          <Pressable style={styles.detailGrip} onPress={() => setDetail(false)} hitSlop={10}>
            <Feather name="chevron-down" size={26} color="#fff" />
          </Pressable>
          <ScrollView contentContainerStyle={{ paddingHorizontal: 22, paddingTop: 4, paddingBottom: 18 }} showsVerticalScrollIndicator={false}>
            <Text style={styles.detailTitle}>{current.title}</Text>
            <Text style={styles.detailMeta}>
              {[current.year, current.category === 'anime' ? 'Animé' : current.type === 'show' ? 'Série' : 'Film'].filter(Boolean).join(' · ')}
            </Text>
            <Text style={styles.detailDesc}>{current.overview || 'Pas de description disponible.'}</Text>

            {infoLoading ? (
              <ActivityIndicator style={{ marginTop: 16, alignSelf: 'flex-start' }} color="#fff" />
            ) : info ? (
              <View style={{ marginTop: 14, gap: 8 }}>
                <InfoLine label="Genres" value={info.media?.genres ?? undefined} />
                <InfoLine label={current.type === 'movie' ? 'Réalisation' : 'Création'} value={info.creators?.join(', ')} />
                <InfoLine label="Diffusion" value={info.show?.network ?? info.show?.platform ?? undefined} />
                <InfoLine label="Casting" value={info.cast?.slice(0, 6).map((c) => c.name).join(', ')} />
                <InfoLine label="Où regarder" value={info.providers?.map((p) => p.name).join(', ')} />
              </View>
            ) : null}
          </ScrollView>
          <View style={styles.detailActions}>
            <DetailAction icon="heart" label="À voir" tint={COLORS.yellow} onPress={() => { doAVoir(current); advance(); }} />
            <DetailAction icon="eye" label="Déjà vu" tint="#4caf50" onPress={() => { doDejaVu(current); advance(); }} />
            <DetailAction icon="x" label="Pas intéressé" tint={COLORS.red} onPress={() => { doPasInteresse(current); advance(); }} />
            <DetailAction icon="external-link" label="Fiche" tint="#fff" onPress={() => openFiche(current)} busy={busy} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

function InfoLine({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <Text style={styles.infoLine}>
      <Text style={styles.infoLabel}>{label} : </Text>
      {value}
    </Text>
  );
}

function DetailAction({ icon, label, tint, onPress, busy }: { icon: keyof typeof Feather.glyphMap; label: string; tint: string; onPress: () => void; busy?: boolean }) {
  return (
    <Pressable style={styles.detailAct} onPress={onPress} hitSlop={6}>
      <View style={[styles.detailActIcon, { borderColor: tint }]}>
        {busy ? <ActivityIndicator size="small" color={tint} /> : <Feather name={icon} size={22} color={tint} />}
      </View>
      <Text style={styles.detailActLabel}>{label}</Text>
    </Pressable>
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
  // --- Bascule de mode Parcourir / Découvrir ---
  modeBar: { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 4 },
  modeChip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7, backgroundColor: COLORS.chipGrey },
  modeChipOn: { backgroundColor: COLORS.yellow },
  modeChipDark: { backgroundColor: 'rgba(255,255,255,0.14)' },
  modeChipText: { fontSize: 13, fontFamily: FONTS.extraBold, letterSpacing: 0.4 },
  // --- Explorer façon TikTok/Tinder ---
  deckTop: { backgroundColor: COLORS.pageMuted, zIndex: 10 },
  catChipDark: { backgroundColor: 'rgba(255,255,255,0.14)' },
  deckHead: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingBottom: 8, gap: 10 },
  deckRefresh: { width: 36, height: 36, borderRadius: 18, borderWidth: 2, borderColor: '#fff', alignItems: 'center', justifyContent: 'center', marginLeft: 'auto', backgroundColor: 'rgba(0,0,0,0.35)' },
  deckCard: { ...StyleSheet.absoluteFillObject, margin: 10, borderRadius: 18, overflow: 'hidden', backgroundColor: '#1a1a22', justifyContent: 'flex-end' },
  deckShade: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.28)' },
  tagLike: { position: 'absolute', top: 60, left: 24, borderWidth: 4, borderColor: COLORS.green, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6, transform: [{ rotate: '-14deg' }] },
  tagLikeText: { color: COLORS.green, fontFamily: FONTS.extraBold, fontSize: 28, letterSpacing: 1 },
  tagNope: { position: 'absolute', top: 60, right: 24, borderWidth: 4, borderColor: COLORS.red, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6, transform: [{ rotate: '14deg' }] },
  tagNopeText: { color: COLORS.red, fontFamily: FONTS.extraBold, fontSize: 24, letterSpacing: 1 },
  tagDeja: { position: 'absolute', top: 120, alignSelf: 'center', borderWidth: 4, borderColor: '#4caf50', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 6 },
  tagDejaText: { color: '#4caf50', fontFamily: FONTS.extraBold, fontSize: 26, letterSpacing: 1 },
  deckInfo: { padding: 20, paddingBottom: 26 },
  deckTitle: { color: '#fff', fontSize: 26, fontFamily: FONTS.extraBold, flexShrink: 1 },
  deckMeta: { color: 'rgba(255,255,255,0.85)', fontFamily: FONTS.bold, fontSize: 14, marginTop: 4 },
  deckDesc: { color: 'rgba(255,255,255,0.92)', fontFamily: FONTS.regular, fontSize: 15, lineHeight: 21, marginTop: 12 },
  deckOverview: { color: 'rgba(255,255,255,0.92)', fontFamily: FONTS.regular, fontSize: 15, lineHeight: 20, marginTop: 10 },
  deckHint: { color: 'rgba(255,255,255,0.55)', fontFamily: FONTS.regular, fontSize: 12, marginTop: 10 },
  deckEnd: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 30 },
  deckEndTitle: { color: COLORS.black, fontSize: 22, fontFamily: FONTS.extraBold },
  deckEndMsg: { color: COLORS.textMuted, fontFamily: FONTS.regular, fontSize: 15, textAlign: 'center' },
  deckEndBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: COLORS.yellow, borderRadius: 999, paddingHorizontal: 22, paddingVertical: 13, marginTop: 8 },
  deckEndBtnText: { fontFamily: FONTS.extraBold, fontSize: 13, letterSpacing: 0.5 },
  deckActions: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 26, paddingVertical: 14 },
  actBtn: { alignItems: 'center', justifyContent: 'center', borderRadius: 999, ...SHADOW.card },
  actNope: { width: 62, height: 62, backgroundColor: '#fff', borderWidth: 2, borderColor: COLORS.red },
  actInfo: { width: 50, height: 50, backgroundColor: '#33333d' },
  actLike: { width: 62, height: 62, backgroundColor: COLORS.yellow },
  // --- Panneau détails (tap) : posé sur l'image, façon TikTok ---
  detailSheet: { position: 'absolute', left: 0, right: 0, top: '30%', bottom: 0, backgroundColor: 'rgba(8,8,12,0.94)', borderTopLeftRadius: 22, borderTopRightRadius: 22, zIndex: 20 },
  detailGrip: { alignSelf: 'center', paddingTop: 8, paddingBottom: 6 },
  detailTitle: { color: '#fff', fontSize: 25, fontFamily: FONTS.extraBold },
  detailMeta: { color: 'rgba(255,255,255,0.8)', fontFamily: FONTS.bold, fontSize: 14, marginTop: 5 },
  detailDesc: { color: 'rgba(255,255,255,0.92)', fontFamily: FONTS.regular, fontSize: 15, lineHeight: 22, marginTop: 14 },
  infoLine: { color: 'rgba(255,255,255,0.9)', fontFamily: FONTS.regular, fontSize: 14, lineHeight: 20 },
  infoLabel: { color: COLORS.yellow, fontFamily: FONTS.bold },
  detailActions: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'flex-start', paddingHorizontal: 12, paddingVertical: 16, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.1)' },
  detailAct: { alignItems: 'center', gap: 6, width: 78 },
  detailActIcon: { width: 54, height: 54, borderRadius: 27, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  detailActLabel: { color: '#fff', fontFamily: FONTS.bold, fontSize: 12, textAlign: 'center' },
});
