import React, { useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Modal, TextInput, ActivityIndicator, Image, Platform, Linking, Animated, Easing, useWindowDimensions, KeyboardAvoidingView } from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { goBack } from '@/lib/nav';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, tmdbImage } from '@/lib/api';
import { COLORS, FONTS, RADIUS, SHADOW, SIZES, SPACE } from '@/lib/theme';
import { Loading, LoadError } from '@/components/ui';
import {
  FicheTopActions, FicheBanner, FicheIdentity, StatTile, StatTiles,
  FicheSection, InfoRow, rating5,
} from '@/components/fiche';
import { Pop, PressableScale, SlideUpBar } from '@/components/anim';
import { shareMedia } from '@/lib/share';
import { FicheSkeleton } from '@/components/FicheSkeleton';
import { StatusLine } from '@/components/StatusLine';
import { ReportModal } from '@/components/ReportModal';
import { useFeedSessionStore } from '@/components/explore/feedSession';
import { shortDateFr } from '@/lib/format';
import { useReduceMotion } from '@/lib/useReduceMotion';
import { useBackClose } from '@/lib/useBackClose';

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
  const { width } = useWindowDimensions();
  const qc = useQueryClient();
  const [toast, setToast] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  // Retour (PWA/Android) : ferme le menu « … » au lieu de reculer le routeur.
  useBackClose(menu, () => setMenu(false));
  const [persoMenu, setPersoMenu] = useState(false);
  const [artwork, setArtwork] = useState<'poster' | 'banner' | null>(null);
  const [listsOpen, setListsOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  // Tuile note : bascule joueurs ↔ presse au tap (quand les deux existent).
  const [scoreView, setScoreView] = useState<'players' | 'critics'>('players');
  const reduce = useReduceMotion();
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const trackingLock = useRef(false);

  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

  const showToast = (msg: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(msg);
    toastTimer.current = setTimeout(() => {
      setToast(null);
      toastTimer.current = null;
    }, 2000);
  };

  const detailKey = ['game', String(id)];
  const detail = useQuery({
    queryKey: detailKey,
    queryFn: () => api.get<GameDetailDto>(`/api/games/${id}`),
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: detailKey });
    qc.invalidateQueries({ queryKey: ['games', 'library'] });
    // La recherche de jeux (Explorer > JEUX) affiche « ajouté » via inLibrary :
    // l'invalider pour que le retour depuis la fiche soit déjà à jour.
    qc.invalidateQueries({ queryKey: ['games', 'search'] });
    // Sorties à venir (bibliothèque Jeux + Agenda) : un changement de statut /
    // retrait de suivi doit s'y refléter aussi (sinon reste figé jusqu'à un
    // pull-to-refresh manuel).
    qc.invalidateQueries({ queryKey: ['games', 'upcoming'] });
    qc.invalidateQueries({ queryKey: ['profile'] });
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
    mutationFn: (status: GameStatus) =>
      api.post('/api/games/' + id + '/status', { status }),
    onMutate: (status: GameStatus) => patch({ userStatus: status }),
    onError: (_error, _status, context) => {
      rollback(context);
      showToast('Le statut n’a pas pu être enregistré. Réessaie.');
    },
    onSettled: refresh,
  });
  // Interrupteur « Je possède » — indépendant du statut (mise à jour optimiste).
  const setOwned = useMutation({
    mutationFn: (owned: boolean) =>
      api.post('/api/games/' + id + '/owned', { owned }),
    onMutate: (owned: boolean) => patch({ isOwned: owned }),
    onError: (_error, _owned, context) => {
      rollback(context);
      showToast('La possession n’a pas pu être enregistrée. Réessaie.');
    },
    onSettled: refresh,
  });
  const removeTracking = useMutation({
    mutationFn: () => api.del('/api/games/' + id + '/tracking'),
    onMutate: () => {
      // DELETE /tracking supprime toute la ligne — « Je possède » part avec.
      return patch({ userStatus: null, isOwned: false });
    },
    onSuccess: () => showToast('Jeu retiré'),
    onError: (_error, _value, context) => {
      rollback(context);
      showToast('Le jeu n’a pas pu être retiré. Réessaie.');
    },
    onSettled: refresh,
  });
  const favorite = useMutation({
    mutationFn: () =>
      api.post<{ ok: boolean; isFavorite: boolean }>(
        '/api/games/' + id + '/favorite',
      ),
    onMutate: () => patch({ isFavorite: !detail.data?.isFavorite }),
    onError: (_error, _value, context) => {
      rollback(context);
      showToast('Le favori n’a pas pu être enregistré. Réessaie.');
    },
    onSettled: refresh,
  });

  // Temps de jeu DÉCLARATIF (demande produit 2026-07-20) : posé à la bascule
  // de statut (feuille non bloquante) ou corrigé à tout moment depuis la ligne
  // « Temps de jeu » des Informations. `null` efface la déclaration.
  const [playtimeOpen, setPlaytimeOpen] = useState(false);
  const setPlaytime = useMutation({
    mutationFn: (hours: number | null) => api.post('/api/games/' + id + '/playtime', { hours }),
    onMutate: (hours: number | null) => patch({ playtimeMinutes: hours === null ? null : Math.round(hours * 60) }),
    onError: (_error, _hours, context) => {
      rollback(context);
      showToast('Le temps de jeu n’a pas pu être enregistré. Réessaie.');
    },
    onSettled: () => {
      refresh();
      qc.invalidateQueries({ queryKey: ['stats'] });
    },
  });

  const releaseTrackingLock = () => {
    trackingLock.current = false;
  };
  const changeStatus = (status: GameStatus) => {
    if (trackingLock.current) return false;
    trackingLock.current = true;
    setStatus.mutate(status, {
      onSettled: releaseTrackingLock,
      // En cours / Terminé / Abandonné : on propose (sans jamais l'imposer)
      // de déclarer ses heures de jeu.
      onSuccess: (_data, s) => {
        if (s === 'playing' || s === 'completed' || s === 'abandoned') setPlaytimeOpen(true);
      },
    });
    return true;
  };
  const changeOwned = (owned: boolean) => {
    if (trackingLock.current) return false;
    trackingLock.current = true;
    setOwned.mutate(owned, { onSettled: releaseTrackingLock });
    return true;
  };
  const removeFromTracking = () => {
    if (trackingLock.current) return false;
    trackingLock.current = true;
    removeTracking.mutate(undefined, { onSettled: releaseTrackingLock });
    return true;
  };
  const share = () => {
    if (!detail.data) return;
    const url = typeof window !== 'undefined' ? window.location.href : undefined;
    shareMedia(detail.data.title, url);
  };

  // Signalement : envoie l'œuvre à l'équipe de modération (tri manuel).
  // Le succès n’est affiché qu’après confirmation du serveur.
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
      showToast('Merci, signalement envoyé 👍');
    } catch {
      showToast('Signalement impossible. Réessaie.');
    }
  };

  // Explorer (catégorie Jeux) : marquer « suivi cette session » dès qu'un statut
  // est posé (déjà vu / en cours / voulu…) pour retirer le jeu du deck figé —
  // même marqué ici (retrait du suivi → ré-autorisé). Clé alignée sur feedItemKey.
  const feedIgdbId = detail.data?.igdbId;
  const feedStatus = detail.data?.userStatus;
  useEffect(() => {
    if (!feedIgdbId) return;
    const key = `game:${feedIgdbId}`;
    const store = useFeedSessionStore.getState();
    if (feedStatus) store.markTracked([key]);
    else store.unmarkTracked([key]);
  }, [feedIgdbId, feedStatus]);

  // Bannière (refonte 2026-07-23) : mêmes cotes que les fiches série/film —
  // elle défile avec le contenu, les boutons restent épinglés.
  const heroH = insets.top + (width >= 700 ? 252 : 196);

  if (detail.isLoading) return <FicheSkeleton heroHeight={heroH} />;
  if (!detail.data) return <LoadError onRetry={detail.refetch} busy={detail.isRefetching} />;
  const game = detail.data;
  const posterUri = tmdbImage(game.posterPath, 'w342');
  const trackingBusy =
    trackingLock.current ||
    setStatus.isPending ||
    setOwned.isPending ||
    removeTracking.isPending;
  const heroUri = tmdbImage(game.backdropPath) ?? tmdbImage(game.posterPath);
  // « Aventure • RPG » (méta de la carte d'identité) + date de sortie séparée
  // en « 14 mars » / « 2024 » pour la tuile (maquette).
  const genresTxt = game.genres
    ? game.genres.split(',').map((g) => g.trim()).filter(Boolean).join(' • ')
    : null;
  const releaseTxt = game.releaseDate ? shortDateFr(game.releaseDate) : null;
  const releaseParts = releaseTxt ? releaseTxt.split(' ') : null;
  const releaseDay = releaseParts && releaseParts.length >= 3 ? releaseParts.slice(0, -1).join(' ') : releaseTxt;
  const releaseYear = releaseParts && releaseParts.length >= 3 ? releaseParts[releaseParts.length - 1] : null;
  // Plateformes en BADGES dans la carte d'identité (retour Étienne 2026-07-23) :
  // l'info est visible dès l'ouverture, sans scroller (la date, déjà dans la
  // tuile, laisse sa place — et la rangée quitte la carte Informations).
  const platformList = game.platforms
    ? game.platforms.split(',').map((p) => p.trim()).filter(Boolean)
    : [];

  return (
    <Pop style={styles.screen}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: Math.max(insets.bottom + 80, 96) }]}
      >
        <View style={styles.canvas}>
          <FicheBanner
            uri={heroUri}
            height={heroH}
            fallback={<Ionicons name="game-controller-outline" size={64} color="rgba(255,255,255,0.34)" />}
          />

          {/* Carte d'identité (maquette) : jaquette flottante, badge JEU VIDÉO,
              titre, genres, date de sortie, puis tuiles note / genre / date. */}
          <FicheIdentity
            posterUri={posterUri}
            posterFallback={<Ionicons name="game-controller-outline" size={30} color={COLORS.textSoft} />}
            posterLabel={'Affiche de ' + game.title}
            badge="JEU VIDÉO"
            title={game.title}
            tiles={
              <StatTiles>
                {game.playerScore || game.criticScore ? (() => {
                  // Bascule joueurs ↔ presse au tap sur la tuile (retour
                  // Étienne 2026-07-23) — indicateur ⇄ dans le coin quand les
                  // deux notes existent ; sinon la seule note disponible.
                  const both = !!(game.playerScore && game.criticScore);
                  const critics = game.playerScore ? scoreView === 'critics' : true;
                  const score = critics ? game.criticScore! : game.playerScore!;
                  const label = critics ? 'Note presse' : 'Note joueurs';
                  return (
                    <StatTile
                      icon={<Ionicons name="star" size={21} color={COLORS.tertiary} />}
                      value={`${rating5(score, 100)}/5`}
                      sub={label}
                      a11y={`${label} ${rating5(score, 100)} sur 5${both ? `. Afficher la note ${critics ? 'des joueurs' : 'de la presse'}` : ''}`}
                      onPress={both ? () => setScoreView(critics ? 'players' : 'critics') : undefined}
                      corner={both ? <Feather name="repeat" size={9} color={COLORS.primary} /> : undefined}
                    />
                  );
                })() : null}
                {genresTxt ? (
                  <StatTile
                    icon={<Ionicons name="game-controller-outline" size={21} color={COLORS.primary} />}
                    text={game.genres!.split(',').map((g) => g.trim()).filter(Boolean).slice(0, 2).join('\n')}
                    a11y={`Genres : ${genresTxt}`}
                  />
                ) : null}
                {releaseTxt ? (
                  <StatTile
                    icon={<Feather name="calendar" size={19} color={COLORS.primary} />}
                    value={releaseDay ?? releaseTxt}
                    sub={releaseYear ?? undefined}
                    a11y={`Sortie le ${releaseTxt}`}
                  />
                ) : null}
              </StatTiles>
            }
          >
            {genresTxt ? <Text style={styles.identityMeta}>{genresTxt}</Text> : null}
            {platformList.length ? (
              <View
                style={styles.platRow}
                accessible
                accessibilityRole="text"
                accessibilityLabel={`Plateformes : ${platformList.join(', ')}`}
              >
                {platformList.map((p) => (
                  <View key={p} style={styles.platBadge} accessible={false}>
                    <Text style={styles.platBadgeText} numberOfLines={1}>{p}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </FicheIdentity>

        {/* Suivi : contrôle segmenté pleine largeur (maquette) — re-taper le
            statut actif le DÉSÉLECTIONNE (retrait du suivi). */}
        <View style={styles.trackCard}>
          <Text style={styles.trackTitle}>Suivi</Text>
          <StatusLine
            options={GAME_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] }))}
            value={game.userStatus}
            onChange={(v) => (v === null ? removeFromTracking() : changeStatus(v as GameStatus))}
            accessibilityLabel="Statut de suivi du jeu"
            disabled={trackingBusy}
            allowDeselect
          />
        </View>

        {/* « Je possède ce jeu » (maquette) : carte dédiée — interrupteur
            INDÉPENDANT du statut (Game Pass, collection…) + tuile TEMPS DE JEU
            éditable (seul point d'entrée de la déclaration d'heures). */}
        <View style={styles.trackCard}>
          <OwnedToggle
            on={game.isOwned}
            disabled={trackingBusy}
            onToggle={changeOwned}
          />
          {game.userStatus || game.playtimeMinutes ? (
            <Pressable
              style={({ pressed }) => [styles.playtimeTile, pressed && styles.playtimeTilePressed]}
              onPress={() => setPlaytimeOpen(true)}
              accessibilityRole="button"
              accessibilityLabel={
                game.playtimeMinutes
                  ? `Temps de jeu : ${formatPlaytime(game.playtimeMinutes)} — modifier`
                  : 'Temps de jeu — déclarer'
              }
            >
              <View style={styles.playtimeIcon}>
                <Ionicons name="stopwatch" size={17} color={COLORS.primary} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.playtimeLabel}>Temps de jeu</Text>
                {game.playtimeMinutes ? (
                  <Text style={styles.playtimeValue} numberOfLines={1}>{formatPlaytime(game.playtimeMinutes)}</Text>
                ) : (
                  <Text style={styles.playtimeCta}>Déclarer mes heures</Text>
                )}
              </View>
              <Feather name="edit-3" size={17} color={COLORS.primary} />
            </Pressable>
          ) : null}
        </View>

        {/* Résumé et Informations AVANT la bande-annonce (retour Étienne
            2026-07-23) ; les plateformes vivent en badges dans la carte
            d'identité, la note presse dans la tuile note. */}
        {game.overview ? (
          <FicheSection icon="book-open" title="Résumé">
            <Text style={styles.overview}>{game.overview}</Text>
          </FicheSection>
        ) : null}

        {game.developer || game.publisher || game.gameModes ? (
          <FicheSection icon="info" title="Informations">
            <View style={styles.infoRows}>
              {game.developer ? <InfoRow label="Développeur" value={game.developer} align="right" /> : null}
              {game.publisher ? <InfoRow label="Éditeur" value={game.publisher} align="right" /> : null}
              {game.gameModes ? <InfoRow label="Modes" value={game.gameModes} align="right" /> : null}
            </View>
          </FicheSection>
        ) : null}

        {game.videoId ? <TrailerPreview videoId={game.videoId} /> : null}

        <RelatedGamesRow items={game.related ?? []} />

            <CommentsRow mediaId={game.id} title={game.title} />
        </View>
      </ScrollView>

      {/* Boutons épinglés au-dessus de tout : retour / favori / options
          (le partage reste dans le menu « … »). */}
      <FicheTopActions
        topInset={insets.top}
        onBack={() => goBack('/')}
        backLabel="Retour aux jeux"
        favorite={{ on: game.isFavorite, busy: favorite.isPending, onPress: () => favorite.mutate() }}
        onMenu={() => setMenu(true)}
      />

      <SlideUpBar visible={!!toast} style={[styles.toastBar, { paddingBottom: insets.bottom + SPACE.md }]}>
        <View style={styles.toastRow} accessibilityRole="alert" accessibilityLiveRegion="polite">
          <Feather name="check" size={22} color={COLORS.black} />
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      </SlideUpBar>

      <Modal visible={menu} transparent animationType={reduce ? 'none' : 'fade'} onRequestClose={() => setMenu(false)}>
        <Pressable style={styles.overlay} onPress={() => setMenu(false)} accessibilityRole="button" accessibilityLabel="Fermer les options" />
        <View style={[styles.sheetDock, { paddingBottom: Math.max(insets.bottom, SPACE.xs) }]} pointerEvents="box-none">
          <View
            style={styles.sheet}
            accessibilityViewIsModal
            onAccessibilityEscape={() => setMenu(false)}
          >
            <View style={styles.sheetHandle} />
            {game.userStatus ? (
              <View style={styles.menuStatusRow}>
                <Text style={styles.menuStatusText}>{STATUS_LABELS[game.userStatus as GameStatus]}</Text>
              </View>
            ) : null}
            <SheetItem icon="edit-2" label="Personnaliser" onPress={() => { setMenu(false); setPersoMenu(true); }} />
            <SheetItem
              icon="heart"
              color={game.isFavorite ? COLORS.red : COLORS.text}
              label={game.isFavorite ? 'Retirer des favoris' : 'Favoris'}
              onPress={() => { favorite.mutate(); setMenu(false); }}
              disabled={favorite.isPending}
              busy={favorite.isPending}
            />
            <SheetItem icon="plus-square" label="Ajouter à une liste" onPress={() => { setMenu(false); setListsOpen(true); }} />
            {game.userStatus ? (
              <SheetItem
                icon="minus-square"
                label="Retirer"
                onPress={() => {
                  if (removeFromTracking()) setMenu(false);
                }}
                disabled={trackingBusy}
                busy={removeTracking.isPending}
              />
            ) : null}
            <SheetItem icon="share-2" label="Partager" onPress={() => { setMenu(false); share(); }} />
            <SheetItem icon="flag" label="Signaler" onPress={() => { setMenu(false); setReportOpen(true); }} last />
          </View>
        </View>
      </Modal>

      <ReportModal visible={reportOpen} onClose={() => setReportOpen(false)} onConfirm={submitReport} />
      <PlaytimeSheet
        visible={playtimeOpen}
        title={game.title}
        currentMinutes={game.playtimeMinutes ?? null}
        onSave={(hours) => {
          setPlaytime.mutate(hours);
          setPlaytimeOpen(false);
        }}
        onClose={() => setPlaytimeOpen(false)}
      />

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
    Animated.timing(v, {
      toValue: on ? 1 : 0,
      duration: reduce ? 0 : 180,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [on, reduce, v]);

  return (
    <View style={[styles.ownedRow, disabled && styles.controlDisabled]}>
      <Text style={styles.ownedLabel}>Je possède ce jeu</Text>
      <Pressable
        style={styles.toggleTarget}
        onPress={() => onToggle(!on)}
        disabled={disabled}
        accessibilityRole="switch"
        accessibilityLabel="Je possède ce jeu"
        accessibilityHint="Active ou désactive la présence du jeu dans ta collection"
        accessibilityState={{ checked: on, disabled: !!disabled, busy: !!disabled }}
      >
        <Animated.View
          style={[
            styles.toggle,
            {
              backgroundColor: v.interpolate({
                inputRange: [0, 1],
                outputRange: [COLORS.surfaceMuted, COLORS.primary],
              }),
            },
          ]}
        >
          <Animated.View
            style={[
              styles.knob,
              {
                backgroundColor: v.interpolate({
                  inputRange: [0, 1],
                  outputRange: [COLORS.surface, COLORS.onPrimary],
                }),
                transform: [{ translateX: v.interpolate({ inputRange: [0, 1], outputRange: [0, 22] }) }],
              },
            ]}
          />
        </Animated.View>
      </Pressable>
    </View>
  );
}

// Feuille « Temps de jeu » (déclaratif) : proposée à la bascule de statut,
// JAMAIS bloquante (« Plus tard »), rouvrable depuis la ligne Informations.
function PlaytimeSheet({
  visible,
  title,
  currentMinutes,
  onSave,
  onClose,
}: {
  visible: boolean;
  title: string;
  currentMinutes: number | null;
  onSave: (hours: number | null) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState('');
  const insets = useSafeAreaInsets();
  // Pré-remplit avec la valeur connue à chaque ouverture.
  useEffect(() => {
    if (visible) setValue(currentMinutes ? String(Math.round((currentMinutes / 60) * 10) / 10) : '');
  }, [visible, currentMinutes]);
  const parsed = Number.parseFloat(value.replace(',', '.'));
  const valid = value.trim().length > 0 && Number.isFinite(parsed) && parsed >= 0 && parsed <= 100_000;
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={ptStyles.keyboardAvoider}
        behavior={Platform.OS === 'ios' ? 'padding' : Platform.OS === 'android' ? 'height' : undefined}
      >
        <View style={[ptStyles.overlay, { paddingTop: insets.top + SPACE.xs, paddingBottom: insets.bottom + SPACE.xl }]}>
          <Pressable
            style={[StyleSheet.absoluteFill, ptStyles.backdrop]}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Fermer la saisie du temps de jeu"
          />
          <View style={ptStyles.card} accessibilityViewIsModal onAccessibilityEscape={onClose}>
            <View style={ptStyles.iconWrap}>
              <Feather name="clock" size={18} color={COLORS.onAccent} />
            </View>
            <Text style={ptStyles.title}>Temps de jeu</Text>
            <Text style={ptStyles.sub}>Indique tes heures. Tu pourras les modifier.</Text>
            <View style={ptStyles.inputRow}>
              <TextInput
                style={ptStyles.input}
                value={value}
                onChangeText={setValue}
                keyboardType="decimal-pad"
                returnKeyType="done"
                placeholder="Ex. 25"
                placeholderTextColor={COLORS.textSoft}
                selectTextOnFocus
                accessibilityLabel={`Nombre d'heures de jeu pour ${title}`}
              />
              <Text style={ptStyles.unit}>heures</Text>
            </View>
            <Pressable
              style={({ pressed }) => [ptStyles.saveBtn, !valid && ptStyles.saveBtnDisabled, pressed && valid && ptStyles.pressed]}
              disabled={!valid}
              onPress={() => onSave(parsed)}
              accessibilityRole="button"
              accessibilityLabel="Enregistrer le temps de jeu"
            >
              <Text style={ptStyles.saveText}>ENREGISTRER</Text>
            </Pressable>
            <View style={ptStyles.secondaryActions}>
              <Pressable
                style={({ pressed }) => [ptStyles.secondaryBtn, pressed && ptStyles.pressed]}
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel="Plus tard"
              >
                <Text style={ptStyles.laterText}>Plus tard</Text>
              </Pressable>
              {currentMinutes ? (
                <Pressable
                  style={({ pressed }) => [ptStyles.secondaryBtn, pressed && ptStyles.pressed]}
                  onPress={() => onSave(null)}
                  accessibilityRole="button"
                  accessibilityLabel="Effacer le temps déclaré"
                >
                  <Text style={ptStyles.clearText}>Effacer</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const ptStyles = StyleSheet.create({
  keyboardAvoider: { flex: 1 },
  overlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACE.md,
  },
  backdrop: { backgroundColor: COLORS.overlay },
  card: {
    width: '100%',
    maxWidth: 360,
    alignItems: 'center',
    backgroundColor: COLORS.sheet,
    borderRadius: RADIUS.sheet,
    paddingHorizontal: SPACE.lg,
    paddingVertical: SPACE.md,
    ...SHADOW.card,
  },
  iconWrap: { width: 40, height: 40, borderRadius: RADIUS.control, backgroundColor: COLORS.yellow, alignItems: 'center', justifyContent: 'center' },
  title: { color: COLORS.text, fontSize: 19, fontFamily: FONTS.extraBold, marginTop: SPACE.xs },
  sub: { color: COLORS.textMuted, fontSize: 13, lineHeight: 18, fontFamily: FONTS.regular, textAlign: 'center', marginTop: SPACE.xxs },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, marginTop: SPACE.sm, alignSelf: 'stretch' },
  input: {
    flex: 1,
    minHeight: SIZES.touchComfortable,
    color: COLORS.text,
    backgroundColor: COLORS.surfaceMuted,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: RADIUS.control,
    fontSize: 18,
    fontFamily: FONTS.bold,
    paddingHorizontal: SPACE.sm,
    paddingVertical: 9,
    textAlign: 'center',
  },
  unit: { color: COLORS.textMuted, fontSize: 15, fontFamily: FONTS.semiBold },
  saveBtn: {
    alignSelf: 'stretch',
    minHeight: SIZES.touchComfortable,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.pill,
    marginTop: SPACE.sm,
  },
  saveBtnDisabled: { opacity: 0.4 },
  saveText: { color: COLORS.onPrimary, fontSize: 14, fontFamily: FONTS.extraBold, letterSpacing: 0.5 },
  pressed: { opacity: 0.86, transform: [{ scale: 0.99 }] },
  secondaryActions: { alignSelf: 'stretch', flexDirection: 'row', gap: SPACE.xs, marginTop: SPACE.xs },
  secondaryBtn: { minHeight: SIZES.touch, flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: RADIUS.control },
  laterText: { color: COLORS.textMuted, fontSize: 14, fontFamily: FONTS.bold },
  clearText: { color: COLORS.danger, fontSize: 13, fontFamily: FONTS.bold },
});

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
    <FicheSection icon="play-circle" title="Bande-annonce">
      <View style={styles.trailerBox}>
        {playing && Platform.OS === 'web' ? (
          // RN-web rend les tags DOM natifs via React.createElement — pas d'équivalent
          // <video>/<iframe> dans les primitives RN, pas de nouvelle dépendance.
          React.createElement('iframe', {
            src: `https://www.youtube.com/embed/${videoId}?autoplay=1`,
            style: { width: '100%', height: '100%', border: 0 },
            title: 'Bande-annonce du jeu',
            allow: 'autoplay; encrypted-media; picture-in-picture',
            allowFullScreen: true,
          })
        ) : (
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={play}
            accessibilityRole="button"
            accessibilityLabel="Lire la bande-annonce"
            accessibilityHint={Platform.OS === 'web' ? 'Lance la vidéo dans la fiche' : 'Ouvre la vidéo dans YouTube'}
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
    </FicheSection>
  );
}

function SheetItem({
  icon,
  label,
  onPress,
  color,
  last,
  disabled = false,
  busy = false,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  onPress: () => void;
  color?: string;
  last?: boolean;
  disabled?: boolean;
  busy?: boolean;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.sheetItem,
        last && { borderBottomWidth: 0 },
        pressed && styles.sheetItemPressed,
        disabled && styles.controlDisabled,
      ]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, busy }}
    >
      <View style={styles.sheetItemIcon}>
        <Feather name={icon} size={20} color={color ?? COLORS.text} />
      </View>
      <Text style={styles.sheetLabel}>{label}</Text>
      {busy ? (
        <ActivityIndicator color={COLORS.primary} size="small" />
      ) : (
        <Feather name="chevron-right" size={18} color={COLORS.textSoft} />
      )}
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
  const reduce = useReduceMotion();
  return (
    <Modal visible={visible} transparent animationType={reduce ? 'none' : 'fade'} onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose} accessibilityRole="button" accessibilityLabel="Fermer la personnalisation" />
      <View style={[styles.sheetDock, { paddingBottom: Math.max(insets.bottom, SPACE.xs) }]} pointerEvents="box-none">
        <View
          style={styles.sheet}
          accessibilityViewIsModal
          onAccessibilityEscape={onClose}
        >
        <View style={styles.sheetHandle} />
        <Text style={pstyles.menuHeader}>Personnaliser</Text>
        <SheetItem icon="image" label="Modifier l’affiche" onPress={() => onPick('poster')} />
        <SheetItem icon="layout" label="Changer la bannière" onPress={() => onPick('banner')} last />
      </View>
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
  const insets = useSafeAreaInsets();
  const reduce = useReduceMotion();
  const { width } = useWindowDimensions();
  const [applyError, setApplyError] = useState<string | null>(null);
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
    setApplyError(null);
    try {
      if (mode === 'poster') await api.post(`/api/games/${mediaId}/poster`, { posterPath: uri });
      else await api.post(`/api/games/${mediaId}/banner`, { backdropPath: uri });
      images.refetch();
      onApplied(mode);
    } catch {
      setApplyError('La modification n’a pas pu être enregistrée. Réessaie.');
    } finally {
      setBusyUri(null);
    }
  };

  const isPoster = mode === 'poster';
  const list = (isPoster ? images.data?.posters : images.data?.backdrops) ?? [];
  const selectedUri = isPoster ? images.data?.selectedPoster : images.data?.selectedBackdrop;

  const columns = width >= 720 ? 4 : width >= 480 ? 3 : 2;
  const pickerWidth = Math.min(width, SIZES.contentMax) - SPACE.md * 2;
  const posterWidth = Math.max(120, (pickerWidth - SPACE.sm * (columns - 1)) / columns);
  const cell = (uri: string) => {
    const selected = uri === selectedUri;
    return (
      <Pressable
        key={uri}
        style={({ pressed }) => [
          isPoster ? pstyles.posterWrap : pstyles.bannerWrap,
          isPoster ? { width: posterWidth } : undefined,
          pressed && pstyles.imagePressed,
        ]}
        onPress={() => apply(uri)}
        disabled={!!busyUri}
        accessibilityRole="button"
        accessibilityLabel={isPoster ? 'Choisir cette affiche' : 'Choisir cette bannière'}
        accessibilityState={{ selected, disabled: !!busyUri, busy: busyUri === uri }}
      >
        <Image
          source={{ uri: tmdbImage(uri, isPoster ? 'w342' : 'w500') ?? uri }}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
          accessibilityIgnoresInvertColors
        />
        {selected ? (
          <View style={pstyles.selectedShade} pointerEvents="none">
            <View style={pstyles.selectedRow}>
              <Feather name="check-circle" size={18} color={COLORS.tertiary} />
              <Text style={pstyles.selectedText}>Sélectionnée</Text>
            </View>
          </View>
        ) : null}
        {busyUri === uri ? (
          <View style={pstyles.busy} pointerEvents="none">
            <ActivityIndicator color="#fff" />
          </View>
        ) : null}
      </Pressable>
    );
  };

  return (
    <Modal visible={mode !== null} animationType={reduce ? 'none' : 'slide'} onRequestClose={onClose}>
      <View style={pstyles.screen} accessibilityViewIsModal onAccessibilityEscape={onClose}>
        <View style={[pstyles.header, { paddingTop: Math.max(insets.top + SPACE.xs, SPACE.lg) }]}>
          <Pressable style={pstyles.closeButton} onPress={onClose} accessibilityRole="button" accessibilityLabel="Fermer le sélecteur d’images">
            <Feather name="arrow-left" size={22} color={COLORS.text} />
          </Pressable>
          <Text style={pstyles.title}>{isPoster ? 'Modifier l’affiche' : 'Changer la bannière'}</Text>
          <View style={pstyles.closeSpacer} />
        </View>
        {applyError ? (
          <View style={pstyles.errorBanner} accessibilityRole="alert" accessibilityLiveRegion="polite">
            <Feather name="alert-circle" size={18} color={COLORS.danger} />
            <Text style={pstyles.errorText}>{applyError}</Text>
          </View>
        ) : null}
        {images.isLoading ? (
          <Loading />
        ) : images.isError ? (
          <LoadError onRetry={() => images.refetch()} busy={images.isRefetching} />
        ) : list.length === 0 ? (
          <View style={pstyles.emptyCard}>
            <Feather name="image" size={28} color={COLORS.textSoft} />
            <Text style={pstyles.emptyNote}>
              {isPoster ? 'Aucune affiche disponible.' : 'Aucune bannière disponible pour ce jeu.'}
            </Text>
          </View>
        ) : (
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={[pstyles.pickerContent, { paddingBottom: Math.max(insets.bottom + SPACE.xl, SPACE.xxl) }]}
          >
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
  const reduce = useReduceMotion();
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
  const syncOthers = () => {
    qc.invalidateQueries({ queryKey: ['lists'] });
    qc.invalidateQueries({ queryKey: ['profile'] });
  };

  const toggle = async (list: PickerList) => {
    if (busyId || creating) return;
    setBusyId(list.id);
    setActionError(null);
    const added = !list.containsMediaId;
    const previous = qc.getQueryData<{ lists: PickerList[] }>(pickerKey);

    qc.setQueryData<{ lists: PickerList[] }>(pickerKey, (data) =>
      data
        ? {
            lists: data.lists.map((item) =>
              item.id === list.id
                ? {
                    ...item,
                    containsMediaId: added,
                    itemCount: Math.max(0, item.itemCount + (added ? 1 : -1)),
                  }
                : item,
            ),
          }
        : data,
    );

    try {
      if (added) {
        await api.post('/api/lists/' + list.id + '/items', { mediaId });
      } else {
        await api.del('/api/lists/' + list.id + '/items/' + mediaId);
      }
      onChanged(added, list.title);
      syncOthers();
    } catch {
      if (previous) qc.setQueryData(pickerKey, previous);
      setActionError('La liste n’a pas pu être modifiée. Réessaie.');
    } finally {
      setBusyId(null);
    }
  };
  const create = async () => {
    const title = newTitle.trim();
    if (!title || creating) return;

    setCreating(true);
    setActionError(null);
    setNewTitle('');

    const previous = qc.getQueryData<{ lists: PickerList[] }>(pickerKey);
    const tempId = 'tmp-' + title;
    const optimisticList: PickerList = {
      id: tempId,
      title,
      itemCount: 1,
      containsMediaId: true,
    };

    qc.setQueryData<{ lists: PickerList[] }>(pickerKey, (data) => ({
      lists: [...(data?.lists ?? []), optimisticList],
    }));

    try {
      const result = await api.post<{ id: string }>('/api/lists', { title });
      const createdSelected: PickerList = { ...optimisticList, id: result.id };

      qc.setQueryData<{ lists: PickerList[] }>(pickerKey, (data) => {
        const current = data?.lists ?? [];
        const withoutDuplicate = current.filter((item) => item.id !== result.id);
        const withServerId = withoutDuplicate.map((item) =>
          item.id === tempId ? createdSelected : item,
        );
        return {
          lists: withServerId.some((item) => item.id === result.id)
            ? withServerId
            : [...withServerId, createdSelected],
        };
      });

      try {
        await api.post('/api/lists/' + result.id + '/items', { mediaId });
      } catch {
        const createdEmpty: PickerList = {
          id: result.id,
          title,
          itemCount: 0,
          containsMediaId: false,
        };

        qc.setQueryData<{ lists: PickerList[] }>(pickerKey, (data) => {
          const current = data?.lists ?? previous?.lists ?? [];
          let inserted = false;
          const lists = current.flatMap((item) => {
            if (item.id !== tempId && item.id !== result.id) return [item];
            if (inserted) return [];
            inserted = true;
            return [createdEmpty];
          });
          if (!inserted) lists.push(createdEmpty);
          return { lists };
        });

        setActionError(
          'La liste « ' +
            title +
            ' » a été créée, mais le jeu n’a pas été ajouté. Touche la liste pour réessayer.',
        );
        syncOthers();
        return;
      }

      onChanged(true, title);
      syncOthers();
    } catch {
      if (previous) {
        qc.setQueryData(pickerKey, previous);
      } else {
        qc.setQueryData<{ lists: PickerList[] }>(pickerKey, (data) => ({
          lists: (data?.lists ?? []).filter((item) => item.id !== tempId),
        }));
      }
      setNewTitle(title);
      setActionError('La liste n’a pas pu être créée. Réessaie.');
    } finally {
      setCreating(false);
    }
  };
  return (
    <Modal visible={visible} transparent animationType={reduce ? 'none' : 'fade'} onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose} accessibilityRole="button" accessibilityLabel="Fermer les listes" />
      <View style={[styles.sheetDock, { paddingBottom: Math.max(insets.bottom, SPACE.xs) }]} pointerEvents="box-none">
        <View
          style={[styles.sheet, styles.listSheet]}
          accessibilityViewIsModal
          onAccessibilityEscape={onClose}
        >
        <View style={styles.sheetHandle} />
        <View style={styles.menuStatusRow}>
          <View style={styles.menuHeaderIcon}>
            <Feather name="bookmark" size={18} color={COLORS.primary} />
          </View>
          <Text style={styles.menuStatusText}>Ajouter à une liste</Text>
        </View>
        {actionError ? (
          <View style={pstyles.errorBanner} accessibilityRole="alert" accessibilityLiveRegion="polite">
            <Feather name="alert-circle" size={18} color={COLORS.danger} />
            <Text style={pstyles.errorText}>{actionError}</Text>
          </View>
        ) : null}
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={pstyles.listContent}>
          {lists.isLoading ? (
            <Loading />
          ) : lists.isError ? (
            <LoadError onRetry={() => lists.refetch()} busy={lists.isRefetching} />
          ) : (
            <>
              {(lists.data?.lists ?? []).length === 0 ? (
                <Text style={pstyles.listEmpty}>Tu n’as pas encore de liste. Crée-en une juste dessous.</Text>
              ) : null}
              {(lists.data?.lists ?? []).map((l) => {
                const disabled = !!busyId || creating;
                return (
                  <Pressable
                    key={l.id}
                    style={({ pressed }) => [styles.listItem, pressed && styles.sheetItemPressed, disabled && styles.controlDisabled]}
                    onPress={() => toggle(l)}
                    disabled={disabled}
                    accessibilityRole="checkbox"
                    accessibilityLabel={l.title}
                    accessibilityState={{ checked: !!l.containsMediaId, disabled, busy: busyId === l.id }}
                  >
                    <View style={[styles.listCheck, l.containsMediaId && styles.listCheckSelected]}>
                      {l.containsMediaId ? <Feather name="check" size={15} color={COLORS.onPrimary} /> : null}
                    </View>
                    <Text style={styles.sheetLabel} numberOfLines={1}>{l.title}</Text>
                    {busyId === l.id ? (
                      <ActivityIndicator color={COLORS.primary} size="small" />
                    ) : (
                      <Text style={pstyles.listCount}>{l.itemCount}</Text>
                    )}
                  </Pressable>
                );
              })}
            </>
          )}
          <View style={pstyles.newListRow}>
            <TextInput
              style={pstyles.newListInput}
              placeholder="Nouvelle liste…"
              placeholderTextColor={COLORS.textSoft}
              value={newTitle}
              onChangeText={setNewTitle}
              onSubmitEditing={create}
              returnKeyType="done"
              accessibilityLabel="Nom de la nouvelle liste"
            />
            <Pressable
              style={({ pressed }) => [pstyles.newListBtn, pressed && pstyles.newListBtnPressed, (!newTitle.trim() || creating) && styles.controlDisabled]}
              onPress={create}
              disabled={!newTitle.trim() || creating}
              accessibilityRole="button"
              accessibilityLabel="Créer la liste"
              accessibilityState={{ disabled: !newTitle.trim() || creating, busy: creating }}
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


// « Éditions et extensions » (façon app Xbox) : cartes à défilement latéral —
// jaquette + bandeau nom + type. Clic : fiche locale directe si déjà en base,
// sinon import IGDB silencieux puis ouverture (fiche jeu standard : on peut y
// mettre Voulu / En cours / … comme n'importe quel jeu).
function RelatedGamesRow({ items }: { items: RelatedGameDto[] }) {
  const router = useRouter();
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  if (!items.length) return null;

  const open = async (r: RelatedGameDto) => {
    if (openingId) return;
    setOpenError(null);
    if (r.localId) {
      router.push(('/game/' + r.localId) as Href);
      return;
    }
    setOpeningId(r.igdbId);
    try {
      const res = await api.post<{ mediaId: string | null }>('/api/games/add-from-igdb', { igdbId: r.igdbId });
      if (res.mediaId) {
        router.push(('/game/' + res.mediaId) as Href);
      } else {
        setOpenError('Ce contenu ne peut pas être ouvert pour le moment.');
      }
    } catch {
      setOpenError('Impossible d’ouvrir ce contenu. Réessaie.');
    } finally {
      setOpeningId(null);
    }
  };

  return (
    <FicheSection icon="layers" title="Éditions et extensions" flush>
      {openError ? (
        <View style={pstyles.errorBanner} accessibilityRole="alert" accessibilityLiveRegion="polite">
          <Feather name="alert-circle" size={18} color={COLORS.danger} />
          <Text style={pstyles.errorText}>{openError}</Text>
        </View>
      ) : null}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.relatedContent}
      >
        {items.map((r) => {
          const opening = openingId === r.igdbId;
          const disabled = !!openingId;
          return (
            <PressableScale
              key={r.igdbId}
              style={[styles.relCard, disabled && !opening ? styles.controlDisabled : undefined]}
              onPress={() => open(r)}
              disabled={disabled}
              accessibilityRole="button"
              accessibilityLabel={'Ouvrir ' + r.title}
              accessibilityHint={r.localId ? 'Ouvre la fiche du jeu' : 'Ajoute le contenu puis ouvre sa fiche'}
              accessibilityState={{ disabled, busy: opening }}
            >
              <View style={styles.relCover}>
                {r.posterPath ? (
                  <Image
                    source={{ uri: r.posterPath }}
                    style={StyleSheet.absoluteFill}
                    resizeMode="cover"
                    accessibilityLabel={'Affiche de ' + r.title}
                    accessibilityIgnoresInvertColors
                  />
                ) : (
                  <View style={[StyleSheet.absoluteFill, styles.relCoverEmpty]}>
                    <Ionicons name="game-controller-outline" size={30} color={COLORS.textSoft} />
                  </View>
                )}
                {r.inLibrary ? (
                  <View style={styles.relBadge} accessibilityLabel="Dans ta bibliothèque">
                    <Feather name="check" size={14} color="#FFFFFF" />
                  </View>
                ) : null}
                {opening ? (
                  <View style={styles.relBusy} pointerEvents="none">
                    <ActivityIndicator color="#fff" />
                  </View>
                ) : null}
              </View>
              <Text style={styles.relName} numberOfLines={2}>{r.title}</Text>
              <Text style={styles.relKind}>
                {[r.kind === 'edition' ? 'Édition' : 'Extension', r.year].filter(Boolean).join(' · ')}
              </Text>
            </PressableScale>
          );
        })}
      </ScrollView>
    </FicheSection>
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
      style={({ pressed }) => (pressed ? styles.commentsRowPressed : null)}
      onPress={() =>
        router.push(('/comments/' + mediaId + '?title=' + encodeURIComponent(title) + '&type=game') as Href)
      }
      accessibilityRole="button"
      accessibilityLabel={'Voir les commentaires sur ' + title}
      accessibilityHint="Ouvre la discussion dédiée à ce jeu"
    >
      <FicheSection
        icon="message-circle"
        title="Commentaires"
        trailing={<Feather name="chevron-right" size={20} color={COLORS.textMuted} />}
      />
    </Pressable>
  );
}
const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  scrollContent: {
    flexGrow: 1,
    alignItems: 'center',
  },
  canvas: {
    width: '100%',
    maxWidth: SIZES.contentMax,
    backgroundColor: COLORS.pageMuted,
    paddingBottom: SPACE.sm,
  },
  // Méta de la carte d'identité : « Aventure • RPG » puis « Sortie le … ».
  identityMeta: {
    marginTop: SPACE.xs,
    color: COLORS.textMuted,
    fontFamily: FONTS.semiBold,
    fontSize: 12.5,
    lineHeight: 17,
  },
  // Badges de plateformes (PJ Étienne, adaptés à la DA) : pilules lavande
  // compactes, texte fort, retour à la ligne libre.
  platRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: SPACE.xs,
  },
  platBadge: {
    minHeight: 24,
    justifyContent: 'center',
    paddingHorizontal: 10,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.surfaceMuted,
  },
  platBadgeText: {
    color: COLORS.text,
    fontFamily: FONTS.bold,
    fontSize: 11.5,
  },
  // Cartes « contrôle » (Suivi, Je possède) : titre bold sans pastille — les
  // sections de CONTENU passent par FicheSection (pastille d'icône).
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
    color: COLORS.text,
    fontFamily: FONTS.extraBold,
    fontSize: 16.5,
    lineHeight: 21,
    marginBottom: SPACE.sm,
  },
  infoRows: { marginTop: SPACE.xs },
  controlDisabled: {
    opacity: 0.48,
  },
  // « Je possède ce jeu » : rangée de tête de sa carte (label + interrupteur).
  ownedRow: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.sm,
  },
  ownedLabel: {
    flex: 1,
    minWidth: 0,
    color: COLORS.text,
    fontFamily: FONTS.extraBold,
    fontSize: 16.5,
  },
  toggleTarget: {
    width: 60,
    minHeight: SIZES.touch,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  toggle: {
    width: 52,
    height: 30,
    padding: 3,
    borderRadius: 15,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
  },
  knob: {
    width: 24,
    height: 24,
    borderRadius: 12,
    ...SHADOW.card,
  },
  // Tuile « TEMPS DE JEU » (maquette) : fond lavande, libellé en petites
  // capitales, valeur en gras, crayon d'édition à droite.
  playtimeTile: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.sm,
    marginTop: SPACE.sm,
    paddingHorizontal: SPACE.sm,
    paddingVertical: SPACE.xs,
    borderRadius: RADIUS.card,
    backgroundColor: COLORS.primarySoft,
  },
  playtimeTilePressed: { opacity: 0.75 },
  playtimeIcon: {
    width: 32, height: 32, borderRadius: RADIUS.pill, backgroundColor: COLORS.surface,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  playtimeLabel: { color: COLORS.primary, fontSize: 11, fontFamily: FONTS.extraBold, letterSpacing: 0.9, textTransform: 'uppercase' },
  playtimeValue: { color: COLORS.text, fontSize: 18, fontFamily: FONTS.extraBold, marginTop: 2 },
  playtimeCta: { color: COLORS.text, fontSize: 14.5, fontFamily: FONTS.bold, marginTop: 2 },
  overview: {
    color: COLORS.text,
    fontFamily: FONTS.regular,
    fontSize: 15.5,
    lineHeight: 23,
  },
  trailerBox: {
    width: '100%',
    aspectRatio: 16 / 9,
    overflow: 'hidden',
    borderRadius: RADIUS.card,
    backgroundColor: '#160F2A',
  },
  trailerPlayShade: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(12,7,28,0.32)',
  },
  trailerPlayBtn: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.72)',
    ...SHADOW.card,
  },
  relatedContent: {
    gap: SPACE.sm,
    paddingHorizontal: SPACE.md,
    paddingTop: SPACE.sm,
    paddingBottom: SPACE.xxs,
  },
  relCard: {
    width: 120,
  },
  relCover: {
    width: 120,
    height: 160,
    borderRadius: RADIUS.card,
    overflow: 'hidden',
    backgroundColor: COLORS.imagePlaceholder,
  },
  relCoverEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.surfaceMuted,
  },
  relBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.success,
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
  },
  relBusy: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(12,7,28,0.48)',
    borderRadius: RADIUS.card,
  },
  relName: {
    marginTop: SPACE.xs,
    color: COLORS.text,
    fontFamily: FONTS.bold,
    fontSize: 12.5,
    lineHeight: 16,
  },
  relKind: {
    marginTop: 1,
    color: COLORS.textMuted,
    fontFamily: FONTS.medium,
    fontSize: 11,
  },
  commentsRowPressed: {
    opacity: 0.78,
  },
  toastBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: SPACE.md,
    alignItems: 'center',
    backgroundColor: COLORS.tertiary,
  },
  toastRow: {
    minHeight: SIZES.touch,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.xs,
    paddingHorizontal: SPACE.md,
  },
  toastText: {
    color: COLORS.onAccent,
    fontFamily: FONTS.extraBold,
    fontSize: 14,
    letterSpacing: 0.3,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: COLORS.overlay,
  },
  sheetDock: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    paddingHorizontal: SPACE.sm,
  },
  sheet: {
    width: '100%',
    maxWidth: 540,
    overflow: 'hidden',
    borderRadius: RADIUS.sheet,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
    backgroundColor: COLORS.sheet,
    ...SHADOW.season,
  },
  listSheet: {
    maxHeight: '82%',
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 42,
    height: 4,
    marginTop: SPACE.xs,
    marginBottom: SPACE.xxs,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.border,
  },
  menuStatusRow: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.sm,
    paddingHorizontal: SPACE.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.borderLight,
    backgroundColor: COLORS.primarySoft,
  },
  menuHeaderIcon: {
    width: 34,
    height: 34,
    borderRadius: RADIUS.control,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.surface,
  },
  menuStatusText: {
    flex: 1,
    color: COLORS.text,
    fontFamily: FONTS.bold,
    fontSize: 15,
  },
  sheetItem: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.sm,
    paddingHorizontal: SPACE.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.borderLight,
  },
  sheetItemPressed: {
    backgroundColor: COLORS.surfaceMuted,
  },
  sheetItemIcon: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetLabel: {
    flex: 1,
    color: COLORS.text,
    fontFamily: FONTS.semiBold,
    fontSize: 15.5,
  },
  listItem: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.sm,
    paddingHorizontal: SPACE.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.borderLight,
  },
  listCheck: {
    width: 26,
    height: 26,
    borderRadius: RADIUS.small,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.surface,
  },
  listCheckSelected: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primary,
  },
});

const pstyles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  header: {
    width: '100%',
    maxWidth: SIZES.contentMax,
    alignSelf: 'center',
    minHeight: SIZES.header,
    paddingHorizontal: SPACE.md,
    paddingBottom: SPACE.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.borderLight,
    backgroundColor: COLORS.surface,
  },
  closeButton: {
    width: SIZES.touch,
    height: SIZES.touch,
    borderRadius: RADIUS.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.surfaceMuted,
  },
  closeSpacer: {
    width: SIZES.touch,
    height: SIZES.touch,
  },
  title: {
    flex: 1,
    paddingHorizontal: SPACE.xs,
    color: COLORS.text,
    fontFamily: FONTS.extraBold,
    fontSize: 18,
    textAlign: 'center',
  },
  pickerContent: {
    width: '100%',
    maxWidth: SIZES.contentMax,
    alignSelf: 'center',
    padding: SPACE.md,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACE.sm,
  },
  posterWrap: {
    aspectRatio: 2 / 3,
    overflow: 'hidden',
    borderRadius: RADIUS.poster,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
    backgroundColor: COLORS.imagePlaceholder,
  },
  bannerList: {
    gap: SPACE.md,
  },
  bannerWrap: {
    width: '100%',
    aspectRatio: 16 / 9,
    overflow: 'hidden',
    borderRadius: RADIUS.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
    backgroundColor: COLORS.imagePlaceholder,
  },
  imagePressed: {
    opacity: 0.8,
  },
  selectedShade: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(12,7,28,0.58)',
  },
  selectedRow: {
    minHeight: SIZES.touch,
    paddingHorizontal: SPACE.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.xs,
  },
  selectedText: {
    color: '#FFFFFF',
    fontFamily: FONTS.bold,
    fontSize: 14,
  },
  busy: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(12,7,28,0.48)',
  },
  emptyCard: {
    width: '100%',
    maxWidth: SIZES.contentMax - SPACE.xl,
    alignSelf: 'center',
    margin: SPACE.md,
    padding: SPACE.xl,
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACE.sm,
    borderRadius: RADIUS.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  emptyNote: {
    color: COLORS.textMuted,
    fontFamily: FONTS.regular,
    fontSize: 14.5,
    lineHeight: 20,
    textAlign: 'center',
  },
  errorBanner: {
    marginHorizontal: SPACE.md,
    marginBottom: SPACE.sm,
    padding: SPACE.sm,
    minHeight: SIZES.touch,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.xs,
    borderRadius: RADIUS.control,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.danger,
    backgroundColor: COLORS.surface,
  },
  errorText: {
    flex: 1,
    color: COLORS.danger,
    fontFamily: FONTS.semiBold,
    fontSize: 13,
    lineHeight: 18,
  },
  menuHeader: {
    color: COLORS.textMuted,
    fontFamily: FONTS.bold,
    fontSize: 12,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    paddingHorizontal: SPACE.md,
    paddingTop: SPACE.sm,
    paddingBottom: SPACE.xs,
  },
  listContent: {
    paddingBottom: SPACE.xs,
  },
  listEmpty: {
    paddingHorizontal: SPACE.md,
    paddingVertical: SPACE.lg,
    color: COLORS.textMuted,
    fontFamily: FONTS.regular,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  listCount: {
    color: COLORS.textMuted,
    fontFamily: FONTS.regular,
    fontSize: 13,
  },
  newListRow: {
    padding: SPACE.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.xs,
  },
  newListInput: {
    flex: 1,
    minHeight: SIZES.touchComfortable,
    paddingHorizontal: SPACE.sm,
    paddingVertical: SPACE.xs,
    borderRadius: RADIUS.control,
    borderWidth: 1,
    borderColor: COLORS.border,
    color: COLORS.text,
    backgroundColor: COLORS.surfaceMuted,
    fontFamily: FONTS.regular,
    fontSize: 15,
  },
  newListBtn: {
    minWidth: 86,
    minHeight: SIZES.touchComfortable,
    paddingHorizontal: SPACE.sm,
    borderRadius: RADIUS.control,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary,
  },
  newListBtnPressed: {
    opacity: 0.78,
  },
  newListBtnText: {
    color: COLORS.onPrimary,
    fontFamily: FONTS.extraBold,
    fontSize: 12,
    letterSpacing: 0.5,
  },
});
