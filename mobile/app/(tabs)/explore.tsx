import React, { useMemo, useRef, useState } from 'react';
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
import { useBackClose } from '@/lib/useBackClose';
import { useAppStore } from '@/lib/store';
import { COLORS, FONTS, RADIUS, SHADOW, SIZES, SPACE } from '@/lib/theme';
import { EmptyState, LoadError } from '@/components/ui';
import { AppearItem, FadeSwitch, PopIn, Skeleton } from '@/components/anim';
import { useTabResetSeq } from '@/lib/tabReset';
import { TikTokFeed } from '@/components/explore/TikTokFeed';
import { FilterBar, SearchFilterSheet, type ActiveChip, type FilterOption } from '@/components/explore/SearchFilters';

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
  // Exposés pour le tri (note/popularité) et le filtre par plateforme.
  voteAverage?: number | null;
  voteCount?: number | null;
  platforms?: string[];
};

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
  // Type de recherche PERSISTÉ (retour Étienne) : on revient sur le dernier type
  // choisi (médias / jeux / profils) — pas de reset systématique sur « médias ».
  const tab = useAppStore((s) => s.searchType);
  const setTab = useAppStore((s) => s.setSearchType);
  // Recherche OUVERTE : overlay affiché (sélecteur + résultats) dès le focus de
  // la barre, et jusqu'à un « retour ». Découplé de la saisie (le sélecteur
  // s'affiche donc immédiatement, avant même de taper).
  const [searchOpen, setSearchOpen] = useState(false);
  const inputRef = useRef<TextInput>(null);
  // Hauteur mesurée de la barre de recherche FLOTTANTE : le feed passe derrière
  // elle (fond pleine hauteur), on décale d'autant les chips et les résultats.
  const [headerHeight, setHeaderHeight] = useState(0);
  // Debounce : une requête quand l'utilisateur marque une pause, pas à chaque frappe.
  const debouncedQuery = useDebounced(query.trim(), 300);

  const searching = debouncedQuery.length > 1;
  const compact = width < 420;
  const headerActive = searchOpen || focused || query.length > 0;

  // Croix : efface le texte SANS fermer la recherche (on reste sur l'écran,
  // champ re-focalisé pour enchaîner une autre recherche).
  const clearQuery = () => {
    setQuery('');
    inputRef.current?.focus();
  };
  // Fermeture réelle (bouton « retour » système) : vide et revient au feed.
  const closeSearch = () => {
    setSearchOpen(false);
    setQuery('');
    setFocused(false);
    Keyboard.dismiss();
  };
  // Le « retour » (précédent navigateur / back Android) ferme la recherche au
  // lieu de quitter l'onglet Explorer (sinon on repartait vers l'Accueil).
  useBackClose(searchOpen, closeSearch);

  return (
    <View style={styles.screen}>
      {/* Le feed (et les résultats) occupent TOUT l'écran : leur fond remonte
          derrière la barre de recherche flottante posée par-dessus (ci-dessous). */}
      <FadeSwitch trigger={searchOpen ? 'search' : 'feed'} style={styles.mode}>
        {searchOpen ? (
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
            {!searching ? (
              <EmptyState
                title="Que cherchez-vous ?"
                message={
                  tab === 'games'
                    ? 'Tapez le nom d’un jeu à suivre.'
                    : tab === 'users'
                      ? 'Tapez le nom d’un profil à retrouver.'
                      : 'Tapez le nom d’une série ou d’un film.'
                }
              />
            ) : (
              <FadeSwitch trigger={tab}>
                {tab === 'media' ? (
                  <MediaResults query={debouncedQuery} rawQuery={query} />
                ) : tab === 'games' ? (
                  <GameResults query={debouncedQuery} rawQuery={query} />
                ) : (
                  <UserResults query={debouncedQuery} />
                )}
              </FadeSwitch>
            )}
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
              ref={inputRef}
              style={[styles.input, !headerActive && styles.inputCompact, Platform.OS === 'web' && ({ outlineStyle: 'none' } as never)]}
              placeholder="Séries, films, jeux, profils…"
              placeholderTextColor={COLORS.textMuted}
              value={query}
              onChangeText={setQuery}
              onFocus={() => { setFocused(true); setSearchOpen(true); }}
              onBlur={() => setFocused(false)}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              accessibilityLabel="Rechercher dans PlotTime"
            />
            {query ? (
              <Pressable
                style={({ pressed }) => [styles.cancel, pressed && styles.cancelPressed]}
                onPress={clearQuery}
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

// --- Filtres résultats séries/films : tri + type (série / film) --------------
type MediaSort = 'relevance' | 'recent' | 'alpha';
type MediaTypeFilter = 'all' | 'show' | 'movie';
const MEDIA_SORT_OPTS: FilterOption[] = [
  { key: 'relevance', label: 'Pertinence' },
  { key: 'recent', label: 'Plus récents' },
  { key: 'alpha', label: 'A → Z' },
];
const MEDIA_TYPE_OPTS: FilterOption[] = [
  { key: 'all', label: 'Séries et films' },
  { key: 'show', label: 'Séries seulement' },
  { key: 'movie', label: 'Films seulement' },
];
function applyMediaFilter(items: FeedItem[], sort: MediaSort, type: MediaTypeFilter): FeedItem[] {
  const arr = type === 'all' ? items.slice() : items.filter((r) => r.type === type);
  if (sort === 'recent') arr.sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
  else if (sort === 'alpha') arr.sort((a, b) => a.title.localeCompare(b.title, 'fr'));
  return arr; // 'relevance' = ordre renvoyé par le serveur
}

// Clé stable d'un résultat média (série/film) — sert au suivi optimiste et au
// tri « contenus déjà ajoutés en premier ».
function mediaResultKey(result: FeedItem) {
  return `${result.type}-${result.id ?? result.tvdbId ?? result.tmdbId}`;
}

// Remonte en tête les résultats déjà en bibliothèque (retour Étienne : voir
// d'abord ce qu'on a déjà ajouté), en conservant l'ordre relatif d'origine.
function prioritizeLibraryResults<T>(results: T[], isInLibrary: (result: T) => boolean) {
  const inLibrary: T[] = [];
  const others: T[] = [];
  results.forEach((result) => (isInLibrary(result) ? inLibrary : others).push(result));
  return [...inLibrary, ...others];
}

// --- Résultats séries / films (façon TV Time) -------------------------------
// Taper une ligne OUVRE la fiche (sans rien ajouter) ; seul le bouton + suit
// la série (statut « Pas commencé ») ou ajoute le film à la watchlist.
function MediaResults({ query, rawQuery }: { query: string; rawQuery: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  const [openingKey, setOpeningKey] = useState<string | null>(null);
  const [addingKey, setAddingKey] = useState<string | null>(null);
  const [followed, setFollowed] = useState<Record<string, boolean>>({});
  const [sheet, setSheet] = useState(false);
  const [sort, setSort] = useState<MediaSort>('relevance');
  const [typeFilter, setTypeFilter] = useState<MediaTypeFilter>('all');

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

  // Filtre/tri utilisateur PUIS remontée des contenus déjà ajoutés en tête.
  const shown = prioritizeLibraryResults(
    applyMediaFilter(results, sort, typeFilter),
    (result) => followed[mediaResultKey(result)] || result.inLibrary,
  );
  const filtersActive = sort !== 'relevance' || typeFilter !== 'all';
  // Badges des filtres actifs (croix = retire ce filtre précis).
  const activeChips: ActiveChip[] = [];
  if (sort !== 'relevance')
    activeChips.push({ key: 'sort', label: MEDIA_SORT_OPTS.find((o) => o.key === sort)!.label, onRemove: () => setSort('relevance') });
  if (typeFilter !== 'all')
    activeChips.push({ key: 'type', label: typeFilter === 'show' ? 'Séries' : 'Films', onRemove: () => setTypeFilter('all') });

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={styles.resultsContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {shown.length === 0 ? (
          <View style={styles.filterEmpty}>
            <EmptyState title="Aucun résultat pour ce filtre" message="Élargissez le tri ou le type pour retrouver les autres résultats." />
          </View>
        ) : (
          shown.map((r, i) => {
            const key = `${r.type}-${r.id ?? r.tvdbId ?? r.tmdbId}`;
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
                        <Feather name="check" size={20} color={COLORS.onPrimary} />
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
          })
        )}
      </ScrollView>
      <FilterBar active={filtersActive} chips={activeChips} onOpen={() => setSheet(true)} bottom={insets.bottom + 58 + SPACE.sm} />
      <SearchFilterSheet
        visible={sheet}
        onClose={() => setSheet(false)}
        title="Trier & filtrer"
        subtitle="Séries et films"
        sortOptions={MEDIA_SORT_OPTS}
        sort={sort}
        filterTitle="Type"
        filterOptions={MEDIA_TYPE_OPTS}
        filter={typeFilter}
        reset={{ sort: 'relevance', filter: 'all' }}
        onApply={(s, f) => { setSort(s as MediaSort); setTypeFilter(f as MediaTypeFilter); setSheet(false); }}
      />
    </View>
  );
}

// --- Filtres résultats jeux : tri (popularité/note…) + plateforme ------------
type GameSort = 'popular' | 'rating' | 'recent' | 'alpha';
const GAME_SORT_OPTS: FilterOption[] = [
  { key: 'popular', label: 'Populaires' },
  { key: 'rating', label: 'Mieux notés' },
  { key: 'recent', label: 'Plus récents' },
  { key: 'alpha', label: 'A → Z' },
];
function applyGameFilter(items: GameSearchResultDto[], sort: GameSort, platform: string): GameSearchResultDto[] {
  const arr = platform === 'all' ? items.slice() : items.filter((r) => (r.platforms ?? []).includes(platform));
  if (sort === 'rating') arr.sort((a, b) => (b.voteAverage ?? 0) - (a.voteAverage ?? 0));
  else if (sort === 'recent') arr.sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
  else if (sort === 'alpha') arr.sort((a, b) => a.title.localeCompare(b.title, 'fr'));
  return arr; // 'popular' = ordre renvoyé par le serveur (par popularité)
}

// --- Résultats jeux (onglet JEUX, façon TV Time) -----------------------------
// Taper une ligne OUVRE la fiche (« consultation ≠ suivi ») ; le bouton +
// suit le jeu (statut « Voulus »), comme MediaResults pour séries/films.
function GameResults({ query, rawQuery }: { query: string; rawQuery: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  const [openingKey, setOpeningKey] = useState<string | null>(null);
  const [addingKey, setAddingKey] = useState<string | null>(null);
  const [followed, setFollowed] = useState<Record<string, boolean>>({});
  const [sheet, setSheet] = useState(false);
  const [sort, setSort] = useState<GameSort>('popular');
  const [platform, setPlatform] = useState<string>('all');

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

  // Plateformes proposées au filtre : celles PRÉSENTES dans les résultats.
  const platformOpts: FilterOption[] = [
    { key: 'all', label: 'Toutes les plateformes' },
    ...Array.from(new Set(results.flatMap((r) => r.platforms ?? [])))
      .sort((a, b) => a.localeCompare(b, 'fr'))
      .map((p) => ({ key: p, label: p })),
  ];
  // Filtre/tri utilisateur PUIS remontée des jeux déjà ajoutés en tête.
  const shown = prioritizeLibraryResults(
    applyGameFilter(results, sort, platform),
    (result) => followed[keyOf(result)] || !!result.inLibrary,
  );
  const filtersActive = sort !== 'popular' || platform !== 'all';
  // Badges des filtres actifs (croix = retire ce filtre précis).
  const activeChips: ActiveChip[] = [];
  if (sort !== 'popular')
    activeChips.push({ key: 'sort', label: GAME_SORT_OPTS.find((o) => o.key === sort)!.label, onRemove: () => setSort('popular') });
  if (platform !== 'all') activeChips.push({ key: 'platform', label: platform, onRemove: () => setPlatform('all') });

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={styles.resultsContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {shown.length === 0 ? (
          <View style={styles.filterEmpty}>
            <EmptyState title="Aucun jeu pour ce filtre" message="Changez de plateforme ou de tri pour voir les autres jeux." />
          </View>
        ) : (
          shown.map((r, i) => {
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
                      <Text style={styles.resultMeta} numberOfLines={1}>
                        {['Jeu', r.year].filter(Boolean).join(' · ')}
                      </Text>
                    </View>
                    {/* Plateformes de sortie en badges : d'un coup d'œil on
                        reconnaît la version du jeu à laquelle on a joué. */}
                    {r.platforms && r.platforms.length ? (
                      <View style={styles.platformRow}>
                        {r.platforms.slice(0, 4).map((p) => (
                          <View key={p} style={styles.platformBadge}>
                            <Text style={styles.platformBadgeText} numberOfLines={1}>{p}</Text>
                          </View>
                        ))}
                        {r.platforms.length > 4 ? (
                          <Text style={styles.platformMore}>+{r.platforms.length - 4}</Text>
                        ) : null}
                      </View>
                    ) : null}
                  </View>
                  {openingKey === key || addingKey === key ? (
                    <View style={styles.addSquareGhost} accessibilityLabel="Action en cours">
                      <ActivityIndicator color={COLORS.primary} size="small" />
                    </View>
                  ) : isFollowed ? (
                    <View accessible accessibilityLabel="Déjà dans votre bibliothèque">
                      <PopIn style={styles.addedSquare}>
                        <Feather name="check" size={20} color={COLORS.onPrimary} />
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
          })
        )}
      </ScrollView>
      <FilterBar active={filtersActive} chips={activeChips} onOpen={() => setSheet(true)} bottom={insets.bottom + 58 + SPACE.sm} />
      <SearchFilterSheet
        visible={sheet}
        onClose={() => setSheet(false)}
        title="Trier & filtrer"
        subtitle="Jeux"
        sortOptions={GAME_SORT_OPTS}
        sort={sort}
        filterTitle="Plateforme"
        filterOptions={platformOpts}
        filter={platform}
        reset={{ sort: 'popular', filter: 'all' }}
        onApply={(s, f) => { setSort(s as GameSort); setPlatform(f); setSheet(false); }}
      />
    </View>
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
    // Dégage la barre de navigation flottante + la pilule « FILTRER » et ses
    // badges de filtres actifs empilés au-dessus.
    paddingBottom: SIZES.tabBar + SPACE.xxl * 2,
  },
  filterEmpty: { paddingTop: SPACE.xl },
  // Badges des plateformes de sortie (cartes de résultats jeux).
  platformRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 4, marginTop: 6 },
  platformBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.surfaceMuted,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
  },
  platformBadgeText: { color: COLORS.textMuted, fontSize: 10.5, fontFamily: FONTS.bold, letterSpacing: 0.2 },
  platformMore: { color: COLORS.textSoft, fontSize: 10.5, fontFamily: FONTS.bold, marginLeft: 2 },
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
  // « Déjà ajouté » : pastille verte pleine + coche blanche, identique à la
  // coche d'épisode vu (CheckCircle) — plus chaleureuse que l'ancien contour.
  addedSquare: {
    width: SIZES.touch,
    height: SIZES.touch,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.green,
    borderWidth: 1,
    borderColor: COLORS.green,
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
