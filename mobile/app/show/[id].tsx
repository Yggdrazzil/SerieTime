import React, { useState, useEffect, useRef } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Modal, TextInput, ActivityIndicator, Image, Share, Platform, useWindowDimensions, Alert } from 'react-native';
import { Feather, Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import Svg, { Circle, Line, Polyline, Text as SvgText } from 'react-native-svg';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { goBack } from '@/lib/nav';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, tmdbImage, ApiError } from '@/lib/api';
import type { EpisodeDto, MediaDto, UserMediaState } from '@/lib/types';
import { episodeCode } from '@/lib/format';
import { COLORS, RADIUS, SHADOW, FONTS, STATUS_BAR, SIZES, SPACE } from '@/lib/theme';
import { Loading, LoadError, EmptyState } from '@/components/ui';
import {
  FicheTopActions, FicheBanner, FicheIdentity, FicheTabs, StatTile, StatTiles,
  FicheSection, InfoRow, ProgressRing, EpisodeCheck, rating5,
} from '@/components/fiche';
import { useFeedSessionStore } from '@/components/explore/feedSession';
import { AnimatedFill, Pop, SlideUpBar, FadeSwitch, PressableScale } from '@/components/anim';
import { Stars } from '@/components/Stars';
import { MarkPreviousPopup, hasUnwatchedPrevious } from '@/components/MarkPreviousPopup';
import { EpisodeSheet, type EpisodeSheetTarget } from '@/components/EpisodeSheet';
import { genresFr, statusFr, airDayFr, compactCount } from '@/lib/frMedia';
import { FicheSkeleton } from '@/components/FicheSkeleton';
import { ReportModal } from '@/components/ReportModal';
import { StatusLine } from '@/components/StatusLine';
import { useReduceMotion } from '@/lib/useReduceMotion';
import { useBackClose } from '@/lib/useBackClose';

const STATUS_LABELS: Record<string, string> = {
  watching: 'En cours', completed: 'Terminée', watchlist: 'À voir',
  paused: 'En pause', abandoned: 'Arrêtée', not_started: 'Pas commencée',
};
// Ligne de suivi (StatusLine) : statuts proposés par type de fiche —
// valeurs EXACTES acceptées par le serveur (shows/routes.ts : POST /status
// accepte watching|completed|watchlist|paused|abandoned|not_started ;
// movies/routes.ts : /watched → completed, /unwatched et /watchlist → watchlist).
const SHOW_STATUS_OPTIONS = [
  { value: 'watchlist', label: 'À voir' },
  { value: 'watching', label: 'En cours' },
  { value: 'completed', label: 'Terminée' },
  { value: 'abandoned', label: 'Arrêtée' },
];
const MOVIE_STATUS_OPTIONS = [
  { value: 'watchlist', label: 'À voir' },
  { value: 'completed', label: 'Vu' },
];

// Ordres d'épisodes (numérotation) : le serveur remappe DÉJÀ toutes les
// réponses (fiche, queue, agenda) — côté app il n'y a qu'une légende discrète
// quand un ordre non officiel est actif, et un override caché dans le menu ⋯.
type EpisodeOrderInfo = {
  effective: 'official' | 'alternate' | 'dvd' | 'absolute' | 'regional' | 'altdvd';
  source: 'auto' | 'user' | 'official';
};
type OrdersData = {
  available: { type: string; label: string; seasons?: number }[];
  effective: string;
  source: 'auto' | 'user' | 'official';
  current: string | null;
};
const ORDER_LABELS: Record<string, string> = {
  official: 'Officielle',
  alternate: 'Streaming',
  dvd: 'DVD',
  absolute: 'Absolue',
  regional: 'Régionale',
  altdvd: 'DVD alternatif',
};

// « 1h 46m » (films) à partir de la durée en minutes.
function fmtRuntime(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${h}h`;
}

export default function ShowDetail() {
  const { id, type } = useLocalSearchParams<{ id: string; type?: string }>();
  const isMovie = type === 'movie';
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const reduceMotion = useReduceMotion();
  const qc = useQueryClient();
  const [tab, setTab] = useState('À PROPOS');
  const [menu, setMenu] = useState(false);
  // Retour (PWA/Android) : ferme le menu « … » au lieu de reculer le routeur.
  useBackClose(menu, () => setMenu(false));
  const [justAdded, setJustAdded] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [persoMenu, setPersoMenu] = useState(false);
  const [artwork, setArtwork] = useState<'poster' | 'banner' | null>(null);
  const [listsOpen, setListsOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [orderOpen, setOrderOpen] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const addedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Bandeau éphémère en bas d'écran (façon « AJOUTÉE ! » de TV Time).
  const showToast = (msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2000);
  };
  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    if (addedTimer.current) clearTimeout(addedTimer.current);
  }, []);

  const detail = useQuery({
    queryKey: [isMovie ? 'movie' : 'show', id],
    queryFn: () => api.get<any>(`/api/${isMovie ? 'movies' : 'shows'}/${id}`),
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: [isMovie ? 'movie' : 'show', id] });
    qc.invalidateQueries({ queryKey: ['shows'] });
    qc.invalidateQueries({ queryKey: ['movies'] });
    qc.invalidateQueries({ queryKey: ['profile'] });
    qc.invalidateQueries({ queryKey: ['gamification'] }); // XP/badges/streak (spec 2026-07-16 §10)
    // Les résultats de recherche (Explorer) affichent « ajouté » via inLibrary :
    // les invalider pour qu'au retour depuis la fiche, l'état soit déjà à jour.
    // (PAS ['explore'] : re-tirer le flux Découvrir pendant la navigation est
    // interdit par la règle produit — il ne se renouvelle QUE sur demande :
    // pull-to-refresh, carte de fin, re-tap de l'onglet Explorer.)
    qc.invalidateQueries({ queryKey: ['search'] });
  };

  // Progression globale de la série (même cache que l'onglet Épisodes) pour la
  // barre au bas de la bannière — basée sur les épisodes DIFFUSÉS uniquement.
  const episodesQ = useQuery({
    queryKey: ['show', id, 'episodes'],
    queryFn: () =>
      api.get<{ seasons: { seasonNumber: number; totalCount: number; episodes: { airDate?: string | null; watched: boolean }[] }[] }>(
        `/api/shows/${id}/episodes`,
      ),
    enabled: !isMovie,
  });

  // Ordres d'épisodes disponibles : tirés SEULEMENT à l'ouverture du menu ⋯
  // (l'entrée « Ordre des épisodes » n'apparaît que s'il y a un vrai choix).
  const ordersQ = useQuery({
    queryKey: ['show', id, 'orders'],
    queryFn: () => api.get<OrdersData>(`/api/shows/${id}/orders`),
    enabled: !isMovie && (menu || orderOpen),
    staleTime: 5 * 60_000,
  });
  // Override d'ordre : POST puis invalidation du préfixe ['show', id] (fiche,
  // épisodes, orders) + ['shows'] (files/agenda) — le serveur renvoie tout remappé.
  const setOrder = useMutation({
    mutationFn: (order: string | null) => api.post<{ ok: boolean; effective: string }>(`/api/shows/${id}/order`, { order }),
    onSuccess: () => {
      setOrderOpen(false);
      qc.invalidateQueries({ queryKey: ['show', id] });
      qc.invalidateQueries({ queryKey: ['shows'] });
    },
    onError: (e: unknown) => {
      setOrderOpen(false);
      showToast(
        e instanceof ApiError && e.status === 422
          ? "Cet ordre n'est pas disponible pour cette série."
          : 'Modification impossible. Réessaie.',
      );
    },
  });

  // Mises à jour OPTIMISTES (recette TanStack Query) : on écrit tout de suite
  // le résultat attendu dans le cache de la fiche (l'UI réagit immédiatement),
  // le serveur confirme en arrière-plan ; rollback si échec, et `refresh` en
  // onSettled réconcilie tout (files, profil…) sans bloquer l'utilisateur.
  const detailKey = [isMovie ? 'movie' : 'show', String(id)];
  const patchMedia = async (patch: Partial<MediaDto>) => {
    await qc.cancelQueries({ queryKey: detailKey });
    const prev = qc.getQueryData<{ media: MediaDto }>(detailKey);
    if (prev?.media) qc.setQueryData(detailKey, { ...prev, media: { ...prev.media, ...patch } });
    return { prev };
  };
  const rollback = (ctx?: { prev?: unknown }) => {
    if (ctx?.prev) qc.setQueryData(detailKey, ctx.prev);
  };

  const favorite = useMutation({
    mutationFn: () => api.post('/api/' + (isMovie ? 'movies' : 'shows') + '/' + id + '/favorite'),
    onMutate: () => patchMedia({ isFavorite: !detail.data?.media?.isFavorite }),
    onError: (_e, _v, ctx) => { rollback(ctx); showToast('Modification impossible. Réessaie.'); },
    onSettled: refresh,
  });
  const markMovie = useMutation({
    mutationFn: (seen: boolean) => api.post('/api/movies/' + id + '/' + (seen ? 'watched' : 'unwatched')),
    onMutate: (seen: boolean) => patchMedia({ userStatus: seen ? 'completed' : 'watchlist' }),
    onError: (_e, _v, ctx) => { rollback(ctx); showToast('Modification impossible. Réessaie.'); },
    onSettled: refresh,
  });
  // Suivre (façon TV Time) : série -> statut « Pas commencé », film -> watchlist.
  const follow = useMutation({
    mutationFn: () => api.post(isMovie ? '/api/movies/' + id + '/watchlist' : '/api/shows/' + id + '/follow'),
    onMutate: () => patchMedia({ userStatus: isMovie ? 'watchlist' : 'not_started' }),
    onSuccess: () => {
      setJustAdded(true);
      if (addedTimer.current) clearTimeout(addedTimer.current);
      addedTimer.current = setTimeout(() => setJustAdded(false), 2000);
    },
    onError: (_e, _v, ctx) => { rollback(ctx); showToast('Ajout impossible. Réessaie.'); },
    onSettled: refresh,
  });
  const watchLater = useMutation({
    mutationFn: () => api.post(isMovie ? '/api/movies/' + id + '/watchlist' : '/api/shows/' + id + '/watchlater'),
    onMutate: () => patchMedia({ userStatus: 'watchlist' }),
    onSuccess: () => showToast('À voir'),
    onError: (_e, _v, ctx) => { rollback(ctx); showToast('Modification impossible. Réessaie.'); },
    onSettled: refresh,
  });
  // « Arrêter de regarder » (série commencée) : statut « Arrêtée », la série
  // rejoint la section ARRÊTÉ de la page Séries du profil et disparaît de
  // « À venir ». Le statut est volontairement collant : cocher un épisode ne
  // la fait PAS repasser « En cours » (cf. recalculateShowStatus côté serveur).
  const abandon = useMutation({
    mutationFn: () => api.post('/api/shows/' + id + '/abandon'),
    onMutate: () => patchMedia({ userStatus: 'abandoned' }),
    onSuccess: () => showToast('Série arrêtée'),
    onError: (_e, _v, ctx) => { rollback(ctx); showToast('Modification impossible. Réessaie.'); },
    onSettled: refresh,
  });
  const removeTracking = useMutation({
    mutationFn: () => api.del('/api/' + (isMovie ? 'movies' : 'shows') + '/' + id + '/tracking'),
    onMutate: () => patchMedia({ userStatus: null, isFavorite: false }),
    onSuccess: () => showToast(isMovie ? 'Film supprimé' : 'Série supprimée'),
    onError: (_e, _v, ctx) => { rollback(ctx); showToast('Suppression impossible. Réessaie.'); },
    onSettled: refresh,
  });
  // Statut libre d'une SÉRIE (ligne de suivi) : POST /api/shows/:id/status
  // pour « En cours » / « Terminée » ; « À voir » et « Arrêtée » passent par
  // les mutations dédiées (watchLater/abandon) qui créent l'événement social.
  const setShowStatus = useMutation({
    mutationFn: (status: UserMediaState) => api.post('/api/shows/' + id + '/status', { status }),
    onMutate: (status: UserMediaState) => patchMedia({ userStatus: status }),
    onError: (_e, _v, ctx) => { rollback(ctx); showToast('Modification impossible. Réessaie.'); },
    onSettled: refresh,
  });
  const trackingBusy = favorite.isPending || markMovie.isPending || follow.isPending || watchLater.isPending || abandon.isPending || removeTracking.isPending || setShowStatus.isPending;
  // Ligne de suivi (composant partagé avec la fiche jeu) :
  // — série/animé : pas de désélection (DELETE /tracking efface aussi
  //   l'historique d'épisodes → réservé à « Supprimer la série » du menu) ;
  // — film : re-taper le statut actif retire le film (même effet que
  //   « Supprimer le film » du menu, sans perte d'historique).
  const changeStatus = (value: string | null) => {
    if (isMovie) {
      if (value === null) removeTracking.mutate();
      else markMovie.mutate(value === 'completed');
      return;
    }
    if (value === 'watchlist') watchLater.mutate();
    else if (value === 'abandoned') abandon.mutate();
    else if (value === 'watching' || value === 'completed') setShowStatus.mutate(value);
  };
  const share = () => {
    const message = `Regarde « ${detail.data?.media?.title} » — suivi avec PlotTime 📺`;
    const url = typeof window !== 'undefined' ? window.location.href : undefined;
    // Web app (plateforme principale) : Share natif RN n'existe pas → Web Share
    // API si dispo (Safari iOS / Chrome Android), sinon copie dans le presse-papier.
    if (Platform.OS === 'web') {
      const nav = typeof navigator !== 'undefined' ? (navigator as Navigator & { share?: (d: object) => Promise<void> }) : undefined;
      if (nav?.share) {
        nav.share({ title: 'PlotTime', text: message, url }).catch(() => undefined);
      } else if (nav?.clipboard) {
        nav.clipboard.writeText(`${message}${url ? ` ${url}` : ''}`).then(() => showToast('Lien copié'), () => undefined);
      }
      return;
    }
    Share.share({ message }).catch(() => undefined);
  };

  // Signalement : envoie l'œuvre à l'équipe de modération (tri manuel).
  // Le succès n’est affiché qu’après confirmation du serveur.
  const submitReport = async () => {
    setReportOpen(false);
    const m: MediaDto | undefined = detail.data?.media;
    if (!m) return;
    try {
      await api.post('/api/report', {
        mediaType: isMovie ? 'movie' : 'show',
        mediaId: m.id,
        tmdbId: m.tmdbId ?? undefined,
        title: m.title,
        reason: 'adult',
      });
      showToast('Merci, signalement envoyé 👍');
    } catch {
      showToast('Signalement impossible. Réessaie.');
    }
  };

  // Bannière (refonte 2026-07-23) : elle DÉFILE avec le contenu — plus d'en-
  // tête rétractable ; les boutons retour / cœur / menu restent épinglés.
  const heroH = insets.top + (width >= 700 ? 252 : 196);

  // Explorer : dès que ce titre a un statut (déjà vu / à voir / en cours…), le
  // marquer « suivi cette session » pour que le deck figé de l'Explorer cesse
  // de le proposer — même marqué ici, fiche ouverte depuis la liste d'un ami
  // (retrait du suivi → on le ré-autorise). Clé alignée sur feedItemKey.
  const feedTmdbId = detail.data?.media?.tmdbId;
  const feedStatus = detail.data?.media?.userStatus;
  useEffect(() => {
    if (!feedTmdbId) return;
    const key = `${isMovie ? 'movie' : 'show'}:${feedTmdbId}`;
    const store = useFeedSessionStore.getState();
    if (feedStatus) store.markTracked([key]);
    else store.unmarkTracked([key]);
  }, [feedTmdbId, feedStatus, isMovie]);

  if (detail.isLoading) return <FicheSkeleton heroHeight={heroH} />;
  if (!detail.data) return <View style={styles.fullState}><LoadError onRetry={detail.refetch} busy={detail.isRefetching} /></View>;
  const media: MediaDto = detail.data.media;
  const isFollowed = media.userStatus != null;

  // Barre de progression au ras du bas de la bannière : épisodes diffusés vus /
  // diffusés (hors spéciaux), colorée par STATUT comme dans les bibliothèques
  // du profil (jaune En cours, vert À jour, bleu Terminé, orange À voir, rouge
  // Arrêté) — violet Prisme pour « En cours » sur la fiche.
  const heroProg = (() => {
    if (isMovie) return null;
    let aired = 0;
    let watched = 0;
    for (const s of episodesQ.data?.seasons ?? []) {
      if (s.seasonNumber === 0) continue;
      for (const e of s.episodes) {
        if (isUpcoming(e.airDate)) continue;
        aired += 1;
        if (e.watched) watched += 1;
      }
    }
    if (aired === 0) return null;
    const complete = watched >= aired;
    const kind: keyof typeof STATUS_BAR =
      media.userStatus === 'abandoned' ? 'stopped'
      : media.userStatus === 'completed' ? 'completed'
      : media.userStatus === 'watchlist' ? 'watchlist'
      : complete ? 'upToDate' : 'watching';
    const pct = kind === 'completed' ? 100 : Math.min(100, (watched / aired) * 100);
    if (kind === 'watching') return { pct, fill: COLORS.primary, track: COLORS.primarySoft };
    return { pct, ...STATUS_BAR[kind] };
  })();

  // Tuile « saisons / épisodes » : total hors saison 0 (spéciaux).
  const totalEps = episodesQ.data
    ? episodesQ.data.seasons.filter((s) => s.seasonNumber !== 0).reduce((n, s) => n + s.totalCount, 0)
    : null;
  const seasonsCount = detail.data.show?.numberOfSeasons ?? null;

  const heroUri = tmdbImage(media.backdropPath, 'w1280') ?? tmdbImage(media.posterPath, 'w780');
  const genresTxt = genresFr(media.genres);
  const identityMeta = [
    isMovie ? media.year : yearRange(media, detail.data.endYear),
    genresTxt,
  ].filter(Boolean).join(' • ');

  // Haut de fiche partagé par les onglets : bannière + carte d'identité
  // (badge, titre, méta, onglets pour les séries) + tuiles de stats.
  const ficheTop = (
    <>
      <FicheBanner
        uri={heroUri}
        height={heroH}
        fallback={<Feather name={isMovie ? 'film' : 'tv'} size={64} color="rgba(255,255,255,0.34)" />}
        progress={heroProg}
      />
      <FicheIdentity
        posterUri={tmdbImage(media.posterPath, 'w342')}
        posterFallback={<Feather name={isMovie ? 'film' : 'tv'} size={30} color={COLORS.textSoft} />}
        posterLabel={'Affiche de ' + media.title}
        badge={isMovie ? 'FILM' : 'SÉRIE'}
        title={media.title}
        tiles={
          <StatTiles>
            {media.voteAverage ? (
              <StatTile
                icon={<Ionicons name="star" size={21} color={COLORS.tertiary} />}
                value={`${rating5(media.voteAverage, 10)}/5`}
                sub="Note TMDb"
                a11y={`Note ${rating5(media.voteAverage, 10)} sur 5`}
              />
            ) : null}
            {genresTxt ? (
              <StatTile
                icon={<MaterialCommunityIcons name="drama-masks" size={21} color={COLORS.primary} />}
                text={genresTxt}
                a11y={`Genres : ${genresTxt}`}
              />
            ) : null}
            {isMovie
              ? (media.runtime ? (
                  <StatTile
                    icon={<Feather name="clock" size={19} color={COLORS.primary} />}
                    value={fmtRuntime(media.runtime)}
                    sub="Durée"
                    a11y={`Durée ${fmtRuntime(media.runtime)}`}
                  />
                ) : null)
              : (seasonsCount ? (
                  <StatTile
                    icon={<Ionicons name="layers-outline" size={21} color={COLORS.primary} />}
                    value={`${seasonsCount} saison${seasonsCount > 1 ? 's' : ''}`}
                    sub={totalEps ? `${totalEps} épisode${totalEps > 1 ? 's' : ''}` : undefined}
                    a11y={`${seasonsCount} saisons${totalEps ? `, ${totalEps} épisodes` : ''}`}
                  />
                ) : null)}
          </StatTiles>
        }
      >
        <Text style={styles.identityMeta}>{identityMeta}</Text>
        {!isMovie ? (
          <FicheTabs
            options={[
              { value: 'À PROPOS', label: 'À propos' },
              { value: 'ÉPISODES', label: 'Épisodes' },
            ]}
            value={tab}
            onChange={setTab}
            accessibilityLabel="Sections de la fiche"
          />
        ) : null}
      </FicheIdentity>
    </>
  );

  // Carte « Suivi » : contrôle segmenté pleine largeur (maquette).
  const trackingLine = (
    <View style={styles.trackCard}>
      <Text style={styles.trackTitle}>Suivi</Text>
      <StatusLine
        options={isMovie ? MOVIE_STATUS_OPTIONS : SHOW_STATUS_OPTIONS}
        value={media.userStatus ?? null}
        onChange={changeStatus}
        accessibilityLabel={isMovie ? 'Statut de suivi du film' : 'Statut de suivi de la série'}
        disabled={trackingBusy}
        allowDeselect={isMovie}
      />
    </View>
  );

  return (
    <Pop style={styles.screen}>
      <View style={styles.canvas}>
      {isMovie ? (
        <MovieBody
          media={media}
          detail={detail.data}
          mediaId={String(id)}
          tracking={trackingLine}
          ficheTop={ficheTop}
        />
      ) : (
        <FadeSwitch trigger={tab}>
          {tab === 'À PROPOS' ? (
            <AboutTab media={media} detail={detail.data} mediaId={String(id)} tracking={trackingLine} ficheTop={ficheTop} />
          ) : (
            <EpisodesTab
              showId={String(id)}
              title={media.title}
              posterPath={media.posterPath}
              runtime={media.runtime ?? null}
              onChange={refresh}
              ficheTop={ficheTop}
            />
          )}
        </FadeSwitch>
      )}

      {/* Boutons épinglés au-dessus de tout : retour / favori / options. */}
      <FicheTopActions
        topInset={insets.top}
        onBack={() => goBack('/')}
        backLabel="Retour"
        favorite={{ on: !!media.isFavorite, busy: favorite.isPending, onPress: () => favorite.mutate() }}
        onMenu={() => setMenu(true)}
      />

      {/* Barre du bas façon TV Time : + AJOUTER, puis ✓ AJOUTÉE ! pendant 2 s. */}
      {!isFollowed && !justAdded && !toast ? (
        <Pressable
          style={({ pressed }) => [styles.addBar, { bottom: insets.bottom + SPACE.sm }, pressed && styles.addBarPressed]}
          onPress={trackingBusy ? undefined : () => follow.mutate()}
          disabled={trackingBusy}
          accessibilityRole="button"
          accessibilityLabel={isMovie ? 'Ajouter le film à la bibliothèque' : 'Ajouter la série à la bibliothèque'}
          accessibilityState={{ busy: trackingBusy, disabled: trackingBusy }}
        >
          {follow.isPending ? (
            <ActivityIndicator color={COLORS.onPrimary} />
          ) : (
            <View style={styles.addBarRow}>
              <Feather name="plus" size={24} color={COLORS.onPrimary} />
              <Text style={styles.addBarText}>{isMovie ? 'AJOUTER LE FILM' : 'AJOUTER LA SÉRIE'}</Text>
            </View>
          )}
        </Pressable>
      ) : null}
      <SlideUpBar
        visible={!!(justAdded || toast)}
        style={[styles.addBar, { bottom: insets.bottom + SPACE.sm }]}
      >
        <View style={styles.addBarRow} accessibilityLiveRegion="polite">
          <Feather name="check" size={24} color={COLORS.onPrimary} />
          <Text style={styles.addBarText}>{toast ?? (isMovie ? 'AJOUTÉ !' : 'AJOUTÉE !')}</Text>
        </View>
      </SlideUpBar>
      </View>

      <Modal visible={menu} transparent animationType={reduceMotion ? 'none' : 'fade'} onRequestClose={() => setMenu(false)}>
        <Pressable
          style={styles.overlay}
          onPress={() => setMenu(false)}
          accessibilityRole="button"
          accessibilityLabel="Fermer les options"
        />
        {/* Carte flottante compacte (cotes TV Time) : rangées ~48dp, police 17.
            Films : pas de rangée de statut ni de « Regarder plus tard » (parité
            TV Time) ; séries commencées : « Arrêter de regarder ». */}
        <View style={[styles.sheetWrap, { paddingBottom: insets.bottom + SPACE.xs }]} pointerEvents="box-none">
        <View style={styles.sheet} accessibilityViewIsModal onAccessibilityEscape={() => setMenu(false)}>
          <View style={styles.sheetHandle} />
          {!isMovie ? (
            <View style={styles.statusRow}>
              <Text style={styles.statusText}>{STATUS_LABELS[media.userStatus ?? 'not_started']}</Text>
            </View>
          ) : null}
          <SheetItem icon="edit-2" label="Personnaliser" onPress={() => { setMenu(false); setPersoMenu(true); }} />
          <SheetItem
            icon="heart"
            color={media.isFavorite ? COLORS.red : COLORS.black}
            label={media.isFavorite ? 'Retirer des favoris' : 'Favoris'}
            onPress={() => { favorite.mutate(); setMenu(false); }}
            disabled={trackingBusy}
          />
          <SheetItem icon="plus-square" label="Ajouter à une liste" onPress={() => { setMenu(false); setListsOpen(true); }} />
          {/* Override caché de la numérotation : uniquement s'il existe un
              vrai choix (plusieurs ordres proposés par le serveur). */}
          {!isMovie && (ordersQ.data?.available?.length ?? 0) > 1 ? (
            <SheetItem icon="list" label="Ordre des épisodes" onPress={() => { setMenu(false); setOrderOpen(true); }} />
          ) : null}
          {/* « Regarder plus tard » et « Arrêter de regarder » ont quitté le
              menu : la ligne de suivi (À voir / Arrêtée) fait strictement la
              même chose, directement sur la fiche. */}
          {isFollowed ? (
            <SheetItem
              icon="minus-square"
              label={isMovie ? 'Supprimer le film' : 'Supprimer la série'}
              onPress={() => { setMenu(false); removeTracking.mutate(); }}
              disabled={trackingBusy}
            />
          ) : null}
          <SheetItem icon="share-2" label="Partager" onPress={() => { setMenu(false); share(); }} />
          <SheetItem icon="flag" label="Signaler" onPress={() => { setMenu(false); setReportOpen(true); }} last />
        </View>
        </View>
      </Modal>

      <ReportModal visible={reportOpen} onClose={() => setReportOpen(false)} onConfirm={submitReport} />

      <EpisodeOrderSheet
        visible={orderOpen}
        onClose={() => setOrderOpen(false)}
        orders={ordersQ.data}
        pendingOrder={setOrder.isPending ? setOrder.variables : undefined}
        onSelect={(order) => { if (!setOrder.isPending) setOrder.mutate(order); }}
      />

      <PersonalizeMenu
        visible={persoMenu}
        onClose={() => setPersoMenu(false)}
        onPick={(m) => { setPersoMenu(false); setArtwork(m); }}
      />
      <ArtworkPicker
        mediaId={String(id)}
        isMovie={isMovie}
        mode={artwork}
        onClose={() => setArtwork(null)}
        onApplied={(what) => { refresh(); showToast(what === 'poster' ? 'Affiche mise à jour' : 'Bannière mise à jour'); }}
      />
      <ListsSheet
        mediaId={String(id)}
        visible={listsOpen}
        onClose={() => setListsOpen(false)}
        onChanged={(added, title) => showToast(added ? `Ajouté à « ${title} »` : `Retiré de « ${title} »`)}
      />
    </Pop>
  );
}

function SheetItem({ icon, label, onPress, color, last, disabled }: { icon: keyof typeof Feather.glyphMap; label: string; onPress: () => void; color?: string; last?: boolean; disabled?: boolean }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.sheetItem, last && { borderBottomWidth: 0 }, disabled && pstyles.disabled, pressed && !disabled && styles.sheetItemPressed]}
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled, busy: !!disabled }}
    >
      <View style={styles.sheetItemIcon}>
        <Feather name={icon} size={19} color={color ?? COLORS.primary} />
      </View>
      <Text style={styles.sheetLabel} numberOfLines={1}>{label}</Text>
      <Feather name="chevron-right" size={18} color={COLORS.textSoft} />
    </Pressable>
  );
}

// « Personnaliser » (copie TV Time) : petit bottom sheet qui propose
// « Modifier l'affiche » et « Changer la bannière » (cf. réf. 38).
function PersonalizeMenu({
  visible,
  onClose,
  onPick,
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (mode: 'poster' | 'banner') => void;
}) {
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  return (
    <Modal visible={visible} transparent animationType={reduceMotion ? 'none' : 'fade'} onRequestClose={onClose}>
      <Pressable
        style={styles.overlay}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Fermer la personnalisation"
      />
      <View style={[styles.sheetWrap, { paddingBottom: insets.bottom + SPACE.xs }]} pointerEvents="box-none">
        <View style={styles.sheet} accessibilityViewIsModal onAccessibilityEscape={onClose}>
          <View style={styles.sheetHandle} />
          <Text accessibilityRole="header" style={pstyles.menuHeader}>Personnaliser l’affichage</Text>
          <SheetItem icon="image" label="Modifier l’affiche" onPress={() => onPick('poster')} />
          <SheetItem icon="maximize" label="Changer la bannière" onPress={() => onPick('banner')} last />
        </View>
      </View>
    </Modal>
  );
}

// « Ordre des épisodes » (override caché, ouvert depuis le menu ⋯) : liste les
// ordres proposés par le serveur + « Automatique » (POST null = défaut auto).
// La coche suit la source : choix utilisateur → l'ordre choisi ; sinon Automatique.
function EpisodeOrderSheet({
  visible,
  onClose,
  orders,
  pendingOrder,
  onSelect,
}: {
  visible: boolean;
  onClose: () => void;
  orders?: OrdersData;
  pendingOrder?: string | null;
  onSelect: (order: string | null) => void;
}) {
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  const busy = pendingOrder !== undefined;
  const userChosen = orders?.source === 'user';
  const row = (label: string, order: string | null, selected: boolean, hint?: string, last?: boolean) => (
    <Pressable
      key={order ?? 'auto'}
      style={({ pressed }) => [styles.sheetItem, last && { borderBottomWidth: 0 }, busy && pstyles.disabled, pressed && !busy && styles.sheetItemPressed]}
      onPress={busy ? undefined : () => onSelect(order)}
      disabled={busy}
      accessibilityRole="radio"
      accessibilityLabel={hint ? `${label}, ${hint}` : label}
      accessibilityState={{ checked: selected, disabled: busy, busy: pendingOrder === order }}
    >
      <Feather name={selected ? 'check-circle' : 'circle'} size={20} color={selected ? COLORS.success : COLORS.textMuted} />
      <Text style={styles.sheetLabel} numberOfLines={1}>{label}</Text>
      {pendingOrder === order && busy ? (
        <ActivityIndicator color={COLORS.black} size="small" />
      ) : hint ? (
        <Text style={pstyles.listCount}>{hint}</Text>
      ) : null}
    </Pressable>
  );
  return (
    <Modal visible={visible} transparent animationType={reduceMotion ? 'none' : 'fade'} onRequestClose={onClose}>
      <Pressable
        style={styles.overlay}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Fermer le choix de l'ordre des épisodes"
      />
      <View style={[styles.sheetWrap, { paddingBottom: insets.bottom + SPACE.xs }]} pointerEvents="box-none">
        <View style={styles.sheet} accessibilityViewIsModal onAccessibilityEscape={onClose}>
          <View style={styles.sheetHandle} />
          <Text accessibilityRole="header" style={pstyles.menuHeader}>Ordre des épisodes</Text>
          {orders ? (
            <View accessibilityRole="radiogroup">
              {row(
                'Automatique',
                null,
                !userChosen,
                !userChosen ? (ORDER_LABELS[orders.effective] ?? orders.effective) : undefined,
              )}
              {orders.available.map((o, i) =>
                row(o.label, o.type, userChosen && o.type === (orders.current ?? orders.effective), undefined, i === orders.available.length - 1),
              )}
            </View>
          ) : (
            <Loading />
          )}
        </View>
      </View>
    </Modal>
  );
}

// Écran plein « Modifier l'affiche » / « Changer la bannière » (copie TV Time,
// cf. réf. 39-40) : retour + titre centré, grille d'affiches sur 2 colonnes ou
// liste de bannières ; l'image active est assombrie avec ★ « Sélectionnée ».
function ArtworkPicker({
  mediaId,
  isMovie,
  mode,
  onClose,
  onApplied,
}: {
  mediaId: string;
  isMovie: boolean;
  mode: 'poster' | 'banner' | null;
  onClose: () => void;
  onApplied: (what: 'poster' | 'banner') => void;
}) {
  const base = isMovie ? 'movies' : 'shows';
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const reduceMotion = useReduceMotion();
  const [busyUri, setBusyUri] = useState<string | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);
  const images = useQuery({
    queryKey: ['media-images', base, mediaId],
    queryFn: () =>
      api.get<{ posters: string[]; backdrops: string[]; selectedPoster: string | null; selectedBackdrop: string | null }>(
        `/api/${base}/${mediaId}/images`,
      ),
    enabled: mode !== null,
  });

  const apply = async (uri: string) => {
    if (busyUri || !mode) return;
    setBusyUri(uri);
    setApplyError(null);
    try {
      if (mode === 'poster') await api.post('/api/' + base + '/' + mediaId + '/poster', { posterPath: uri });
      else await api.post('/api/' + base + '/' + mediaId + '/banner', { backdropPath: uri });
      void images.refetch();
      onApplied(mode);
    } catch {
      setApplyError("L'image n'a pas pu être enregistrée. Réessaie.");
    } finally {
      setBusyUri(null);
    }
  };
  const isPoster = mode === 'poster';
  const list = (isPoster ? images.data?.posters : images.data?.backdrops) ?? [];
  const selectedUri = isPoster ? images.data?.selectedPoster : images.data?.selectedBackdrop;
  const posterColumns = width >= 620 ? 3 : 2;
  const galleryWidth = Math.min(width, SIZES.contentMax) - SPACE.md * 2;
  const posterWidth = Math.max(112, (galleryWidth - SPACE.sm * (posterColumns - 1)) / posterColumns);

  const cell = (uri: string) => {
    const selected = uri === selectedUri;
    return (
      <Pressable
        key={uri}
        style={({ pressed }) => [
          isPoster ? pstyles.posterWrap : pstyles.bannerWrap,
          isPoster && { width: posterWidth },
          pressed && pstyles.imagePressed,
        ]}
        onPress={() => apply(uri)}
        disabled={busyUri !== null}
        accessibilityRole="button"
        accessibilityLabel={selected ? 'Image actuellement sélectionnée' : 'Sélectionner cette image'}
        accessibilityState={{ selected, busy: busyUri === uri, disabled: busyUri !== null }}
      >
        <Image
          source={{ uri: tmdbImage(uri, isPoster ? 'w342' : 'w500') ?? uri }}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
          accessible={false}
        />
        {selected ? (
          <View style={pstyles.selectedShade}>
            <View style={pstyles.selectedRow}>
              <Text style={pstyles.selectedStar}>★</Text>
              <Text style={pstyles.selectedText}>Sélectionnée</Text>
            </View>
          </View>
        ) : null}
        {busyUri === uri ? (
          <View style={pstyles.busy}>
            <ActivityIndicator color="#fff" />
          </View>
        ) : null}
      </Pressable>
    );
  };

  return (
    <Modal visible={mode !== null} animationType={reduceMotion ? 'none' : 'slide'} onRequestClose={onClose}>
      <View style={pstyles.artworkScreen}>
      <View style={pstyles.artworkCanvas} accessibilityViewIsModal onAccessibilityEscape={onClose}>
        <View style={[pstyles.header, { paddingTop: insets.top + SPACE.xs }]}>
          <Pressable style={({ pressed }) => [pstyles.headerButton, pressed && pstyles.imagePressed]} onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="Fermer">
            <Feather name="arrow-left" size={22} color={COLORS.text} />
          </Pressable>
          <Text accessibilityRole="header" style={pstyles.title}>{isPoster ? "Modifier l'affiche" : 'Changer la bannière'}</Text>
          <View style={{ width: SIZES.touch }} />
        </View>
        {applyError ? (
          <Text style={pstyles.inlineError} accessibilityRole="alert" accessibilityLiveRegion="polite">
            {applyError}
          </Text>
        ) : null}
        {images.isLoading ? (
          <Loading />
        ) : images.isError && !images.data ? (
          <LoadError onRetry={() => void images.refetch()} busy={images.isRefetching} />
        ) : list.length === 0 ? (
          <Text style={pstyles.emptyNote}>
            {isPoster ? 'Aucune affiche disponible.' : isMovie ? 'Aucune bannière disponible pour ce film.' : 'Aucune bannière disponible pour cette série.'}
          </Text>
        ) : (
          <ScrollView contentContainerStyle={pstyles.galleryContent} showsVerticalScrollIndicator={false}>
            <View style={isPoster ? pstyles.grid : pstyles.bannerList}>{list.map(cell)}</View>
          </ScrollView>
        )}
      </View>
      </View>
    </Modal>
  );
}

// « Ajouter à une liste » : coche/décoche les listes existantes, création rapide.
function ListsSheet({
  mediaId,
  visible,
  onClose,
  onChanged,
}: {
  mediaId: string;
  visible: boolean;
  onClose: () => void;
  onChanged: (added: boolean, title: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  const qc = useQueryClient();
  const [newTitle, setNewTitle] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  type PickerList = { id: string; title: string; itemCount: number; containsMediaId?: boolean };
  const pickerKey = ['lists', 'picker', mediaId];
  const lists = useQuery({
    queryKey: pickerKey,
    queryFn: () => api.get<{ lists: PickerList[] }>(`/api/lists?mediaId=${mediaId}`),
    enabled: visible,
  });
  // Les listes apparaissent aussi sur le profil (section « Listes ») : sans
  // cette invalidation, elles n'y arrivaient qu'au redémarrage de l'app.
  const syncOthers = () => {
    qc.invalidateQueries({ queryKey: ['lists'] });
    qc.invalidateQueries({ queryKey: ['profile'] });
  };

  // Coche/décoche OPTIMISTE : la case et le compteur bougent immédiatement,
  // rollback si le serveur refuse.
  const toggle = async (l: PickerList) => {
    if (busyId || creating) return;
    setBusyId(l.id);
    setActionError(null);
    const added = !l.containsMediaId;
    const prev = qc.getQueryData<{ lists: PickerList[] }>(pickerKey);
    qc.setQueryData<{ lists: PickerList[] }>(pickerKey, (d) =>
      d ? { lists: d.lists.map((x) => (x.id === l.id ? { ...x, containsMediaId: added, itemCount: Math.max(0, x.itemCount + (added ? 1 : -1)) } : x)) } : d,
    );
    try {
      if (added) await api.post('/api/lists/' + l.id + '/items', { mediaId });
      else await api.del('/api/lists/' + l.id + '/items/' + mediaId);
      syncOthers();
      onChanged(added, l.title);
    } catch {
      if (prev) qc.setQueryData(pickerKey, prev);
      setActionError("La liste n'a pas pu être modifiée. Réessaie.");
    } finally {
      setBusyId(null);
    }
  };
  // Création OPTIMISTE : la liste apparaît tout de suite (cochée), le serveur
  // confirme derrière ; le profil est invalidé pour afficher la nouvelle liste.
  const create = async () => {
    const title = newTitle.trim();
    if (!title || creating || busyId) return;
    setCreating(true);
    setActionError(null);
    setNewTitle('');
    const prev = qc.getQueryData<{ lists: PickerList[] }>(pickerKey);
    const tempId = 'tmp-' + title;
    qc.setQueryData<{ lists: PickerList[] }>(pickerKey, (d) =>
      d ? { lists: [...d.lists, { id: tempId, title, itemCount: 1, containsMediaId: true }] } : d,
    );
    try {
      const res = await api.post<{ id: string }>('/api/lists', { title });
      qc.setQueryData<{ lists: PickerList[] }>(pickerKey, (d) =>
        d ? { lists: d.lists.map((x) => (x.id === tempId ? { ...x, id: res.id } : x)) } : d,
      );
      try {
        await api.post('/api/lists/' + res.id + '/items', { mediaId });
        onChanged(true, title);
      } catch {
        qc.setQueryData<{ lists: PickerList[] }>(pickerKey, (d) =>
          d ? { lists: d.lists.map((x) => (x.id === res.id ? { ...x, itemCount: 0, containsMediaId: false } : x)) } : d,
        );
        setActionError("La liste a été créée, mais l'œuvre n'a pas été ajoutée. Coche la liste pour réessayer.");
      }
      syncOthers();
    } catch {
      if (prev) qc.setQueryData(pickerKey, prev);
      setNewTitle(title);
      setActionError("La liste n'a pas pu être créée. Réessaie.");
    } finally {
      setCreating(false);
    }
  };
  return (
    <Modal visible={visible} transparent animationType={reduceMotion ? 'none' : 'fade'} onRequestClose={onClose}>
      <Pressable
        style={styles.overlay}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Fermer les listes"
      />
      <View style={[styles.sheetWrap, { paddingBottom: insets.bottom + SPACE.xs }]} pointerEvents="box-none">
      <View style={[styles.sheet, styles.listsSheet]} accessibilityViewIsModal onAccessibilityEscape={onClose}>
        <View style={styles.sheetHandle} />
        <View style={styles.statusRow}>
          <Text accessibilityRole="header" style={styles.statusText}>Ajouter à une liste</Text>
        </View>
        <ScrollView keyboardShouldPersistTaps="handled">
          {lists.isLoading ? (
            <Loading />
          ) : lists.isError && !lists.data ? (
            <LoadError onRetry={() => void lists.refetch()} busy={lists.isRefetching} />
          ) : (lists.data?.lists ?? []).length === 0 ? (
            <EmptyState title="Aucune liste" message="Créez votre première liste ci-dessous." />
          ) : (
            (lists.data?.lists ?? []).map((l) => (
              <Pressable
                key={l.id}
                style={({ pressed }) => [styles.sheetItem, pressed && styles.sheetItemPressed]}
                onPress={() => toggle(l)}
                disabled={busyId !== null || creating}
                accessibilityRole="checkbox"
                accessibilityLabel={l.title}
                accessibilityState={{ checked: !!l.containsMediaId, busy: busyId === l.id, disabled: busyId !== null || creating }}
              >
                <Feather name={l.containsMediaId ? 'check-square' : 'square'} size={22} color={l.containsMediaId ? COLORS.success : COLORS.textMuted} />
                <Text style={styles.sheetLabel} numberOfLines={1}>
                  {l.title}
                </Text>
                {busyId === l.id ? <ActivityIndicator color={COLORS.black} size="small" /> : (
                  <Text style={pstyles.listCount}>{l.itemCount}</Text>
                )}
              </Pressable>
            ))
          )}
          {actionError ? (
            <Text style={pstyles.inlineError} accessibilityRole="alert" accessibilityLiveRegion="polite">
              {actionError}
            </Text>
          ) : null}
          <View style={pstyles.newListRow}>
            <TextInput
              style={pstyles.newListInput}
              placeholder="Nouvelle liste…"
              placeholderTextColor={COLORS.textSoft}
              value={newTitle}
              onChangeText={(value) => { setNewTitle(value); if (actionError) setActionError(null); }}
              maxLength={120}
              onSubmitEditing={create}
              returnKeyType="done"
              accessibilityLabel="Nom de la nouvelle liste"
            />
            <Pressable
              style={({ pressed }) => [pstyles.newListBtn, (!newTitle.trim() || creating || busyId !== null) && pstyles.disabled, pressed && pstyles.imagePressed]}
              onPress={create}
              disabled={!newTitle.trim() || creating || busyId !== null}
              accessibilityRole="button"
              accessibilityLabel="Créer la liste"
              accessibilityState={{ busy: creating, disabled: !newTitle.trim() || creating || busyId !== null }}
            >
              {creating ? <ActivityIndicator color={COLORS.onPrimary} size="small" /> : <Text style={pstyles.newListBtnText}>CRÉER</Text>}
            </Pressable>
          </View>
        </ScrollView>
      </View>
      </View>
    </Modal>
  );
}

const pstyles = StyleSheet.create({
  artworkScreen: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: COLORS.bg,
  },
  artworkCanvas: {
    flex: 1,
    width: '100%',
    maxWidth: SIZES.contentMax,
    backgroundColor: COLORS.white,
  },
  header: {
    minHeight: SIZES.header,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACE.md,
    paddingBottom: SPACE.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
    backgroundColor: COLORS.white,
  },
  headerButton: {
    width: SIZES.touch,
    height: SIZES.touch,
    borderRadius: RADIUS.control,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.surfaceMuted,
  },
  title: {
    flex: 1,
    marginHorizontal: SPACE.sm,
    color: COLORS.text,
    fontSize: 18,
    fontFamily: FONTS.extraBold,
    textAlign: 'center',
  },
  galleryContent: {
    padding: SPACE.md,
    paddingBottom: SPACE.xxl,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACE.sm,
  },
  posterWrap: {
    aspectRatio: 2 / 3,
    borderRadius: RADIUS.poster,
    overflow: 'hidden',
    backgroundColor: COLORS.imagePlaceholder,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    ...SHADOW.card,
  },
  bannerList: { gap: SPACE.sm },
  bannerWrap: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: RADIUS.poster,
    overflow: 'hidden',
    backgroundColor: COLORS.imagePlaceholder,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    ...SHADOW.card,
  },
  selectedShade: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(9,5,16,0.64)',
    justifyContent: 'flex-end',
  },
  selectedRow: {
    minHeight: SIZES.touch,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.xs,
    paddingHorizontal: SPACE.sm,
  },
  selectedStar: { color: COLORS.yellow, fontSize: 19, lineHeight: 22 },
  selectedText: { color: '#FFFFFF', fontSize: 15, fontFamily: FONTS.bold },
  busy: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(9,5,16,0.42)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  inlineError: {
    color: COLORS.red,
    fontFamily: FONTS.bold,
    fontSize: 14,
    lineHeight: 20,
    paddingHorizontal: SPACE.md,
    paddingTop: SPACE.sm,
    textAlign: 'center',
  },
  emptyNote: {
    color: COLORS.textMuted,
    fontFamily: FONTS.regular,
    fontSize: 15,
    lineHeight: 22,
    padding: SPACE.lg,
    textAlign: 'center',
  },
  imagePressed: { opacity: 0.76 },
  disabled: { opacity: 0.46 },
  menuHeader: {
    fontSize: 15,
    fontFamily: FONTS.bold,
    color: COLORS.textMuted,
    paddingHorizontal: SPACE.lg,
    paddingTop: SPACE.xs,
    paddingBottom: SPACE.sm,
  },
  listCount: { color: COLORS.textMuted, fontFamily: FONTS.bold, fontSize: 14 },
  newListRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.sm,
    paddingHorizontal: SPACE.md,
    paddingVertical: SPACE.md,
    borderTopWidth: 1,
    borderTopColor: COLORS.borderLight,
  },
  newListInput: {
    flex: 1,
    minWidth: 0,
    minHeight: SIZES.touch,
    color: COLORS.text,
    backgroundColor: COLORS.surfaceMuted,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.control,
    fontFamily: FONTS.regular,
    fontSize: 16,
    paddingHorizontal: SPACE.sm,
    paddingVertical: SPACE.xs,
  },
  newListBtn: {
    minHeight: SIZES.touch,
    minWidth: 76,
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.pill,
    paddingHorizontal: SPACE.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  newListBtnText: { color: COLORS.onPrimary, fontFamily: FONTS.extraBold, fontSize: 13, letterSpacing: 0.4 },
});

// Ouvre une recommandation TMDb : fiche locale si la série/le film est déjà
// connu, sinon import silencieux (follow: false) puis navigation.
function useOpenRec(type: 'show' | 'movie') {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const open = async (item: { tmdbId: string; localId?: string | null }) => {
    if (busyId) return;
    if (item.localId) {
      router.push(('/show/' + item.localId + (type === 'movie' ? '?type=movie' : '')) as Href);
      return;
    }
    setBusyId(item.tmdbId);
    try {
      const res = await api.post<{ mediaId: string }>(
        '/api/' + (type === 'movie' ? 'movies' : 'shows') + '/add-from-tmdb',
        { tmdbId: item.tmdbId, follow: false },
      );
      router.push(('/show/' + res.mediaId + (type === 'movie' ? '?type=movie' : '')) as Href);
    } catch {
      Alert.alert('Import impossible', "Cette recommandation n'a pas pu être ouverte. Réessaie.");
    } finally {
      setBusyId(null);
    }
  };
  return { open, busyId };
}

// « Où regarder » : tuiles lavande (une par plateforme), initiale en pastille.
function WhereToWatch({ providers }: { providers: { name: string }[] }) {
  return (
    <FicheSection icon="play-circle" title="Où regarder">
      {providers.length === 0 ? (
        <Text style={styles.muted}>Non disponible</Text>
      ) : (
        <View style={styles.provWrap}>
          {providers.map((p) => (
            <View key={p.name} style={styles.provTile}>
              <View style={styles.provBadge} accessible={false}>
                <Text style={styles.provBadgeText}>{p.name.slice(0, 1).toUpperCase()}</Text>
              </View>
              <Text style={styles.provName} numberOfLines={1}>{p.name}</Text>
            </View>
          ))}
        </View>
      )}
    </FicheSection>
  );
}

// « Distribution » : photo arrondie, nom + rôle SOUS la photo (maquette) ;
// le clic ouvre la fiche acteur (/person).
function CastSection({ cast, mediaId, type }: { cast: any[]; mediaId: string; type: 'show' | 'movie' }) {
  const router = useRouter();
  if (!cast.length) return null;
  return (
    <FicheSection icon="users" title="Distribution" flush>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.railContent}>
        {cast.map((c, i) => (
          <PressableScale
            key={`${c.name}-${i}`}
            style={styles.castCard}
            onPress={() => router.push(`/person?mediaId=${mediaId}&type=${type}&index=${i}`)}
            accessibilityRole="button"
            accessibilityLabel={[c.name, c.character].filter(Boolean).join(', ')}
            accessibilityHint="Ouvre la fiche de cette personne"
          >
            <View style={styles.castPhoto}>
              {tmdbImage(c.profilePath, 'w185') ? (
                <Image source={{ uri: tmdbImage(c.profilePath, 'w185')! }} style={StyleSheet.absoluteFill} resizeMode="cover" accessible={false} />
              ) : (
                <View style={[StyleSheet.absoluteFill, styles.castPhotoEmpty]}>
                  <Feather name="user" size={28} color={COLORS.textSoft} />
                </View>
              )}
            </View>
            <Text style={styles.castName} numberOfLines={1}>{c.name}</Text>
            {c.character ? <Text style={styles.castRole} numberOfLines={1}>{c.character}</Text> : null}
          </PressableScale>
        ))}
      </ScrollView>
    </FicheSection>
  );
}

// Recommandations TMDb (« Également regardé » séries / « Similaire à » films,
// libellés maquettes) : affiche + titre dessous, badge vert si déjà en
// bibliothèque, import silencieux au clic.
function AlsoWatched({ items, type }: { items: any[]; type: 'show' | 'movie' }) {
  const rec = useOpenRec(type);
  if (!items.length) return null;
  return (
    <FicheSection icon={type === 'movie' ? 'compass' : 'eye'} title={type === 'movie' ? 'Similaire à' : 'Également regardé'} flush>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.railContent}>
        {items.map((r) => (
          <PressableScale
            key={r.tmdbId}
            style={styles.recoCard}
            onPress={() => rec.open(r)}
            disabled={rec.busyId !== null}
            accessibilityRole="button"
            accessibilityLabel={`Ouvrir ${r.title}`}
            accessibilityState={{ busy: rec.busyId === r.tmdbId, disabled: rec.busyId !== null }}
          >
            <View style={styles.recoPoster}>
              {tmdbImage(r.posterPath, 'w342') ? (
                <Image source={{ uri: tmdbImage(r.posterPath, 'w342')! }} style={StyleSheet.absoluteFill} resizeMode="cover" accessible={false} />
              ) : (
                <View style={[StyleSheet.absoluteFill, styles.castPhotoEmpty]}>
                  <Feather name={type === 'movie' ? 'film' : 'tv'} size={24} color={COLORS.textSoft} />
                </View>
              )}
              {r.inLibrary ? (
                <View style={styles.recoBadge}>
                  <Feather name="check" size={14} color="#FFFFFF" />
                </View>
              ) : null}
              {rec.busyId === r.tmdbId ? (
                <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' }]}>
                  <ActivityIndicator color="#fff" />
                </View>
              ) : null}
            </View>
            <Text style={styles.recoTitle} numberOfLines={2}>{r.title}</Text>
            <Text style={styles.recoKind}>{type === 'movie' ? 'Film' : 'Série'}</Text>
          </PressableScale>
        ))}
      </ScrollView>
    </FicheSection>
  );
}

type RatingPoint = { episodeNumber: number; avg: number; count: number };
type RatingSeason = { seasonNumber: number; points: RatingPoint[] };

// « Notes de la communauté » : courbe des moyennes d'épisodes par saison
// (quadrillage 0-5, polyline violette, sélecteur de saison + points).
// Masquée tant qu'aucun épisode n'a été noté (404 / liste vide).
function CommunityRatings({ mediaId }: { mediaId: string }) {
  const { width } = useWindowDimensions();
  const [season, setSeason] = useState(0);
  const q = useQuery({
    queryKey: ['community-ratings', mediaId],
    queryFn: () => api.get<{ seasons: RatingSeason[] }>(`/api/shows/${mediaId}/community-ratings`),
    retry: false,
  });
  const seasons = q.data?.seasons ?? [];
  if (!seasons.length) return null;
  const idx = Math.min(season, seasons.length - 1);
  const cur = seasons[idx];
  const W = Math.max(220, Math.min(width, SIZES.contentMax) - SPACE.md * 4);
  const H = 150;
  const PAD = { l: 26, r: 8, t: 8, b: 20 };
  // Les notes sont sur 5 dans l'app ; garde-fou si une source note sur 10.
  const maxVal = Math.max(...seasons.flatMap((s) => s.points.map((p) => p.avg)));
  const scaleMax = maxVal > 5 ? 10 : 5;
  const xs = cur.points.length > 1 ? (W - PAD.l - PAD.r) / (cur.points.length - 1) : 0;
  const y = (v: number) => PAD.t + (1 - v / scaleMax) * (H - PAD.t - PAD.b);
  const pts = cur.points.map((p, i) => `${PAD.l + i * xs},${y(p.avg)}`).join(' ');
  return (
    <FicheSection
      icon="trending-up"
      title="Notes de la communauté"
      trailing={
        <Pressable
          style={({ pressed }) => [styles.seasonPickRow, pressed && styles.pressed]}
          onPress={() => setSeason((idx + 1) % seasons.length)}
          disabled={seasons.length <= 1}
          accessibilityRole="button"
          accessibilityLabel={`Saison ${cur.seasonNumber}. ${seasons.length > 1 ? 'Afficher la saison suivante' : 'Seule saison disponible'}`}
          accessibilityState={{ disabled: seasons.length <= 1 }}
        >
          <Text style={styles.seasonPick}>Saison {cur.seasonNumber}</Text>
          {seasons.length > 1 ? <Feather name="chevron-down" size={16} color={COLORS.primary} /> : null}
        </Pressable>
      }
    >
      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel={`Courbe de notes de la saison ${cur.seasonNumber}, ${cur.points.length} épisode${cur.points.length > 1 ? 's' : ''}`}
        style={{ marginTop: SPACE.sm }}
      >
      <Svg width={W} height={H} accessible={false}>
        {[0, 1, 2, 3, 4, 5].map((g) => {
          const v = (g * scaleMax) / 5;
          return (
            <React.Fragment key={g}>
              <Line x1={PAD.l} y1={y(v)} x2={W - PAD.r} y2={y(v)} stroke={COLORS.borderLight} strokeWidth={1} />
              <SvgText x={PAD.l - 8} y={y(v) + 4} fontSize={10} fill={COLORS.textSoft} textAnchor="end">
                {String(v)}
              </SvgText>
            </React.Fragment>
          );
        })}
        {cur.points.length > 1 ? <Polyline points={pts} fill="none" stroke={COLORS.primary} strokeWidth={2.5} /> : null}
        {cur.points.map((p, i) => (
          <Circle key={i} cx={PAD.l + i * xs} cy={y(p.avg)} r={3.5} fill={COLORS.primary} />
        ))}
      </Svg>
      </View>
      {seasons.length > 1 ? (
        <View style={styles.dotsRow}>
          {seasons.map((_, i) => (
            <View key={i} style={[styles.dot, i === idx && styles.dotOn]} />
          ))}
        </View>
      ) : null}
    </FicheSection>
  );
}

// Rangée « Commentaires » (compteur + chevron) : ouvre la page dédiée. `type`
// est transmis à /comments/[id] pour que son en-tête sache rouvrir la fiche.
function CommentsRowLink({ mediaId, title, type }: { mediaId: string; title: string; type: 'show' | 'movie' }) {
  const router = useRouter();
  const q = useQuery({
    queryKey: ['comments', mediaId],
    queryFn: () => api.get<{ comments: { replies?: unknown[] }[] }>(`/api/media/${mediaId}/comments`),
  });
  const total = (q.data?.comments ?? []).reduce((n, c) => n + 1 + (c.replies?.length ?? 0), 0);
  return (
    <Pressable
      onPress={() => router.push(`/comments/${mediaId}?title=${encodeURIComponent(title)}&type=${type}`)}
      accessibilityRole="button"
      accessibilityLabel={`Commentaires, ${total}`}
      accessibilityHint="Ouvre tous les commentaires"
      style={({ pressed }) => (pressed ? styles.pressed : null)}
    >
      <FicheSection
        icon="message-circle"
        title="Commentaires"
        trailing={
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={styles.commentsCount}>{total}</Text>
            <Feather name="chevron-right" size={20} color={COLORS.textMuted} />
          </View>
        }
      />
    </Pressable>
  );
}

// « 2002 - 2007 » pour une série terminée/annulée, sinon l'année de début.
function yearRange(media: MediaDto, endYear?: number | null) {
  if (!media.year) return null;
  const done = media.status ? /ended|cancell?ed/i.test(media.status) : false;
  if (done && endYear && endYear !== media.year) return `${media.year} - ${endYear}`;
  return String(media.year);
}

// Onglet « À propos » : Suivi, Où regarder, Informations (méta + étoiles +
// synopsis + rangées), Distribution, Également regardé, Notes, Commentaires.
function AboutTab({ media, detail, mediaId, tracking, ficheTop }: any) {
  const schedule = detail.show?.airDay ? [airDayFr(detail.show.airDay), detail.show.airTime].filter(Boolean).join(' ') : null;
  const network = detail.show?.platform ?? detail.show?.network;
  return (
    <ScrollView contentContainerStyle={styles.tabContent} showsVerticalScrollIndicator={false}>
      {ficheTop}
      {tracking}
      <WhereToWatch providers={detail.providers ?? []} />

      <FicheSection icon="info" title="Informations">
        <Text style={styles.infoMeta}>
          {[yearRange(media, detail.endYear), genresFr(media.genres)].filter(Boolean).join(' • ')}
        </Text>
        {media.voteAverage ? <Stars rating10={media.voteAverage} size={17} /> : null}
        {media.overview ? <Text style={styles.overview}>{media.overview}</Text> : null}
        <View style={styles.infoRows}>
          {network ? <InfoRow icon="tv" label="Diffuseur" value={network} /> : null}
          {schedule ? <InfoRow icon="clock" label="Diffusion" value={schedule} /> : null}
          {media.runtime ? <InfoRow icon="watch" label="Durée épisode" value={`${media.runtime} min`} /> : null}
          {media.status ? <InfoRow icon="activity" label="Statut" value={statusFr(media.status) ?? media.status} /> : null}
          {detail.addedByCount > 0 ? (
            <InfoRow icon="users" label="Communauté" value={`Ajoutée par ${compactCount(detail.addedByCount)} personne${detail.addedByCount > 1 ? 's' : ''}`} />
          ) : null}
        </View>
      </FicheSection>

      <CastSection cast={detail.cast ?? []} mediaId={mediaId} type="show" />
      <AlsoWatched items={detail.recommendations ?? []} type="show" />
      <CommunityRatings mediaId={mediaId} />
      <CommentsRowLink mediaId={mediaId} title={media.title} type="show" />
    </ScrollView>
  );
}

function MovieBody({ media, detail, mediaId, tracking, ficheTop }: any) {
  // La ligne de suivi (À voir / Vu) remplace l'ancienne rangée « Vu / Pas vu »
  // à coche : même mutation (watched/unwatched), présentation harmonisée.
  return (
    <ScrollView contentContainerStyle={styles.tabContent} showsVerticalScrollIndicator={false}>
      {ficheTop}
      {tracking}
      <WhereToWatch providers={detail.providers ?? []} />

      {media.overview || detail.addedByCount > 0 ? (
        <FicheSection icon="book-open" title="Synopsis">
          {media.overview ? <Text style={styles.overview}>{media.overview}</Text> : null}
          {detail.addedByCount > 0 ? (
            <View style={styles.infoRows}>
              <InfoRow icon="users" label="Communauté" value={`Ajouté par ${compactCount(detail.addedByCount)} personne${detail.addedByCount > 1 ? 's' : ''}`} />
            </View>
          ) : null}
        </FicheSection>
      ) : null}

      <CastSection cast={detail.cast ?? []} mediaId={mediaId} type="movie" />
      <AlsoWatched items={detail.recommendations ?? []} type="movie" />
      <CommentsRowLink mediaId={mediaId} title={media.title} type="movie" />
    </ScrollView>
  );
}

type SeasonData = { id: string; seasonNumber: number; title: string; watchedCount: number; totalCount: number; episodes: EpisodeDto[] };
type EpisodesData = { seasons: SeasonData[]; nextEpisode: EpisodeDto | null; episodeOrder?: EpisodeOrderInfo };

// Un épisode encore non diffusé (pas d'image de toute façon : rien n'a été diffusé).
const isUpcoming = (iso?: string | null) => !!iso && new Date(iso).getTime() > Date.now();
// Jours restants avant diffusion (arrondi supérieur, minimum 1 — façon TV Time).
const daysUntil = (iso?: string | null) =>
  iso ? Math.max(1, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000)) : 0;

// « 5 h 20 min » restantes (est.) à partir des minutes.
function fmtRemaining(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h} h ${String(m).padStart(2, '0')} min` : `${h} h`;
}

// Vignette d'épisode : image TheTVDB/TMDb si disponible, sinon affiche de la série, sinon pictogramme.
function EpThumb({ stillPath, fallback }: { stillPath?: string | null; fallback?: string | null }) {
  const uri = tmdbImage(stillPath, 'w300') ?? tmdbImage(fallback, 'w342');
  if (uri) return <Image source={{ uri }} style={styles.epThumb} resizeMode="cover" accessible={false} />;
  return (
    <View style={[styles.epThumb, { alignItems: 'center', justifyContent: 'center' }]}>
      <Feather name="image" size={20} color={COLORS.textSoft} />
    </View>
  );
}

// Rangée d'épisode (maquette) : vignette 16:9, code violet + titre + durée,
// coche verte / anneau à droite (ou décompte J-x avant diffusion).
function EpisodeRow({
  episode,
  runtime,
  posterPath,
  onOpen,
  onToggle,
  busy,
}: {
  episode: EpisodeDto;
  runtime: number | null;
  posterPath?: string | null;
  onOpen?: () => void;
  onToggle?: () => void;
  busy: boolean;
}) {
  const upcoming = isUpcoming(episode.airDate);
  return (
    <Pressable
      style={({ pressed }) => [styles.epRow, pressed && onOpen && styles.pressed]}
      onPress={onOpen}
      accessibilityRole={onOpen ? 'button' : undefined}
      accessibilityLabel={`Épisode ${episodeCode(episode.seasonNumber, episode.episodeNumber)}`}
    >
      <EpThumb stillPath={episode.stillPath} fallback={posterPath} />
      <View style={styles.epCopy}>
        <Text style={styles.epCode}>{episodeCode(episode.seasonNumber, episode.episodeNumber)}</Text>
        <Text style={styles.epTitle} numberOfLines={2}>{episode.title}</Text>
        {runtime ? (
          <View style={styles.epDurRow}>
            <Feather name="clock" size={11} color={COLORS.textSoft} />
            <Text style={styles.epDur}>{runtime} min</Text>
          </View>
        ) : null}
      </View>
      {upcoming ? (
        <View style={styles.daysWrap}>
          <Text style={styles.daysNum}>{daysUntil(episode.airDate)}</Text>
          <Text style={styles.daysLabel}>{daysUntil(episode.airDate) > 1 ? 'JOURS' : 'JOUR'}</Text>
        </View>
      ) : (
        <EpisodeCheck
          checked={episode.watched}
          onPress={onToggle}
          disabled={busy}
          label={`Épisode ${episodeCode(episode.seasonNumber, episode.episodeNumber)} vu`}
        />
      )}
    </Pressable>
  );
}

function EpisodesTab({ showId, title, posterPath, runtime, onChange, ficheTop }: { showId: string; title: string; posterPath?: string | null; runtime: number | null; onChange: () => void; ficheTop: React.ReactNode }) {
  const qc = useQueryClient();
  const { width } = useWindowDimensions();
  // Saison affichée dans la carte « Épisodes » (maquette : une saison à la
  // fois, sélecteur en tête) ; null = suivre le prochain épisode à voir.
  const [seasonSel, setSeasonSel] = useState<number | null>(null);
  // Pop-up « Cocher aussi les épisodes précédents ? » : proposée quand on
  // coche un épisode alors que des épisodes antérieurs diffusés sont non vus.
  const [prevAsk, setPrevAsk] = useState<EpisodeDto | null>(null);
  // Fenêtre « fiche épisode » (la même que depuis l'onglet Séries) : ouverte
  // en tapant une carte, dans « Continuer le suivi » comme dans les saisons.
  const [sheet, setSheet] = useState<EpisodeSheetTarget | null>(null);
  const openSheet = (e: EpisodeDto) =>
    setSheet({ mediaId: showId, mediaTitle: title, posterPath, episode: e });
  // Snackbar « Marquer tout comme non vu » (2ᵉ appui sur la coche maîtresse).
  const [confirmUnmark, setConfirmUnmark] = useState(false);
  useEffect(() => {
    if (!confirmUnmark) return;
    const t = setTimeout(() => setConfirmUnmark(false), 4000);
    return () => clearTimeout(t);
  }, [confirmUnmark]);
  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['show', showId, 'episodes'],
    queryFn: () => api.get<EpisodesData>(`/api/shows/${showId}/episodes`),
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['show', showId, 'episodes'] });
    qc.invalidateQueries({ queryKey: ['show', showId] });
    qc.invalidateQueries({ queryKey: ['gamification'] }); // XP/badges/streak (spec 2026-07-16 §10)
    onChange();
  };
  const toggleEp = useMutation({
    mutationFn: (ep: EpisodeDto) => api.post(`/api/episodes/${ep.id}/${ep.watched ? 'unwatched' : 'watched'}`),
    // Mise à jour optimiste : la coche répond immédiatement, l'appel réseau suit
    // (retour en arrière si le serveur refuse).
    onMutate: async (ep: EpisodeDto) => {
      await qc.cancelQueries({ queryKey: ['show', showId, 'episodes'] });
      const prev = qc.getQueryData<EpisodesData>(['show', showId, 'episodes']);
      if (prev) {
        qc.setQueryData<EpisodesData>(['show', showId, 'episodes'], {
          nextEpisode:
            prev.nextEpisode && prev.nextEpisode.id === ep.id
              ? { ...prev.nextEpisode, watched: !ep.watched }
              : prev.nextEpisode,
          seasons: prev.seasons.map((s) =>
            s.seasonNumber !== ep.seasonNumber
              ? s
              : {
                  ...s,
                  watchedCount: Math.max(0, Math.min(s.totalCount, s.watchedCount + (ep.watched ? -1 : 1))),
                  episodes: s.episodes.map((e) => (e.id === ep.id ? { ...e, watched: !e.watched } : e)),
                },
          ),
        });
      }
      return { prev };
    },
    onError: (_err: unknown, _ep: EpisodeDto, ctx?: { prev?: EpisodesData }) => {
      if (ctx?.prev) qc.setQueryData(['show', showId, 'episodes'], ctx.prev);
    },
    onSettled: refresh,
  });
  const markAll = useMutation({
    mutationFn: (seasonNumber?: number) => api.post('/api/shows/' + showId + '/mark-all-watched', seasonNumber !== undefined ? { seasonNumber } : {}),
    onMutate: async (seasonNumber?: number) => {
      await qc.cancelQueries({ queryKey: ['show', showId, 'episodes'] });
      const prev = qc.getQueryData<EpisodesData>(['show', showId, 'episodes']);
      if (prev) {
        qc.setQueryData<EpisodesData>(['show', showId, 'episodes'], {
          nextEpisode: prev.nextEpisode,
          seasons: prev.seasons.map((s) => {
            const target = seasonNumber !== undefined ? s.seasonNumber === seasonNumber : s.seasonNumber > 0;
            if (!target) return s;
            const episodes = s.episodes.map((e) =>
              isUpcoming(e.airDate) ? e : { ...e, watched: true },
            );
            return { ...s, episodes, watchedCount: episodes.filter((e) => e.watched).length };
          }),
        });
      }
      return { prev };
    },
    onError: (_err: unknown, _sn: number | undefined, ctx?: { prev?: EpisodesData }) => {
      if (ctx?.prev) qc.setQueryData(['show', showId, 'episodes'], ctx.prev);
    },
    onSettled: refresh,
  });  // OUI de la pop-up : coche tous les épisodes diffusés situés AVANT celui
  // choisi (saisons antérieures comprises, spéciaux exclus) — consentement
  // explicite de l'utilisateur, reflété immédiatement dans la liste.
  const markPrevious = useMutation({
    mutationFn: (ep: EpisodeDto) => api.post(`/api/episodes/${ep.id}/watched-previous`),
    onMutate: async (ep: EpisodeDto) => {
      await qc.cancelQueries({ queryKey: ['show', showId, 'episodes'] });
      const prev = qc.getQueryData<EpisodesData>(['show', showId, 'episodes']);
      if (prev) {
        const isBefore = (e: EpisodeDto) =>
          e.seasonNumber < ep.seasonNumber ||
          (e.seasonNumber === ep.seasonNumber && e.episodeNumber < ep.episodeNumber);
        qc.setQueryData<EpisodesData>(['show', showId, 'episodes'], {
          nextEpisode: prev.nextEpisode,
          seasons: prev.seasons.map((s) => {
            if (s.seasonNumber <= 0) return s;
            const episodes = s.episodes.map((e) =>
              !e.watched && isBefore(e) && !isUpcoming(e.airDate) ? { ...e, watched: true } : e,
            );
            return { ...s, episodes, watchedCount: episodes.filter((e) => e.watched).length };
          }),
        });
      }
      return { prev };
    },
    onError: (_err: unknown, _ep: EpisodeDto, ctx?: { prev?: EpisodesData }) => {
      if (ctx?.prev) qc.setQueryData(['show', showId, 'episodes'], ctx.prev);
    },
    onSettled: refresh,
  });
  // Tout démarquer (hors spéciaux quand aucune saison précise), avec la même
  // mise à jour optimiste que « tout marquer ».
  const markAllUnwatched = useMutation({
    mutationFn: (seasonNumber?: number) => api.post(`/api/shows/${showId}/mark-all-unwatched`, seasonNumber !== undefined ? { seasonNumber } : {}),
    onMutate: async (seasonNumber?: number) => {
      await qc.cancelQueries({ queryKey: ['show', showId, 'episodes'] });
      const prev = qc.getQueryData<EpisodesData>(['show', showId, 'episodes']);
      if (prev) {
        qc.setQueryData<EpisodesData>(['show', showId, 'episodes'], {
          nextEpisode: prev.nextEpisode,
          seasons: prev.seasons.map((s) => {
            const target = seasonNumber !== undefined ? s.seasonNumber === seasonNumber : s.seasonNumber > 0;
            return target ? { ...s, watchedCount: 0, episodes: s.episodes.map((e) => ({ ...e, watched: false })) } : s;
          }),
        });
      }
      return { prev };
    },
    onError: (_err: unknown, _sn: number | undefined, ctx?: { prev?: EpisodesData }) => {
      if (ctx?.prev) qc.setQueryData(['show', showId, 'episodes'], ctx.prev);
    },
    onSettled: refresh,
  });
  const episodeBusy = toggleEp.isPending || markAll.isPending || markPrevious.isPending || markAllUnwatched.isPending;
  // Coche d'un épisode : bascule + proposition de cocher les précédents.
  const pressEp = (e: EpisodeDto) => {
    if (episodeBusy) return;
    if (!e.watched && data && hasUnwatchedPrevious(data.seasons, e)) setPrevAsk(e);
    toggleEp.mutate(e);
  };

  if (isLoading) return <ScrollView contentContainerStyle={styles.tabContent}>{ficheTop}<Loading /></ScrollView>;
  if (!data) return <ScrollView contentContainerStyle={styles.tabContent}>{ficheTop}<LoadError onRetry={refetch} busy={isRefetching} /></ScrollView>;
  if (data.seasons.length === 0) return <ScrollView contentContainerStyle={styles.tabContent}>{ficheTop}<EmptyState title="Aucun épisode" /></ScrollView>;

  // Épisodes spéciaux (saison 0) toujours en fin de liste (façon TV Time).
  const isSpecial = (s: SeasonData) => s.seasonNumber === 0;
  const seasons = [...data.seasons].sort((a, b) => {
    if (isSpecial(a) !== isSpecial(b)) return isSpecial(a) ? 1 : -1;
    return a.seasonNumber - b.seasonNumber;
  });
  // « À jour » (comme TV Time) = tous les épisodes réguliers DÉJÀ DIFFUSÉS sont vus
  // (les non diffusés et les spéciaux n'entrent pas en compte). data.nextEpisode =
  // prochain épisode régulier diffusé non vu : null ⇒ à jour.
  const anyWatched = seasons.some((s) => s.watchedCount > 0);
  const caughtUp = anyWatched && !data.nextEpisode;
  const onMasterPress = () => {
    if (episodeBusy) return;
    if (caughtUp) setConfirmUnmark(true);
    else markAll.mutate(undefined);
  };
  const doUnmarkAll = () => {
    if (episodeBusy) return;
    setConfirmUnmark(false);
    markAllUnwatched.mutate(undefined);
  };

  // Progression globale (épisodes réguliers diffusés) pour la carte du haut.
  let airedTotal = 0;
  let airedWatched = 0;
  for (const s of seasons) {
    if (isSpecial(s)) continue;
    for (const e of s.episodes) {
      if (isUpcoming(e.airDate)) continue;
      airedTotal += 1;
      if (e.watched) airedWatched += 1;
    }
  }
  const progressPct = airedTotal > 0 ? (airedWatched / airedTotal) * 100 : 0;
  const remainingMin = runtime && airedTotal > airedWatched ? (airedTotal - airedWatched) * runtime : null;

  // Saison affichée : sélection manuelle, sinon celle du prochain épisode à
  // voir, sinon la première.
  const effectiveSeason =
    seasons.find((s) => s.seasonNumber === seasonSel) ??
    (data.nextEpisode ? seasons.find((s) => s.seasonNumber === data.nextEpisode!.seasonNumber) : undefined) ??
    seasons[0];
  const seasonLabel = (s: SeasonData) => (isSpecial(s) ? 'Spéciaux' : `Saison ${s.seasonNumber}`);
  const cycleSeason = () => {
    const i = seasons.findIndex((s) => s.seasonNumber === effectiveSeason.seasonNumber);
    setSeasonSel(seasons[(i + 1) % seasons.length].seasonNumber);
  };
  // Coche de saison : basée sur les épisodes DÉJÀ DIFFUSÉS (règle TV Time).
  const seasonAired = effectiveSeason.episodes.filter((e) => !isUpcoming(e.airDate));
  const seasonDone = seasonAired.length > 0 && seasonAired.every((e) => e.watched);
  const seasonPct = seasonAired.length > 0 ? (seasonAired.filter((e) => e.watched).length / seasonAired.length) * 100 : 0;

  // File « Continuer le suivi » : épisodes réguliers diffusés non vus, dans
  // l'ordre — on coche l'un, la carte suivante prend sa place.
  const queue = data.nextEpisode
    ? seasons
        .filter((s) => !isSpecial(s))
        .flatMap((s) => s.episodes)
        .filter((e) => !isUpcoming(e.airDate) && !e.watched)
        .slice(0, 24)
    : [];
  const CARD_W = Math.max(248, Math.min(width, SIZES.contentMax) - 120);

  return (
    <View style={{ flex: 1 }}>
    <ScrollView contentContainerStyle={styles.tabContent} showsVerticalScrollIndicator={false}>
      {ficheTop}

      {/* « Ma progression » (maquette) : anneau + épisodes vus + temps restant
          estimé ; la coche maîtresse « tout marquer vu » vit dans l'en-tête. */}
      {airedTotal > 0 ? (
        <View style={styles.progressCard}>
          <View style={styles.progressHead}>
            <Text style={styles.trackTitle}>Ma progression</Text>
            <EpisodeCheck
              checked={caughtUp}
              size={34}
              onPress={onMasterPress}
              disabled={episodeBusy}
              label={caughtUp ? 'Proposer de tout marquer comme non vu' : 'Tout marquer comme vu'}
            />
          </View>
          <View style={styles.progressRow}>
            <ProgressRing size={104} stroke={11} pct={progressPct}>
              <Text style={styles.progressPct}>{Math.round(progressPct)}%</Text>
              <Text style={styles.progressPctSub}>terminée</Text>
            </ProgressRing>
            <View style={styles.progressStats}>
              <View style={styles.progressStat}>
                <Feather name="tv" size={17} color={COLORS.primary} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.progressStatValue}>{airedWatched} / {airedTotal}</Text>
                  <Text style={styles.progressStatSub}>épisodes vus</Text>
                </View>
              </View>
              {remainingMin ? (
                <View style={styles.progressStat}>
                  <Feather name="clock" size={17} color={COLORS.primary} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.progressStatValue}>{fmtRemaining(remainingMin)}</Text>
                    <Text style={styles.progressStatSub}>restantes (est.)</Text>
                  </View>
                </View>
              ) : null}
            </View>
          </View>
        </View>
      ) : null}

      {/* File latérale (façon TV Time) : tous les épisodes diffusés non vus. */}
      {queue.length > 0 ? (
        <FicheSection icon="play" title={anyWatched ? 'Continuer le suivi' : 'Démarrer le suivi'} flush>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            snapToInterval={CARD_W + SPACE.xs}
            decelerationRate="fast"
            contentContainerStyle={styles.railContent}
          >
            {queue.map((e) => (
              <Pressable
                key={e.id}
                style={[styles.queueCard, { width: CARD_W }]}
                onPress={() => openSheet(e)}
                accessibilityRole="button"
                accessibilityLabel={`Épisode ${episodeCode(e.seasonNumber, e.episodeNumber)}`}
              >
                <EpThumb stillPath={e.stillPath} fallback={posterPath} />
                <View style={styles.epCopy}>
                  <Text style={styles.epCode}>{episodeCode(e.seasonNumber, e.episodeNumber)}</Text>
                  <Text style={styles.epTitle} numberOfLines={1}>{e.title}</Text>
                </View>
                <EpisodeCheck
                  checked={e.watched}
                  onPress={episodeBusy ? undefined : () => pressEp(e)}
                  disabled={episodeBusy}
                  label={`Épisode ${episodeCode(e.seasonNumber, e.episodeNumber)} vu`}
                />
              </Pressable>
            ))}
          </ScrollView>
        </FicheSection>
      ) : null}

      {/* Carte « Épisodes » (maquette) : une saison à la fois — le sélecteur
          fait défiler les saisons, la coche marque/démarque toute la saison. */}
      <View style={styles.episodesCard}>
        <View style={styles.episodesHead}>
          <Text style={styles.trackTitle}>Épisodes</Text>
          <View style={styles.episodesHeadRight}>
            <Pressable
              style={({ pressed }) => [styles.seasonPickRow, pressed && styles.pressed]}
              onPress={cycleSeason}
              disabled={seasons.length <= 1}
              accessibilityRole="button"
              accessibilityLabel={`${seasonLabel(effectiveSeason)}. ${seasons.length > 1 ? 'Afficher la saison suivante' : 'Seule saison'}`}
              accessibilityState={{ disabled: seasons.length <= 1 }}
            >
              <Text style={styles.seasonPick}>{seasonLabel(effectiveSeason)}</Text>
              {seasons.length > 1 ? <Feather name="chevron-down" size={16} color={COLORS.primary} /> : null}
            </Pressable>
            <EpisodeCheck
              checked={seasonDone}
              size={30}
              onPress={episodeBusy ? undefined : () => (seasonDone ? markAllUnwatched.mutate(effectiveSeason.seasonNumber) : markAll.mutate(effectiveSeason.seasonNumber))}
              disabled={episodeBusy}
              label={seasonDone ? `Marquer ${seasonLabel(effectiveSeason)} comme non vue` : `Marquer ${seasonLabel(effectiveSeason)} comme vue`}
            />
          </View>
        </View>
        {/* Légende discrète : visible seulement quand la numérotation suivie
            n'est pas l'ordre officiel (remappage déjà appliqué par le serveur). */}
        {data.episodeOrder && data.episodeOrder.effective !== 'official' ? (
          <Text style={styles.orderLegend}>
            Numérotation : {ORDER_LABELS[data.episodeOrder.effective] ?? data.episodeOrder.effective}
            {data.episodeOrder.source === 'auto' ? ' (auto)' : ''}
          </Text>
        ) : null}
        <View style={styles.seasonProgressRow}>
          <Text style={styles.seasonProgText}>{effectiveSeason.watchedCount}/{effectiveSeason.totalCount} vus</Text>
          <View style={[styles.seasonTrack, seasonDone && { backgroundColor: 'rgba(46,154,98,0.22)' }]}>
            <AnimatedFill pct={seasonPct} color={seasonDone ? COLORS.green : COLORS.primary} style={styles.seasonFill} />
          </View>
        </View>
        <View style={styles.epList}>
          {effectiveSeason.episodes.map((e) => {
            const upcoming = isUpcoming(e.airDate);
            return (
              <EpisodeRow
                key={e.id}
                episode={e}
                runtime={runtime}
                posterPath={posterPath}
                onOpen={upcoming ? undefined : () => openSheet(e)}
                onToggle={episodeBusy ? undefined : () => pressEp(e)}
                busy={episodeBusy}
              />
            );
          })}
        </View>
      </View>
    </ScrollView>

      {/* Confirmation « Marquer tout comme non vu » (cf TV Time). */}
      {confirmUnmark ? (
        <Pressable
          style={({ pressed }) => [styles.unmarkBar, pressed && styles.pressed]}
          onPress={episodeBusy ? undefined : doUnmarkAll}
          disabled={episodeBusy}
          accessibilityRole="button"
          accessibilityLabel="Marquer tous les épisodes comme non vus"
          accessibilityState={{ busy: episodeBusy, disabled: episodeBusy }}
        >
          <Feather name="eye-off" size={22} color={COLORS.black} />
          <Text style={styles.unmarkText}>Marquer tout comme non vu</Text>
        </Pressable>
      ) : null}

      <MarkPreviousPopup
        visible={!!prevAsk}
        onYes={() => { if (episodeBusy) return; if (prevAsk) markPrevious.mutate(prevAsk); setPrevAsk(null); }}
        onNo={() => setPrevAsk(null)}
      />

      {/* Fenêtre épisode (la même que dans l'onglet Séries), swipe latéral inclus. */}
      <EpisodeSheet target={sheet} onClose={() => setSheet(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bg },
  canvas: {
    flex: 1,
    width: '100%',
    maxWidth: SIZES.contentMax,
    alignSelf: 'center',
    backgroundColor: COLORS.pageMuted,
  },
  fullState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.bg,
    padding: SPACE.lg,
  },
  tabContent: { paddingBottom: 96 },
  pressed: { opacity: 0.7 },
  // Méta de la carte d'identité : « 2023 • Science-fiction, Action, Drame ».
  identityMeta: {
    marginTop: SPACE.xs,
    color: COLORS.textMuted,
    fontFamily: FONTS.semiBold,
    fontSize: 12.5,
    lineHeight: 17,
  },
  // Barre d'ajout flottante : pilule violette Prisme.
  addBar: {
    position: 'absolute',
    left: SPACE.sm,
    right: SPACE.sm,
    zIndex: 40,
    minHeight: 56,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.primary,
    paddingHorizontal: SPACE.md,
    alignItems: 'center',
    justifyContent: 'center',
    ...SHADOW.card,
  },
  addBarPressed: { opacity: 0.84, transform: [{ scale: 0.99 }] },
  addBarRow: { minHeight: SIZES.touch, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACE.xs },
  addBarText: { color: COLORS.onPrimary, fontSize: 14, fontFamily: FONTS.extraBold, letterSpacing: 0.7 },
  // Cartes « contrôle » (Suivi, Ma progression, Épisodes) : titre bold sans
  // pastille — les sections de CONTENU passent par FicheSection (pastille).
  trackCard: {
    marginTop: SPACE.sm,
    marginHorizontal: SPACE.md,
    padding: SPACE.md,
    borderRadius: RADIUS.sheet,
    backgroundColor: COLORS.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.borderLight,
    ...SHADOW.card,
  },
  trackTitle: {
    flex: 1,
    color: COLORS.text,
    fontFamily: FONTS.extraBold,
    fontSize: 16.5,
    lineHeight: 21,
    marginBottom: SPACE.sm,
  },
  muted: { color: COLORS.textMuted, fontFamily: FONTS.regular, fontSize: 13.5, lineHeight: 20, marginTop: SPACE.sm },
  overview: { color: COLORS.text, fontFamily: FONTS.regular, fontSize: 14, lineHeight: 21, marginTop: SPACE.sm },
  infoMeta: { color: COLORS.textMuted, fontFamily: FONTS.semiBold, fontSize: 13, lineHeight: 18, marginTop: SPACE.sm },
  infoRows: { marginTop: SPACE.sm },
  // « Où regarder » : tuiles lavande qui s'enroulent.
  provWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.xs, marginTop: SPACE.sm },
  provTile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.xs,
    minHeight: 46,
    paddingHorizontal: SPACE.sm,
    paddingVertical: SPACE.xs,
    borderRadius: RADIUS.card,
    backgroundColor: COLORS.surfaceMuted,
  },
  provBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary,
  },
  provBadgeText: { color: COLORS.onPrimary, fontFamily: FONTS.extraBold, fontSize: 12 },
  provName: { color: COLORS.text, fontFamily: FONTS.bold, fontSize: 13 },
  railContent: { gap: SPACE.sm, paddingHorizontal: SPACE.md, paddingTop: SPACE.sm },
  castCard: { width: 96 },
  castPhoto: {
    width: 96,
    height: 122,
    borderRadius: RADIUS.card,
    overflow: 'hidden',
    backgroundColor: COLORS.imagePlaceholder,
  },
  castPhotoEmpty: { alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.surfaceMuted },
  castName: { marginTop: SPACE.xs, color: COLORS.text, fontSize: 12.5, lineHeight: 16, fontFamily: FONTS.bold },
  castRole: { color: COLORS.textMuted, fontSize: 11, lineHeight: 15, fontFamily: FONTS.medium, marginTop: 1 },
  recoCard: { width: 108 },
  recoPoster: {
    width: 108,
    height: 162,
    borderRadius: RADIUS.card,
    overflow: 'hidden',
    backgroundColor: COLORS.imagePlaceholder,
  },
  recoBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: COLORS.success,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
  },
  recoTitle: { marginTop: SPACE.xs, color: COLORS.text, fontSize: 12.5, lineHeight: 16, fontFamily: FONTS.bold },
  recoKind: { color: COLORS.textMuted, fontSize: 11, lineHeight: 15, fontFamily: FONTS.medium, marginTop: 1 },
  seasonPickRow: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: SPACE.sm,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.surfaceMuted,
  },
  seasonPick: { color: COLORS.primary, fontSize: 13.5, fontFamily: FONTS.bold },
  dotsRow: { flexDirection: 'row', gap: 6, justifyContent: 'center', marginTop: SPACE.xs },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: COLORS.chipSelected },
  dotOn: { width: 20, backgroundColor: COLORS.primary },
  commentsCount: { fontSize: 14, fontFamily: FONTS.bold, color: COLORS.secondary },
  // Carte « Ma progression ».
  progressCard: {
    marginTop: SPACE.sm,
    marginHorizontal: SPACE.md,
    padding: SPACE.md,
    borderRadius: RADIUS.sheet,
    backgroundColor: COLORS.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.borderLight,
    ...SHADOW.card,
  },
  progressHead: { flexDirection: 'row', alignItems: 'center' },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE.lg, marginTop: SPACE.xs },
  progressPct: { color: COLORS.text, fontFamily: FONTS.extraBold, fontSize: 21 },
  progressPctSub: { color: COLORS.textMuted, fontFamily: FONTS.medium, fontSize: 11, marginTop: 1 },
  progressStats: { flex: 1, minWidth: 0, gap: SPACE.md },
  progressStat: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm },
  progressStatValue: { color: COLORS.text, fontFamily: FONTS.extraBold, fontSize: 16, lineHeight: 20 },
  progressStatSub: { color: COLORS.textMuted, fontFamily: FONTS.medium, fontSize: 12, lineHeight: 16 },
  // Carte « Épisodes ».
  episodesCard: {
    marginTop: SPACE.sm,
    marginHorizontal: SPACE.md,
    padding: SPACE.md,
    borderRadius: RADIUS.sheet,
    backgroundColor: COLORS.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.borderLight,
    ...SHADOW.card,
  },
  episodesHead: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm },
  episodesHeadRight: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm },
  orderLegend: {
    color: COLORS.textMuted,
    fontFamily: FONTS.regular,
    fontSize: 12.5,
    lineHeight: 17,
  },
  seasonProgressRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, marginTop: SPACE.xxs, marginBottom: SPACE.xs },
  seasonProgText: { color: COLORS.textMuted, fontFamily: FONTS.bold, fontSize: 12 },
  seasonTrack: { flex: 1, height: 6, borderRadius: 3, overflow: 'hidden', backgroundColor: COLORS.primarySoft },
  seasonFill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 3 },
  epList: { gap: SPACE.sm, marginTop: SPACE.xs },
  epRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, minHeight: 56 },
  epThumb: { width: 92, height: 54, borderRadius: RADIUS.small + 2, backgroundColor: COLORS.imagePlaceholder, overflow: 'hidden' },
  epCopy: { flex: 1, minWidth: 0 },
  epCode: { color: COLORS.primary, fontSize: 12, fontFamily: FONTS.extraBold, letterSpacing: 0.4 },
  epTitle: { color: COLORS.text, fontFamily: FONTS.semiBold, fontSize: 13.5, lineHeight: 18, marginTop: 2 },
  epDurRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
  epDur: { color: COLORS.textSoft, fontFamily: FONTS.medium, fontSize: 11.5 },
  // File « Continuer le suivi » : cartes horizontales sur fond lavande.
  queueCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.sm,
    padding: SPACE.xs,
    paddingRight: SPACE.sm,
    borderRadius: RADIUS.card,
    backgroundColor: COLORS.surfaceMuted,
  },
  daysWrap: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  daysNum: { color: COLORS.text, fontSize: 19, fontFamily: FONTS.extraBold, lineHeight: 22 },
  daysLabel: { color: COLORS.textMuted, fontSize: 9, fontFamily: FONTS.bold, letterSpacing: 0.8 },
  unmarkBar: {
    position: 'absolute',
    left: SPACE.sm,
    right: SPACE.sm,
    bottom: SPACE.lg,
    zIndex: 50,
    minHeight: 58,
    borderRadius: RADIUS.card,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACE.sm,
    paddingHorizontal: SPACE.md,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.border,
    ...SHADOW.card,
  },
  unmarkText: { fontSize: 14, fontFamily: FONTS.bold, color: COLORS.text },
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: COLORS.overlay },
  sheetWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: SPACE.sm },
  sheet: {
    width: '100%',
    maxWidth: 600,
    maxHeight: '88%',
    alignSelf: 'center',
    overflow: 'hidden',
    borderRadius: RADIUS.sheet,
    backgroundColor: COLORS.sheet,
    borderWidth: 1,
    borderColor: COLORS.border,
    ...SHADOW.card,
  },
  listsSheet: { maxHeight: '82%' },
  sheetHandle: { width: 42, height: 4, borderRadius: 2, alignSelf: 'center', marginTop: SPACE.xs, marginBottom: SPACE.xs, backgroundColor: COLORS.border },
  statusRow: { minHeight: 52, justifyContent: 'center', paddingHorizontal: SPACE.lg, backgroundColor: COLORS.surfaceMuted, borderBottomWidth: 1, borderBottomColor: COLORS.borderLight },
  statusText: { fontFamily: FONTS.extraBold, fontSize: 15, color: COLORS.text },
  sheetItem: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, paddingHorizontal: SPACE.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.borderLight },
  sheetItemPressed: { backgroundColor: COLORS.primarySoft },
  sheetItemIcon: { width: 36, height: 36, borderRadius: RADIUS.control, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.surfaceMuted },
  sheetLabel: { flex: 1, color: COLORS.text, fontSize: 16, fontFamily: FONTS.semiBold },
});
