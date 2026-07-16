import React, { useState, useEffect, useRef } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Modal, TextInput, ActivityIndicator, Image, Share, Platform, Animated, Dimensions } from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';
import Svg, { Circle, Line, Polyline, Text as SvgText } from 'react-native-svg';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { goBack } from '@/lib/nav';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, tmdbImage } from '@/lib/api';
import type { EpisodeDto, MediaDto } from '@/lib/types';
import { episodeCode } from '@/lib/format';
import { COLORS, RADIUS, SHADOW, FONTS, STATUS_BAR } from '@/lib/theme';
import { TopTabs, CheckCircle, Loading, LoadError, EmptyState } from '@/components/ui';
import { AnimatedFill, Pop, SlideUpBar, FadeSwitch, PressableScale } from '@/components/anim';
import { Stars } from '@/components/Stars';
import { MarkPreviousPopup, hasUnwatchedPrevious } from '@/components/MarkPreviousPopup';
import { EpisodeSheet, type EpisodeSheetTarget } from '@/components/EpisodeSheet';
import { genresFr, statusFr, airDayFr, compactCount } from '@/lib/frMedia';
import { FicheSkeleton } from '@/components/FicheSkeleton';
import { ReportModal } from '@/components/ReportModal';

const INTEREST = ['LES ACTEURS', 'LA PRÉMISSE', 'LES CRÉATEURS', 'LA CHAÎNE/LA PLATEFORME', "LA FRANCHISE OU L'UNIVERS", 'AUTRE'];
const STATUS_LABELS: Record<string, string> = {
  watching: 'En cours', completed: 'Terminée', watchlist: 'Regarder plus tard',
  paused: 'En pause', abandoned: 'Arrêtée', not_started: 'Pas commencée',
};

export default function ShowDetail() {
  const { id, type } = useLocalSearchParams<{ id: string; type?: string }>();
  const isMovie = type === 'movie';
  const router = useRouter();
  const insets = useSafeAreaInsets();
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

  // Bandeau jaune éphémère en bas d'écran (façon « AJOUTÉE ! » de TV Time).
  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2000);
  };

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
    mutationFn: () => api.post(`/api/${isMovie ? 'movies' : 'shows'}/${id}/favorite`),
    onMutate: () => patchMedia({ isFavorite: !detail.data?.media?.isFavorite }),
    onError: (_e, _v, ctx) => rollback(ctx),
    onSettled: refresh,
  });
  const markMovie = useMutation({
    mutationFn: (seen: boolean) => api.post(`/api/movies/${id}/${seen ? 'watched' : 'unwatched'}`),
    onMutate: (seen: boolean) => patchMedia({ userStatus: seen ? 'completed' : 'watchlist' }),
    onError: (_e, _v, ctx) => rollback(ctx),
    onSettled: refresh,
  });
  // Suivre (façon TV Time) : série -> statut « Pas commencé », film -> watchlist.
  const follow = useMutation({
    mutationFn: () => api.post(isMovie ? `/api/movies/${id}/watchlist` : `/api/shows/${id}/follow`),
    onMutate: async () => {
      setJustAdded(true);
      setTimeout(() => setJustAdded(false), 2000);
      return patchMedia({ userStatus: isMovie ? 'watchlist' : 'not_started' });
    },
    onError: (_e, _v, ctx) => rollback(ctx),
    onSettled: refresh,
  });
  const watchLater = useMutation({
    mutationFn: () => api.post(isMovie ? `/api/movies/${id}/watchlist` : `/api/shows/${id}/watchlater`),
    onMutate: async () => {
      showToast('Regarder plus tard');
      return patchMedia({ userStatus: 'watchlist' });
    },
    onError: (_e, _v, ctx) => rollback(ctx),
    onSettled: refresh,
  });
  // « Arrêter de regarder » (série commencée) : statut « Arrêtée », la série
  // rejoint la section ARRÊTÉ de la page Séries du profil et disparaît de
  // « À venir ». Le statut est volontairement collant : cocher un épisode ne
  // la fait PAS repasser « En cours » (cf. recalculateShowStatus côté serveur).
  const abandon = useMutation({
    mutationFn: () => api.post(`/api/shows/${id}/abandon`),
    onMutate: async () => {
      showToast('Série arrêtée');
      return patchMedia({ userStatus: 'abandoned' });
    },
    onError: (_e, _v, ctx) => rollback(ctx),
    onSettled: refresh,
  });
  const removeTracking = useMutation({
    mutationFn: () => api.del(`/api/${isMovie ? 'movies' : 'shows'}/${id}/tracking`),
    onMutate: async () => {
      showToast(isMovie ? 'Film supprimé' : 'Série supprimée');
      return patchMedia({ userStatus: null, isFavorite: false });
    },
    onError: (_e, _v, ctx) => rollback(ctx),
    onSettled: refresh,
  });
  const share = () => {
    const message = `Regarde « ${detail.data?.media?.title} » — suivi avec SerieTime 📺`;
    const url = typeof window !== 'undefined' ? window.location.href : undefined;
    // Web app (plateforme principale) : Share natif RN n'existe pas → Web Share
    // API si dispo (Safari iOS / Chrome Android), sinon copie dans le presse-papier.
    if (Platform.OS === 'web') {
      const nav = typeof navigator !== 'undefined' ? (navigator as Navigator & { share?: (d: object) => Promise<void> }) : undefined;
      if (nav?.share) {
        nav.share({ title: 'SerieTime', text: message, url }).catch(() => undefined);
      } else if (nav?.clipboard) {
        nav.clipboard.writeText(`${message}${url ? ` ${url}` : ''}`).then(() => showToast('Lien copié'), () => undefined);
      }
      return;
    }
    Share.share({ message }).catch(() => undefined);
  };

  // Signalement : envoie l'œuvre à l'équipe de modération (tri manuel).
  // Échec silencieux — toast neutre dans tous les cas.
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
    } catch {
      // Erreur silencieuse : on remercie quand même (pas de fuite d'état serveur).
    }
    showToast('Merci, signalement envoyé 👍');
  };

  // En-tête repliable façon TV Time : la bannière se réduit en barre compacte
  // (titre centré) à mesure que le contenu défile, quel que soit l'onglet.
  const scrollY = useRef(new Animated.Value(0)).current;

  if (detail.isLoading) return <FicheSkeleton heroHeight={240} />;
  if (!detail.data) return <LoadError onRetry={detail.refetch} busy={detail.isRefetching} />;
  const media: MediaDto = detail.data.media;
  const isFollowed = media.userStatus != null;
  const HERO_MAX = 240;
  const HERO_MIN = insets.top + 54;
  const heroH = scrollY.interpolate({ inputRange: [0, 150], outputRange: [HERO_MAX, HERO_MIN], extrapolate: 'clamp' });
  const bigOpacity = scrollY.interpolate({ inputRange: [0, 90], outputRange: [1, 0], extrapolate: 'clamp' });
  const smallOpacity = scrollY.interpolate({ inputRange: [90, 150], outputRange: [0, 1], extrapolate: 'clamp' });
  const onScroll = Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: false });

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

  return (
    <Pop style={{ backgroundColor: COLORS.white }}>
      <Animated.View style={[styles.hero, { height: heroH }]}>
        {(() => {
          const heroUri = tmdbImage(media.backdropPath, 'w780') ?? tmdbImage(media.posterPath, 'w500');
          return heroUri ? (
            <>
              <Image source={{ uri: heroUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
              <View style={styles.heroShade} />
            </>
          ) : null;
        })()}
        <View style={[styles.heroBtns, { top: insets.top + 4 }]}>
          <Pressable onPress={() => goBack('/')} hitSlop={8} accessibilityRole="button" accessibilityLabel="Retour">
            <Feather name="chevron-down" size={30} color="#fff" />
          </Pressable>
          <Pressable onPress={() => setMenu(true)} hitSlop={8} accessibilityLabel="Options">
            <Feather name="more-horizontal" size={28} color="#fff" />
          </Pressable>
        </View>
        {/* Titre compact centré, visible quand l'en-tête est replié. */}
        <Animated.Text
          style={[styles.heroCollapsedTitle, { top: insets.top + 12, opacity: smallOpacity }]}
          numberOfLines={1}
        >
          {media.title}
        </Animated.Text>
        <Animated.View style={[styles.heroTitleWrap, { opacity: bigOpacity }]}>
          <Text style={styles.heroTitle}>{media.title}</Text>
          <Text style={styles.heroSub}>
            {isMovie
              ? [media.year, genresFr(media.genres)].filter(Boolean).join(' • ')
              : [
                  detail.data.show?.numberOfSeasons ? `${detail.data.show.numberOfSeasons} saison${detail.data.show.numberOfSeasons > 1 ? 's' : ''}` : null,
                  statusFr(media.status),
                  detail.data.show?.platform ?? detail.data.show?.network,
                ].filter(Boolean).join(' • ')}
          </Text>
        </Animated.View>
        {/* Progression globale au bas de la bannière, colorée par statut. */}
        {heroProg ? (
          <View style={[styles.heroProgressTrack, { backgroundColor: heroProg.track }]}>
            <AnimatedFill pct={heroProg.pct} color={heroProg.fill} style={styles.heroProgressFill} />
          </View>
        ) : null}
      </Animated.View>

      {isMovie ? (
        <MovieBody
          media={media}
          detail={detail.data}
          mediaId={String(id)}
          onToggle={() => markMovie.mutate(media.userStatus !== 'completed')}
          onScroll={onScroll}
        />
      ) : (
        <>
          {/* Comme TV Time : deux onglets, les commentaires vivent au bas de « À propos ». */}
          <TopTabs tabs={['À PROPOS', 'ÉPISODES']} active={tab} onChange={setTab} />
          <FadeSwitch trigger={tab}>
            {tab === 'À PROPOS' ? (
              <AboutTab media={media} detail={detail.data} mediaId={String(id)} interest={interest} setInterest={setInterest} onScroll={onScroll} />
            ) : (
              <EpisodesTab showId={String(id)} title={media.title} posterPath={media.posterPath} onChange={refresh} onScroll={onScroll} />
            )}
          </FadeSwitch>
        </>
      )}

      {/* Barre du bas façon TV Time : + AJOUTER, puis ✓ AJOUTÉE ! pendant 2 s. */}
      {!isFollowed && !justAdded && !toast ? (
        <Pressable
          style={[styles.addBar, { paddingBottom: insets.bottom + 16 }]}
          onPress={() => follow.mutate()}
          disabled={follow.isPending}
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
      <SlideUpBar visible={!!(justAdded || toast)} style={[styles.addBar, { paddingBottom: insets.bottom + 16 }]}>
        <View style={styles.addBarRow}>
          <Feather name="check" size={24} color={COLORS.onAccent} />
          <Text style={styles.addBarText}>{toast ?? (isMovie ? 'AJOUTÉ !' : 'AJOUTÉE !')}</Text>
        </View>
      </SlideUpBar>

      <Modal visible={menu} transparent animationType="fade" onRequestClose={() => setMenu(false)}>
        <Pressable style={styles.overlay} onPress={() => setMenu(false)} />
        {/* Carte flottante compacte (cotes TV Time) : rangées ~48dp, police 17.
            Films : pas de rangée de statut ni de « Regarder plus tard » (parité
            TV Time) ; séries commencées : « Arrêter de regarder ». */}
        <View style={[styles.sheet, { bottom: insets.bottom + 8 }]}>
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
          />
          <SheetItem icon="plus-square" label="Ajouter à une liste" onPress={() => { setMenu(false); setListsOpen(true); }} />
          {!isMovie ? (
            <SheetItem icon="clock" label="Regarder plus tard" onPress={() => { setMenu(false); watchLater.mutate(); }} />
          ) : null}
          {/* « Terminée » incluse : une série finie dont une nouvelle saison sort
              revient dans « À voir » — on doit pouvoir l'arrêter sans la
              supprimer (l'historique de visionnage est conservé). */}
          {!isMovie && (media.userStatus === 'watching' || media.userStatus === 'paused' || media.userStatus === 'completed') ? (
            <SheetItem icon="x-circle" label="Arrêter de regarder" onPress={() => { setMenu(false); abandon.mutate(); }} />
          ) : null}
          {isFollowed ? (
            <SheetItem
              icon="minus-square"
              label={isMovie ? 'Supprimer le film' : 'Supprimer la série'}
              onPress={() => { setMenu(false); removeTracking.mutate(); }}
            />
          ) : null}
          <SheetItem icon="share-2" label="Partager" onPress={() => { setMenu(false); share(); }} />
          <SheetItem icon="flag" label="Signaler" onPress={() => { setMenu(false); setReportOpen(true); }} last />
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

function SheetItem({ icon, label, onPress, color, last }: { icon: keyof typeof Feather.glyphMap; label: string; onPress: () => void; color?: string; last?: boolean }) {
  return (
    <Pressable style={[styles.sheetItem, last && { borderBottomWidth: 0 }]} onPress={onPress}>
      <Feather name={icon} size={20} color={color ?? COLORS.black} />
      <Text style={styles.sheetLabel}>{label}</Text>
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
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose} />
      <View style={[styles.sheet, { bottom: insets.bottom + 8 }]}>
        <Text style={pstyles.menuHeader}>Personnaliser</Text>
        <Pressable style={pstyles.menuItem} onPress={() => onPick('poster')}>
          <Text style={pstyles.menuItemText}>Modifier l&apos;affiche</Text>
        </Pressable>
        <Pressable style={pstyles.menuItem} onPress={() => onPick('banner')}>
          <Text style={pstyles.menuItemText}>Changer la bannière</Text>
        </Pressable>
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
  const [busyUri, setBusyUri] = useState<string | null>(null);
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
    try {
      if (mode === 'poster') await api.post(`/api/${base}/${mediaId}/poster`, { posterPath: uri });
      else await api.post(`/api/${base}/${mediaId}/banner`, { backdropPath: uri });
      images.refetch();
      onApplied(mode);
    } finally {
      setBusyUri(null);
    }
  };

  const isPoster = mode === 'poster';
  const list = (isPoster ? images.data?.posters : images.data?.backdrops) ?? [];
  const selectedUri = isPoster ? images.data?.selectedPoster : images.data?.selectedBackdrop;

  const cell = (uri: string) => {
    const selected = uri === selectedUri;
    return (
      <Pressable key={uri} style={isPoster ? pstyles.posterWrap : pstyles.bannerWrap} onPress={() => apply(uri)}>
        <Image
          source={{ uri: tmdbImage(uri, isPoster ? 'w342' : 'w500') ?? uri }}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
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
    <Modal visible={mode !== null} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: COLORS.white }}>
        <View style={pstyles.header}>
          <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Fermer">
            <Feather name="arrow-left" size={24} color={COLORS.black} />
          </Pressable>
          <Text style={pstyles.title}>{isPoster ? "Modifier l'affiche" : 'Changer la bannière'}</Text>
          <View style={{ width: 24 }} />
        </View>
        {images.isLoading ? (
          <Loading />
        ) : list.length === 0 ? (
          <Text style={pstyles.emptyNote}>
            {isPoster ? 'Aucune affiche disponible.' : isMovie ? 'Aucune bannière disponible pour ce film.' : 'Aucune bannière disponible pour cette série.'}
          </Text>
        ) : (
          <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 40 }}>
            <View style={isPoster ? pstyles.grid : pstyles.bannerList}>{list.map(cell)}</View>
          </ScrollView>
        )}
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
  const qc = useQueryClient();
  const [newTitle, setNewTitle] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
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
    if (busyId) return;
    setBusyId(l.id);
    const added = !l.containsMediaId;
    const prev = qc.getQueryData<{ lists: PickerList[] }>(pickerKey);
    qc.setQueryData<{ lists: PickerList[] }>(pickerKey, (d) =>
      d ? { lists: d.lists.map((x) => (x.id === l.id ? { ...x, containsMediaId: added, itemCount: Math.max(0, x.itemCount + (added ? 1 : -1)) } : x)) } : d,
    );
    onChanged(added, l.title);
    try {
      if (added) await api.post(`/api/lists/${l.id}/items`, { mediaId });
      else await api.del(`/api/lists/${l.id}/items/${mediaId}`);
      syncOthers();
    } catch {
      if (prev) qc.setQueryData(pickerKey, prev);
    } finally {
      setBusyId(null);
    }
  };

  // Création OPTIMISTE : la liste apparaît tout de suite (cochée), le serveur
  // confirme derrière ; le profil est invalidé pour afficher la nouvelle liste.
  const create = async () => {
    const title = newTitle.trim();
    if (!title || creating) return;
    setCreating(true);
    setNewTitle('');
    const prev = qc.getQueryData<{ lists: PickerList[] }>(pickerKey);
    const tempId = `tmp-${title}`;
    qc.setQueryData<{ lists: PickerList[] }>(pickerKey, (d) =>
      d ? { lists: [...d.lists, { id: tempId, title, itemCount: 1, containsMediaId: true }] } : d,
    );
    onChanged(true, title);
    try {
      const res = await api.post<{ id: string }>('/api/lists', { title });
      await api.post(`/api/lists/${res.id}/items`, { mediaId });
      qc.setQueryData<{ lists: PickerList[] }>(pickerKey, (d) =>
        d ? { lists: d.lists.map((x) => (x.id === tempId ? { ...x, id: res.id } : x)) } : d,
      );
      syncOthers();
    } catch {
      if (prev) qc.setQueryData(pickerKey, prev);
    } finally {
      setCreating(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose} />
      <View style={[styles.sheet, { maxHeight: '70%', bottom: insets.bottom + 8 }]}>
        <View style={styles.statusRow}>
          <Text style={styles.statusText}>Ajouter à une liste</Text>
        </View>
        <ScrollView keyboardShouldPersistTaps="handled">
          {lists.isLoading ? (
            <Loading />
          ) : (
            (lists.data?.lists ?? []).map((l) => (
              <Pressable key={l.id} style={styles.sheetItem} onPress={() => toggle(l)}>
                <Feather name={l.containsMediaId ? 'check-square' : 'square'} size={22} color={l.containsMediaId ? '#1a9c4b' : COLORS.black} />
                <Text style={styles.sheetLabel} numberOfLines={1}>
                  {l.title}
                </Text>
                {busyId === l.id ? <ActivityIndicator color={COLORS.black} size="small" /> : (
                  <Text style={pstyles.listCount}>{l.itemCount}</Text>
                )}
              </Pressable>
            ))
          )}
          <View style={pstyles.newListRow}>
            <TextInput
              style={pstyles.newListInput}
              placeholder="Nouvelle liste…"
              placeholderTextColor={COLORS.textSoft}
              value={newTitle}
              onChangeText={setNewTitle}
              onSubmitEditing={create}
            />
            <Pressable style={[pstyles.newListBtn, (!newTitle.trim() || creating) && { opacity: 0.4 }]} onPress={create} disabled={!newTitle.trim() || creating}>
              {creating ? <ActivityIndicator color={COLORS.black} size="small" /> : <Text style={pstyles.newListBtnText}>CRÉER</Text>}
            </Pressable>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const pstyles = StyleSheet.create({
  // Mesures TV Time (réf. 38-40) : entête « Personnaliser » 15 regular,
  // options 17 semiBold, grille d'affiches 2 colonnes, sélection assombrie.
  menuHeader: { fontSize: 15, fontFamily: FONTS.regular, color: COLORS.textMuted, paddingHorizontal: 22, paddingTop: 20, paddingBottom: 8 },
  menuItem: { paddingHorizontal: 22, paddingVertical: 13 },
  menuItemText: { color: COLORS.text, fontSize: 16, fontFamily: FONTS.regular },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16,
    paddingTop: 54, paddingBottom: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.border,
  },
  title: { color: COLORS.text, fontSize: 18, fontFamily: FONTS.bold },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  posterWrap: { width: '48.3%', aspectRatio: 2 / 3, borderRadius: 8, overflow: 'hidden', backgroundColor: COLORS.imagePlaceholder },
  bannerList: { gap: 12 },
  bannerWrap: { width: '100%', aspectRatio: 16 / 9, borderRadius: 8, overflow: 'hidden', backgroundColor: COLORS.imagePlaceholder },
  selectedShade: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  selectedRow: { flexDirection: 'row', alignItems: 'center', gap: 9, padding: 14 },
  selectedStar: { color: COLORS.yellow, fontSize: 19, lineHeight: 22 },
  selectedText: { color: COLORS.white, fontSize: 16, fontFamily: FONTS.semiBold },
  busy: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' },
  emptyNote: { color: COLORS.textMuted, fontFamily: FONTS.regular, fontSize: 15, padding: 20 },
  listCount: { color: COLORS.textMuted, fontFamily: FONTS.regular, fontSize: 15 },
  newListRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 24, paddingVertical: 16 },
  newListInput: { color: COLORS.text, flex: 1, borderBottomWidth: 1, borderBottomColor: COLORS.border, fontFamily: FONTS.regular, fontSize: 16, paddingVertical: 8 },
  newListBtn: { backgroundColor: COLORS.yellow, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 10 },
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
      router.push(`/show/${item.localId}${type === 'movie' ? '?type=movie' : ''}`);
      return;
    }
    setBusyId(item.tmdbId);
    try {
      const res = await api.post<{ mediaId: string }>(
        `/api/${type === 'movie' ? 'movies' : 'shows'}/add-from-tmdb`,
        { tmdbId: item.tmdbId, follow: false },
      );
      router.push(`/show/${res.mediaId}${type === 'movie' ? '?type=movie' : ''}`);
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
        <Text style={styles.sectionTitle}>Où regarder</Text>
        <Feather name="settings" size={18} color={COLORS.black} />
      </View>
      {providers.length === 0 ? (
        <Text style={styles.muted}>Non disponible</Text>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingTop: 12 }}>
          {providers.map((p) => (
            <View key={p.name} style={styles.provBtn}>
              <Ionicons name="play-circle-outline" size={17} color="#fff" />
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
    <PressableScale style={[styles.section, styles.similarRow]} onPress={() => rec.open(item)}>
      {thumb ? <Image source={{ uri: thumb }} style={styles.similarThumb} resizeMode="cover" /> : <View style={styles.similarThumb} />}
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
          >
            {tmdbImage(c.profilePath, 'w185') ? (
              <Image source={{ uri: tmdbImage(c.profilePath, 'w185')! }} style={StyleSheet.absoluteFill} resizeMode="cover" />
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
          <PressableScale key={r.tmdbId} style={styles.recoCard} onPress={() => rec.open(r)}>
            {tmdbImage(r.posterPath, 'w342') ? (
              <Image source={{ uri: tmdbImage(r.posterPath, 'w342')! }} style={StyleSheet.absoluteFill} resizeMode="cover" />
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
  const W = Dimensions.get('window').width - 40;
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
      <Text style={styles.sectionTitle}>Notes de la communauté</Text>
      <Pressable style={styles.seasonPickRow} onPress={() => setSeason((idx + 1) % seasons.length)}>
        <Text style={styles.seasonPick}>Saison {cur.seasonNumber}</Text>
        {seasons.length > 1 ? <Feather name="chevron-down" size={18} color={COLORS.black} /> : null}
      </Pressable>
      <Svg width={W} height={H}>
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

// Rangée « Commentaires » (compteur + chevron) : ouvre la page dédiée.
function CommentsRowLink({ mediaId, title }: { mediaId: string; title: string }) {
  const router = useRouter();
  const q = useQuery({
    queryKey: ['comments', mediaId],
    queryFn: () => api.get<{ comments: { replies?: unknown[] }[] }>(`/api/media/${mediaId}/comments`),
  });
  const total = (q.data?.comments ?? []).reduce((n, c) => n + 1 + (c.replies?.length ?? 0), 0);
  return (
    <Pressable
      style={[styles.section, styles.commentsRow]}
      onPress={() => router.push(`/comments/${mediaId}?title=${encodeURIComponent(title)}`)}
    >
      <Text style={styles.sectionTitle}>Commentaires</Text>
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
function AboutTab({ media, detail, mediaId, interest, setInterest, onScroll }: any) {
  return (
    <ScrollView onScroll={onScroll} scrollEventThrottle={16} contentContainerStyle={{ paddingBottom: 90 }}>
      <WhereToWatch providers={detail.providers ?? []} />

      <View style={styles.section}>
        <Text style={styles.question}>QU'EST-CE QUI VOUS INTÉRESSE LE PLUS DANS CETTE SÉRIE ?</Text>
        {INTEREST.map((o) => (
          <Pressable
            key={o}
            style={[styles.qbtn, interest.includes(o) && styles.qbtnSel]}
            onPress={() =>
              setInterest((sel: string[]) => (sel.includes(o) ? sel.filter((x) => x !== o) : [...sel, o]))
            }
          >
            <Text style={[styles.qbtnText, interest.includes(o) && { color: COLORS.onAccent }]}>{o}</Text>
          </Pressable>
        ))}
      </View>

      {detail.recommendations?.length ? <SimilarTo item={detail.recommendations[0]} isMovie={false} /> : null}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Informations sur la série</Text>
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
      <CommentsRowLink mediaId={mediaId} title={media.title} />
    </ScrollView>
  );
}

function MovieBody({ media, detail, mediaId, onToggle, onScroll }: any) {
  const seen = media.userStatus === 'completed';
  return (
    <ScrollView onScroll={onScroll} scrollEventThrottle={16} contentContainerStyle={{ paddingBottom: 90 }}>
      <View style={[styles.section, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Feather name="eye" size={18} color={COLORS.black} />
          <Text style={{ color: COLORS.text, fontFamily: FONTS.regular, fontSize: 14 }}>{seen ? 'Vu' : 'Pas vu'}</Text>
        </View>
        <CheckCircle size={44} checked={seen} onPress={onToggle} />
      </View>

      <WhereToWatch providers={detail.providers ?? []} />

      {detail.recommendations?.length ? <SimilarTo item={detail.recommendations[0]} isMovie /> : null}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Informations sur le film</Text>
        <Text style={styles.infoMeta}>{[media.year, genresFr(media.genres)].filter(Boolean).join(' • ')}</Text>
        {media.voteAverage ? <Stars rating10={media.voteAverage} size={17} /> : null}
        {media.overview ? <Text style={styles.overview}>{media.overview}</Text> : null}
        <MetaRows show={null} media={media} addedByCount={detail.addedByCount} isMovie />
      </View>

      <CastSection cast={detail.cast ?? []} mediaId={mediaId} type="movie" />
      <AlsoWatched items={detail.recommendations ?? []} type="movie" />
      <CommentsRowLink mediaId={mediaId} title={media.title} />
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
  if (uri) return <Image source={{ uri }} style={styles.epThumb} resizeMode="cover" />;
  return (
    <View style={[styles.epThumb, { alignItems: 'center', justifyContent: 'center' }]}>
      <Feather name="image" size={24} color="#9a9a9a" />
    </View>
  );
}

function EpisodesTab({ showId, title, posterPath, onChange, onScroll }: { showId: string; title: string; posterPath?: string | null; onChange: () => void; onScroll?: any }) {
  const qc = useQueryClient();
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
    mutationFn: (seasonNumber?: number) => api.post(`/api/shows/${showId}/mark-all-watched`, seasonNumber ? { seasonNumber } : {}),
    onMutate: async (seasonNumber?: number) => {
      await qc.cancelQueries({ queryKey: ['show', showId, 'episodes'] });
      const prev = qc.getQueryData<EpisodesData>(['show', showId, 'episodes']);
      if (prev) {
        qc.setQueryData<EpisodesData>(['show', showId, 'episodes'], {
          nextEpisode: prev.nextEpisode,
          seasons: prev.seasons.map((s) =>
            seasonNumber !== undefined && s.seasonNumber !== seasonNumber
              ? s
              : { ...s, watchedCount: s.totalCount, episodes: s.episodes.map((e) => ({ ...e, watched: true })) },
          ),
        });
      }
      return { prev };
    },
    onError: (_err: unknown, _sn: number | undefined, ctx?: { prev?: EpisodesData }) => {
      if (ctx?.prev) qc.setQueryData(['show', showId, 'episodes'], ctx.prev);
    },
    onSettled: refresh,
  });
  // OUI de la pop-up : coche tous les épisodes diffusés situés AVANT celui
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
  const pressEp = (e: EpisodeDto) => {
    if (!e.watched && data && hasUnwatchedPrevious(data.seasons, e)) setPrevAsk(e);
    toggleEp.mutate(e);
  };
  // Tout démarquer (hors spéciaux quand aucune saison précise), avec la même
  // mise à jour optimiste que « tout marquer ».
  const markAllUnwatched = useMutation({
    mutationFn: (seasonNumber?: number) => api.post(`/api/shows/${showId}/mark-all-unwatched`, seasonNumber ? { seasonNumber } : {}),
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

  if (isLoading) return <Loading />;
  if (!data) return <LoadError onRetry={refetch} busy={isRefetching} />;
  if (data.seasons.length === 0) return <EmptyState title="Aucun épisode" />;

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
    if (caughtUp) setConfirmUnmark(true);
    else markAll.mutate(undefined);
  };
  const doUnmarkAll = () => {
    setConfirmUnmark(false);
    markAllUnwatched.mutate(undefined);
  };

  return (
    <View style={{ flex: 1 }}>
    <ScrollView
      style={{ backgroundColor: COLORS.pageMuted }}
      contentContainerStyle={{ paddingBottom: 40 }}
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
        const CARD_W = Dimensions.get('window').width - 56; // la suivante dépasse
        return (
          <View style={{ paddingTop: 20, borderBottomWidth: 1, borderBottomColor: COLORS.borderLight, backgroundColor: COLORS.white }}>
            <Text style={[styles.sectionTitle, { paddingHorizontal: 24 }]}>{anyWatched ? 'Continuer le suivi' : 'Démarrer le suivi'}</Text>
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
                    <CheckCircle checked={e.watched} onPress={() => pressEp(e)} />
                  </View>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        );
      })() : null}

      <View style={{ paddingTop: 20 }}>
        <View style={[styles.sectionHeadRow, { marginBottom: 0 }]}>
          <Text style={styles.sectionTitle}>Tous les épisodes</Text>
          <Pressable style={styles.markAllBtn} onPress={onMasterPress} accessibilityLabel="Tout marquer">
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
                      onPress={() => (done ? markAllUnwatched.mutate(s.seasonNumber) : markAll.mutate(s.seasonNumber))}
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
                              <CheckCircle size={44} checked={e.watched} onPress={() => pressEp(e)} />
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
        <Pressable style={styles.unmarkBar} onPress={doUnmarkAll}>
          <Feather name="eye-off" size={22} color={COLORS.black} />
          <Text style={styles.unmarkText}>Marquer tout comme non vu</Text>
        </Pressable>
      ) : null}

      <MarkPreviousPopup
        visible={!!prevAsk}
        onYes={() => { if (prevAsk) markPrevious.mutate(prevAsk); setPrevAsk(null); }}
        onNo={() => setPrevAsk(null)}
      />

      {/* Fenêtre épisode (la même que dans l'onglet Séries), swipe latéral inclus. */}
      <EpisodeSheet target={sheet} onClose={() => setSheet(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { height: 240, backgroundColor: '#1a1a22', justifyContent: 'flex-end', overflow: 'hidden' },
  heroShade: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.35)' },
  addBar: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: COLORS.yellow, paddingTop: 18, alignItems: 'center' },
  addBarRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  addBarText: { color: COLORS.onAccent, fontSize: 15, fontFamily: FONTS.extraBold, letterSpacing: 0.6 },
  heroBtns: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 14 },
  heroTitleWrap: { padding: 20 },
  heroTitle: { color: '#fff', fontSize: 25, fontFamily: FONTS.extraBold },
  heroSub: { color: 'rgba(255,255,255,0.9)', fontFamily: FONTS.regular, fontSize: 15, marginTop: 2 },
  // Titre compact centré quand la bannière est repliée (marges = place des boutons).
  heroCollapsedTitle: { position: 'absolute', left: 60, right: 60, textAlign: 'center', color: '#fff', fontSize: 18, fontFamily: FONTS.bold },
  section: { paddingHorizontal: 20, paddingVertical: 18, borderBottomWidth: 1, borderBottomColor: COLORS.borderLight },
  sectionHeadRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 24, marginBottom: 14 },
  // Variante sans marges pour les entêtes DANS une section (Où regarder + rouage).
  sectionHeadRowTight: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  // Cotes HARMONISÉES avec le reste de l'app (fenêtre épisode, pages profil) :
  // titres de section 16, corps 13,5/20, méta 14 — les tailles lues sur les
  // captures TV Time brutes rendaient « énormes » (retour récurrent).
  sectionTitle: { color: COLORS.text, fontSize: 16, fontFamily: FONTS.extraBold },
  muted: { color: COLORS.textMuted, fontFamily: FONTS.regular, fontSize: 13.5, marginTop: 8 },
  overview: { color: COLORS.text, fontFamily: FONTS.regular, fontSize: 13.5, lineHeight: 20, marginTop: 10 },
  infoMeta: { color: COLORS.textMuted, fontFamily: FONTS.regular, fontSize: 13, marginTop: 5 },
  // Pastilles noires « Où regarder » (TV Time affiche toutes les plateformes).
  provBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#101014', borderRadius: 999, paddingHorizontal: 16, paddingVertical: 9 },
  provText: { color: '#fff', fontSize: 12, fontFamily: FONTS.extraBold, letterSpacing: 0.3 },
  question: { color: COLORS.text, textAlign: 'center', fontSize: 13, fontFamily: FONTS.extraBold, marginBottom: 14, letterSpacing: 0.2 },
  qbtn: { backgroundColor: COLORS.chipGrey, borderRadius: 8, paddingVertical: 12, marginBottom: 10, alignItems: 'center' },
  qbtnSel: { backgroundColor: COLORS.yellow },
  qbtnText: { color: COLORS.text, fontSize: 13.5, fontFamily: FONTS.bold },
  // « Similaire à » : vignette ronde + titre/nom à l'échelle de l'app.
  similarRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  similarThumb: { width: 48, height: 48, borderRadius: 24, backgroundColor: COLORS.imagePlaceholder },
  similarTitle: { color: COLORS.text, fontSize: 16, fontFamily: FONTS.extraBold },
  similarName: { fontSize: 13.5, fontFamily: FONTS.regular, color: COLORS.textMuted, marginTop: 2 },
  // Rangées méta (horloge / chrono / personnes) sous le synopsis.
  metaRows: { marginTop: 14, gap: 11 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  metaText: { color: COLORS.text, fontSize: 14, fontFamily: FONTS.regular },
  // Distribution : cartes 108x148, bandeau sombre nom/rôle en bas.
  castCard: { width: 108, height: 148, borderRadius: 8, overflow: 'hidden', backgroundColor: COLORS.imagePlaceholder, justifyContent: 'flex-end' },
  castCap: { backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 7, paddingVertical: 6 },
  castName: { color: '#fff', fontSize: 13, fontFamily: FONTS.bold },
  castRole: { color: 'rgba(255,255,255,0.85)', fontSize: 10.5, fontFamily: FONTS.bold, letterSpacing: 0.3, marginTop: 1 },
  // « Également regardé » : affiches 132 (2/3), badge coche jaune en haut à droite.
  recoCard: { width: 132, aspectRatio: 2 / 3, borderRadius: 8, overflow: 'hidden', backgroundColor: COLORS.imagePlaceholder },
  recoBadge: { position: 'absolute', top: 0, right: 10, width: 34, height: 30, backgroundColor: COLORS.yellow, borderBottomLeftRadius: 6, borderBottomRightRadius: 6, alignItems: 'center', justifyContent: 'center' },
  // Notes de la communauté : sélecteur de saison + points de pagination.
  seasonPickRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10, marginBottom: 12, alignSelf: 'flex-start' },
  seasonPick: { color: COLORS.text, fontSize: 16, fontFamily: FONTS.bold },
  dotsRow: { flexDirection: 'row', gap: 6, justifyContent: 'center', marginTop: 10 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: COLORS.chipSelected },
  dotOn: { backgroundColor: COLORS.black },
  // Rangée « Commentaires » (compteur + chevron) vers la page dédiée.
  commentsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  commentsCount: { fontSize: 14, fontFamily: FONTS.regular, color: COLORS.textMuted },
  eprow: { flexDirection: 'row', backgroundColor: COLORS.white, borderRadius: 5, minHeight: 92, overflow: 'hidden', marginBottom: 8, ...SHADOW.card },
  epThumb: { width: 90, backgroundColor: COLORS.imagePlaceholder },
  epCode: { color: COLORS.text, fontSize: 19, fontFamily: FONTS.extraBold },
  markAllBtn: { width: 40, height: 40, borderRadius: 20, borderWidth: 2, borderColor: COLORS.black, alignItems: 'center', justifyContent: 'center' },
  season: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 76, paddingHorizontal: 20, backgroundColor: COLORS.white, borderRadius: 5, ...SHADOW.season },
  epRowTitle: { color: COLORS.text, fontFamily: FONTS.regular, fontSize: 13, marginTop: 2 },
  // Compte à rebours des épisodes non diffusés (cf. TV Time : « 4 / JOURS »).
  daysWrap: { alignItems: 'center', minWidth: 44 },
  daysNum: { color: COLORS.text, fontSize: 22, fontFamily: FONTS.extraBold, lineHeight: 25 },
  daysLabel: { color: COLORS.text, fontSize: 10, fontFamily: FONTS.bold, letterSpacing: 0.8 },
  seasonTitle: { color: COLORS.text, fontSize: 20, fontFamily: FONTS.extraBold },
  seasonProg: { color: COLORS.text, fontFamily: FONTS.regular, fontSize: 15, marginRight: 14 },
  progressTrack: {
    position: 'absolute', left: 0, right: 0, bottom: 0, height: 5,
    borderBottomLeftRadius: 5, borderBottomRightRadius: 5, overflow: 'hidden',
    backgroundColor: 'rgba(255,212,0,0.30)', // piste jaune pâle toujours visible (réf. 35)
  },
  progressFill: { position: 'absolute', left: 0, bottom: 0, top: 0, borderBottomLeftRadius: 5 },
  // Barre de progression globale de la série, au bas de la bannière (TV Time).
  // Le fond (portion restante) est surchargé inline avec la teinte du statut.
  heroProgressTrack: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 5 },
  heroProgressFill: { height: '100%' },
  unmarkBar: { position: 'absolute', left: 12, right: 12, bottom: 20, backgroundColor: COLORS.white, borderRadius: 8, flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingVertical: 18, ...SHADOW.card },
  unmarkText: { fontSize: 15, fontFamily: FONTS.semiBold, color: COLORS.black },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: COLORS.overlay },
  // Menu « ... » : carte FLOTTANTE compacte (cotes TV Time — comparaison px des
  // captures) : marges 8, coins 14, rangées 48dp, police 17 fine, icônes 20.
  sheet: { position: 'absolute', left: 8, right: 8, bottom: 8, backgroundColor: COLORS.white, borderRadius: 14, overflow: 'hidden' },
  statusRow: { backgroundColor: COLORS.chipGrey, borderBottomWidth: 3, borderBottomColor: COLORS.yellow, height: 48, justifyContent: 'center', paddingHorizontal: 20 },
  statusText: { fontFamily: FONTS.regular, fontSize: 16, color: COLORS.textMuted },
  sheetItem: { flexDirection: 'row', alignItems: 'center', gap: 14, height: 48, paddingHorizontal: 20, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.borderLight },
  sheetLabel: { color: COLORS.text, fontSize: 17, fontFamily: FONTS.regular },
});

