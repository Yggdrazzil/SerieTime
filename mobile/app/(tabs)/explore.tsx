import React, { useState } from 'react';
import { View, Text, TextInput, ScrollView, StyleSheet, Pressable, Image, ActivityIndicator, Keyboard, Platform } from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import type { Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, tmdbImage } from '@/lib/api';
import { useDebounced } from '@/lib/useDebounced';
import { COLORS, FONTS } from '@/lib/theme';
import { EmptyState, Loading } from '@/components/ui';
import { AppearItem, FadeSwitch, PopIn } from '@/components/anim';
import { useTabResetSeq } from '@/lib/tabReset';
import { TikTokFeed } from '@/components/explore/TikTokFeed';

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

type PublicUser = { id: string; displayName: string; avatarUrl: string | null; isFollowing?: boolean };

// Miroir de DiscoverGameDto (games.tsx) : posterPath est une URL IGDB absolue.
type GameSearchResultDto = { igdbId: string; title: string; year: number | null; posterPath: string | null };

export default function ExploreScreen() {
  // Re-clic sur l'onglet « Explorer » : remontage complet (recherche + flux réinitialisés).
  const resetSeq = useTabResetSeq('explore');
  return <ExploreScreenInner key={resetSeq} />;
}

function ExploreScreenInner() {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const [tab, setTab] = useState<'media' | 'users' | 'games'>('media');
  // Debounce : une requête quand l'utilisateur marque une pause, pas à chaque frappe.
  const debouncedQuery = useDebounced(query.trim(), 300);

  const searching = query.trim().length > 1;
  const cancel = () => {
    setQuery('');
    setTab('media');
    Keyboard.dismiss();
  };

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.white, paddingTop: insets.top }}>
      {/* Barre façon TV Time : icône + champ, simple soulignement sous toute la
          rangée (pas d'encadré — on neutralise aussi le focus-ring du navigateur
          sur la web app). Placeholder court au repos, complet une fois le champ actif. */}
      <View style={styles.searchbar}>
        <Feather name="search" size={20} color={searching ? COLORS.black : COLORS.textMuted} />
        <TextInput
          style={[styles.input, Platform.OS === 'web' && ({ outlineStyle: 'none' } as never)]}
          placeholder={focused || query ? 'Rechercher des séries et films' : 'Rechercher'}
          placeholderTextColor={COLORS.textMuted}
          value={query}
          onChangeText={setQuery}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          autoCapitalize="none"
        />
        {query ? (
          <Pressable onPress={cancel} hitSlop={8}>
            <Text style={styles.cancel}>Annuler</Text>
          </Pressable>
        ) : null}
      </View>

      {/* Fondu à l'entrée/sortie du mode recherche, puis entre les deux onglets. */}
      <FadeSwitch trigger={searching ? 'search' : 'feed'}>
        {searching ? (
          <>
            <View style={styles.tabs}>
              <SearchTab label="SÉRIES ET FILMS" active={tab === 'media'} onPress={() => setTab('media')} />
              <SearchTab label="JEUX" active={tab === 'games'} onPress={() => setTab('games')} />
              <SearchTab label="UTILISATEURS" active={tab === 'users'} onPress={() => setTab('users')} />
            </View>
            <FadeSwitch trigger={tab}>
              {tab === 'media' ? (
                <MediaResults query={debouncedQuery} rawQuery={query} />
              ) : tab === 'games' ? (
                <GameResults query={debouncedQuery} rawQuery={query} />
              ) : (
                <UserResults query={debouncedQuery} />
              )}
            </FadeSwitch>
          </>
        ) : (
          <TikTokFeed />
        )}
      </FadeSwitch>
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
      {results.map((r, i) => {
        const key = `${r.type}-${r.id ?? r.tvdbId ?? r.tmdbId}`;
        const poster = tmdbImage(r.posterPath, 'w185');
        const isFollowed = followed[key] || r.inLibrary;
        return (
          <AppearItem key={key} index={i}>
          <Pressable style={styles.resultRow} onPress={() => open(r, key)}>
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
                <Feather name={r.type === 'show' ? 'tv' : 'film'} size={14} color={COLORS.textMuted} />
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
              // La coche « ajouté » arrive avec un petit rebond (feedback du +).
              <PopIn style={styles.addedSquare}>
                <Feather name="check" size={20} color={COLORS.textMuted} />
              </PopIn>
            ) : (
              <Pressable
                style={styles.addSquare}
                onPress={() => add(r, key)}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel="Ajouter à ma bibliothèque"
              >
                <Feather name="plus" size={22} color="#E6B800" />
              </Pressable>
            )}
          </Pressable>
          </AppearItem>
        );
      })}
    </ScrollView>
  );
}

// --- Résultats jeux (onglet JEUX, façon TV Time) -----------------------------
// Taper une ligne OUVRE la fiche (« consultation ≠ suivi ») ; le bouton +
// suit le jeu (statut « Voulus »), comme MediaResults pour séries/films.
function GameResults({ query, rawQuery }: { query: string; rawQuery: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [openingKey, setOpeningKey] = useState<string | null>(null);
  const [addingKey, setAddingKey] = useState<string | null>(null);
  const [followed, setFollowed] = useState<Record<string, boolean>>({});

  const search = useQuery({
    queryKey: ['games', 'search', query],
    queryFn: () => api.get<{ results: GameSearchResultDto[] }>(`/api/games/search?q=${encodeURIComponent(query)}`),
    enabled: query.length > 1,
    placeholderData: keepPreviousData,
  });

  // Consultation seule : ajoute (sans suivre) puis ouvre la fiche.
  const open = async (r: GameSearchResultDto) => {
    if (openingKey || addingKey) return;
    setOpeningKey(r.igdbId);
    try {
      const res = await api.post<{ mediaId: string | null }>('/api/games/add-from-igdb', { igdbId: r.igdbId });
      if (res.mediaId) router.push(('/game/' + res.mediaId) as Href);
    } finally {
      setOpeningKey(null);
    }
  };

  // Le + : suit le jeu (statut « Voulus »), sans quitter la liste.
  const add = async (r: GameSearchResultDto) => {
    if (addingKey) return;
    setAddingKey(r.igdbId);
    try {
      await api.post('/api/games/add-from-igdb', { igdbId: r.igdbId, status: 'wishlist' });
      setFollowed((f) => ({ ...f, [r.igdbId]: true }));
      queryClient.invalidateQueries({ queryKey: ['games', 'library'] });
    } finally {
      setAddingKey(null);
    }
  };

  if (search.isLoading) return <Loading />;
  const results = search.data?.results ?? [];
  if (results.length === 0) {
    return <EmptyState title="Toutes nos excuses" message={`Nous n'avons trouvé aucun résultat pour « ${rawQuery.trim()} »`} />;
  }

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 24, paddingTop: 6 }} keyboardShouldPersistTaps="handled">
      {results.map((r, i) => {
        const poster = tmdbImage(r.posterPath, 'w185');
        const isFollowed = followed[r.igdbId];
        return (
          <AppearItem key={r.igdbId} index={i}>
            <Pressable style={styles.resultRow} onPress={() => open(r)}>
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
                  <Ionicons name="game-controller" size={14} color={COLORS.textMuted} />
                  <Text style={styles.resultMeta}>{['Jeu', r.year].filter(Boolean).join(' · ')}</Text>
                </View>
              </View>
              {openingKey === r.igdbId || addingKey === r.igdbId ? (
                <View style={styles.addSquareGhost}>
                  <ActivityIndicator color={COLORS.black} size="small" />
                </View>
              ) : isFollowed ? (
                // La coche « ajouté » arrive avec un petit rebond (feedback du +).
                <PopIn style={styles.addedSquare}>
                  <Feather name="check" size={20} color={COLORS.textMuted} />
                </PopIn>
              ) : (
                <Pressable
                  style={styles.addSquare}
                  onPress={() => add(r)}
                  hitSlop={6}
                  accessibilityRole="button"
                  accessibilityLabel="Ajouter à ma bibliothèque"
                >
                  <Feather name="plus" size={22} color="#E6B800" />
                </Pressable>
              )}
            </Pressable>
          </AppearItem>
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

  // Bascule OPTIMISTE : le bouton change au doigt, retour arrière si échec.
  const toggle = async (u: PublicUser) => {
    if (busyId) return;
    const currently = overrides[u.id] ?? u.isFollowing ?? false;
    setBusyId(u.id);
    setOverrides((o) => ({ ...o, [u.id]: !currently }));
    try {
      if (currently) await api.del(`/api/social/follow/${u.id}`);
      else await api.post(`/api/social/follow/${u.id}`);
      queryClient.invalidateQueries({ queryKey: ['social'] });
      queryClient.invalidateQueries({ queryKey: ['profile'] });
    } catch {
      setOverrides((o) => ({ ...o, [u.id]: currently }));
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
      {users.map((u, i) => {
        const following = overrides[u.id] ?? u.isFollowing ?? false;
        return (
          <AppearItem key={u.id} index={i} style={styles.userRow}>
            <Pressable style={styles.userTap} onPress={() => router.push(`/user/${u.id}`)}>
              <View style={styles.avatar}>
                <Text style={styles.avatarInit}>{u.displayName.slice(0, 1).toUpperCase()}</Text>
              </View>
              <Text style={styles.userName} numberOfLines={1}>
                {u.displayName}
              </Text>
            </Pressable>
            <Pressable style={[styles.followBtn, following && styles.followingBtn]} onPress={() => toggle(u)} disabled={busyId === u.id}>
              <Text style={[styles.followText, following && styles.followingText]}>{following ? 'ABONNÉ' : 'SUIVRE'}</Text>
            </Pressable>
          </AppearItem>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  // Cotes TV Time (comparaison px sur captures, même téléphone) : rangée ~56dp,
  // saisie 17, soulignement sous icône + champ (pas d'encadré).
  // Barre de recherche recalée sur TV Time (comparaison px) : rangée 44dp,
  // icône 20, texte 15.5 — nettement plus compacte qu'avant.
  searchbar: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 18, height: 44, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  input: { flex: 1, fontFamily: FONTS.regular, fontSize: 15.5, borderWidth: 0, paddingVertical: 6 },
  cancel: { color: COLORS.blue, fontFamily: FONTS.regular, fontSize: 16 },
  tabs: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: COLORS.borderLight },
  // Onglets répartis sur toute la largeur, comme TV Time.
  tab: { flex: 1, alignItems: 'center', paddingVertical: 12, borderBottomWidth: 3, borderBottomColor: 'transparent', marginBottom: -1 },
  tabActive: { borderBottomColor: COLORS.black },
  tabText: { fontSize: 14, fontFamily: FONTS.extraBold, letterSpacing: 0.4, color: COLORS.textSoft },
  tabTextActive: { color: COLORS.black },
  resultRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.borderLight },
  resultPoster: { width: 56, aspectRatio: 2 / 3, borderRadius: 4, backgroundColor: '#e5e5e5' },
  posterEmpty: { alignItems: 'center', justifyContent: 'center' },
  resultTitle: { fontSize: 17, fontFamily: FONTS.bold },
  resultMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 },
  resultMeta: { fontFamily: FONTS.regular, fontSize: 14, color: COLORS.textMuted },
  addSquare: { width: 40, height: 40, borderRadius: 10, borderWidth: 2.5, borderColor: COLORS.yellow, alignItems: 'center', justifyContent: 'center' },
  addSquareGhost: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  addedSquare: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  userRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingVertical: 10 },
  userTap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 14 },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#20202a', alignItems: 'center', justifyContent: 'center' },
  avatarInit: { color: '#fff', fontSize: 17, fontFamily: FONTS.extraBold },
  userName: { flex: 1, fontSize: 16, fontFamily: FONTS.bold },
  followBtn: { minWidth: 96, paddingHorizontal: 16, paddingVertical: 9, borderRadius: 999, backgroundColor: COLORS.black, alignItems: 'center' },
  followingBtn: { backgroundColor: COLORS.chipGrey },
  followText: { color: '#fff', fontFamily: FONTS.extraBold, fontSize: 13, letterSpacing: 0.4 },
  followingText: { color: COLORS.black },
});
