import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Modal, TextInput, ActivityIndicator, Image, Share, Platform } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, tmdbImage } from '@/lib/api';
import type { EpisodeDto, MediaDto } from '@/lib/types';
import { episodeCode } from '@/lib/format';
import { COLORS, RADIUS, SHADOW, FONTS } from '@/lib/theme';
import { TopTabs, CheckCircle, Loading, LoadError, EmptyState } from '@/components/ui';
import { AnimatedFill, Pop, SlideUpBar, FadeSwitch } from '@/components/anim';

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
  // rejoint la section ARRÊTÉ de la page Séries du profil. Cocher un épisode
  // la fera repasser « En cours » (recalcul serveur).
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

  if (detail.isLoading) return <Loading />;
  if (!detail.data) return <LoadError onRetry={detail.refetch} busy={detail.isRefetching} />;
  const media: MediaDto = detail.data.media;
  const isFollowed = media.userStatus != null;

  // Barre de progression globale : épisodes diffusés vus / diffusés (hors spéciaux).
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
    return aired > 0 ? { pct: Math.min(100, (watched / aired) * 100), complete: watched >= aired } : null;
  })();

  return (
    <Pop style={{ backgroundColor: COLORS.white }}>
      <View style={styles.hero}>
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
          <Pressable onPress={() => router.back()} hitSlop={8}>
            <Feather name="chevron-down" size={30} color="#fff" />
          </Pressable>
          <Pressable onPress={() => setMenu(true)} hitSlop={8} accessibilityLabel="Options">
            <Feather name="more-horizontal" size={28} color="#fff" />
          </Pressable>
        </View>
        <View style={styles.heroTitleWrap}>
          <Text style={styles.heroTitle}>{media.title}</Text>
          <Text style={styles.heroSub}>
            {isMovie
              ? [media.year, media.genres].filter(Boolean).join(' · ')
              : [
                  detail.data.show?.numberOfSeasons ? `${detail.data.show.numberOfSeasons} saison${detail.data.show.numberOfSeasons > 1 ? 's' : ''}` : null,
                  detail.data.show?.platform ?? detail.data.show?.network,
                ].filter(Boolean).join(' · ')}
          </Text>
        </View>
        {/* Progression globale au bas de la bannière : jaune en cours, verte à jour. */}
        {heroProg ? (
          <View style={styles.heroProgressTrack}>
            <AnimatedFill
              pct={heroProg.pct}
              color={heroProg.complete ? COLORS.green : COLORS.yellow}
              style={styles.heroProgressFill}
            />
          </View>
        ) : null}
      </View>

      {isMovie ? (
        <>
          <MovieBody media={media} detail={detail.data} onToggle={() => markMovie.mutate(media.userStatus !== 'completed')} />
          <CommentsTab mediaId={String(id)} />
        </>
      ) : (
        <>
          <TopTabs tabs={['À PROPOS', 'ÉPISODES', 'DISCUSSION']} active={tab} onChange={setTab} />
          <FadeSwitch trigger={tab}>
            {tab === 'À PROPOS' ? (
              <AboutTab media={media} detail={detail.data} interest={interest} setInterest={setInterest} />
            ) : tab === 'ÉPISODES' ? (
              <EpisodesTab showId={String(id)} posterPath={media.posterPath} onChange={refresh} />
            ) : (
              <CommentsTab mediaId={String(id)} />
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
            <ActivityIndicator color={COLORS.black} />
          ) : (
            <View style={styles.addBarRow}>
              <Feather name="plus" size={24} color={COLORS.black} />
              <Text style={styles.addBarText}>{isMovie ? 'AJOUTER LE FILM' : 'AJOUTER LA SÉRIE'}</Text>
            </View>
          )}
        </Pressable>
      ) : null}
      <SlideUpBar visible={!!(justAdded || toast)} style={[styles.addBar, { paddingBottom: insets.bottom + 16 }]}>
        <View style={styles.addBarRow}>
          <Feather name="check" size={24} color={COLORS.black} />
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
          {!isMovie && (media.userStatus === 'watching' || media.userStatus === 'paused') ? (
            <SheetItem icon="x-circle" label="Arrêter de regarder" onPress={() => { setMenu(false); abandon.mutate(); }} />
          ) : null}
          {isFollowed ? (
            <SheetItem
              icon="minus-square"
              label={isMovie ? 'Supprimer le film' : 'Supprimer la série'}
              onPress={() => { setMenu(false); removeTracking.mutate(); }}
            />
          ) : null}
          <SheetItem icon="share-2" label="Partager" onPress={() => { setMenu(false); share(); }} last />
        </View>
      </Modal>

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
          <Pressable onPress={onClose} hitSlop={12}>
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
  menuHeader: { fontSize: 15, fontFamily: FONTS.regular, color: '#555', paddingHorizontal: 22, paddingTop: 20, paddingBottom: 8 },
  menuItem: { paddingHorizontal: 22, paddingVertical: 17 },
  menuItemText: { fontSize: 17, fontFamily: FONTS.semiBold },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16,
    paddingTop: 54, paddingBottom: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.border,
  },
  title: { fontSize: 18, fontFamily: FONTS.bold },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  posterWrap: { width: '48.3%', aspectRatio: 2 / 3, borderRadius: 8, overflow: 'hidden', backgroundColor: '#e5e5e5' },
  bannerList: { gap: 12 },
  bannerWrap: { width: '100%', aspectRatio: 16 / 9, borderRadius: 8, overflow: 'hidden', backgroundColor: '#e5e5e5' },
  selectedShade: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  selectedRow: { flexDirection: 'row', alignItems: 'center', gap: 9, padding: 14 },
  selectedStar: { color: COLORS.yellow, fontSize: 19, lineHeight: 22 },
  selectedText: { color: COLORS.white, fontSize: 16, fontFamily: FONTS.semiBold },
  busy: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' },
  emptyNote: { color: COLORS.textMuted, fontFamily: FONTS.regular, fontSize: 15, padding: 20 },
  listCount: { color: COLORS.textMuted, fontFamily: FONTS.regular, fontSize: 15 },
  newListRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 24, paddingVertical: 16 },
  newListInput: { flex: 1, borderBottomWidth: 1, borderBottomColor: COLORS.border, fontFamily: FONTS.regular, fontSize: 17, paddingVertical: 8 },
  newListBtn: { backgroundColor: COLORS.yellow, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 10 },
  newListBtnText: { fontFamily: FONTS.extraBold, fontSize: 13, letterSpacing: 0.4 },
});

function AboutTab({ media, detail, interest, setInterest }: any) {
  const providers = detail.providers ?? [];
  return (
    <ScrollView>
      <View style={styles.section}>
        <View style={styles.sectionHeadRow}>
          <Text style={styles.sectionTitle}>Où regarder</Text>
          <Feather name="settings" size={22} color={COLORS.black} />
        </View>
        {providers.length === 0 ? (
          <Text style={styles.muted}>Non disponible</Text>
        ) : (
          <View style={styles.provBtn}>
            <Feather name="play" size={18} color="#fff" />
            <Text style={styles.provText}>{providers[0].name.toUpperCase()}</Text>
          </View>
        )}
      </View>

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
            <Text style={styles.qbtnText}>{o}</Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Informations sur la série</Text>
        <Text style={styles.muted}>{[media.status, media.genres].filter(Boolean).join(' · ')}</Text>
        {media.overview ? <Text style={styles.overview}>{media.overview}</Text> : null}
      </View>
    </ScrollView>
  );
}

function MovieBody({ media, detail, onToggle }: any) {
  const seen = media.userStatus === 'completed';
  const providers = detail.providers ?? [];
  return (
    <ScrollView>
      <View style={[styles.section, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Feather name="eye" size={22} color={COLORS.black} />
          <Text style={{ fontFamily: FONTS.regular, fontSize: 17 }}>{seen ? 'Vu' : 'Pas vu'}</Text>
        </View>
        <CheckCircle checked={seen} onPress={onToggle} />
      </View>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Où regarder</Text>
        {providers.length === 0 ? (
          <Text style={styles.muted}>Non disponible</Text>
        ) : (
          <View style={styles.provBtn}>
            <Feather name="play" size={18} color="#fff" />
            <Text style={styles.provText}>{providers[0].name.toUpperCase()}</Text>
          </View>
        )}
      </View>
      {media.overview ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Synopsis</Text>
          <Text style={styles.overview}>{media.overview}</Text>
        </View>
      ) : null}
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

function EpisodesTab({ showId, posterPath, onChange }: { showId: string; posterPath?: string | null; onChange: () => void }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState<Record<number, boolean>>({});
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
    <ScrollView style={{ backgroundColor: COLORS.pageMuted }} contentContainerStyle={{ paddingBottom: 40 }}>
      {data.nextEpisode ? (
        <View style={{ paddingTop: 20, borderBottomWidth: 1, borderBottomColor: COLORS.borderLight, backgroundColor: COLORS.white }}>
          <Text style={[styles.sectionTitle, { paddingHorizontal: 24 }]}>{anyWatched ? 'Continuer le suivi' : 'Démarrer le suivi'}</Text>
          <View style={{ padding: 12 }}>
            <View style={styles.eprow}>
              <EpThumb stillPath={data.nextEpisode.stillPath} fallback={posterPath} />
              <View style={{ flex: 1, padding: 12, justifyContent: 'center' }}>
                <Text style={styles.epCode}>{episodeCode(data.nextEpisode.seasonNumber, data.nextEpisode.episodeNumber)}</Text>
                <Text style={styles.epRowTitle} numberOfLines={1}>{data.nextEpisode.title}</Text>
              </View>
              <View style={{ justifyContent: 'center', paddingRight: 14 }}>
                <CheckCircle checked={data.nextEpisode.watched} onPress={() => toggleEp.mutate(data.nextEpisode!)} />
              </View>
            </View>
          </View>
        </View>
      ) : null}

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
                        <View key={e.id} style={styles.eprow}>
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
                              <CheckCircle size={44} checked={e.watched} onPress={() => toggleEp.mutate(e)} />
                            )}
                          </View>
                        </View>
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
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { height: 240, backgroundColor: '#1a1a22', justifyContent: 'flex-end', overflow: 'hidden' },
  heroShade: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.35)' },
  addBar: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: COLORS.yellow, paddingTop: 18, alignItems: 'center' },
  addBarRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  addBarText: { fontSize: 17, fontFamily: FONTS.extraBold, letterSpacing: 0.6 },
  heroBtns: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 14 },
  heroTitleWrap: { padding: 20 },
  heroTitle: { color: '#fff', fontSize: 27, fontFamily: FONTS.extraBold },
  heroSub: { color: 'rgba(255,255,255,0.9)', fontFamily: FONTS.regular, fontSize: 15, marginTop: 2 },
  section: { padding: 22, borderBottomWidth: 1, borderBottomColor: COLORS.borderLight },
  sectionHeadRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 24, marginBottom: 14 },
  sectionTitle: { fontSize: 24, fontFamily: FONTS.extraBold },
  muted: { color: COLORS.textMuted, fontFamily: FONTS.regular, fontSize: 16, marginTop: 8 },
  overview: { fontFamily: FONTS.regular, fontSize: 18, lineHeight: 26, marginTop: 16 },
  provBtn: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: COLORS.provider, borderRadius: 999, paddingHorizontal: 24, paddingVertical: 12, alignSelf: 'flex-start', marginTop: 12 },
  provText: { color: '#fff', fontSize: 15, fontFamily: FONTS.extraBold },
  question: { textAlign: 'center', fontSize: 14, fontFamily: FONTS.bold, marginBottom: 16 },
  qbtn: { backgroundColor: COLORS.chipGrey, borderRadius: 6, paddingVertical: 16, marginBottom: 12, alignItems: 'center' },
  qbtnSel: { backgroundColor: COLORS.yellow },
  qbtnText: { fontSize: 14, fontFamily: FONTS.bold },
  eprow: { flexDirection: 'row', backgroundColor: COLORS.white, borderRadius: 5, minHeight: 92, overflow: 'hidden', marginBottom: 8, ...SHADOW.card },
  epThumb: { width: 90, backgroundColor: '#e5e5e5' },
  epCode: { fontSize: 19, fontFamily: FONTS.extraBold },
  markAllBtn: { width: 40, height: 40, borderRadius: 20, borderWidth: 2, borderColor: COLORS.black, alignItems: 'center', justifyContent: 'center' },
  season: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 76, paddingHorizontal: 20, backgroundColor: COLORS.white, borderRadius: 5, ...SHADOW.season },
  epRowTitle: { fontFamily: FONTS.regular, fontSize: 13, marginTop: 2 },
  // Compte à rebours des épisodes non diffusés (cf. TV Time : « 4 / JOURS »).
  daysWrap: { alignItems: 'center', minWidth: 44 },
  daysNum: { fontSize: 24, fontFamily: FONTS.extraBold, lineHeight: 27 },
  daysLabel: { fontSize: 10, fontFamily: FONTS.bold, letterSpacing: 0.8 },
  seasonTitle: { fontSize: 24, fontFamily: FONTS.extraBold },
  seasonProg: { fontFamily: FONTS.regular, fontSize: 17, marginRight: 14 },
  progressTrack: {
    position: 'absolute', left: 0, right: 0, bottom: 0, height: 5,
    borderBottomLeftRadius: 5, borderBottomRightRadius: 5, overflow: 'hidden',
    backgroundColor: 'rgba(255,212,0,0.30)', // piste jaune pâle toujours visible (réf. 35)
  },
  progressFill: { position: 'absolute', left: 0, bottom: 0, top: 0, borderBottomLeftRadius: 5 },
  // Barre de progression globale de la série, au bas de la bannière (TV Time).
  heroProgressTrack: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 5, backgroundColor: 'rgba(255,212,0,0.35)' },
  heroProgressFill: { height: '100%' },
  unmarkBar: { position: 'absolute', left: 12, right: 12, bottom: 20, backgroundColor: COLORS.white, borderRadius: 8, flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingVertical: 18, ...SHADOW.card },
  unmarkText: { fontSize: 17, fontFamily: FONTS.semiBold, color: COLORS.black },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: COLORS.overlay },
  // Menu « ... » : carte FLOTTANTE compacte (cotes TV Time — comparaison px des
  // captures) : marges 8, coins 14, rangées 48dp, police 17 fine, icônes 20.
  sheet: { position: 'absolute', left: 8, right: 8, bottom: 8, backgroundColor: COLORS.white, borderRadius: 14, overflow: 'hidden' },
  statusRow: { backgroundColor: COLORS.chipGrey, borderBottomWidth: 3, borderBottomColor: COLORS.yellow, height: 48, justifyContent: 'center', paddingHorizontal: 20 },
  statusText: { fontFamily: FONTS.regular, fontSize: 16, color: '#444' },
  sheetItem: { flexDirection: 'row', alignItems: 'center', gap: 14, height: 48, paddingHorizontal: 20, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.borderLight },
  sheetLabel: { fontSize: 17, fontFamily: FONTS.regular },
});

type CommentDto = {
  id: string;
  body: string;
  createdAt: string;
  episodeId: string | null;
  parentId: string | null;
  user: { id: string; displayName: string; avatarUrl: string | null };
  isMine: boolean;
  reactions: { total: number; byEmoji: Record<string, number>; mine: string[] };
  replies?: CommentDto[];
};

const REACT_EMOJIS = ['❤️', '👍', '😂', '😮', '😢'];

// Discussion sociale : commentaires, fils de réponses et réactions multi-emoji.
function CommentsTab({ mediaId }: { mediaId: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const { data, isLoading } = useQuery({
    queryKey: ['comments', mediaId],
    queryFn: () => api.get<{ comments: CommentDto[] }>(`/api/media/${mediaId}/comments`),
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['comments', mediaId] });

  const post = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      await api.post(`/api/media/${mediaId}/comments`, { body: text.trim() });
      setText('');
      invalidate();
    } finally {
      setBusy(false);
    }
  };
  const postReply = async (parentId: string) => {
    if (!replyText.trim()) return;
    await api.post(`/api/media/${mediaId}/comments`, { body: replyText.trim(), parentId });
    setReplyText('');
    setReplyTo(null);
    invalidate();
  };
  const react = async (c: CommentDto, emoji: string) => {
    await api.post(`/api/comments/${c.id}/react`, { emoji });
    invalidate();
  };
  const remove = async (c: CommentDto) => {
    await api.del(`/api/comments/${c.id}`);
    invalidate();
  };

  const renderComment = (c: CommentDto, isReply = false) => (
    <View key={c.id} style={[cstyles.row, isReply && cstyles.replyRow]}>
      <Pressable style={cstyles.avatar} onPress={() => router.push(`/user/${c.user.id}`)}>
        <Text style={cstyles.avatarInit}>{c.user.displayName.slice(0, 1).toUpperCase()}</Text>
      </Pressable>
      <View style={{ flex: 1 }}>
        <Text style={cstyles.name}>{c.user.displayName}</Text>
        <Text style={cstyles.body}>{c.body}</Text>
        <View style={cstyles.reactBar}>
          {REACT_EMOJIS.map((e) => {
            const count = c.reactions.byEmoji[e] ?? 0;
            const mine = c.reactions.mine.includes(e);
            return (
              <Pressable key={e} style={[cstyles.chip, mine && cstyles.chipActive]} onPress={() => react(c, e)}>
                <Text style={cstyles.chipText}>
                  {e}
                  {count > 0 ? ` ${count}` : ''}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <View style={cstyles.actions}>
          {!isReply ? (
            <Pressable onPress={() => { setReplyTo(replyTo === c.id ? null : c.id); setReplyText(''); }} hitSlop={8}>
              <Text style={cstyles.action}>Répondre</Text>
            </Pressable>
          ) : null}
          {c.isMine ? (
            <Pressable onPress={() => remove(c)} hitSlop={8}>
              <Text style={cstyles.action}>Supprimer</Text>
            </Pressable>
          ) : null}
        </View>
        {replyTo === c.id ? (
          <View style={cstyles.replyComposer}>
            <TextInput
              style={cstyles.replyInput}
              placeholder="Votre réponse…"
              placeholderTextColor={COLORS.textMuted}
              value={replyText}
              onChangeText={setReplyText}
            />
            <Pressable style={[cstyles.replySend, !replyText.trim() && { opacity: 0.4 }]} onPress={() => postReply(c.id)} disabled={!replyText.trim()}>
              <Text style={cstyles.sendText}>OK</Text>
            </Pressable>
          </View>
        ) : null}
        {c.replies?.map((r) => renderComment(r, true))}
      </View>
    </View>
  );

  return (
    <View style={cstyles.wrap}>
      <View style={cstyles.composer}>
        <TextInput
          style={cstyles.input}
          placeholder="Partager un avis…"
          placeholderTextColor={COLORS.textMuted}
          value={text}
          onChangeText={setText}
          multiline
        />
        <Pressable
          style={[cstyles.send, (!text.trim() || busy) && { opacity: 0.4 }]}
          onPress={post}
          disabled={!text.trim() || busy}
        >
          {busy ? <ActivityIndicator color="#000" /> : <Text style={cstyles.sendText}>PUBLIER</Text>}
        </Pressable>
      </View>
      {isLoading ? (
        <Loading />
      ) : (data?.comments.length ?? 0) === 0 ? (
        <EmptyState title="Aucun commentaire" message="Soyez le premier à réagir." />
      ) : (
        data!.comments.map((c) => renderComment(c))
      )}
    </View>
  );
}

const cstyles = StyleSheet.create({
  wrap: { padding: 20 },
  composer: { marginBottom: 20 },
  input: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 8, minHeight: 60, padding: 12, fontFamily: FONTS.regular, fontSize: 16, textAlignVertical: 'top' },
  send: { alignSelf: 'flex-end', marginTop: 10, backgroundColor: COLORS.yellow, borderRadius: 999, paddingHorizontal: 22, paddingVertical: 10 },
  sendText: { fontFamily: FONTS.extraBold, fontSize: 13, letterSpacing: 0.4 },
  row: { flexDirection: 'row', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: COLORS.borderLight },
  replyRow: { borderBottomWidth: 0, paddingVertical: 8, marginLeft: 8, borderLeftWidth: 2, borderLeftColor: COLORS.borderLight, paddingLeft: 12 },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#20202a', alignItems: 'center', justifyContent: 'center' },
  avatarInit: { color: '#fff', fontSize: 16, fontFamily: FONTS.extraBold },
  name: { fontSize: 15, fontFamily: FONTS.extraBold },
  body: { fontFamily: FONTS.regular, fontSize: 16, lineHeight: 22, marginTop: 3 },
  reactBar: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  chip: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  chipActive: { borderColor: COLORS.yellow, backgroundColor: COLORS.yellowSoft },
  chipText: { fontFamily: FONTS.regular, fontSize: 14 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 20, marginTop: 8 },
  action: { fontSize: 14, color: COLORS.textMuted, fontFamily: FONTS.semiBold },
  replyComposer: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  replyInput: { flex: 1, borderWidth: 1, borderColor: COLORS.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontFamily: FONTS.regular, fontSize: 15 },
  replySend: { backgroundColor: COLORS.yellow, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 9 },
});
