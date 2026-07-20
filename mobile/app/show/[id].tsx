import React, { useState, useEffect, useRef } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Modal, TextInput, ActivityIndicator, Image, Share, Platform, Animated, useWindowDimensions, Alert } from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Line, Polyline, Text as SvgText } from 'react-native-svg';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { goBack } from '@/lib/nav';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, tmdbImage } from '@/lib/api';
import type { EpisodeDto, MediaDto, UserMediaState } from '@/lib/types';
import { episodeCode } from '@/lib/format';
import { COLORS, RADIUS, SHADOW, FONTS, STATUS_BAR, YELLOW_TRACK, SIZES, SPACE } from '@/lib/theme';
import { TopTabs, CheckCircle, Loading, LoadError, EmptyState } from '@/components/ui';
import { AnimatedFill, Pop, SlideUpBar, FadeSwitch, PressableScale } from '@/components/anim';
import { Stars } from '@/components/Stars';
import { MarkPreviousPopup, hasUnwatchedPrevious } from '@/components/MarkPreviousPopup';
import { EpisodeSheet, type EpisodeSheetTarget } from '@/components/EpisodeSheet';
import { genresFr, statusFr, airDayFr, compactCount } from '@/lib/frMedia';
import { FicheSkeleton } from '@/components/FicheSkeleton';
import { ReportModal } from '@/components/ReportModal';
import { StatusLine } from '@/components/StatusLine';
import { useReduceMotion } from '@/lib/useReduceMotion';

const INTEREST = ['LES ACTEURS', 'LA PRÉMISSE', 'LES CRÉATEURS', 'LA CHAÎNE/LA PLATEFORME', "LA FRANCHISE OU L'UNIVERS", 'AUTRE'];
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
  const [interest, setInterest] = useState<string[]>([]);
  const [justAdded, setJustAdded] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [persoMenu, setPersoMenu] = useState(false);
  const [artwork, setArtwork] = useState<'poster' | 'banner' | null>(null);
  const [listsOpen, setListsOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const addedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Bandeau jaune éphémère en bas d'écran (façon « AJOUTÉE ! » de TV Time).
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
    // interdit par la règle produit — il se renouvelle au changement d'onglet.)
    qc.invalidateQueries({ queryKey: ['search'] });
  };

  // Progression globale de la série (même cache que l'onglet Épisodes) pour la
  // barre au bas de la bannière — basée sur les épisodes DIFFUSÉS uniquement.
  const episodesQ = useQuery({
    queryKey: ['show', id, 'episodes'],
    queryFn: () =>
      api.get<{ seasons: { seasonNumber: number; episodes: { airDate?: string | null; watched: boolean }[] }[] }>(
        `/api/shows/${id}/episodes`,
      ),
    enabled: !isMovie,
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

  // En-tête repliable façon TV Time : la bannière se réduit en barre compacte
  // (titre centré) à mesure que le contenu défile, quel que soit l'onglet.
  const scrollY = useRef(new Animated.Value(0)).current;

  const responsiveHeroHeight = width >= 700 ? 300 : width < 380 ? 236 : 260;
  if (detail.isLoading) return <FicheSkeleton heroHeight={responsiveHeroHeight} />;
  if (!detail.data) return <View style={styles.fullState}><LoadError onRetry={detail.refetch} busy={detail.isRefetching} /></View>;
  const media: MediaDto = detail.data.media;
  const isFollowed = media.userStatus != null;
  const HERO_MAX = responsiveHeroHeight;
  const HERO_MIN = insets.top + 60;
  // Plage de repli = exactement la hauteur perdue par l'en-tête : le bord bas
  // de l'en-tête en surimpression suit alors le contenu au pixel près (aucun
  // écart pendant le repli, cf. structure « overlay » plus bas).
  const HERO_RANGE = HERO_MAX - HERO_MIN;
  const heroH = scrollY.interpolate({ inputRange: [0, HERO_RANGE], outputRange: [HERO_MAX, HERO_MIN], extrapolate: 'clamp' });
  const bigOpacity = scrollY.interpolate({ inputRange: [0, HERO_RANGE * 0.6], outputRange: [1, 0], extrapolate: 'clamp' });
  const smallOpacity = scrollY.interpolate({ inputRange: [HERO_RANGE * 0.6, HERO_RANGE], outputRange: [0, 1], extrapolate: 'clamp' });
  const onScroll = Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: false });
  // Hauteur de la barre d'onglets À PROPOS / ÉPISODES (TopTabs, ui.tsx).
  const TABS_H = 42;
  const topPad = HERO_MAX + (isMovie ? 0 : TABS_H);

  // Barre de progression globale : épisodes diffusés vus / diffusés (hors
  // spéciaux), colorée par STATUT comme dans les bibliothèques du profil :
  // jaune En cours, vert À jour, bleu Terminé (pleine), orange Regarder plus
  // tard, rouge Arrêté (la barre montre où on s'est arrêté).
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
    return { pct: kind === 'completed' ? 100 : Math.min(100, (watched / aired) * 100), ...STATUS_BAR[kind] };
  })();

  // Ligne de suivi (même présentation que la fiche jeu) : première carte du
  // corps de la fiche, juste sous la bannière — le statut se règle sans scroller.
  const trackingLine = (
    <View style={styles.section}>
      <Text style={styles.trackingTitle}>Suivi</Text>
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
      {/* Contenu EN FLUX : il défile sous l'en-tête en surimpression (padding
          haut constant = place de l'en-tête déployé + onglets). */}
      {isMovie ? (
        <MovieBody
          media={media}
          detail={detail.data}
          mediaId={String(id)}
          tracking={trackingLine}
          onScroll={onScroll}
          topPad={topPad}
        />
      ) : (
        <FadeSwitch trigger={tab}>
          {tab === 'À PROPOS' ? (
            <AboutTab media={media} detail={detail.data} mediaId={String(id)} tracking={trackingLine} interest={interest} setInterest={setInterest} onScroll={onScroll} topPad={topPad} />
          ) : (
            <EpisodesTab showId={String(id)} title={media.title} posterPath={media.posterPath} onChange={refresh} onScroll={onScroll} topPad={topPad} />
          )}
        </FadeSwitch>
      )}

      {/* En-tête en SURIMPRESSION (hors flux) : sa hauteur animée ne re-layoute
          que lui-même — auparavant l'en-tête était dans le flux et chaque frame
          de repli re-layoutait TOUTE la fiche (saccades au défilement, web). */}
      <View style={styles.headerOverlay}>
      <Animated.View style={[styles.hero, { height: heroH }]}>
        {(() => {
          const heroUri = tmdbImage(media.backdropPath, 'w1280') ?? tmdbImage(media.posterPath, 'w780');
          return heroUri ? <Image source={{ uri: heroUri }} style={StyleSheet.absoluteFill} resizeMode="cover" accessible={false} /> : null;
        })()}
        <LinearGradient
          colors={['rgba(9,5,16,0.22)', 'rgba(9,5,16,0.48)', 'rgba(9,5,16,0.94)']}
          locations={[0, 0.44, 1]}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        <View style={styles.heroPrism} pointerEvents="none" />
        <View style={styles.heroOrb} pointerEvents="none" />
        <View style={[styles.heroBtns, { top: insets.top + 4 }]}>
          <Pressable
            style={({ pressed }) => [styles.heroIconButton, pressed && styles.pressed]}
            onPress={() => goBack('/')}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Retour"
          >
            <Feather name="chevron-down" size={25} color="#fff" />
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.heroIconButton, pressed && styles.pressed]}
            onPress={() => setMenu(true)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Options"
            accessibilityHint="Ouvre les actions de personnalisation et de suivi"
          >
            <Feather name="more-horizontal" size={24} color="#fff" />
          </Pressable>
        </View>
        {/* Titre compact centré, visible quand l'en-tête est replié. */}
        <Animated.Text
          style={[styles.heroCollapsedTitle, { top: insets.top + 12, opacity: smallOpacity }]}
          numberOfLines={1}
          accessible={false}
        >
          {media.title}
        </Animated.Text>
        <Animated.View style={[styles.heroTitleWrap, { opacity: bigOpacity }]}>
          {tmdbImage(media.posterPath, 'w342') ? (
            <Image
              source={{ uri: tmdbImage(media.posterPath, 'w342')! }}
              style={styles.heroPoster}
              resizeMode="cover"
              accessible={false}
            />
          ) : null}
          <View style={styles.heroCopy}>
            <View style={styles.heroKindBadge}>
              <Feather name={isMovie ? 'film' : 'tv'} size={12} color={COLORS.onAccent} />
              <Text style={styles.heroKindText}>{isMovie ? 'FILM' : 'SÉRIE'}</Text>
            </View>
            <Text accessibilityRole="header" style={styles.heroTitle} numberOfLines={2}>{media.title}</Text>
            <Text style={styles.heroSub} numberOfLines={2}>
              {isMovie
                ? [media.year, genresFr(media.genres)].filter(Boolean).join(' • ')
                : [
                    detail.data.show?.numberOfSeasons ? `${detail.data.show.numberOfSeasons} saison${detail.data.show.numberOfSeasons > 1 ? 's' : ''}` : null,
                    statusFr(media.status),
                    detail.data.show?.platform ?? detail.data.show?.network,
                  ].filter(Boolean).join(' • ')}
            </Text>
          </View>
        </Animated.View>
        {/* Progression globale au bas de la bannière, colorée par statut. */}
        {heroProg ? (
          <View style={[styles.heroProgressTrack, { backgroundColor: heroProg.track }]}>
            <AnimatedFill pct={heroProg.pct} color={heroProg.fill} style={styles.heroProgressFill} />
          </View>
        ) : null}
      </Animated.View>
      {/* Comme TV Time : deux onglets, les commentaires vivent au bas de « À propos ». */}
      {!isMovie ? <TopTabs tabs={['À PROPOS', 'ÉPISODES']} active={tab} onChange={setTab} /> : null}
      </View>

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
            <ActivityIndicator color={COLORS.onAccent} />
          ) : (
            <View style={styles.addBarRow}>
              <Feather name="plus" size={24} color={COLORS.onAccent} />
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
          <Feather name="check" size={24} color={COLORS.onAccent} />
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
              {creating ? <ActivityIndicator color={COLORS.black} size="small" /> : <Text style={pstyles.newListBtnText}>CRÉER</Text>}
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
    backgroundColor: COLORS.yellow,
    borderRadius: RADIUS.pill,
    paddingHorizontal: SPACE.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  newListBtnText: { color: COLORS.onAccent, fontFamily: FONTS.extraBold, fontSize: 13, letterSpacing: 0.4 },
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
// « Où regarder » : pastilles noires horizontales (une par plateforme), rouage
// à droite — cotes TV Time.
function WhereToWatch({ providers }: { providers: { name: string }[] }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeadRowTight}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>Où regarder</Text>
        <Feather name="settings" size={18} color={COLORS.black} />
      </View>
      {providers.length === 0 ? (
        <Text style={styles.muted}>Non disponible</Text>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingTop: 12 }}>
          {providers.map((p) => (
            <View key={p.name} style={styles.provBtn}>
              <Ionicons name="play-circle-outline" size={17} color={COLORS.onPrimary} />
              <Text style={styles.provText}>{p.name.toUpperCase()}</Text>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

// « Similaire à » : vignette ronde + titre de l'œuvre la plus proche (première
// recommandation TMDb), ouvre sa fiche au clic.
function SimilarTo({ item, isMovie }: { item: any; isMovie: boolean }) {
  const rec = useOpenRec(isMovie ? 'movie' : 'show');
  const thumb = tmdbImage(item.posterPath, 'w185');
  return (
    <PressableScale
      style={[styles.section, styles.similarRow]}
      onPress={() => rec.open(item)}
      disabled={rec.busyId !== null}
      accessibilityRole="button"
      accessibilityLabel={`Ouvrir ${item.title}`}
      accessibilityState={{ busy: rec.busyId === item.tmdbId, disabled: rec.busyId !== null }}
    >
      {thumb ? <Image source={{ uri: thumb }} style={styles.similarThumb} resizeMode="cover" accessible={false} /> : <View style={styles.similarThumb} />}
      <View style={{ flex: 1 }}>
        <Text style={styles.similarTitle}>Similaire à</Text>
        <Text style={styles.similarName} numberOfLines={1}>{item.title}</Text>
      </View>
      {rec.busyId === item.tmdbId ? (
        <ActivityIndicator size="small" color={COLORS.black} />
      ) : (
        <Feather name="chevron-right" size={20} color={COLORS.textMuted} />
      )}
    </PressableScale>
  );
}

// Rangées d'infos sous le synopsis (horloge = jour/heure de diffusion,
// chrono = durée d'épisode, silhouettes = « ajoutée par N personnes »).
function MetaRows({ show, media, addedByCount, isMovie }: any) {
  const schedule = !isMovie && show?.airDay ? [airDayFr(show.airDay), show.airTime].filter(Boolean).join(' ') : null;
  if (!schedule && !media.runtime && !addedByCount) return null;
  return (
    <View style={styles.metaRows}>
      {schedule ? (
        <View style={styles.metaItem}>
          <Feather name="clock" size={16} color={COLORS.black} />
          <Text style={styles.metaText}>{schedule}</Text>
        </View>
      ) : null}
      {media.runtime ? (
        <View style={styles.metaItem}>
          <Ionicons name="stopwatch-outline" size={17} color={COLORS.black} />
          <Text style={styles.metaText}>{media.runtime}m</Text>
        </View>
      ) : null}
      {addedByCount > 0 ? (
        <View style={styles.metaItem}>
          <Feather name="users" size={16} color={COLORS.black} />
          <Text style={styles.metaText}>
            {isMovie ? 'Film ajouté' : 'Série ajoutée'} par {compactCount(addedByCount)} personne{addedByCount > 1 ? 's' : ''}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

// « Distribution » : cartes horizontales photo + nom + rôle (bandeau sombre en
// bas de carte, façon TV Time) ; le clic ouvre la fiche acteur (/person).
function CastSection({ cast, mediaId, type }: { cast: any[]; mediaId: string; type: 'show' | 'movie' }) {
  const router = useRouter();
  if (!cast.length) return null;
  return (
    <View style={[styles.section, { paddingHorizontal: 0 }]}>
      <Text style={[styles.sectionTitle, { paddingHorizontal: 20 }]}>Distribution</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingHorizontal: 20, paddingTop: 14 }}>
        {cast.map((c, i) => (
          <PressableScale
            key={`${c.name}-${i}`}
            style={styles.castCard}
            onPress={() => router.push(`/person?mediaId=${mediaId}&type=${type}&index=${i}`)}
            accessibilityRole="button"
            accessibilityLabel={[c.name, c.character].filter(Boolean).join(', ')}
            accessibilityHint="Ouvre la fiche de cette personne"
          >
            {tmdbImage(c.profilePath, 'w185') ? (
              <Image source={{ uri: tmdbImage(c.profilePath, 'w185')! }} style={StyleSheet.absoluteFill} resizeMode="cover" accessible={false} />
            ) : (
              <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
                <Feather name="user" size={30} color="#9a9a9a" />
              </View>
            )}
            <View style={styles.castCap}>
              <Text style={styles.castName} numberOfLines={1}>{c.name}</Text>
              {c.character ? <Text style={styles.castRole} numberOfLines={1}>{c.character.toUpperCase()}</Text> : null}
            </View>
          </PressableScale>
        ))}
      </ScrollView>
    </View>
  );
}

// « Les utilisateurs ont également regardé » : affiches horizontales, badge
// coche jaune si déjà dans ma bibliothèque, import TMDb silencieux au clic.
function AlsoWatched({ items, type }: { items: any[]; type: 'show' | 'movie' }) {
  const rec = useOpenRec(type);
  if (!items.length) return null;
  return (
    <View style={[styles.section, { paddingHorizontal: 0 }]}>
      <Text style={[styles.sectionTitle, { paddingHorizontal: 20 }]}>Les utilisateurs ont également regardé</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingHorizontal: 20, paddingTop: 14 }}>
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
            {tmdbImage(r.posterPath, 'w342') ? (
              <Image source={{ uri: tmdbImage(r.posterPath, 'w342')! }} style={StyleSheet.absoluteFill} resizeMode="cover" accessible={false} />
            ) : (
              <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
                <Feather name={type === 'movie' ? 'film' : 'tv'} size={26} color="#9a9a9a" />
              </View>
            )}
            {r.inLibrary ? (
              <View style={styles.recoBadge}>
                <Feather name="check" size={18} color={COLORS.onAccent} />
              </View>
            ) : null}
            {rec.busyId === r.tmdbId ? (
              <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' }]}>
                <ActivityIndicator color="#fff" />
              </View>
            ) : null}
          </PressableScale>
        ))}
      </ScrollView>
    </View>
  );
}

type RatingPoint = { episodeNumber: number; avg: number; count: number };
type RatingSeason = { seasonNumber: number; points: RatingPoint[] };

// « Notes de la communauté » : courbe des moyennes d'épisodes par saison
// (quadrillage 0-5, polyline jaune, sélecteur de saison + points), cf. TV Time.
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
  const W = Math.max(220, Math.min(width, SIZES.contentMax) - SPACE.xl * 2);
  const H = 150;
  const PAD = { l: 26, r: 8, t: 8, b: 20 };
  // Les notes sont sur 5 dans l'app ; garde-fou si une source note sur 10.
  const maxVal = Math.max(...seasons.flatMap((s) => s.points.map((p) => p.avg)));
  const scaleMax = maxVal > 5 ? 10 : 5;
  const xs = cur.points.length > 1 ? (W - PAD.l - PAD.r) / (cur.points.length - 1) : 0;
  const y = (v: number) => PAD.t + (1 - v / scaleMax) * (H - PAD.t - PAD.b);
  const pts = cur.points.map((p, i) => `${PAD.l + i * xs},${y(p.avg)}`).join(' ');
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.sectionTitle}>Notes de la communauté</Text>
      <Pressable
        style={({ pressed }) => [styles.seasonPickRow, pressed && styles.pressed]}
        onPress={() => setSeason((idx + 1) % seasons.length)}
        disabled={seasons.length <= 1}
        accessibilityRole="button"
        accessibilityLabel={`Saison ${cur.seasonNumber}. ${seasons.length > 1 ? 'Afficher la saison suivante' : 'Seule saison disponible'}`}
        accessibilityState={{ disabled: seasons.length <= 1 }}
      >
        <Text style={styles.seasonPick}>Saison {cur.seasonNumber}</Text>
        {seasons.length > 1 ? <Feather name="chevron-down" size={18} color={COLORS.black} /> : null}
      </Pressable>
      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel={`Courbe de notes de la saison ${cur.seasonNumber}, ${cur.points.length} épisode${cur.points.length > 1 ? 's' : ''}`}
      >
      <Svg width={W} height={H} accessible={false}>
        {[0, 1, 2, 3, 4, 5].map((g) => {
          const v = (g * scaleMax) / 5;
          return (
            <React.Fragment key={g}>
              <Line x1={PAD.l} y1={y(v)} x2={W - PAD.r} y2={y(v)} stroke="#ececec" strokeWidth={1} />
              <SvgText x={PAD.l - 8} y={y(v) + 4} fontSize={10} fill="#9a9a9a" textAnchor="end">
                {String(v)}
              </SvgText>
            </React.Fragment>
          );
        })}
        {cur.points.length > 1 ? <Polyline points={pts} fill="none" stroke={COLORS.yellow} strokeWidth={2.5} /> : null}
        {cur.points.map((p, i) => (
          <Circle key={i} cx={PAD.l + i * xs} cy={y(p.avg)} r={3.5} fill={COLORS.yellow} />
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
    </View>
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
      style={[styles.section, styles.commentsRow]}
      onPress={() => router.push(`/comments/${mediaId}?title=${encodeURIComponent(title)}&type=${type}`)}
      accessibilityRole="button"
      accessibilityLabel={`Commentaires, ${total}`}
      accessibilityHint="Ouvre tous les commentaires"
    >
      <Text accessibilityRole="header" style={styles.sectionTitle}>Commentaires</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text style={styles.commentsCount}>{total}</Text>
        <Feather name="chevron-right" size={20} color={COLORS.black} />
      </View>
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

// Onglet « À propos » — ordre des sections calqué sur la fiche TV Time :
// où regarder, question d'intérêt, similaire à, informations (méta + étoiles +
// synopsis + rangées), distribution, également regardé, notes, commentaires.
function AboutTab({ media, detail, mediaId, tracking, interest, setInterest, onScroll, topPad }: any) {
  return (
    <ScrollView onScroll={onScroll} scrollEventThrottle={16} contentContainerStyle={{ paddingTop: topPad, paddingBottom: 90 }}>
      {tracking}
      <WhereToWatch providers={detail.providers ?? []} />

      <View style={styles.section}>
        <Text style={styles.question}>QU'EST-CE QUI VOUS INTÉRESSE LE PLUS DANS CETTE SÉRIE ?</Text>
        {INTEREST.map((o) => (
          <Pressable
            key={o}
            style={({ pressed }) => [styles.qbtn, interest.includes(o) && styles.qbtnSel, pressed && styles.pressed]}
            onPress={() =>
              setInterest((sel: string[]) => (sel.includes(o) ? sel.filter((x) => x !== o) : [...sel, o]))
            }
            accessibilityRole="checkbox"
            accessibilityLabel={o}
            accessibilityState={{ checked: interest.includes(o) }}
          >
            <Text style={[styles.qbtnText, interest.includes(o) && { color: COLORS.onPrimary }]}>{o}</Text>
          </Pressable>
        ))}
      </View>

      {detail.recommendations?.length ? <SimilarTo item={detail.recommendations[0]} isMovie={false} /> : null}

      <View style={styles.section}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>Informations sur la série</Text>
        <Text style={styles.infoMeta}>
          {[yearRange(media, detail.endYear), genresFr(media.genres)].filter(Boolean).join(' • ')}
        </Text>
        {media.voteAverage ? <Stars rating10={media.voteAverage} size={17} /> : null}
        {media.overview ? <Text style={styles.overview}>{media.overview}</Text> : null}
        <MetaRows show={detail.show} media={media} addedByCount={detail.addedByCount} isMovie={false} />
      </View>

      <CastSection cast={detail.cast ?? []} mediaId={mediaId} type="show" />
      <AlsoWatched items={detail.recommendations ?? []} type="show" />
      <CommunityRatings mediaId={mediaId} />
      <CommentsRowLink mediaId={mediaId} title={media.title} type="show" />
    </ScrollView>
  );
}

function MovieBody({ media, detail, mediaId, tracking, onScroll, topPad }: any) {
  // La ligne de suivi (À voir / Vu) remplace l'ancienne rangée « Vu / Pas vu »
  // à coche : même mutation (watched/unwatched), présentation harmonisée.
  return (
    <ScrollView onScroll={onScroll} scrollEventThrottle={16} contentContainerStyle={{ paddingTop: topPad, paddingBottom: 90 }}>
      {tracking}
      <WhereToWatch providers={detail.providers ?? []} />

      {detail.recommendations?.length ? <SimilarTo item={detail.recommendations[0]} isMovie /> : null}

      <View style={styles.section}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>Informations sur le film</Text>
        <Text style={styles.infoMeta}>{[media.year, genresFr(media.genres)].filter(Boolean).join(' • ')}</Text>
        {media.voteAverage ? <Stars rating10={media.voteAverage} size={17} /> : null}
        {media.overview ? <Text style={styles.overview}>{media.overview}</Text> : null}
        <MetaRows show={null} media={media} addedByCount={detail.addedByCount} isMovie />
      </View>

      <CastSection cast={detail.cast ?? []} mediaId={mediaId} type="movie" />
      <AlsoWatched items={detail.recommendations ?? []} type="movie" />
      <CommentsRowLink mediaId={mediaId} title={media.title} type="movie" />
    </ScrollView>
  );
}

type SeasonData = { id: string; seasonNumber: number; title: string; watchedCount: number; totalCount: number; episodes: EpisodeDto[] };
type EpisodesData = { seasons: SeasonData[]; nextEpisode: EpisodeDto | null };

// Un épisode encore non diffusé (pas d'image de toute façon : rien n'a été diffusé).
const isUpcoming = (iso?: string | null) => !!iso && new Date(iso).getTime() > Date.now();
// Jours restants avant diffusion (arrondi supérieur, minimum 1 — façon TV Time).
const daysUntil = (iso?: string | null) =>
  iso ? Math.max(1, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000)) : 0;

// Vignette d'épisode : image TheTVDB/TMDb si disponible, sinon affiche de la série, sinon pictogramme.
function EpThumb({ stillPath, fallback }: { stillPath?: string | null; fallback?: string | null }) {
  const uri = tmdbImage(stillPath, 'w300') ?? tmdbImage(fallback, 'w342');
  if (uri) return <Image source={{ uri }} style={styles.epThumb} resizeMode="cover" accessible={false} />;
  return (
    <View style={[styles.epThumb, { alignItems: 'center', justifyContent: 'center' }]}>
      <Feather name="image" size={24} color="#9a9a9a" />
    </View>
  );
}

function EpisodesTab({ showId, title, posterPath, onChange, onScroll, topPad }: { showId: string; title: string; posterPath?: string | null; onChange: () => void; onScroll?: any; topPad?: number }) {
  const qc = useQueryClient();
  const { width } = useWindowDimensions();
  const [open, setOpen] = useState<Record<number, boolean>>({});
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
  // Coche d'un épisode : bascule + proposition de cocher les précédents.
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

  // Les états intermédiaires descendent sous l'en-tête en surimpression.
  if (isLoading) return <View style={{ paddingTop: topPad }}><Loading /></View>;
  if (!data) return <View style={{ paddingTop: topPad }}><LoadError onRetry={refetch} busy={isRefetching} /></View>;
  if (data.seasons.length === 0) return <View style={{ paddingTop: topPad }}><EmptyState title="Aucun épisode" /></View>;

  // Épisodes spéciaux (saison 0) toujours en bas de la liste (façon TV Time).
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

  return (
    <View style={{ flex: 1 }}>
    <ScrollView
      style={{ backgroundColor: COLORS.pageMuted }}
      contentContainerStyle={{ paddingTop: topPad, paddingBottom: 40 }}
      onScroll={onScroll}
      scrollEventThrottle={16}
    >
      {data.nextEpisode ? (() => {
        // Carrousel latéral (façon TV Time) : TOUS les épisodes réguliers déjà
        // diffusés et non vus, dans l'ordre — on coche l'un, la carte suivante
        // prend sa place (la liste se recalcule via le cache optimiste).
        const queue = seasons
          .filter((s) => !isSpecial(s))
          .flatMap((s) => s.episodes)
          .filter((e) => !isUpcoming(e.airDate) && !e.watched)
          .slice(0, 24);
        const CARD_W = Math.max(248, Math.min(width, SIZES.contentMax) - 56); // la suivante dépasse
        return (
          <View style={{ paddingTop: 20, borderBottomWidth: 1, borderBottomColor: COLORS.borderLight, backgroundColor: COLORS.white }}>
            <Text accessibilityRole="header" style={[styles.sectionTitle, { paddingHorizontal: 24 }]}>{anyWatched ? 'Continuer le suivi' : 'Démarrer le suivi'}</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              snapToInterval={CARD_W + 10}
              decelerationRate="fast"
              contentContainerStyle={{ padding: 12, gap: 10 }}
            >
              {queue.map((e) => (
                <Pressable
                  key={e.id}
                  style={[styles.eprow, { width: CARD_W, marginBottom: 0 }]}
                  onPress={() => openSheet(e)}
                  accessibilityRole="button"
                  accessibilityLabel={`Épisode ${episodeCode(e.seasonNumber, e.episodeNumber)}`}
                >
                  <EpThumb stillPath={e.stillPath} fallback={posterPath} />
                  <View style={{ flex: 1, padding: 12, justifyContent: 'center' }}>
                    <Text style={styles.epCode}>{episodeCode(e.seasonNumber, e.episodeNumber)}</Text>
                    <Text style={styles.epRowTitle} numberOfLines={1}>{e.title}</Text>
                  </View>
                  <View style={{ justifyContent: 'center', paddingRight: 14 }}>
                    <CheckCircle checked={e.watched} onPress={episodeBusy ? undefined : () => pressEp(e)} />
                  </View>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        );
      })() : null}

      <View style={{ paddingTop: 20 }}>
        <View style={[styles.sectionHeadRow, { marginBottom: 0 }]}>
          <Text accessibilityRole="header" style={styles.sectionTitle}>Tous les épisodes</Text>
          <Pressable
            style={({ pressed }) => [styles.markAllBtn, pressed && styles.pressed]}
            onPress={episodeBusy ? undefined : onMasterPress}
            disabled={episodeBusy}
            accessibilityRole="button"
            accessibilityLabel={caughtUp ? 'Proposer de tout marquer comme non vu' : 'Tout marquer comme vu'}
            accessibilityState={{ busy: episodeBusy, disabled: episodeBusy }}
          >
            <Feather name="check" size={18} color={COLORS.black} />
          </Pressable>
        </View>
        <View style={{ padding: 12 }}>
          {seasons.map((s) => {
            const isOpen = open[s.seasonNumber];
            // Progression basée sur les épisodes DÉJÀ DIFFUSÉS (règle TV Time) :
            // « terminé » (vert) = tous les épisodes disponibles à date sont vus,
            // même si la saison compte encore des épisodes à venir.
            const airedEps = s.episodes.filter((e) => !isUpcoming(e.airDate));
            const airedWatched = airedEps.filter((e) => e.watched).length;
            const done = airedEps.length > 0 && airedWatched >= airedEps.length;
            const pct = airedEps.length > 0 ? Math.min(100, (airedWatched / airedEps.length) * 100) : 0;
            const label = isSpecial(s) ? 'Épisodes spéciaux' : s.title;
            return (
              <View key={s.id} style={{ marginBottom: 12 }}>
                <Pressable
                  style={styles.season}
                  onPress={() => setOpen((o) => ({ ...o, [s.seasonNumber]: !o[s.seasonNumber] }))}
                  accessibilityRole="button"
                  accessibilityLabel={`${label}, ${s.watchedCount} sur ${s.totalCount} vus`}
                  accessibilityState={{ expanded: !!isOpen }}
                >
                  <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, marginRight: 8 }}>
                    <Text style={[styles.seasonTitle, { flexShrink: 1 }]} numberOfLines={1}>
                      {label}
                    </Text>
                    <Feather name={isOpen ? 'chevron-up' : 'chevron-down'} size={22} color={COLORS.black} />
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Text style={styles.seasonProg}>{s.watchedCount}/{s.totalCount}</Text>
                    <CheckCircle
                      size={44}
                      checked={done}
                      onPress={episodeBusy ? undefined : () => (done ? markAllUnwatched.mutate(s.seasonNumber) : markAll.mutate(s.seasonNumber))}
                    />
                  </View>
                  {/* Barre : piste jaune pâle toujours visible, remplissage jaune,
                      le tout vert quand tous les épisodes diffusés sont vus. */}
                  <View style={[styles.progressTrack, done && { backgroundColor: COLORS.green }]}>
                    <AnimatedFill pct={pct} color={done ? COLORS.green : COLORS.yellow} style={styles.progressFill} />
                  </View>
                </Pressable>
                {isOpen
                  ? s.episodes.map((e) => {
                      const upcoming = isUpcoming(e.airDate);
                      return (
                        // Taper la carte ouvre la fenêtre épisode (les non
                        // diffusés restent inertes : rien à y voir/cocher).
                        <Pressable
                          key={e.id}
                          style={styles.eprow}
                          onPress={upcoming ? undefined : () => openSheet(e)}
                          accessibilityRole={upcoming ? undefined : 'button'}
                          accessibilityLabel={`Épisode ${episodeCode(e.seasonNumber, e.episodeNumber)}`}
                        >
                          <EpThumb stillPath={e.stillPath} fallback={posterPath} />
                          <View style={{ flex: 1, padding: 10, justifyContent: 'center' }}>
                            <Text style={styles.epCode}>{episodeCode(e.seasonNumber, e.episodeNumber)}</Text>
                            <Text style={styles.epRowTitle} numberOfLines={2}>{e.title}</Text>
                          </View>
                          <View style={{ justifyContent: 'center', paddingRight: 14 }}>
                            {upcoming ? (
                              // Épisode pas encore diffusé : pas de coche, mais le
                              // compte à rebours en jours (façon TV Time).
                              <View style={styles.daysWrap}>
                                <Text style={styles.daysNum}>{daysUntil(e.airDate)}</Text>
                                <Text style={styles.daysLabel}>{daysUntil(e.airDate) > 1 ? 'JOURS' : 'JOUR'}</Text>
                              </View>
                            ) : (
                              <CheckCircle size={44} checked={e.watched} onPress={episodeBusy ? undefined : () => pressEp(e)} />
                            )}
                          </View>
                        </Pressable>
                      );
                    })
                  : null}
              </View>
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
  headerOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 20,
    backgroundColor: COLORS.white,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.borderLight,
  },
  hero: {
    height: 260,
    backgroundColor: '#171120',
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  heroPrism: {
    position: 'absolute',
    right: -86,
    bottom: -124,
    width: 220,
    height: 220,
    borderRadius: 46,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.17)',
    backgroundColor: 'rgba(239,91,168,0.18)',
    transform: [{ rotate: '34deg' }],
  },
  heroOrb: {
    position: 'absolute',
    left: -72,
    top: -96,
    width: 210,
    height: 210,
    borderRadius: 105,
    backgroundColor: 'rgba(243,197,79,0.13)',
  },
  heroBtns: {
    position: 'absolute',
    left: SPACE.sm,
    right: SPACE.sm,
    zIndex: 4,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  heroIconButton: {
    width: SIZES.touch,
    height: SIZES.touch,
    borderRadius: RADIUS.control,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(14,8,22,0.56)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
  },
  pressed: { opacity: 0.7 },
  heroTitleWrap: {
    width: '100%',
    minHeight: 112,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: SPACE.sm,
    paddingHorizontal: SPACE.md,
    paddingBottom: SPACE.md,
  },
  heroPoster: {
    width: 62,
    height: 92,
    borderRadius: RADIUS.small,
    backgroundColor: COLORS.imagePlaceholder,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.28)',
  },
  heroCopy: { flex: 1, minWidth: 0, paddingBottom: 2 },
  heroKindBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    minHeight: 24,
    paddingHorizontal: SPACE.xs,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.yellow,
    marginBottom: SPACE.xs,
  },
  heroKindText: { color: COLORS.onAccent, fontSize: 10, fontFamily: FONTS.extraBold, letterSpacing: 1 },
  heroTitle: { color: '#FFFFFF', fontSize: 25, lineHeight: 29, fontFamily: FONTS.extraBold },
  heroSub: { color: 'rgba(255,255,255,0.86)', fontFamily: FONTS.semiBold, fontSize: 13, lineHeight: 18, marginTop: 3 },
  heroCollapsedTitle: {
    position: 'absolute',
    left: 70,
    right: 70,
    zIndex: 3,
    textAlign: 'center',
    color: '#FFFFFF',
    fontSize: 17,
    fontFamily: FONTS.extraBold,
  },
  heroProgressTrack: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 5 },
  heroProgressFill: { height: '100%' },
  addBar: {
    position: 'absolute',
    left: SPACE.sm,
    right: SPACE.sm,
    zIndex: 40,
    minHeight: 56,
    borderRadius: RADIUS.card,
    backgroundColor: COLORS.yellow,
    paddingHorizontal: SPACE.md,
    alignItems: 'center',
    justifyContent: 'center',
    ...SHADOW.card,
  },
  addBarPressed: { opacity: 0.84, transform: [{ scale: 0.99 }] },
  addBarRow: { minHeight: SIZES.touch, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACE.xs },
  addBarText: { color: COLORS.onAccent, fontSize: 14, fontFamily: FONTS.extraBold, letterSpacing: 0.7 },
  section: {
    marginHorizontal: SPACE.sm,
    marginTop: SPACE.sm,
    paddingHorizontal: SPACE.md,
    paddingVertical: SPACE.md,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: RADIUS.card,
    backgroundColor: COLORS.white,
  },
  sectionHeadRow: {
    minHeight: SIZES.touch,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: SPACE.lg,
    marginBottom: SPACE.sm,
  },
  sectionHeadRowTight: { minHeight: 32, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  // Petit titre discret de la ligne de suivi (même recette que la fiche jeu).
  trackingTitle: {
    color: COLORS.textMuted,
    fontFamily: FONTS.bold,
    fontSize: 13,
    lineHeight: 17,
    marginBottom: SPACE.xs,
  },
  sectionTitle: { color: COLORS.text, fontSize: 17, lineHeight: 22, fontFamily: FONTS.extraBold },
  muted: { color: COLORS.textMuted, fontFamily: FONTS.regular, fontSize: 13.5, lineHeight: 20, marginTop: SPACE.xs },
  overview: { color: COLORS.text, fontFamily: FONTS.regular, fontSize: 14, lineHeight: 21, marginTop: SPACE.sm },
  infoMeta: { color: COLORS.textMuted, fontFamily: FONTS.semiBold, fontSize: 13, lineHeight: 18, marginTop: 5 },
  provBtn: {
    minHeight: SIZES.touch,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.xs,
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.pill,
    paddingHorizontal: SPACE.md,
  },
  provText: { color: COLORS.onPrimary, fontSize: 12, fontFamily: FONTS.extraBold, letterSpacing: 0.3 },
  question: { color: COLORS.text, textAlign: 'center', fontSize: 13, lineHeight: 19, fontFamily: FONTS.extraBold, marginBottom: SPACE.md, letterSpacing: 0.2 },
  qbtn: {
    minHeight: SIZES.touch,
    backgroundColor: COLORS.surfaceMuted,
    borderRadius: RADIUS.control,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    paddingHorizontal: SPACE.sm,
    paddingVertical: SPACE.sm,
    marginBottom: SPACE.xs,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qbtnSel: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  qbtnText: { color: COLORS.text, textAlign: 'center', fontSize: 13, fontFamily: FONTS.bold },
  similarRow: { minHeight: 78, flexDirection: 'row', alignItems: 'center', gap: SPACE.sm },
  similarThumb: { width: 52, height: 52, borderRadius: RADIUS.control, backgroundColor: COLORS.imagePlaceholder },
  similarTitle: { color: COLORS.text, fontSize: 16, fontFamily: FONTS.extraBold },
  similarName: { fontSize: 13.5, fontFamily: FONTS.regular, color: COLORS.textMuted, marginTop: 2 },
  metaRows: { marginTop: SPACE.md, gap: SPACE.sm },
  metaItem: { minHeight: 24, flexDirection: 'row', alignItems: 'center', gap: SPACE.xs },
  metaText: { flex: 1, color: COLORS.text, fontSize: 14, lineHeight: 20, fontFamily: FONTS.regular },
  castCard: {
    width: 112,
    height: 156,
    borderRadius: RADIUS.poster,
    overflow: 'hidden',
    backgroundColor: COLORS.imagePlaceholder,
    justifyContent: 'flex-end',
    borderWidth: 1,
    borderColor: COLORS.borderLight,
  },
  castCap: { backgroundColor: 'rgba(9,5,16,0.72)', paddingHorizontal: SPACE.xs, paddingVertical: SPACE.xs },
  castName: { color: '#FFFFFF', fontSize: 13, fontFamily: FONTS.bold },
  castRole: { color: 'rgba(255,255,255,0.82)', fontSize: 10.5, fontFamily: FONTS.bold, letterSpacing: 0.3, marginTop: 1 },
  recoCard: {
    width: 132,
    aspectRatio: 2 / 3,
    borderRadius: RADIUS.poster,
    overflow: 'hidden',
    backgroundColor: COLORS.imagePlaceholder,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
  },
  recoBadge: { position: 'absolute', top: 0, right: SPACE.xs, width: 36, height: 32, backgroundColor: COLORS.yellow, borderBottomLeftRadius: RADIUS.small, borderBottomRightRadius: RADIUS.small, alignItems: 'center', justifyContent: 'center' },
  seasonPickRow: {
    minHeight: SIZES.touch,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.xs,
    alignSelf: 'flex-start',
    marginTop: SPACE.xs,
    marginBottom: SPACE.xs,
    paddingHorizontal: SPACE.xs,
    borderRadius: RADIUS.control,
    backgroundColor: COLORS.surfaceMuted,
  },
  seasonPick: { color: COLORS.text, fontSize: 15, fontFamily: FONTS.bold },
  dotsRow: { flexDirection: 'row', gap: 6, justifyContent: 'center', marginTop: SPACE.xs },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: COLORS.chipSelected },
  dotOn: { width: 20, backgroundColor: COLORS.primary },
  commentsRow: { minHeight: 68, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  commentsCount: { fontSize: 14, fontFamily: FONTS.bold, color: COLORS.secondary },
  eprow: {
    flexDirection: 'row',
    minHeight: 96,
    overflow: 'hidden',
    marginBottom: SPACE.xs,
    borderRadius: RADIUS.poster,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    backgroundColor: COLORS.white,
    ...SHADOW.card,
  },
  epThumb: { width: 106, backgroundColor: COLORS.imagePlaceholder },
  epCode: { color: COLORS.primary, fontSize: 14, fontFamily: FONTS.extraBold, letterSpacing: 0.4 },
  epRowTitle: { color: COLORS.text, fontFamily: FONTS.regular, fontSize: 13, lineHeight: 18, marginTop: 3 },
  markAllBtn: { width: SIZES.touch, height: SIZES.touch, borderRadius: 22, borderWidth: 2, borderColor: COLORS.primary, backgroundColor: COLORS.primarySoft, alignItems: 'center', justifyContent: 'center' },
  season: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 80,
    paddingHorizontal: SPACE.md,
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.card,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    ...SHADOW.season,
  },
  seasonTitle: { color: COLORS.text, fontSize: 18, fontFamily: FONTS.extraBold },
  seasonProg: { color: COLORS.textMuted, fontFamily: FONTS.bold, fontSize: 14, marginRight: SPACE.xs },
  daysWrap: { minWidth: SIZES.touch, minHeight: SIZES.touch, alignItems: 'center', justifyContent: 'center' },
  daysNum: { color: COLORS.text, fontSize: 21, fontFamily: FONTS.extraBold, lineHeight: 24 },
  daysLabel: { color: COLORS.textMuted, fontSize: 9.5, fontFamily: FONTS.bold, letterSpacing: 0.8 },
  progressTrack: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 5,
    borderBottomLeftRadius: RADIUS.card,
    borderBottomRightRadius: RADIUS.card,
    overflow: 'hidden',
    backgroundColor: YELLOW_TRACK,
  },
  progressFill: { position: 'absolute', left: 0, bottom: 0, top: 0, borderBottomLeftRadius: RADIUS.card },
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
