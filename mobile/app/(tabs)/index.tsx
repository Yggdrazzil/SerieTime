import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Image, ActivityIndicator, RefreshControl, Platform } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter, type Href } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, tmdbImage } from '@/lib/api';
import type { EpisodeDto, MediaDto, QueueItemDto, UpcomingItemDto } from '@/lib/types';
import { queueGroupLabel, episodeCode, episodeCodeCompact, airTimeLabel } from '@/lib/format';
import { COLORS, SHADOW, FONTS, RADIUS, SPACE, SIZES } from '@/lib/theme';
import { PillHeader, EmptyState, LoadError, ShowPill, Badge, CheckCircle } from '@/components/ui';
import { EpisodeQueueCard, SeriesProgressBar } from '@/components/EpisodeQueueCard';
import { EpisodeSheet, type EpisodeSheetTarget } from '@/components/EpisodeSheet';
import { useTabResetSeq } from '@/lib/tabReset';
import { AppearItem, PopIn } from '@/components/anim';
import { useFloatingSection, FloatingSectionPill } from '@/components/FloatingSection';
import { SegmentedFilter, TabHeader } from '@/components/prisme';
import { QueueSkeleton } from '@/components/skeletons';
import { usePullRefresh } from '@/lib/usePullRefresh';

// Accueil coupé en trois (demande produit 2026-07-20, miroir de l'Agenda) :
// Séries = la file d'épisodes à voir (contenu historique de l'Accueil),
// Films = les films ajoutés mais pas encore vus, Jeux = les jeux « Voulus »
// pas encore commencés.
type HomeTab = 'series' | 'movies' | 'games';
const HOME_TABS: { value: HomeTab; label: string }[] = [
  { value: 'series', label: 'Séries' },
  { value: 'movies', label: 'Films' },
  { value: 'games', label: 'Jeux' },
];

export default function ShowsScreen() {
  const insets = useSafeAreaInsets();
  // Re-clic sur Accueil : le remontage rejoue le scroll initial de la file.
  const resetSeq = useTabResetSeq('index');
  const [tab, setTab] = useState<HomeTab>('series');
  return (
    <View key={resetSeq} style={{ flex: 1, backgroundColor: COLORS.pageMuted }}>
      <View style={[styles.homeHeader, { paddingTop: insets.top }]}>
        <TabHeader title="À voir" trailing={<HomeHeaderActions />} />
        <SegmentedFilter
          options={HOME_TABS}
          value={tab}
          onChange={setTab}
          accessibilityLabel="Choisir le type de contenu à voir"
          style={styles.homeTabs}
        />
      </View>
      {tab === 'series' ? <QueueView /> : tab === 'movies' ? <MoviesToWatchView /> : <GamesWishlistView />}
    </View>
  );
}

// Raccourci d'en-tête (Accueil uniquement) : la cloche de notifications, en
// haut à droite — disposition classique. Le Profil s'ouvre via sa tab.
function HomeHeaderActions() {
  const router = useRouter();
  const { data: unreadData } = useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: () => api.get<{ unreadCount: number }>('/api/notifications/unread-count'),
    refetchInterval: 30_000,
  });
  const unread = unreadData?.unreadCount ?? 0;
  return (
    <Pressable
      style={({ pressed }) => [styles.headerBtn, pressed && styles.headerBtnPressed]}
      onPress={() => router.push('/notifications')}
      accessibilityRole="button"
      accessibilityLabel={unread > 0 ? `Notifications, ${unread} non lue${unread > 1 ? 's' : ''}` : 'Notifications'}
      accessibilityHint="Ouvre le centre de notifications"
    >
      <Feather name="bell" size={25} color={COLORS.text} />
      {unread > 0 ? (
        <PopIn style={styles.headerBadge}>
          <Text style={styles.headerBadgeText}>{unread > 9 ? '9+' : unread}</Text>
        </PopIn>
      ) : null}
    </Pressable>
  );
}

type HistoryItem = { media: MediaDto; episode: EpisodeDto; watchedAt: string | null };

function QueueView() {
  const qc = useQueryClient();
  // L'historique est masqué au-dessus de la liste : on cale le scroll initial
  // juste en dessous, il se découvre en faisant défiler vers le haut (TV Time).
  const scrollRef = useRef<ScrollView>(null);
  const didInitialScroll = useRef(false);
  // Fenêtre « fiche épisode » (swipe latéral entre épisodes, façon TV Time).
  const [sheet, setSheet] = useState<EpisodeSheetTarget | null>(null);
  // Pastille de section FLOTTANTE (mécanique partagée, cf. FloatingSection).
  const { registerSection, onListScroll, floatLabel } = useFloatingSection();
  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['shows', 'queue'],
    queryFn: () => api.get<{ items: QueueItemDto[] }>('/api/shows/queue'),
  });
  const history = useQuery({
    queryKey: ['shows', 'history'],
    queryFn: () => api.get<{ items: HistoryItem[] }>('/api/shows/history'),
  });
  // Marquer l'épisode « à voir » comme vu : mise à jour optimiste — la carte
  // disparaît (ou avance) immédiatement, l'appel réseau suit (rollback si échec).
  const mark = useMutation({
    mutationFn: (episodeId: string) => api.post(`/api/episodes/${episodeId}/watched`),
    onMutate: async (episodeId: string) => {
      await qc.cancelQueries({ queryKey: ['shows', 'queue'] });
      const prev = qc.getQueryData<{ items: QueueItemDto[] }>(['shows', 'queue']);
      if (prev) {
        qc.setQueryData<{ items: QueueItemDto[] }>(['shows', 'queue'], {
          items: prev.items.filter((it) => it.nextEpisode?.id !== episodeId),
        });
      }
      return { prev };
    },
    onError: (_e: unknown, _id: string, ctx?: { prev?: { items: QueueItemDto[] } }) => {
      if (ctx?.prev) qc.setQueryData(['shows', 'queue'], ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['shows'] });
      qc.invalidateQueries({ queryKey: ['profile'] });
      qc.invalidateQueries({ queryKey: ['gamification'] }); // XP/badges/streak (spec 2026-07-16 §10)
      // Fiche série (clé singulier ['show', id] + ses épisodes) : une fiche
      // déjà en cache doit refléter l'épisode coché depuis l'agenda.
      qc.invalidateQueries({ queryKey: ['show'] });
    },
  });
  // Décocher depuis l'historique : l'épisode redevient « à voir ». Mise à jour
  // OPTIMISTE : la rangée disparaît de l'historique immédiatement.
  const unmark = useMutation({
    mutationFn: (episodeId: string) => api.post(`/api/episodes/${episodeId}/unwatched`),
    onMutate: async (episodeId: string) => {
      await qc.cancelQueries({ queryKey: ['shows', 'history'] });
      const prev = qc.getQueryData<{ items: HistoryItem[] }>(['shows', 'history']);
      if (prev) {
        qc.setQueryData<{ items: HistoryItem[] }>(['shows', 'history'], {
          items: prev.items.filter((it) => it.episode.id !== episodeId),
        });
      }
      return { prev };
    },
    onError: (_e: unknown, _id: string, ctx?: { prev?: { items: HistoryItem[] } }) => {
      if (ctx?.prev) qc.setQueryData(['shows', 'history'], ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['shows'] });
      qc.invalidateQueries({ queryKey: ['profile'] });
      qc.invalidateQueries({ queryKey: ['gamification'] }); // XP/badges/streak (spec 2026-07-16 §10)
      // Fiche série (clé singulier) : reflète l'épisode décoché depuis l'historique.
      qc.invalidateQueries({ queryKey: ['show'] });
    },
  });

  const { refreshing, onRefresh } = usePullRefresh([refetch, history.refetch]);

  // Anti-flash : l'historique est rendu AU-DESSUS de « À voir » puis le scroll
  // se cale en dessous — entre les deux, l'utilisateur voyait l'historique une
  // fraction de seconde (persistait en prod : l'historique peut arriver du
  // réseau APRÈS le premier rendu, l'ancien garde-fou 700 ms avait déjà
  // démasqué). Correctif racine, web : useLayoutEffect tourne APRÈS l'insertion
  // de l'historique dans le DOM mais AVANT la peinture du navigateur → le
  // scrollTop est posé avant qu'aucune frame ne montre l'historique, quel que
  // soit le moment où il arrive. Natif : onLayout + masque (comme avant).
  const [settled, setSettled] = useState(false);
  const historyWrapRef = useRef<View | null>(null);
  const historyCount = history.data?.items?.length ?? 0;
  useLayoutEffect(() => {
    if (Platform.OS !== 'web' || didInitialScroll.current) return;
    const node = historyWrapRef.current as unknown as HTMLElement | null;
    const scroller = (scrollRef.current as unknown as { getScrollableNode?: () => HTMLElement } | null)?.getScrollableNode?.();
    if (node && node.offsetHeight > 0) {
      didInitialScroll.current = true;
      if (scroller) scroller.scrollTop = node.offsetHeight;
      else scrollRef.current?.scrollTo({ y: node.offsetHeight, animated: false });
      setSettled(true); // flush synchrone avant la peinture (React 18)
    }
  }); // sans dépendances : rejoue à chaque commit tant que le calage n'est pas fait
  useEffect(() => {
    if (settled) return;
    if ((history.isSuccess && historyCount === 0) || history.isError) setSettled(true);
    // Ceinture et bretelles (surtout natif) : jamais masqué plus de 2,5 s.
    const t = setTimeout(() => setSettled(true), 2500);
    return () => clearTimeout(t);
  }, [settled, history.isSuccess, history.isError, historyCount]);

  if (isLoading) return <QueueSkeleton />;
  if (isError && !data) return <LoadError onRetry={refetch} busy={isRefetching} />;
  // Du plus ancien au plus récent : le dernier épisode coché juste au-dessus
  // de la section « À voir » (cf. TV Time).
  const historyItems = [...(history.data?.items ?? [])].reverse();
  if ((!data || data.items.length === 0) && historyItems.length === 0)
    return (
      <EmptyState
        title="Rien à voir pour le moment"
        message="Ajoutez des séries depuis Explorer ou importez vos données TV Time."
      />
    );

  // Héro « À regarder maintenant » : le tout premier épisode regardable de la
  // file (tri serveur). Il reste DANS son groupe (« À voir » en général) — il
  // en est juste la carte de tête, sous l'en-tête du groupe (retour Étienne
  // 2026-07-21 : l'épisode mis en avant doit compter dans « À voir »).
  const heroItem = (data?.items ?? []).find((it) => it.nextEpisode) ?? null;
  const groups = new Map<string, QueueItemDto[]>();
  (data?.items ?? []).forEach((it) => groups.set(it.group, [...(groups.get(it.group) ?? []), it]));

  return (
    <View style={{ flex: 1 }}>
    <ScrollView
      ref={scrollRef}
      // Masqué SEULEMENT quand un historique est rendu sans être encore calé :
      // pendant son chargement, la file « À voir » s'affiche normalement.
      style={{ opacity: settled || historyItems.length === 0 ? 1 : 0 }}
      contentContainerStyle={styles.queueContent}
      onScroll={onListScroll}
      scrollEventThrottle={16}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} colors={[COLORS.primary]} />}
    >
      {historyItems.length > 0 ? (
        <View
          ref={historyWrapRef}
          style={styles.queueColumn}
          onLayout={(e) => {
            registerSection('Historique de visionnage')(e);
            // Une fois l'historique mesuré, on cale le scroll juste en dessous
            // pour ouvrir l'écran sur « À voir » (l'historique reste au-dessus) ;
            // la liste ne devient visible qu'une fois le scroll appliqué.
            const h = e.nativeEvent.layout.height;
            if (!didInitialScroll.current && h > 0) {
              didInitialScroll.current = true;
              scrollRef.current?.scrollTo({ y: h, animated: false });
              requestAnimationFrame(() => setSettled(true));
            }
          }}
        >
          <GroupHead label="Historique de visionnage" count={historyItems.length} />
          {historyItems.map((it) => (
            <EpisodeQueueCard
              key={`h-${it.episode.id}`}
              item={{ group: 'a_voir', media: it.media, nextEpisode: it.episode, remainingCount: 0, badges: [] }}
              watched
              onCheck={() => unmark.mutate(it.episode.id)}
              onOpenEpisode={() =>
                setSheet({ mediaId: it.media.id, mediaTitle: it.media.title, posterPath: it.media.posterPath, episode: it.episode })
              }
            />
          ))}
        </View>
      ) : null}
      {(() => {
        // Index continu à travers les groupes pour une entrée en cascade.
        let n = -1;
        return [...groups.entries()].map(([group, items]) => (
          <View key={group} style={styles.queueColumn} onLayout={registerSection(queueGroupLabel(group))}>
            <GroupHead label={queueGroupLabel(group)} count={items.length} />
            {items.map((item) => {
              // L'épisode mis en avant est rendu en CARTE HÉRO, en tête de son
              // groupe (juste sous l'en-tête « À voir »).
              if (item === heroItem && item.nextEpisode) {
                return (
                  <HeroCard
                    key={item.media.id}
                    item={item}
                    marking={mark.isPending}
                    onMark={() => mark.mutate(item.nextEpisode!.id)}
                    onOpenEpisode={() =>
                      setSheet({
                        mediaId: item.media.id,
                        mediaTitle: item.media.title,
                        posterPath: item.media.posterPath,
                        episode: item.nextEpisode!,
                      })
                    }
                  />
                );
              }
              n += 1;
              return (
                <AppearItem key={item.media.id} index={n}>
                  <EpisodeQueueCard
                    item={item}
                    onCheck={() => item.nextEpisode && mark.mutate(item.nextEpisode.id)}
                    onOpenEpisode={
                      item.nextEpisode
                        ? () =>
                            setSheet({
                              mediaId: item.media.id,
                              mediaTitle: item.media.title,
                              posterPath: item.media.posterPath,
                              episode: item.nextEpisode!,
                            })
                        : undefined
                    }
                  />
                </AppearItem>
              );
            })}
          </View>
        ));
      })()}
    </ScrollView>

      {/* Pastille de section flottante (façon TV Time) : suit le défilement,
          change de libellé au passage d'une section, rebond à l'apparition. */}
      <FloatingSectionPill label={floatLabel} />

      <EpisodeSheet target={sheet} onClose={() => setSheet(null)} />
    </View>
  );
}

// En-tête de section de la file (maquette : libellé + compteur — épisodes par
// défaut, films/jeux dans les sous-onglets de l'Accueil).
function GroupHead({ label, count, unit = 'épisode' }: { label: string; count: number; unit?: string }) {
  return (
    <View style={styles.groupHead}>
      <Text accessibilityRole="header" style={styles.groupHeadLabel}>
        {label}
      </Text>
      <Text style={styles.groupHeadCount}>
        {count} {unit}{count > 1 ? 's' : ''}
      </Text>
    </View>
  );
}

// --- Sous-onglet Films : les films AJOUTÉS mais pas encore vus (déjà sortis,
// les sorties futures vivent dans l'Agenda > Films). Même source que
// l'Agenda (`/api/movies`), cache partagé.
type MoviesResponse = { toWatch: MediaDto[]; upcoming: { media: MediaDto; releaseDate: string }[] };

function MoviesToWatchView() {
  const router = useRouter();
  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['movies'],
    queryFn: () => api.get<MoviesResponse>('/api/movies'),
  });
  const { refreshing, onRefresh } = usePullRefresh([refetch]);
  if (isLoading) return <QueueSkeleton />;
  if (isError && !data) return <LoadError onRetry={refetch} busy={isRefetching} />;
  const items = data?.toWatch ?? [];
  if (items.length === 0)
    return <EmptyState title="Aucun film à voir" message="Ajoutez des films depuis Explorer : ils vous attendront ici." />;
  return (
    <ScrollView
      contentContainerStyle={styles.homeListContent}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} colors={[COLORS.primary]} />}
    >
      <View style={styles.queueColumn}>
        <GroupHead label="À voir" count={items.length} unit="film" />
        {items.map((media, i) => (
          <AppearItem key={media.id} index={i}>
            <ToWatchRow
              title={media.title}
              sub={media.year ? String(media.year) : null}
              uri={tmdbImage(media.posterPath ?? null, 'w342')}
              onPress={() => router.push(`/show/${media.id}?type=movie`)}
              hint="Ouvre la fiche du film"
            />
          </AppearItem>
        ))}
      </View>
    </ScrollView>
  );
}

// --- Sous-onglet Jeux : les jeux marqués « Voulu » (donc pas encore
// commencés — dès qu'on y joue, le statut passe à « En cours »).
type HomeGameDto = { id: string; title: string; posterPath: string | null; year: number | null };

function GamesWishlistView() {
  const router = useRouter();
  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['games', 'library'],
    queryFn: () => api.get<{ wishlist: HomeGameDto[] }>('/api/games'),
  });
  const { refreshing, onRefresh } = usePullRefresh([refetch]);
  if (isLoading) return <QueueSkeleton />;
  if (isError && !data) return <LoadError onRetry={refetch} busy={isRefetching} />;
  const items = data?.wishlist ?? [];
  if (items.length === 0)
    return (
      <EmptyState
        title="Aucun jeu en attente"
        message="Marquez des jeux en « Voulu » depuis Explorer : votre liste d'envies s'affichera ici."
      />
    );
  return (
    <ScrollView
      contentContainerStyle={styles.homeListContent}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} colors={[COLORS.primary]} />}
    >
      <View style={styles.queueColumn}>
        <GroupHead label="Voulus" count={items.length} unit="jeu" />
        {items.map((game, i) => (
          <AppearItem key={game.id} index={i}>
            <ToWatchRow
              title={game.title}
              sub={game.year ? String(game.year) : null}
              uri={tmdbImage(game.posterPath, 'w342')}
              onPress={() => router.push(`/game/${game.id}`)}
              hint="Ouvre la fiche du jeu"
            />
          </AppearItem>
        ))}
      </View>
    </ScrollView>
  );
}

// Rangée commune Films/Jeux de l'Accueil : affiche + titre (+ année).
function ToWatchRow({
  title,
  sub,
  uri,
  onPress,
  hint,
}: {
  title: string;
  sub: string | null;
  uri: string | null;
  onPress: () => void;
  hint: string;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.toWatchRow, pressed && styles.toWatchRowPressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={sub ? `${title}, ${sub}` : title}
      accessibilityHint={hint}
    >
      {uri ? (
        <Image source={{ uri }} style={styles.toWatchPoster} resizeMode="cover" accessible={false} />
      ) : (
        <View style={[styles.toWatchPoster, styles.toWatchPosterEmpty]} accessible={false}>
          <Feather name="image" size={22} color={COLORS.textSoft} />
        </View>
      )}
      <View style={styles.toWatchBody}>
        <Text style={styles.toWatchTitle} numberOfLines={2}>{title}</Text>
        {sub ? <Text style={styles.toWatchSub}>{sub}</Text> : null}
      </View>
      <Feather name="chevron-right" size={20} color={COLORS.textSoft} />
    </Pressable>
  );
}

const HERO_BADGES: Record<string, { label: string; variant: 'black' | 'yellow' }> = {
  PREMIERE: { label: 'PREMIERE', variant: 'black' },
  NOUVEAU: { label: 'NOUVEAU', variant: 'yellow' },
  PLUS_RECENT: { label: 'PLUS RÉCENT', variant: 'black' },
};

// Carte héro « À regarder maintenant » (maquette Prisme) : backdrop de la
// série, dégradé de lisibilité, progression et action « Marquer vu ». Le titre
// ouvre la fiche série, la carte ouvre la fiche épisode (mêmes gestes que les
// rangées de la file).
function HeroCard({
  item,
  marking,
  onMark,
  onOpenEpisode,
}: {
  item: QueueItemDto;
  marking: boolean;
  onMark: () => void;
  onOpenEpisode: () => void;
}) {
  const router = useRouter();
  const ep = item.nextEpisode!;
  const backdrop =
    tmdbImage(item.media.backdropPath, 'w780') ?? tmdbImage(ep.stillPath, 'w300') ?? tmdbImage(item.media.posterPath, 'w342');
  const openShow = () => router.push(`/show/${item.media.id}`);
  const pct = item.progress && item.progress.total > 0
    ? Math.max(0, Math.min(100, (item.progress.watched / item.progress.total) * 100))
    : null;
  return (
    <Pressable
      style={({ pressed }) => [styles.hero, pressed && styles.heroPressed]}
      onPress={onOpenEpisode}
      accessibilityRole="button"
      accessibilityLabel={`À regarder maintenant : ${item.media.title}, ${episodeCodeCompact(ep.seasonNumber, ep.episodeNumber)}, ${ep.title}`}
      accessibilityHint="Ouvre le détail de l'épisode"
    >
      {backdrop ? (
        <Image source={{ uri: backdrop }} style={StyleSheet.absoluteFill} resizeMode="cover" accessible={false} />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.heroFallback]} />
      )}
      <LinearGradient colors={['rgba(23,15,45,0.16)', 'rgba(15,9,32,0.90)']} style={StyleSheet.absoluteFill} />
      <View style={styles.heroContent}>
        <Text style={styles.heroEyebrow}>À REGARDER MAINTENANT</Text>
        <Pressable
          onPress={(event) => {
            event.stopPropagation();
            openShow();
          }}
          hitSlop={4}
          accessibilityRole="button"
          accessibilityLabel={`Ouvrir ${item.media.title}`}
        >
          <Text style={styles.heroTitle} numberOfLines={2}>
            {item.media.title}
          </Text>
        </Pressable>
        <Text style={styles.heroEp} numberOfLines={1}>
          {episodeCodeCompact(ep.seasonNumber, ep.episodeNumber)} — {ep.title}
        </Text>
        {pct !== null ? (
          <View
            style={styles.heroTrack}
            accessible
            accessibilityRole="progressbar"
            accessibilityLabel={`${item.progress!.watched} épisode${item.progress!.watched > 1 ? 's' : ''} vu${item.progress!.watched > 1 ? 's' : ''} sur ${item.progress!.total}`}
            accessibilityValue={{ min: 0, max: item.progress!.total, now: item.progress!.watched }}
          >
            <LinearGradient
              colors={[COLORS.secondary, COLORS.primary]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={[styles.heroFill, { width: `${pct}%` }]}
            />
          </View>
        ) : null}
        <View style={styles.heroActions}>
          <Pressable
            style={({ pressed }) => [styles.heroBtn, pressed && styles.heroBtnPressed, marking && styles.heroBtnBusy]}
            disabled={marking}
            onPress={(event) => {
              event.stopPropagation();
              onMark();
            }}
            accessibilityRole="button"
            accessibilityLabel="Marquer l'épisode comme vu"
            accessibilityState={{ disabled: marking, busy: marking }}
          >
            {marking ? (
              <ActivityIndicator size="small" color={COLORS.onPrimary} />
            ) : (
              <Feather name="check" size={17} color={COLORS.onPrimary} />
            )}
            <Text style={styles.heroBtnText}>Marquer vu</Text>
          </Pressable>
          {item.badges.map((b) => {
            const badge = HERO_BADGES[b];
            return badge ? <Badge key={b} label={badge.label} variant={badge.variant} /> : null;
          })}
          {item.remainingCount > 0 ? (
            <Text
              style={styles.heroPlus}
              accessibilityLabel={`${item.remainingCount} épisode${item.remainingCount > 1 ? 's' : ''} supplémentaire${item.remainingCount > 1 ? 's' : ''}`}
            >
              +{item.remainingCount}
            </Text>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

export function UpcomingView() {
  // Historique des sorties (HIER, AVANT-HIER…) masqué au-dessus de la liste,
  // comme l'historique de visionnage de « À voir » : le scroll initial se cale
  // sur AUJOURD'HUI, on remonte pour rattraper une sortie manquée.
  const scrollRef = useRef<ScrollView>(null);
  const didInitialScroll = useRef(false);
  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['shows', 'upcoming'],
    queryFn: () =>
      api.get<{
        groups: { label: string; items: UpcomingItemDto[] }[];
        past?: { label: string; items: UpcomingItemDto[] }[];
      }>('/api/shows/upcoming'),
  });
  const { refreshing, onRefresh } = usePullRefresh([refetch]);
  // Anti-flash (même mécanique que « À voir ») : web = scrollTop posé avant
  // la peinture (useLayoutEffect), natif = onLayout + masque.
  const [settled, setSettled] = useState(false);
  const pastWrapRef = useRef<View | null>(null);
  const pastCount = data?.past?.length ?? 0;
  useLayoutEffect(() => {
    if (Platform.OS !== 'web' || didInitialScroll.current) return;
    const node = pastWrapRef.current as unknown as HTMLElement | null;
    const scroller = (scrollRef.current as unknown as { getScrollableNode?: () => HTMLElement } | null)?.getScrollableNode?.();
    if (node && node.offsetHeight > 0) {
      didInitialScroll.current = true;
      if (scroller) scroller.scrollTop = node.offsetHeight;
      else scrollRef.current?.scrollTo({ y: node.offsetHeight, animated: false });
      setSettled(true);
    }
  });
  useEffect(() => {
    if (settled) return;
    if (data && pastCount === 0) setSettled(true);
    const t = setTimeout(() => setSettled(true), 2500);
    return () => clearTimeout(t);
  }, [settled, data, pastCount]);
  if (isLoading) return <QueueSkeleton />;
  if (isError && !data) return <LoadError onRetry={refetch} busy={isRefetching} />;
  const pastGroups = data?.past ?? [];
  if (!data || (data.groups.length === 0 && pastGroups.length === 0))
    return <EmptyState title="Aucun épisode à venir" message="Les prochaines diffusions apparaîtront ici." />;

  return (
    <ScrollView
      ref={scrollRef}
      style={{ opacity: settled || pastGroups.length === 0 ? 1 : 0 }}
      contentContainerStyle={styles.agendaContent}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} colors={[COLORS.primary]} />}
    >
      {pastGroups.length > 0 ? (
        <View
          ref={pastWrapRef}
          style={styles.agendaPastWrap}
          onLayout={(e) => {
            const h = e.nativeEvent.layout.height;
            if (!didInitialScroll.current && h > 0) {
              didInitialScroll.current = true;
              scrollRef.current?.scrollTo({ y: h, animated: false });
              requestAnimationFrame(() => setSettled(true));
            }
          }}
        >
          {pastGroups.map((g) => (
            <View key={`p-${g.label}`} style={styles.agendaGroup}>
              <PillHeader label={g.label} />
              {g.items.map((item) => (
                <UpcomingCard key={`${item.media.id}-${item.date}`} item={item} past />
              ))}
            </View>
          ))}
        </View>
      ) : null}
      {data.groups.map((g) => (
        <View key={g.label} style={styles.agendaGroup}>
          <PillHeader label={g.label} />
          {g.items.map((item) => (
            <UpcomingCard key={`${item.media.id}-${item.date}`} item={item} />
          ))}
        </View>
      ))}
    </ScrollView>
  );
}

function UpcomingCard({ item, past = false }: { item: UpcomingItemDto; past?: boolean }) {
  const router = useRouter();
  const ep = item.episodes[0];
  if (!ep) return null;
  const isPremiere = ep.seasonNumber >= 1 && ep.episodeNumber === 1;
  // Vignette : image de l'épisode si déjà publiée, sinon affiche de la série.
  const thumbUri = tmdbImage(ep.stillPath, 'w300') ?? tmdbImage(item.media.posterPath, 'w342');
  const air = airTimeLabel(ep.airDate);
  const accessibilityLabel = [
    item.media.title,
    episodeCode(ep.seasonNumber, ep.episodeNumber),
    ep.title,
    air ? `à ${air}` : null,
    ep.network ?? null,
    isPremiere ? 'Première' : null,
    item.episodes.length > 1 ? `${item.episodes.length} épisodes` : null,
  ].filter(Boolean).join(', ');

  return (
    <Pressable
      style={({ pressed }) => [styles.upcard, past && styles.upcardPast, pressed && styles.upcardPressed]}
      onPress={() => router.push(`/show/${item.media.id}`)}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={"Ouvre la fiche de la s\u00e9rie"}
    >
      {thumbUri ? (
        <Image source={{ uri: thumbUri }} style={[styles.thumb, past && styles.thumbPast]} resizeMode="cover" accessible={false} />
      ) : (
        <View style={[styles.thumb, past && styles.thumbPast]} accessible={false}>
          <Feather name="image" size={26} color={COLORS.textSoft} />
        </View>
      )}
      <View style={styles.body}>
        <View style={styles.topRow}>
          <View style={{ flexShrink: 1 }}>
            <ShowPill label={item.media.title} onPress={() => router.push(`/show/${item.media.id}`)} />
          </View>
          {air || ep.network ? (
            <View style={styles.schedule}>
              {air ? <Text style={styles.time}>{air}</Text> : null}
              {ep.network ? <Text style={styles.ch}>{ep.network}</Text> : null}
            </View>
          ) : null}
        </View>
        <Text style={styles.code}>{episodeCode(ep.seasonNumber, ep.episodeNumber)}</Text>
        <Text style={styles.epTitle} numberOfLines={1}>
          {ep.title}
        </Text>
        {isPremiere ? (
          <View style={styles.badgeRow}>
            <Badge label="PREMIERE" variant="black" />
          </View>
        ) : null}
        {item.episodes.length > 1 ? (
          <Text style={styles.multi}>{item.episodes.length} épisodes</Text>
        ) : null}
      </View>
    </Pressable>
  );
}

// Carte chronologique compacte : hiérarchie Studio dans le shell Prisme.
const styles = StyleSheet.create({
  // En-tête aligné sur ceux de l'Agenda et de la Communauté (mêmes paddings,
  // retour Étienne 2026-07-21).
  homeHeader: {
    backgroundColor: COLORS.white,
    paddingHorizontal: SPACE.md,
    paddingBottom: SPACE.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.borderLight,
  },
  // Sous-onglets Séries / Films / Jeux (identiques à ceux de l'Agenda).
  homeTabs: { width: '100%', maxWidth: SIZES.contentMax, alignSelf: 'center' },
  // File « À voir » : contenu centré et borné à contentMax comme l'agenda et la
  // bibliothèque (les cartes ne s'étirent plus bord à bord sur web/tablette).
  queueContent: { alignItems: 'center', paddingBottom: SIZES.tabBar + SPACE.xl },
  queueColumn: { width: '100%', maxWidth: SIZES.contentMax },
  // Listes Films à voir / Jeux voulus.
  homeListContent: { alignItems: 'center', paddingBottom: SIZES.tabBar + SPACE.xl },
  toWatchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.sm,
    marginHorizontal: SPACE.md,
    marginBottom: SPACE.sm,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: RADIUS.card,
    padding: SPACE.sm,
    ...SHADOW.card,
  },
  toWatchRowPressed: { opacity: 0.85 },
  toWatchPoster: { width: 52, height: 76, borderRadius: RADIUS.small, backgroundColor: COLORS.imagePlaceholder },
  toWatchPosterEmpty: { alignItems: 'center', justifyContent: 'center' },
  toWatchBody: { flex: 1, minWidth: 0 },
  toWatchTitle: { color: COLORS.text, fontFamily: FONTS.semiBold, fontSize: 15 },
  toWatchSub: { color: COLORS.textMuted, fontFamily: FONTS.regular, fontSize: 13, marginTop: 2 },
  agendaContent: {
    alignItems: 'center',
    paddingTop: SPACE.xxs,
    paddingBottom: SIZES.tabBar + SPACE.xl,
  },
  agendaPastWrap: { width: '100%', maxWidth: SIZES.contentMax },
  agendaGroup: { width: '100%', maxWidth: SIZES.contentMax },
  upcard: {
    flexDirection: 'row',
    minHeight: 112,
    marginHorizontal: SPACE.md,
    marginBottom: SPACE.sm,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: RADIUS.card,
    overflow: 'hidden',
    ...SHADOW.card,
  },
  upcardPast: { backgroundColor: COLORS.surfaceMuted, borderColor: COLORS.border },
  upcardPressed: { opacity: 0.84 },
  thumb: {
    width: 112,
    minHeight: 112,
    backgroundColor: COLORS.imagePlaceholder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbPast: { opacity: 0.82 },
  body: { flex: 1, justifyContent: 'center', paddingHorizontal: SPACE.sm, paddingVertical: SPACE.sm, gap: SPACE.xxs },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', gap: SPACE.xs, alignItems: 'flex-start' },
  schedule: { alignItems: 'flex-end', flexShrink: 0, minHeight: SIZES.touch },
  time: { color: COLORS.text, fontSize: 13, lineHeight: 17, fontFamily: FONTS.extraBold },
  ch: {
    maxWidth: 96,
    color: COLORS.textMuted,
    fontSize: 10,
    lineHeight: 14,
    fontFamily: FONTS.bold,
    textTransform: 'uppercase',
    textAlign: 'right',
  },
  code: { color: COLORS.text, fontSize: 17, lineHeight: 22, fontFamily: FONTS.extraBold },
  epTitle: { color: COLORS.textMuted, fontFamily: FONTS.regular, fontSize: 13, lineHeight: 18 },
  badgeRow: { flexDirection: 'row', marginTop: 2 },
  multi: { color: COLORS.secondary, fontFamily: FONTS.bold, fontSize: 12, lineHeight: 16, marginTop: SPACE.xxs },
  // Raccourcis d'en-tête Accueil (cloche + avatar, disposition maquette).
  // Icône nue, calée à droite (façon Instagram) : cible 44 px conservée, le
  // glyphe affleure au padding de l'écran.
  headerBtn: {
    width: SIZES.touch,
    height: SIZES.touch,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  headerBtnPressed: { opacity: 0.55, transform: [{ scale: 0.94 }] },
  headerBadge: {
    position: 'absolute',
    top: -3,
    right: -3,
    minWidth: 18,
    height: 18,
    borderRadius: RADIUS.pill,
    borderWidth: 2,
    borderColor: COLORS.white,
    backgroundColor: COLORS.notif,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  headerBadgeText: { color: '#FFFFFF', fontSize: 9, fontFamily: FONTS.extraBold },
  // En-têtes de section de la file (libellé + compteur, façon « Ensuite »).
  groupHead: {
    minHeight: SIZES.touch,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACE.sm,
    paddingHorizontal: SPACE.md,
    paddingTop: SPACE.sm,
    paddingBottom: SPACE.xxs,
  },
  groupHeadLabel: { flexShrink: 1, color: COLORS.text, fontSize: 20, lineHeight: 26, fontFamily: FONTS.extraBold },
  groupHeadCount: { flexShrink: 0, color: COLORS.textMuted, fontSize: 13, fontFamily: FONTS.semiBold },
  // Carte héro « À regarder maintenant ».
  hero: {
    minHeight: 220,
    marginHorizontal: SPACE.md,
    marginTop: SPACE.sm,
    marginBottom: SPACE.xs,
    borderRadius: RADIUS.card,
    overflow: 'hidden',
    justifyContent: 'flex-end',
    backgroundColor: '#241B3D',
    ...SHADOW.card,
  },
  heroPressed: { opacity: 0.92 },
  heroFallback: { backgroundColor: '#241B3D' },
  heroContent: { padding: SPACE.md, gap: 6 },
  heroEyebrow: { color: 'rgba(255,255,255,0.78)', fontSize: 11, letterSpacing: 1.2, fontFamily: FONTS.bold },
  heroTitle: { color: '#FFFFFF', fontSize: 26, lineHeight: 32, fontFamily: FONTS.extraBold },
  heroEp: { color: 'rgba(255,255,255,0.86)', fontSize: 14, lineHeight: 19, fontFamily: FONTS.medium },
  heroTrack: {
    height: 7,
    borderRadius: RADIUS.pill,
    backgroundColor: 'rgba(255,255,255,0.24)',
    overflow: 'hidden',
    marginTop: 4,
  },
  heroFill: { height: '100%', borderRadius: RADIUS.pill },
  heroActions: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, marginTop: SPACE.xs },
  heroBtn: {
    minHeight: SIZES.touch,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACE.xs,
    paddingHorizontal: SPACE.md,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.primary,
  },
  heroBtnPressed: { opacity: 0.86, transform: [{ scale: 0.98 }] },
  heroBtnBusy: { opacity: 0.6 },
  heroBtnText: { color: COLORS.onPrimary, fontSize: 15, fontFamily: FONTS.extraBold },
  heroPlus: { color: '#FFFFFF', fontSize: 13, fontFamily: FONTS.extraBold },
});
