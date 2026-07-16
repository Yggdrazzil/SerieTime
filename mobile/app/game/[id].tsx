import React, { useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Modal, TextInput, ActivityIndicator, Image, Platform, Linking, Animated, Easing } from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { goBack } from '@/lib/nav';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, tmdbImage } from '@/lib/api';
import { COLORS, FONTS } from '@/lib/theme';
import { Loading, LoadError } from '@/components/ui';
import { Pop, PressableScale, SlideUpBar } from '@/components/anim';
import { shareMedia } from '@/lib/share';
import { FicheSkeleton } from '@/components/FicheSkeleton';
import { ReportModal } from '@/components/ReportModal';
import { shortDateFr } from '@/lib/format';
import { useReduceMotion } from '@/lib/useReduceMotion';

// Miroir de la réponse GET /api/games/:id (serveur : apps/server/src/modules/games/routes.ts).
type GameDetailDto = {
  id: string;
  igdbId: string | null;
  title: string;
  posterPath: string | null;
  year: number | null;
  voteAverage: number | null;
  platforms: string | null;
  userStatus: string | null;
  // « Je possède » — booléen indépendant du statut (interrupteur de la fiche).
  isOwned: boolean;
  playtimeMinutes: number | null;
  overview: string | null;
  backdropPath: string | null;
  developer: string | null;
  publisher: string | null;
  gameModes: string | null;
  releaseDate: string | null;
  genres: string | null;
  isFavorite: boolean;
  videoId: string | null;
  // Notes IGDB sur le même barème /100 : joueurs (rating) et presse (aggregated).
  playerScore: number | null;
  criticScore: number | null;
  // Éditions (Deluxe, GOTY…) et extensions/DLC — section latérale de la fiche.
  related?: RelatedGameDto[];
};

type RelatedGameDto = {
  igdbId: string;
  localId: string | null;
  inLibrary: boolean;
  title: string;
  year: number | null;
  posterPath: string | null;
  kind: 'edition' | 'extension';
};

// « Possédé » n'est plus un statut : c'est l'interrupteur « Je possède »
// (isOwned), indépendant — on peut être « En cours » ET posséder le jeu.
const GAME_STATUSES = ['wishlist', 'playing', 'completed', 'abandoned'] as const;
type GameStatus = (typeof GAME_STATUSES)[number];
// « Voulu » au singulier ici : le chip désigne CE jeu (décision produit d'Étienne).
// L'onglet Jeux garde « VOULUS » au pluriel (collection).
const STATUS_LABELS: Record<GameStatus, string> = {
  wishlist: 'Voulu',
  playing: 'En cours',
  completed: 'Terminé',
  abandoned: 'Abandonné',
};

// « 3h45 » / « 45 min » à partir du temps de jeu en minutes (import Steam).
function formatPlaytime(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}

// Fiche jeu — parité avec mobile/app/show/[id].tsx : menu « ... » (Personnaliser,
// Favoris, Ajouter à une liste, Partager, Retirer), aperçu bande-annonce.
// Suivi optimiste avec rollback, comme les autres fiches de l'app.
export default function GameDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [toast, setToast] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [persoMenu, setPersoMenu] = useState(false);
  const [artwork, setArtwork] = useState<'poster' | 'banner' | null>(null);
  const [listsOpen, setListsOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2000);
  };

  const detailKey = ['game', String(id)];
  const detail = useQuery({
    queryKey: detailKey,
    queryFn: () => api.get<GameDetailDto>(`/api/games/${id}`),
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: detailKey });
    qc.invalidateQueries({ queryKey: ['games', 'library'] });
    qc.invalidateQueries({ queryKey: ['gamification'] }); // XP/badges/streak (spec 2026-07-16 §10)
  };

  // Mise à jour optimiste du cache de la fiche (même recette que show/[id].tsx) :
  // on écrit tout de suite le résultat attendu, rollback si le serveur refuse.
  const patch = async (p: Partial<GameDetailDto>) => {
    await qc.cancelQueries({ queryKey: detailKey });
    const prev = qc.getQueryData<GameDetailDto>(detailKey);
    if (prev) qc.setQueryData<GameDetailDto>(detailKey, { ...prev, ...p });
    return { prev };
  };
  const rollback = (ctx?: { prev?: GameDetailDto }) => {
    if (ctx?.prev) qc.setQueryData(detailKey, ctx.prev);
  };

  const setStatus = useMutation({
    mutationFn: (status: GameStatus) => api.post(`/api/games/${id}/status`, { status }),
    onMutate: (status: GameStatus) => patch({ userStatus: status }),
    onError: (_e, _v, ctx) => rollback(ctx),
    onSettled: refresh,
  });

  // Interrupteur « Je possède » — indépendant du statut (mise à jour optimiste).
  const setOwned = useMutation({
    mutationFn: (owned: boolean) => api.post(`/api/games/${id}/owned`, { owned }),
    onMutate: (owned: boolean) => patch({ isOwned: owned }),
    onError: (_e, _v, ctx) => rollback(ctx),
    onSettled: refresh,
  });

  const removeTracking = useMutation({
    mutationFn: () => api.del(`/api/games/${id}/tracking`),
    onMutate: () => {
      showToast('Jeu retiré');
      // DELETE /tracking supprime toute la ligne — « Je possède » part avec.
      return patch({ userStatus: null, isOwned: false });
    },
    onError: (_e, _v, ctx) => rollback(ctx),
    onSettled: refresh,
  });

  const favorite = useMutation({
    mutationFn: () => api.post<{ ok: boolean; isFavorite: boolean }>(`/api/games/${id}/favorite`),
    onMutate: () => patch({ isFavorite: !detail.data?.isFavorite }),
    onError: (_e, _v, ctx) => rollback(ctx),
    onSettled: refresh,
  });

  const share = () => {
    if (!detail.data) return;
    const url = typeof window !== 'undefined' ? window.location.href : undefined;
    shareMedia(detail.data.title, url);
  };

  // Signalement : envoie l'œuvre à l'équipe de modération (tri manuel).
  // Échec silencieux — toast neutre dans tous les cas.
  const submitReport = async () => {
    setReportOpen(false);
    if (!detail.data) return;
    try {
      await api.post('/api/report', {
        mediaType: 'game',
        mediaId: detail.data.id,
        igdbId: detail.data.igdbId ?? undefined,
        title: detail.data.title,
        reason: 'adult',
      });
    } catch {
      // Erreur silencieuse : on remercie quand même (pas de fuite d'état serveur).
    }
    showToast('Merci, signalement envoyé 👍');
  };

  if (detail.isLoading) return <FicheSkeleton heroHeight={200} />;
  if (!detail.data) return <LoadError onRetry={detail.refetch} busy={detail.isRefetching} />;
  const game = detail.data;
  const heroUri = tmdbImage(game.backdropPath) ?? tmdbImage(game.posterPath);

  return (
    <Pop style={{ flex: 1, backgroundColor: COLORS.white }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 60 }}>
        <View style={styles.hero}>
          {heroUri ? <Image source={{ uri: heroUri }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
          <View style={styles.heroShade} />
          <View style={[styles.heroBtns, { top: insets.top + 8 }]}>
            <Pressable onPress={() => goBack('/games')} hitSlop={8} accessibilityRole="button" accessibilityLabel="Retour">
              <Feather name="chevron-down" size={30} color="#fff" />
            </Pressable>
            <Pressable onPress={() => setMenu(true)} hitSlop={8} accessibilityLabel="Options">
              <Feather name="more-horizontal" size={28} color="#fff" />
            </Pressable>
          </View>
        </View>

        <View style={styles.headRow}>
          {tmdbImage(game.posterPath, 'w342') ? (
            <Image source={{ uri: tmdbImage(game.posterPath, 'w342')! }} style={styles.poster} resizeMode="cover" />
          ) : (
            <View style={[styles.poster, styles.posterEmpty]}>
              <Feather name="image" size={26} color="#b4b4b4" />
            </View>
          )}
          <View style={{ flex: 1 }}>
            {/* 1 ligne comme la fiche série : la 2e ligne tomberait en blanc
                sur fond blanc (le bloc chevauche la bannière). */}
            <Text style={styles.title} numberOfLines={1}>{game.title}</Text>
            {/* Infos compactes À CÔTÉ de la jaquette (remplit le vide à droite).
                Deux notes DISTINCTES sur le MÊME barème /100 (décision 2026-07-17,
                façon jv.com) — plus d'étoiles combinées en doublon. */}
            <View style={styles.headFacts}>
              {game.genres ? (
                <Text style={styles.headFact} numberOfLines={2}><Text style={styles.factLabel}>Genre : </Text>{game.genres}</Text>
              ) : null}
              {game.releaseDate ? (
                <Text style={styles.headFact}><Text style={styles.factLabel}>Sortie le </Text>{shortDateFr(game.releaseDate)}</Text>
              ) : null}
              {game.playerScore ? (
                <Text style={styles.headFact}><Text style={styles.factLabel}>Note joueurs : </Text>{game.playerScore}/100</Text>
              ) : null}
              {game.criticScore ? (
                <Text style={styles.headFact}><Text style={styles.factLabel}>Note presse : </Text>{game.criticScore}/100</Text>
              ) : null}
            </View>
          </View>
        </View>

        {/* Suivi REMONTÉ juste sous la jaquette/titre (avant le trailer) :
            l'utilisateur coche son statut sans scroller. */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Suivi</Text>
          <View style={styles.statusRow}>
            {GAME_STATUSES.map((s) => (
              <Pressable
                key={s}
                style={[styles.statusChip, game.userStatus === s && styles.statusChipSel]}
                // Re-taper le statut actif le DÉSÉLECTIONNE (retrait du suivi).
                onPress={() => (game.userStatus === s ? removeTracking.mutate() : setStatus.mutate(s))}
                disabled={setStatus.isPending || removeTracking.isPending}
              >
                <Text style={[styles.statusChipText, game.userStatus === s && styles.statusChipTextSel]}>
                  {STATUS_LABELS[s]}
                </Text>
              </Pressable>
            ))}
          </View>
          {/* « Je possède » : interrupteur INDÉPENDANT du statut (Game Pass,
              collection…) — même style que les toggles des Paramètres. */}
          <OwnedToggle
            on={game.isOwned}
            disabled={setOwned.isPending}
            onToggle={(v) => setOwned.mutate(v)}
          />
        </View>

        {game.videoId ? <TrailerPreview videoId={game.videoId} /> : null}

        {/* Fiche d'identité complète (Genre/Sortie/Note presse vivent à côté de
            la jaquette) : Plateformes / Développeur / Éditeur / Modes / Temps
            de jeu — l'ancienne section « Informations » est fusionnée ici. */}
        {game.platforms || game.developer || game.publisher || game.gameModes || game.playtimeMinutes ? (
          <View style={[styles.section, styles.factList]}>
            {game.platforms ? (
              <Text style={styles.fact}><Text style={styles.factLabel}>Plateformes : </Text>{game.platforms}</Text>
            ) : null}
            {game.developer ? (
              <Text style={styles.fact}><Text style={styles.factLabel}>Développeur : </Text>{game.developer}</Text>
            ) : null}
            {game.publisher ? (
              <Text style={styles.fact}><Text style={styles.factLabel}>Éditeur : </Text>{game.publisher}</Text>
            ) : null}
            {game.gameModes ? (
              <Text style={styles.fact}><Text style={styles.factLabel}>Modes : </Text>{game.gameModes}</Text>
            ) : null}
            {game.playtimeMinutes ? (
              <Text style={styles.fact}><Text style={styles.factLabel}>Temps de jeu : </Text>{formatPlaytime(game.playtimeMinutes)}</Text>
            ) : null}
          </View>
        ) : null}

        {game.overview ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Résumé</Text>
            <Text style={styles.overview}>{game.overview}</Text>
          </View>
        ) : null}

        <RelatedGamesRow items={game.related ?? []} />

        <CommentsRow mediaId={game.id} title={game.title} />
      </ScrollView>

      <SlideUpBar visible={!!toast} style={[styles.toastBar, { paddingBottom: insets.bottom + 16 }]}>
        <View style={styles.toastRow}>
          <Feather name="check" size={22} color={COLORS.black} />
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      </SlideUpBar>

      <Modal visible={menu} transparent animationType="fade" onRequestClose={() => setMenu(false)}>
        <Pressable style={styles.overlay} onPress={() => setMenu(false)} />
        <View style={[styles.sheet, { bottom: insets.bottom + 8 }]}>
          {game.userStatus ? (
            <View style={styles.menuStatusRow}>
              <Text style={styles.menuStatusText}>{STATUS_LABELS[game.userStatus as GameStatus]}</Text>
            </View>
          ) : null}
          <SheetItem icon="edit-2" label="Personnaliser" onPress={() => { setMenu(false); setPersoMenu(true); }} />
          <SheetItem
            icon="heart"
            color={game.isFavorite ? COLORS.red : COLORS.black}
            label={game.isFavorite ? 'Retirer des favoris' : 'Favoris'}
            onPress={() => { favorite.mutate(); setMenu(false); }}
          />
          <SheetItem icon="plus-square" label="Ajouter à une liste" onPress={() => { setMenu(false); setListsOpen(true); }} />
          {game.userStatus ? (
            <SheetItem
              icon="minus-square"
              label="Retirer"
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

// Interrupteur « Je possède » — réplique du ToggleRow des Paramètres
// (settings.tsx, non exporté) : piste qui change de couleur + bouton qui
// glisse. Couleurs interpolées → driver JS obligatoire.
function OwnedToggle({ on, disabled, onToggle }: { on: boolean; disabled?: boolean; onToggle: (v: boolean) => void }) {
  const reduce = useReduceMotion();
  const v = useRef(new Animated.Value(on ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(v, { toValue: on ? 1 : 0, duration: reduce ? 0 : 180, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [on, reduce, v]);
  return (
    <View style={styles.ownedRow}>
      <Feather name="archive" size={20} color={COLORS.black} />
      <Text style={styles.ownedLabel}>Je possède</Text>
      <Pressable
        onPress={() => onToggle(!on)}
        disabled={disabled}
        hitSlop={8}
        accessibilityRole="switch"
        accessibilityLabel="Je possède"
        accessibilityState={{ checked: on }}
      >
        <Animated.View style={[styles.toggle, { backgroundColor: v.interpolate({ inputRange: [0, 1], outputRange: [COLORS.chipSelected, COLORS.yellow] }) }]}>
          <Animated.View
            style={[
              styles.knob,
              {
                backgroundColor: v.interpolate({ inputRange: [0, 1], outputRange: ['#ffffff', '#000000'] }),
                transform: [{ translateX: v.interpolate({ inputRange: [0, 1], outputRange: [0, 22] }) }],
              },
            ]}
          />
        </Animated.View>
      </Pressable>
    </View>
  );
}

// Aperçu bande-annonce (16:9) : miniature YouTube + bouton lecture centré. Sur
// web, tap = iframe intégré autoplay ; sur natif, tap = ouverture YouTube
// (pas de nouvelle dépendance native).
function TrailerPreview({ videoId }: { videoId: string }) {
  const [playing, setPlaying] = useState(false);
  const thumbUri = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;

  const play = () => {
    if (Platform.OS === 'web') {
      setPlaying(true);
    } else {
      Linking.openURL(`https://www.youtube.com/watch?v=${videoId}`).catch(() => undefined);
    }
  };

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Bande-annonce</Text>
      <View style={styles.trailerBox}>
        {playing && Platform.OS === 'web' ? (
          // RN-web rend les tags DOM natifs via React.createElement — pas d'équivalent
          // <video>/<iframe> dans les primitives RN, pas de nouvelle dépendance.
          React.createElement('iframe', {
            src: `https://www.youtube.com/embed/${videoId}?autoplay=1`,
            style: { width: '100%', height: '100%', border: 0 },
            allow: 'autoplay; encrypted-media; picture-in-picture',
            allowFullScreen: true,
          })
        ) : (
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={play}
            accessibilityRole="button"
            accessibilityLabel="Lire la bande-annonce"
          >
            <Image source={{ uri: thumbUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
            <View style={styles.trailerPlayShade}>
              <View style={styles.trailerPlayBtn}>
                <Feather name="play" size={26} color="#fff" />
              </View>
            </View>
          </Pressable>
        )}
      </View>
    </View>
  );
}

function SheetItem({
  icon,
  label,
  onPress,
  color,
  last,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  onPress: () => void;
  color?: string;
  last?: boolean;
}) {
  return (
    <Pressable style={[styles.sheetItem, last && { borderBottomWidth: 0 }]} onPress={onPress}>
      <Feather name={icon} size={20} color={color ?? COLORS.black} />
      <Text style={styles.sheetLabel}>{label}</Text>
    </Pressable>
  );
}

// « Personnaliser » (copie de show/[id].tsx) : propose « Modifier l'affiche »
// et « Changer la bannière ».
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

// Écran plein « Modifier l'affiche » / « Changer la bannière » (copie de
// show/[id].tsx, base fixée à `games`) : grille d'affiches 2 colonnes ou liste
// de bannières ; l'image active est assombrie avec ★ « Sélectionnée ».
function ArtworkPicker({
  mediaId,
  mode,
  onClose,
  onApplied,
}: {
  mediaId: string;
  mode: 'poster' | 'banner' | null;
  onClose: () => void;
  onApplied: (what: 'poster' | 'banner') => void;
}) {
  const [busyUri, setBusyUri] = useState<string | null>(null);
  const images = useQuery({
    queryKey: ['media-images', 'games', mediaId],
    queryFn: () =>
      api.get<{ posters: string[]; backdrops: string[]; selectedPoster: string | null; selectedBackdrop: string | null }>(
        `/api/games/${mediaId}/images`,
      ),
    enabled: mode !== null,
  });

  const apply = async (uri: string) => {
    if (busyUri || !mode) return;
    setBusyUri(uri);
    try {
      if (mode === 'poster') await api.post(`/api/games/${mediaId}/poster`, { posterPath: uri });
      else await api.post(`/api/games/${mediaId}/banner`, { backdropPath: uri });
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
            {isPoster ? 'Aucune affiche disponible.' : 'Aucune bannière disponible pour ce jeu.'}
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

// « Ajouter à une liste » (copie de show/[id].tsx) : coche/décoche les listes
// existantes, création rapide.
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
  const syncOthers = () => {
    qc.invalidateQueries({ queryKey: ['lists'] });
    qc.invalidateQueries({ queryKey: ['profile'] });
  };

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
        <View style={styles.menuStatusRow}>
          <Text style={styles.menuStatusText}>Ajouter à une liste</Text>
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


// « Éditions et extensions » (façon app Xbox) : cartes à défilement latéral —
// jaquette + bandeau nom + type. Clic : fiche locale directe si déjà en base,
// sinon import IGDB silencieux puis ouverture (fiche jeu standard : on peut y
// mettre Voulu / En cours / … comme n'importe quel jeu).
function RelatedGamesRow({ items }: { items: RelatedGameDto[] }) {
  const router = useRouter();
  const [openingId, setOpeningId] = useState<string | null>(null);
  if (!items.length) return null;
  const open = async (r: RelatedGameDto) => {
    if (openingId) return;
    if (r.localId) {
      router.push(('/game/' + r.localId) as Href);
      return;
    }
    setOpeningId(r.igdbId);
    try {
      const res = await api.post<{ mediaId: string | null }>('/api/games/add-from-igdb', { igdbId: r.igdbId });
      if (res.mediaId) router.push(('/game/' + res.mediaId) as Href);
    } finally {
      setOpeningId(null);
    }
  };
  return (
    <View style={[styles.section, { paddingHorizontal: 0 }]}>
      <Text style={[styles.sectionTitle, { paddingHorizontal: 20 }]}>Éditions et extensions</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingHorizontal: 20, paddingTop: 14 }}>
        {items.map((r) => (
          <PressableScale key={r.igdbId} style={styles.relCard} onPress={() => open(r)}>
            <View style={styles.relCover}>
              {r.posterPath ? (
                <Image source={{ uri: r.posterPath }} style={StyleSheet.absoluteFill} resizeMode="cover" />
              ) : (
                <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
                  <Ionicons name="game-controller-outline" size={30} color="#9a9a9a" />
                </View>
              )}
              {r.inLibrary ? (
                <View style={styles.relBadge}>
                  <Feather name="check" size={16} color={COLORS.onAccent} />
                </View>
              ) : null}
              {openingId === r.igdbId ? (
                <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' }]}>
                  <ActivityIndicator color="#fff" />
                </View>
              ) : null}
            </View>
            <View style={styles.relCap}>
              <Text style={styles.relName} numberOfLines={2}>{r.title}</Text>
              <Text style={styles.relKind}>
                {[r.kind === 'edition' ? 'Édition' : 'Extension', r.year].filter(Boolean).join(' · ')}
              </Text>
            </View>
          </PressableScale>
        ))}
      </ScrollView>
    </View>
  );
}

// Rangée « Commentaires » (titre + chevron) ouvrant la page dédiée /comments/:id
// (générique par mediaId, cf. mobile/app/comments/[id].tsx). `CommentsRowLink`
// (show/[id].tsx) n'est pas exporté depuis ce fichier ; on reproduit ici la
// version simple — pas de compteur — plutôt que dupliquer sa requête de comptage.
function CommentsRow({ mediaId, title }: { mediaId: string; title: string }) {
  const router = useRouter();
  return (
    <Pressable
      style={[styles.section, styles.commentsRow]}
      onPress={() => router.push(`/comments/${mediaId}?title=${encodeURIComponent(title)}`)}
    >
      <Text style={styles.sectionTitle}>Commentaires</Text>
      <Feather name="chevron-right" size={24} color={COLORS.black} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hero: { height: 200, backgroundColor: '#1a1a22', overflow: 'hidden' },
  heroShade: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.35)' },
  heroBtns: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 14 },
  headRow: { flexDirection: 'row', gap: 14, padding: 20, marginTop: -50 },
  poster: { width: 100, aspectRatio: 2 / 3, borderRadius: 8, backgroundColor: COLORS.imagePlaceholder },
  posterEmpty: { alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 21, fontFamily: FONTS.extraBold, color: '#fff' },
  meta: { fontFamily: FONTS.regular, fontSize: 15, color: 'rgba(255,255,255,0.85)', marginTop: 4 },
  // Infos compactes à droite de la jaquette (Genre / Sortie / Note presse).
  headFacts: { marginTop: 8, gap: 3 },
  headFact: { fontFamily: FONTS.regular, fontSize: 12.5, lineHeight: 17, color: COLORS.textMuted },
  // Fiche d'identité du jeu (Plateformes / Dev / Éditeur / Modes / Temps de jeu) —
  // combinée avec styles.section (padding + bordure), ne garde que l'interligne.
  factList: { gap: 5 },
  fact: { fontFamily: FONTS.regular, fontSize: 13, lineHeight: 18, color: COLORS.textMuted },
  factLabel: { fontFamily: FONTS.bold, color: COLORS.black },
  section: { paddingHorizontal: 20, paddingVertical: 18, borderBottomWidth: 1, borderBottomColor: COLORS.borderLight },
  sectionTitle: { color: COLORS.text, fontSize: 18, fontFamily: FONTS.extraBold, marginBottom: 12 },
  // « Éditions et extensions » : cartes 150 façon app Xbox (jaquette 3/4 +
  // bandeau nom/type), badge coche jaune si déjà en bibliothèque.
  relCard: { width: 150, borderRadius: 10, overflow: 'hidden', backgroundColor: COLORS.chipGrey },
  relCover: { width: 150, height: 200, backgroundColor: COLORS.imagePlaceholder },
  relBadge: { position: 'absolute', top: 0, right: 8, width: 30, height: 26, backgroundColor: COLORS.yellow, borderBottomLeftRadius: 6, borderBottomRightRadius: 6, alignItems: 'center', justifyContent: 'center' },
  relCap: { paddingHorizontal: 10, paddingVertical: 9, minHeight: 64 },
  relName: { color: COLORS.text, fontSize: 13.5, fontFamily: FONTS.bold, lineHeight: 18 },
  relKind: { color: COLORS.textMuted, fontSize: 11.5, fontFamily: FONTS.regular, marginTop: 3 },
  statusRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  statusChip: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999, backgroundColor: COLORS.chipGrey },
  statusChipSel: { backgroundColor: COLORS.yellow },
  statusChipText: { color: COLORS.text, fontFamily: FONTS.bold, fontSize: 14 },
  statusChipTextSel: { color: COLORS.onAccent },
  overview: { color: COLORS.text, fontFamily: FONTS.regular, fontSize: 16, lineHeight: 23 },
  // Interrupteur « Je possède » (cotes du ToggleRow des Paramètres).
  ownedRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 16 },
  ownedLabel: { flex: 1, color: COLORS.text, fontFamily: FONTS.bold, fontSize: 14 },
  toggle: { width: 52, height: 30, borderRadius: 15, padding: 3 },
  knob: { width: 24, height: 24, borderRadius: 12 },
  commentsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  toastBar: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: COLORS.yellow, paddingTop: 18, alignItems: 'center' },
  toastRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  toastText: { color: COLORS.onAccent, fontSize: 15, fontFamily: FONTS.extraBold, letterSpacing: 0.6 },
  // Aperçu bande-annonce 16:9.
  trailerBox: { width: '100%', aspectRatio: 16 / 9, borderRadius: 8, overflow: 'hidden', backgroundColor: '#1a1a22' },
  trailerPlayShade: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.25)', alignItems: 'center', justifyContent: 'center' },
  trailerPlayBtn: { width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  // Menu « ... » : carte flottante compacte (mêmes cotes que show/[id].tsx).
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: COLORS.overlay },
  sheet: { position: 'absolute', left: 8, right: 8, bottom: 8, backgroundColor: COLORS.white, borderRadius: 14, overflow: 'hidden' },
  menuStatusRow: { backgroundColor: COLORS.chipGrey, borderBottomWidth: 3, borderBottomColor: COLORS.yellow, height: 48, justifyContent: 'center', paddingHorizontal: 20 },
  menuStatusText: { fontFamily: FONTS.regular, fontSize: 16, color: '#444' },
  sheetItem: { flexDirection: 'row', alignItems: 'center', gap: 14, height: 48, paddingHorizontal: 20, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.borderLight },
  sheetLabel: { color: COLORS.text, fontSize: 17, fontFamily: FONTS.regular },
});

const pstyles = StyleSheet.create({
  menuHeader: { fontSize: 15, fontFamily: FONTS.regular, color: '#555', paddingHorizontal: 22, paddingTop: 20, paddingBottom: 8 },
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
