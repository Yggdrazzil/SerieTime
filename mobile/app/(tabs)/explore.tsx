import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  StyleSheet,
  Pressable,
  Image,
  ActivityIndicator,
  Keyboard,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import type { Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, tmdbImage } from '@/lib/api';
import { useDebounced } from '@/lib/useDebounced';
import { COLORS, FONTS, RADIUS, SHADOW, SIZES, SPACE } from '@/lib/theme';
import { EmptyState, LoadError } from '@/components/ui';
import { AppearItem, FadeSwitch, PopIn, Skeleton } from '@/components/anim';
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
type GameSearchResultDto = {
  // Jeu déjà en base : id local direct (fiche ouvrable sans import IGDB).
  id: string | null;
  igdbId: string | null;
  title: string;
  year: number | null;
  posterPath: string | null;
  inLibrary?: boolean;
};

function mediaResultKey(result: FeedItem) {
  return `${result.type}-${result.id ?? result.tvdbId ?? result.tmdbId}`;
}

function prioritizeLibraryResults<T>(results: T[], isInLibrary: (result: T) => boolean) {
  const inLibrary: T[] = [];
  const others: T[] = [];
  results.forEach((result) => (isInLibrary(result) ? inLibrary : others).push(result));
  return [...inLibrary, ...others];
}

export default function ExploreScreen() {
  // Re-clic sur l'onglet « Explorer » : remontage complet (recherche + flux réinitialisés).
  const resetSeq = useTabResetSeq('explore');
  return <ExploreScreenInner key={resetSeq} />;
}

function ExploreScreenInner() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const [tab, setTab] = useState<'media' | 'users' | 'games'>('media');
  // Hauteur mesurée de la barre de recherche FLOTTANTE : le feed passe derrière
  // elle (fond pleine hauteur), on décale d'autant les chips et les résultats.
  const [headerHeight, setHeaderHeight] = useState(0);
  // Debounce : une requête quand l'utilisateur marque une pause, pas à chaque frappe.
  const debouncedQuery = useDebounced(query.trim(), 300);

  const searching = query.trim().length > 1;
  const compact = width < 420;
  // En-tête « actif » (agrandi) : champ focalisé OU saisie en cours.
  const headerActive = focused || query.length > 0;
  const cancel = () => {
    setQuery('');
    setTab('media');
    Keyboard.dismiss();
  };

  return (
    <View style={styles.screen}>
      {/* Le feed (et les résultats) occupent TOUT l'écran : leur fond remonte
          derrière la barre de recherche flottante posée par-dessus (ci-dessous). */}
      <FadeSwitch trigger={searching ? 'search' : 'feed'} style={styles.mode}>
        {searching ? (
          <View style={[styles.resultsFrame, { paddingTop: headerHeight }]}>
            <View style={styles.tabs}>
              <SearchTab
                icon="film"
                label={compact ? 'MÉDIAS' : 'SÉRIES & FILMS'}
                active={tab === 'media'}
                onPress={() => setTab('media')}
              />
              <SearchTab icon="game-controller-outline" label="JEUX" active={tab === 'games'} onPress={() => setTab('games')} />
              <SearchTab
                icon="users"
                label={compact ? 'PROFILS' : 'UTILISATEURS'}
                active={tab === 'users'}
                onPress={() => setTab('users')}
              />
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
          </View>
        ) : (
          <View style={styles.feedFrame}>
            <TikTokFeed topInset={headerHeight} />
          </View>
        )}
      </FadeSwitch>

      {/* Barre de recherche FLOTTANTE (retour Étienne 2026-07-21) : posée en
          absolu au-dessus du feed, sans bandeau opaque ni bordure — le fond de
          l'onglet transparaît autour. `box-none` laisse défiler ce qu'il y a
          derrière. Elle reprend sa taille confortable dès le focus/saisie. */}
      <View
        style={[styles.header, headerActive ? styles.headerActive : null, { paddingTop: insets.top + (headerActive ? SPACE.sm : SPACE.xxs) }]}
        onLayout={(e) => setHeaderHeight(e.nativeEvent.layout.height)}
        pointerEvents="box-none"
      >
        <View style={styles.headerContent}>
          <View style={[styles.searchbar, !headerActive && styles.searchbarCompact, focused && styles.searchbarFocused]}>
            <View style={[styles.searchIcon, !headerActive && styles.searchIconCompact, focused && styles.searchIconFocused]} accessible={false}>
              <Feather name="search" size={headerActive ? 18 : 15} color={focused ? COLORS.onPrimary : COLORS.primary} />
            </View>
            <TextInput
              style={[styles.input, !headerActive && styles.inputCompact, Platform.OS === 'web' && ({ outlineStyle: 'none' } as never)]}
              placeholder="Séries, films, jeux, profils…"
              placeholderTextColor={COLORS.textMuted}
              value={query}
              onChangeText={setQuery}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              accessibilityLabel="Rechercher dans PlotTime"
            />
            {query ? (
              <Pressable
                style={({ pressed }) => [styles.cancel, pressed && styles.cancelPressed]}
                onPress={cancel}
                accessibilityRole="button"
                accessibilityLabel="Effacer la recherche"
              >
                <Feather name="x" size={19} color={COLORS.text} />
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>
    </View>
  );
}

function SearchTab({
  icon,
  label,
  active,
  onPress,
}: {
  icon: keyof typeof Feather.glyphMap | 'game-controller-outline';
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.tab, active && styles.tabActive, pressed && styles.tabPressed]}
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
    >
      {icon === 'game-controller-outline' ? (
        <Ionicons name={icon} size={17} color={active ? COLORS.onPrimary : COLORS.textMuted} />
      ) : (
        <Feather name={icon} size={15} color={active ? COLORS.onPrimary : COLORS.textMuted} />
      )}
      <Text style={[styles.tabText, active && styles.tabTextActive]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

function SearchResultsSkeleton() {
  return (
    <ScrollView
      contentContainerStyle={styles.resultsContent}
      showsVerticalScrollIndicator={false}
      accessibilityLabel="Chargement des résultats"
    >
      {[0, 1, 2, 3].map((item) => (
        <View key={item} style={styles.resultRow}>
          <Skeleton style={styles.resultPoster} />
          <View style={styles.resultBody}>
            <Skeleton style={styles.skeletonTitle} />
            <Skeleton style={styles.skeletonMeta} />
          </View>
          <Skeleton style={styles.skeletonAction} />
        </View>
      ))}
    </ScrollView>
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
      // Fiches détaillées (clés singulier) : une fiche déjà en cache doit
      // refléter le suivi/watchlist posé depuis la recherche.
      queryClient.invalidateQueries({ queryKey: ['show'] });
      queryClient.invalidateQueries({ queryKey: ['movie'] });
    } finally {
      setAddingKey(null);
    }
  };

  if (query.length <= 1 || search.isLoading) return <SearchResultsSkeleton />;
  if (search.isError && !search.data) {
    return <LoadError onRetry={() => void search.refetch()} busy={search.isFetching} />;
  }
  const results = search.data?.results;
  const sources = search.data?.sources;
  if (!results || results.length === 0) {
    if (sources && !sources.tmdb && !sources.tvdb) {
      return (
        <EmptyState
          title="Recherche momentanément indisponible"
          message="Les sources de séries et de films ne répondent pas pour le moment. Réessayez un peu plus tard."
        />
      );
    }
    return <EmptyState title="Aucun résultat" message={`Aucune série ni aucun film ne correspond à « ${rawQuery.trim()} ».`} />;
  }
  const prioritizedResults = prioritizeLibraryResults(
    results,
    (result) => followed[mediaResultKey(result)] || result.inLibrary,
  );

  return (
    <ScrollView
      contentContainerStyle={styles.resultsContent}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {prioritizedResults.map((r, i) => {
        const key = mediaResultKey(r);
        const poster = tmdbImage(r.posterPath, 'w185');
        const isFollowed = followed[key] || r.inLibrary;
        return (
          <AppearItem key={key} index={i}>
            <Pressable
              style={({ pressed }) => [styles.resultRow, pressed && styles.resultRowPressed]}
              onPress={() => open(r, key)}
              accessibilityRole="button"
              accessibilityLabel={`Ouvrir la fiche de ${r.title}`}
            >
              {poster ? (
                <Image source={{ uri: poster }} style={styles.resultPoster} resizeMode="cover" accessible={false} />
              ) : (
                <View style={[styles.resultPoster, styles.posterEmpty]} accessible={false}>
                  <Feather name="image" size={20} color={COLORS.textSoft} />
                </View>
              )}
              <View style={styles.resultBody}>
                <Text style={styles.resultTitle} numberOfLines={2}>
                  {r.title}
                </Text>
                <View style={styles.resultMetaRow}>
                  <Feather name={r.type === 'show' ? 'tv' : 'film'} size={14} color={COLORS.primary} />
                  <Text style={styles.resultMeta}>
                    {[r.category === 'anime' ? 'Animé' : r.type === 'show' ? 'Série' : 'Film', r.year]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                </View>
              </View>
              {openingKey === key || addingKey === key ? (
                <View style={styles.addSquareGhost} accessibilityLabel="Action en cours">
                  <ActivityIndicator color={COLORS.primary} size="small" />
                </View>
              ) : isFollowed ? (
                <View accessible accessibilityLabel="Déjà dans votre bibliothèque">
                  <PopIn style={styles.addedSquare}>
                    <Feather name="check" size={20} color={COLORS.success} />
                  </PopIn>
                </View>
              ) : (
                <Pressable
                  style={({ pressed }) => [styles.addSquare, pressed && styles.addSquarePressed]}
                  onPress={(event) => {
                    event.stopPropagation();
                    void add(r, key);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={
                    r.type === 'movie' ? `Ajouter ${r.title} à voir` : `Suivre ${r.title}`
                  }
                >
                  <Feather name="plus" size={20} color={COLORS.onPrimary} />
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

  const keyOf = (r: GameSearchResultDto) => r.id ?? r.igdbId ?? r.title;

  // Consultation seule : fiche locale directe si le jeu est déjà connu, sinon
  // import IGDB silencieux puis ouverture.
  const open = async (r: GameSearchResultDto) => {
    if (openingKey || addingKey) return;
    if (r.id) {
      router.push(('/game/' + r.id) as Href);
      return;
    }
    setOpeningKey(keyOf(r));
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
    setAddingKey(keyOf(r));
    try {
      if (r.id) await api.post(`/api/games/${r.id}/status`, { status: 'wishlist' });
      else await api.post('/api/games/add-from-igdb', { igdbId: r.igdbId, status: 'wishlist' });
      setFollowed((f) => ({ ...f, [keyOf(r)]: true }));
      queryClient.invalidateQueries({ queryKey: ['games', 'library'] });
      // Fiche jeu (clé singulier ['game', id]) : reflète le statut « Voulus »
      // posé depuis la recherche même si la fiche est déjà en cache.
      queryClient.invalidateQueries({ queryKey: ['game'] });
    } finally {
      setAddingKey(null);
    }
  };

  if (query.length <= 1 || search.isLoading) return <SearchResultsSkeleton />;
  if (search.isError && !search.data) {
    return <LoadError onRetry={() => void search.refetch()} busy={search.isFetching} />;
  }
  const results = search.data?.results ?? [];
  if (results.length === 0) {
    return <EmptyState title="Aucun résultat" message={`Aucun jeu ne correspond à « ${rawQuery.trim()} ».`} />;
  }
  const prioritizedResults = prioritizeLibraryResults(
    results,
    (result) => followed[keyOf(result)] || !!result.inLibrary,
  );

  return (
    <ScrollView
      contentContainerStyle={styles.resultsContent}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {prioritizedResults.map((r, i) => {
        const poster = tmdbImage(r.posterPath, 'w185');
        const key = keyOf(r);
        const isFollowed = followed[key] || r.inLibrary;
        return (
          <AppearItem key={key} index={i}>
            <Pressable
              style={({ pressed }) => [styles.resultRow, pressed && styles.resultRowPressed]}
              onPress={() => open(r)}
              accessibilityRole="button"
              accessibilityLabel={`Ouvrir la fiche de ${r.title}`}
            >
              {poster ? (
                <Image source={{ uri: poster }} style={styles.resultPoster} resizeMode="cover" accessible={false} />
              ) : (
                <View style={[styles.resultPoster, styles.posterEmpty]} accessible={false}>
                  <Feather name="image" size={20} color={COLORS.textSoft} />
                </View>
              )}
              <View style={styles.resultBody}>
                <Text style={styles.resultTitle} numberOfLines={2}>
                  {r.title}
                </Text>
                <View style={styles.resultMetaRow}>
                  <Ionicons name="game-controller" size={14} color={COLORS.primary} />
                  <Text style={styles.resultMeta}>{['Jeu', r.year].filter(Boolean).join(' · ')}</Text>
                </View>
              </View>
              {openingKey === key || addingKey === key ? (
                <View style={styles.addSquareGhost} accessibilityLabel="Action en cours">
                  <ActivityIndicator color={COLORS.primary} size="small" />
                </View>
              ) : isFollowed ? (
                <View accessible accessibilityLabel="Déjà dans votre bibliothèque">
                  <PopIn style={styles.addedSquare}>
                    <Feather name="check" size={20} color={COLORS.success} />
                  </PopIn>
                </View>
              ) : (
                <Pressable
                  style={({ pressed }) => [styles.addSquare, pressed && styles.addSquarePressed]}
                  onPress={(event) => {
                    event.stopPropagation();
                    void add(r);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Ajouter ${r.title} aux jeux voulus`}
                >
                  <Feather name="plus" size={20} color={COLORS.onPrimary} />
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

  if (query.length <= 1 || search.isLoading) return <SearchResultsSkeleton />;
  if (search.isError && !search.data) {
    return <LoadError onRetry={() => void search.refetch()} busy={search.isFetching} />;
  }
  const users = search.data?.users ?? [];
  if (users.length === 0)
    return <EmptyState title="Aucun profil" message={`Aucun profil ne correspond à « ${query} ».`} />;

  return (
    <ScrollView
      contentContainerStyle={styles.resultsContent}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {users.map((u, i) => {
        const following = overrides[u.id] ?? u.isFollowing ?? false;
        const avatar = u.avatarUrl ? tmdbImage(u.avatarUrl, 'w185') ?? u.avatarUrl : null;
        const busy = busyId === u.id;
        return (
          <AppearItem key={u.id} index={i} style={styles.userRow}>
            <Pressable
              style={({ pressed }) => [styles.userTap, pressed && styles.userTapPressed]}
              onPress={() => router.push(`/user/${u.id}`)}
              accessibilityRole="button"
              accessibilityLabel={`Ouvrir le profil de ${u.displayName}`}
            >
              {avatar ? (
                <Image source={{ uri: avatar }} style={styles.avatar} resizeMode="cover" accessible={false} />
              ) : (
                <View style={styles.avatar} accessible={false}>
                  <Text style={styles.avatarInit}>{u.displayName.slice(0, 1).toUpperCase()}</Text>
                </View>
              )}
              <Text style={styles.userName} numberOfLines={1}>
                {u.displayName}
              </Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.followBtn,
                following && styles.followingBtn,
                pressed && styles.followBtnPressed,
              ]}
              onPress={() => toggle(u)}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={following ? `Ne plus suivre ${u.displayName}` : `Suivre ${u.displayName}`}
              accessibilityState={{ selected: following, busy, disabled: busy }}
            >
              {busy ? (
                <ActivityIndicator size="small" color={following ? COLORS.primary : COLORS.onPrimary} />
              ) : (
                <>
                  <Feather name={following ? 'check' : 'user-plus'} size={15} color={following ? COLORS.primary : COLORS.onPrimary} />
                  <Text style={[styles.followText, following && styles.followingText]}>
                    {following ? 'SUIVI' : 'SUIVRE'}
                  </Text>
                </>
              )}
            </Pressable>
          </AppearItem>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.pageMuted },
  // Barre de recherche FLOTTANTE : posée en absolu au-dessus du feed, fond
  // transparent (le fond de l'onglet remonte derrière), sans bordure.
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: SPACE.md,
    paddingBottom: SPACE.xs,
    zIndex: 5,
  },
  headerActive: { paddingBottom: SPACE.md },
  headerContent: {
    width: '100%',
    maxWidth: SIZES.contentMax,
    alignSelf: 'center',
    gap: SPACE.sm,
  },
  searchbar: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.xs,
    paddingHorizontal: 5,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: RADIUS.control,
    // Barre flottante : ombre portée pour la détacher du feed sous-jacent.
    ...SHADOW.card,
  },
  searchbarFocused: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.focus,
    borderWidth: 2,
    paddingHorizontal: 4,
  },
  // Mode navigation : barre discrète, l'image du feed prend la place.
  searchbarCompact: { minHeight: 36 },
  searchIconCompact: { width: 26, height: 26 },
  inputCompact: { minHeight: 32, paddingVertical: 4, fontSize: 14.5 },
  searchIcon: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primarySoft,
    borderRadius: RADIUS.small,
  },
  searchIconFocused: { backgroundColor: COLORS.primary },
  input: {
    minHeight: SIZES.touch,
    flex: 1,
    paddingVertical: SPACE.xs,
    color: COLORS.text,
    fontFamily: FONTS.regular,
    fontSize: 16,
    borderWidth: 0,
  },
  cancel: {
    width: SIZES.touch,
    height: SIZES.touch,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: RADIUS.pill,
  },
  cancelPressed: { backgroundColor: COLORS.borderLight },
  mode: { flex: 1 },
  feedFrame: {
    flex: 1,
    width: '100%',
    maxWidth: SIZES.contentMax,
    alignSelf: 'center',
    overflow: 'hidden',
    backgroundColor: '#0D0A14',
  },
  resultsFrame: {
    flex: 1,
    width: '100%',
    maxWidth: SIZES.contentMax,
    alignSelf: 'center',
    backgroundColor: COLORS.pageMuted,
  },
  tabs: {
    flexDirection: 'row',
    gap: 4,
    marginHorizontal: SPACE.md,
    marginTop: SPACE.md,
    padding: 4,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: RADIUS.card,
    ...SHADOW.card,
  },
  tab: {
    minHeight: SIZES.touch,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingHorizontal: 4,
    borderRadius: RADIUS.control,
  },
  tabActive: { backgroundColor: COLORS.primary },
  tabPressed: { opacity: 0.78 },
  tabText: {
    flexShrink: 1,
    color: COLORS.textMuted,
    fontSize: 10.5,
    fontFamily: FONTS.extraBold,
    letterSpacing: 0.35,
  },
  tabTextActive: { color: COLORS.onPrimary },
  resultsContent: {
    gap: SPACE.sm,
    paddingHorizontal: SPACE.md,
    paddingTop: SPACE.md,
    paddingBottom: SPACE.xl,
  },
  resultRow: {
    minHeight: 112,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.sm,
    padding: SPACE.sm,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: RADIUS.card,
    ...SHADOW.card,
  },
  resultRowPressed: { opacity: 0.82 },
  resultPoster: {
    width: 64,
    aspectRatio: 2 / 3,
    borderRadius: RADIUS.poster,
    backgroundColor: COLORS.imagePlaceholder,
  },
  posterEmpty: { alignItems: 'center', justifyContent: 'center' },
  resultBody: { flex: 1, minWidth: 0 },
  resultTitle: {
    color: COLORS.text,
    fontSize: 16,
    lineHeight: 21,
    fontFamily: FONTS.extraBold,
  },
  resultMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  resultMeta: { color: COLORS.textMuted, fontFamily: FONTS.regular, fontSize: 13, lineHeight: 18 },
  addSquare: {
    width: SIZES.touch,
    height: SIZES.touch,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.pill,
  },
  addSquarePressed: { opacity: 0.78 },
  addSquareGhost: {
    width: SIZES.touch,
    height: SIZES.touch,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addedSquare: {
    width: SIZES.touch,
    height: SIZES.touch,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.surfaceMuted,
    borderWidth: 1,
    borderColor: COLORS.success,
    borderRadius: RADIUS.pill,
  },
  skeletonTitle: { width: '74%', height: 17, borderRadius: RADIUS.small },
  skeletonMeta: { width: '48%', height: 13, marginTop: SPACE.sm, borderRadius: RADIUS.small },
  skeletonAction: { width: SIZES.touch, height: SIZES.touch, borderRadius: RADIUS.pill },
  userRow: {
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.sm,
    padding: SPACE.sm,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: RADIUS.card,
    ...SHADOW.card,
  },
  userTap: {
    minHeight: SIZES.touch,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.sm,
    borderRadius: RADIUS.control,
  },
  userTapPressed: { opacity: 0.72 },
  avatar: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary,
    borderRadius: 24,
  },
  avatarInit: { color: COLORS.onPrimary, fontSize: 18, fontFamily: FONTS.extraBold },
  userName: { flex: 1, color: COLORS.text, fontSize: 15.5, fontFamily: FONTS.extraBold },
  followBtn: {
    minWidth: 100,
    minHeight: SIZES.touch,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: SPACE.sm,
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.pill,
  },
  followingBtn: {
    backgroundColor: COLORS.primarySoft,
    borderWidth: 1,
    borderColor: COLORS.primary,
  },
  followBtnPressed: { opacity: 0.78 },
  followText: {
    color: COLORS.onPrimary,
    fontFamily: FONTS.extraBold,
    fontSize: 11.5,
    letterSpacing: 0.35,
  },
  followingText: { color: COLORS.primary },
});
