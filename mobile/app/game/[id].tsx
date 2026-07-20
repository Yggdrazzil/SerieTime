import React, { useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Modal, TextInput, ActivityIndicator, Image, Platform, Linking, Animated, Easing, useWindowDimensions } from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { goBack } from '@/lib/nav';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, tmdbImage } from '@/lib/api';
import { COLORS, FONTS, RADIUS, SHADOW, SIZES, SPACE } from '@/lib/theme';
import { Loading, LoadError } from '@/components/ui';
import { Pop, PressableScale, SlideUpBar } from '@/components/anim';
import { shareMedia } from '@/lib/share';
import { FicheSkeleton } from '@/components/FicheSkeleton';
import { StatusLine } from '@/components/StatusLine';
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

  if (detail.isLoading) return <FicheSkeleton heroHeight={288} />;
  if (!detail.data) return <LoadError onRetry={detail.refetch} busy={detail.isRefetching} />;
  const game = detail.data;
  const posterUri = tmdbImage(game.posterPath, 'w342');
  const heroMeta = [game.year, game.platforms?.split(',')[0]?.trim()].filter(Boolean).join(' · ');
  const trackingBusy =
    trackingLock.current ||
    setStatus.isPending ||
    setOwned.isPending ||
    removeTracking.isPending;
  const heroUri = tmdbImage(game.backdropPath) ?? tmdbImage(game.posterPath);

  return (
    <Pop style={styles.screen}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: Math.max(insets.bottom + 80, 96) }]}
      >
        <View style={styles.canvas}>
          <View style={styles.hero}>
            {heroUri ? (
              <Image source={{ uri: heroUri }} style={StyleSheet.absoluteFill} resizeMode="cover" accessibilityIgnoresInvertColors />
            ) : (
              <View style={[StyleSheet.absoluteFill, styles.heroFallback]} accessible={false}>
                <View style={styles.heroPrismOne} />
                <View style={styles.heroPrismTwo} />
                <Ionicons name="game-controller-outline" size={74} color="rgba(255,255,255,0.34)" />
              </View>
            )}
            <LinearGradient
              colors={['rgba(12,7,28,0.08)', 'rgba(12,7,28,0.52)', 'rgba(12,7,28,0.95)']}
              locations={[0, 0.46, 1]}
              style={StyleSheet.absoluteFill}
            />
            <View style={[styles.heroBtns, { top: insets.top + SPACE.sm }]}>
              <PressableScale
                style={styles.heroAction}
                onPress={() => goBack('/games')}
                accessibilityRole="button"
                accessibilityLabel="Retour aux jeux"
                accessibilityHint="Revient à l’écran précédent"
              >
                <Feather name="arrow-left" size={22} color="#fff" />
              </PressableScale>
              <View style={styles.heroActionGroup}>
                <PressableScale
                  style={styles.heroAction}
                  onPress={() => favorite.mutate()}
                  disabled={favorite.isPending}
                  accessibilityRole="button"
                  accessibilityLabel={game.isFavorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
                  accessibilityState={{ selected: game.isFavorite, disabled: favorite.isPending, busy: favorite.isPending }}
                >
                  <Feather name="heart" size={20} color={game.isFavorite ? '#FF77B8' : '#fff'} />
                </PressableScale>
                <PressableScale
                  style={styles.heroAction}
                  onPress={share}
                  accessibilityRole="button"
                  accessibilityLabel="Partager ce jeu"
                >
                  <Feather name="share-2" size={20} color="#fff" />
                </PressableScale>
                <PressableScale
                  style={styles.heroAction}
                  onPress={() => setMenu(true)}
                  accessibilityRole="button"
                  accessibilityLabel="Plus d’options"
                >
                  <Feather name="more-horizontal" size={22} color="#fff" />
                </PressableScale>
              </View>
            </View>
            <View style={styles.heroCopy}>
              <View style={styles.eyebrowRow}>
                <Ionicons name="game-controller-outline" size={15} color="#fff" />
                <Text style={styles.heroEyebrow}>JEU VIDÉO</Text>
              </View>
              <Text style={styles.heroTitle} numberOfLines={2}>{game.title}</Text>
              {heroMeta ? <Text style={styles.heroMeta} numberOfLines={1}>{heroMeta}</Text> : null}
            </View>
          </View>

          <View style={styles.body}>
          <View style={styles.identityCard}>
          {posterUri ? (
            <Image source={{ uri: posterUri }} style={styles.poster} resizeMode="cover" accessibilityLabel={'Affiche de ' + game.title} />
          ) : (
            <View style={[styles.poster, styles.posterEmpty]}>
              <Ionicons name="game-controller-outline" size={32} color={COLORS.textSoft} />
            </View>
          )}
          <View style={styles.identityCopy}>
            {/* 1 ligne comme la fiche série : la 2e ligne tomberait en blanc
                sur fond blanc (le bloc chevauche la bannière). */}
            <Text style={styles.title} numberOfLines={2}>{game.title}</Text>
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
              {game.playerScore || game.criticScore ? (
                <View style={styles.scoreRow}>
                  {game.playerScore ? (
                    <View style={styles.scorePill}>
                      <Feather name="users" size={14} color={COLORS.primary} />
                      <View>
                        <Text style={styles.scoreValue}>{game.playerScore}/100</Text>
                        <Text style={styles.scoreLabel}>Joueurs</Text>
                      </View>
                    </View>
                  ) : null}
                  {game.criticScore ? (
                    <View style={styles.scorePill}>
                      <Feather name="award" size={14} color={COLORS.secondary} />
                      <View>
                        <Text style={styles.scoreValue}>{game.criticScore}/100</Text>
                        <Text style={styles.scoreLabel}>Presse</Text>
                      </View>
                    </View>
                  ) : null}
                </View>
              ) : null}
            </View>
          </View>
        </View>

        {/* Suivi REMONTÉ juste sous la jaquette/titre (avant le trailer) :
            bloc COMPACT (demande produit 2026-07-20) — petit titre discret et
            les 4 statuts sur UNE ligne (StatusLine partagée avec show/[id]). */}
        <View style={[styles.section, styles.trackingCard]}>
          <Text style={styles.trackingTitle}>Suivi</Text>
          <StatusLine
            options={GAME_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] }))}
            value={game.userStatus}
            // Re-taper le statut actif le DÉSÉLECTIONNE (retrait du suivi).
            onChange={(v) => (v === null ? removeFromTracking() : changeStatus(v as GameStatus))}
            accessibilityLabel="Statut de suivi du jeu"
            disabled={trackingBusy}
            allowDeselect
          />
          {/* « Je possède » : interrupteur INDÉPENDANT du statut (Game Pass,
              collection…) — même style que les toggles des Paramètres. */}
          <OwnedToggle
            on={game.isOwned}
            disabled={trackingBusy}
            onToggle={changeOwned}
          />
          {/* Temps de jeu : bouton BIEN VISIBLE dès que le jeu est suivi
              (peu importe le statut) — retour Étienne 2026-07-20 : plus besoin
              de re-basculer un statut pour rouvrir la feuille. */}
          {game.userStatus ? (
            <Pressable
              style={({ pressed }) => [styles.playtimeBtn, pressed && styles.playtimeBtnPressed]}
              onPress={() => setPlaytimeOpen(true)}
              accessibilityRole="button"
              accessibilityLabel={
                game.playtimeMinutes
                  ? `Temps de jeu : ${formatPlaytime(game.playtimeMinutes)} — modifier`
                  : 'Déclarer mon temps de jeu'
              }
            >
              <View style={styles.playtimeIcon}>
                <Feather name="clock" size={16} color={COLORS.onAccent} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.playtimeLabel}>Temps de jeu</Text>
                <Text style={styles.playtimeValue} numberOfLines={1}>
                  {game.playtimeMinutes ? formatPlaytime(game.playtimeMinutes) : 'Déclarer mes heures'}
                </Text>
              </View>
              <Feather name="edit-3" size={17} color={COLORS.primary} />
            </Pressable>
          ) : null}
        </View>

        {game.videoId ? <TrailerPreview videoId={game.videoId} /> : null}

        {/* Fiche d'identité complète (Genre/Sortie/Note presse vivent à côté de
            la jaquette) : Plateformes / Développeur / Éditeur / Modes / Temps
            de jeu — l'ancienne section « Informations » est fusionnée ici. */}
        {game.platforms || game.developer || game.publisher || game.gameModes || game.playtimeMinutes || game.userStatus ? (
          <View style={[styles.section, styles.factList]}>
            <View style={styles.sectionHeading}>
              <View style={styles.sectionIcon}>
                <Feather name="info" size={18} color={COLORS.primary} />
              </View>
              <View style={styles.sectionHeadingCopy}>
                <Text style={styles.sectionTitle}>Informations</Text>
              </View>
            </View>
            {game.platforms ? (
              <FactRow icon="monitor" label="Plateformes" value={game.platforms} />
            ) : null}
            {game.developer ? (
              <FactRow icon="code" label="Développeur" value={game.developer} />
            ) : null}
            {game.publisher ? (
              <FactRow icon="briefcase" label="Éditeur" value={game.publisher} />
            ) : null}
            {game.gameModes ? (
              <FactRow icon="users" label="Modes" value={game.gameModes} />
            ) : null}
            {game.userStatus ? (
              // Jeu suivi : le temps de jeu est déclaratif et ÉDITABLE ici.
              <Pressable
                style={({ pressed }) => pressed && { opacity: 0.7 }}
                onPress={() => setPlaytimeOpen(true)}
                accessibilityRole="button"
                accessibilityLabel={
                  game.playtimeMinutes
                    ? `Temps de jeu : ${formatPlaytime(game.playtimeMinutes)} — modifier`
                    : 'Déclarer ton temps de jeu'
                }
              >
                <View style={styles.factRow}>
                  <View style={styles.factIcon}>
                    <Feather name="clock" size={17} color={COLORS.primary} />
                  </View>
                  <View style={styles.factCopy}>
                    <Text style={styles.factLabel}>Temps de jeu</Text>
                    <Text style={styles.fact}>
                      {game.playtimeMinutes ? formatPlaytime(game.playtimeMinutes) : 'Ajouter mes heures'}
                    </Text>
                  </View>
                  <Feather name="edit-3" size={16} color={COLORS.textMuted} />
                </View>
              </Pressable>
            ) : game.playtimeMinutes ? (
              <FactRow icon="clock" label="Temps de jeu" value={formatPlaytime(game.playtimeMinutes)} />
            ) : null}
          </View>
        ) : null}

        {game.overview ? (
          <View style={[styles.section, styles.overviewCard]}>
            <View style={styles.sectionHeading}>
              <View style={styles.sectionIcon}>
                <Feather name="book-open" size={18} color={COLORS.primary} />
              </View>
              <View style={styles.sectionHeadingCopy}>
                <Text style={styles.sectionTitle}>Résumé</Text>
              </View>
            </View>
            <Text style={styles.overview}>{game.overview}</Text>
          </View>
        ) : null}

        <RelatedGamesRow items={game.related ?? []} />

            <CommentsRow mediaId={game.id} title={game.title} />
          </View>
        </View>
      </ScrollView>

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
      <Text style={styles.ownedLabel}>Je possède</Text>
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

function FactRow({
  icon,
  label,
  value,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  value: string;
}) {
  return (
    <View style={styles.factRow}>
      <View style={styles.factIcon}>
        <Feather name={icon} size={17} color={COLORS.primary} />
      </View>
      <View style={styles.factCopy}>
        <Text style={styles.factLabel}>{label}</Text>
        <Text style={styles.fact}>{value}</Text>
      </View>
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
  // Pré-remplit avec la valeur connue à chaque ouverture.
  useEffect(() => {
    if (visible) setValue(currentMinutes ? String(Math.round((currentMinutes / 60) * 10) / 10) : '');
  }, [visible, currentMinutes]);
  const parsed = Number.parseFloat(value.replace(',', '.'));
  const valid = value.trim().length > 0 && Number.isFinite(parsed) && parsed >= 0 && parsed <= 100_000;
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={ptStyles.overlay} onPress={onClose}>
        <Pressable style={ptStyles.card} onPress={(e) => e.stopPropagation()}>
          <View style={ptStyles.iconWrap}>
            <Feather name="clock" size={20} color={COLORS.onAccent} />
          </View>
          <Text style={ptStyles.title}>Temps de jeu</Text>
          <Text style={ptStyles.sub} numberOfLines={3}>
            Combien d’heures as-tu passé sur « {title} » ? C’est déclaratif — tu pourras le corriger à tout moment ici.
          </Text>
          <View style={ptStyles.inputRow}>
            <TextInput
              style={ptStyles.input}
              value={value}
              onChangeText={setValue}
              keyboardType="decimal-pad"
              placeholder="Ex. 25"
              placeholderTextColor={COLORS.textSoft}
              autoFocus
              accessibilityLabel="Nombre d'heures de jeu"
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
          <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="Plus tard">
            <Text style={ptStyles.laterText}>Plus tard</Text>
          </Pressable>
          {currentMinutes ? (
            <Pressable
              onPress={() => onSave(null)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Effacer le temps déclaré"
            >
              <Text style={ptStyles.clearText}>Effacer le temps déclaré</Text>
            </Pressable>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const ptStyles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: COLORS.overlay, alignItems: 'center', justifyContent: 'center', padding: SPACE.lg },
  card: {
    width: '100%',
    maxWidth: 360,
    alignItems: 'center',
    backgroundColor: COLORS.sheet,
    borderRadius: RADIUS.sheet,
    padding: SPACE.lg,
    ...SHADOW.card,
  },
  iconWrap: { width: 46, height: 46, borderRadius: RADIUS.control, backgroundColor: COLORS.yellow, alignItems: 'center', justifyContent: 'center' },
  title: { color: COLORS.text, fontSize: 19, fontFamily: FONTS.extraBold, marginTop: SPACE.sm },
  sub: { color: COLORS.textMuted, fontSize: 13.5, lineHeight: 19, fontFamily: FONTS.regular, textAlign: 'center', marginTop: SPACE.xs },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, marginTop: SPACE.md, alignSelf: 'stretch' },
  input: {
    flex: 1,
    color: COLORS.text,
    backgroundColor: COLORS.surfaceMuted,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: RADIUS.control,
    fontSize: 18,
    fontFamily: FONTS.bold,
    paddingHorizontal: SPACE.sm,
    paddingVertical: 11,
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
    marginTop: SPACE.md,
  },
  saveBtnDisabled: { opacity: 0.4 },
  saveText: { color: COLORS.onPrimary, fontSize: 14, fontFamily: FONTS.extraBold, letterSpacing: 0.5 },
  pressed: { opacity: 0.86, transform: [{ scale: 0.99 }] },
  laterText: { color: COLORS.textMuted, fontSize: 14, fontFamily: FONTS.bold, marginTop: SPACE.md },
  clearText: { color: COLORS.danger, fontSize: 13, fontFamily: FONTS.bold, marginTop: SPACE.sm },
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
    <View style={styles.section}>
      <View style={styles.sectionHeading}>
        <View style={styles.sectionIcon}>
          <Feather name="play-circle" size={18} color={COLORS.primary} />
        </View>
        <View style={styles.sectionHeadingCopy}>
          <Text style={styles.sectionTitle}>Bande-annonce</Text>
          <Text style={styles.sectionSubtitle}>Découvre l’univers du jeu</Text>
        </View>
      </View>
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
    </View>
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
    <View style={[styles.section, styles.relatedSection]}>
      <View style={[styles.sectionHeading, styles.relatedHeading]}>
        <View style={styles.sectionIcon}>
          <Feather name="layers" size={18} color={COLORS.primary} />
        </View>
        <View style={styles.sectionHeadingCopy}>
          <Text style={styles.sectionTitle}>Éditions et extensions</Text>
          <Text style={styles.sectionSubtitle}>Continue l’aventure avec les contenus liés</Text>
        </View>
      </View>
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
                    <Feather name="check" size={16} color={COLORS.onPrimary} />
                  </View>
                ) : null}
                {opening ? (
                  <View style={styles.relBusy} pointerEvents="none">
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
          );
        })}
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
      style={({ pressed }) => [styles.section, styles.commentsRow, pressed && styles.commentsRowPressed]}
      onPress={() =>
        router.push(('/comments/' + mediaId + '?title=' + encodeURIComponent(title) + '&type=game') as Href)
      }
      accessibilityRole="button"
      accessibilityLabel={'Voir les commentaires sur ' + title}
      accessibilityHint="Ouvre la discussion dédiée à ce jeu"
    >
      <View style={styles.commentsCopy}>
        <View style={styles.sectionIcon}>
          <Feather name="message-circle" size={18} color={COLORS.primary} />
        </View>
        <Text style={styles.commentsTitle}>Commentaires</Text>
      </View>
      <View style={styles.commentsArrow}>
        <Feather name="chevron-right" size={21} color={COLORS.primary} />
      </View>
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
    backgroundColor: COLORS.bg,
  },
  hero: {
    width: '100%',
    height: 288,
    backgroundColor: '#160F2A',
    overflow: 'hidden',
  },
  heroFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#3E2678',
  },
  heroPrismOne: {
    position: 'absolute',
    width: 220,
    height: 220,
    borderRadius: 44,
    backgroundColor: 'rgba(239,91,168,0.34)',
    transform: [{ rotate: '28deg' }],
    top: -88,
    right: -34,
  },
  heroPrismTwo: {
    position: 'absolute',
    width: 190,
    height: 190,
    borderRadius: 38,
    backgroundColor: 'rgba(243,197,79,0.27)',
    transform: [{ rotate: '-24deg' }],
    bottom: -98,
    left: -42,
  },
  heroBtns: {
    position: 'absolute',
    left: SPACE.md,
    right: SPACE.md,
    zIndex: 2,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  heroActionGroup: {
    flexDirection: 'row',
    gap: SPACE.xs,
  },
  heroAction: {
    width: SIZES.touch,
    height: SIZES.touch,
    borderRadius: RADIUS.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(20,13,36,0.62)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.28)',
  },
  heroCopy: {
    position: 'absolute',
    left: SPACE.lg,
    right: SPACE.lg,
    bottom: SPACE.xl + SPACE.sm,
  },
  eyebrowRow: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.xs,
    minHeight: 28,
    paddingHorizontal: SPACE.sm,
    borderRadius: RADIUS.pill,
    backgroundColor: 'rgba(109,78,209,0.88)',
  },
  heroEyebrow: {
    color: '#FFFFFF',
    fontFamily: FONTS.extraBold,
    fontSize: 11,
    letterSpacing: 1.1,
  },
  heroTitle: {
    marginTop: SPACE.sm,
    color: '#FFFFFF',
    fontFamily: FONTS.extraBold,
    fontSize: 31,
    lineHeight: 35,
    letterSpacing: -0.5,
  },
  heroMeta: {
    marginTop: SPACE.xs,
    color: 'rgba(255,255,255,0.86)',
    fontFamily: FONTS.semiBold,
    fontSize: 14,
  },
  body: {
    marginTop: -SPACE.xl,
    paddingBottom: SPACE.sm,
  },
  identityCard: {
    minHeight: 174,
    marginHorizontal: SPACE.md,
    marginBottom: SPACE.sm,
    padding: SPACE.sm,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACE.md,
    borderRadius: RADIUS.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.borderLight,
    backgroundColor: COLORS.surface,
    ...SHADOW.card,
  },
  poster: {
    width: 108,
    aspectRatio: 2 / 3,
    borderRadius: RADIUS.poster,
    backgroundColor: COLORS.imagePlaceholder,
  },
  posterEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  identityCopy: {
    flex: 1,
    minWidth: 0,
    paddingVertical: SPACE.xxs,
  },
  title: {
    color: COLORS.text,
    fontFamily: FONTS.extraBold,
    fontSize: 21,
    lineHeight: 25,
  },
  headFacts: {
    marginTop: SPACE.xs,
    gap: SPACE.xxs,
  },
  headFact: {
    color: COLORS.textMuted,
    fontFamily: FONTS.regular,
    fontSize: 12.5,
    lineHeight: 17,
  },
  scoreRow: {
    marginTop: SPACE.xxs,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACE.xs,
  },
  scorePill: {
    minHeight: SIZES.touch,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.xs,
    paddingHorizontal: SPACE.sm,
    paddingVertical: SPACE.xs,
    borderRadius: RADIUS.control,
    backgroundColor: COLORS.surfaceMuted,
  },
  scoreValue: {
    color: COLORS.text,
    fontFamily: FONTS.extraBold,
    fontSize: 13,
  },
  scoreLabel: {
    color: COLORS.textMuted,
    fontFamily: FONTS.regular,
    fontSize: 10.5,
  },
  section: {
    marginHorizontal: SPACE.md,
    marginBottom: SPACE.sm,
    padding: SPACE.md,
    borderRadius: RADIUS.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.borderLight,
    backgroundColor: COLORS.surface,
    ...SHADOW.card,
  },
  trackingCard: {
    overflow: 'hidden',
  },
  overviewCard: {
    paddingBottom: SPACE.lg,
  },
  sectionHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.sm,
    marginBottom: SPACE.md,
  },
  sectionHeadingCopy: {
    flex: 1,
    minWidth: 0,
  },
  sectionIcon: {
    width: SIZES.touch,
    height: SIZES.touch,
    borderRadius: RADIUS.control,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primarySoft,
  },
  sectionTitle: {
    color: COLORS.text,
    fontFamily: FONTS.extraBold,
    fontSize: 18,
    lineHeight: 22,
  },
  sectionSubtitle: {
    marginTop: 2,
    color: COLORS.textMuted,
    fontFamily: FONTS.regular,
    fontSize: 12.5,
    lineHeight: 17,
  },
  // Petit titre discret du bloc suivi compact.
  trackingTitle: {
    color: COLORS.textMuted,
    fontFamily: FONTS.bold,
    fontSize: 13,
    lineHeight: 17,
    marginBottom: SPACE.xs,
  },
  controlDisabled: {
    opacity: 0.48,
  },
  // « Je possède » compact : une seule ligne label + interrupteur.
  ownedRow: {
    minHeight: SIZES.touch,
    marginTop: SPACE.sm,
    paddingTop: SPACE.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.borderLight,
  },
  ownedLabel: {
    flex: 1,
    minWidth: 0,
    color: COLORS.text,
    fontFamily: FONTS.bold,
    fontSize: 14,
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
  factList: {
    gap: SPACE.xs,
  },
  // Bouton « Temps de jeu » du bloc suivi (visible dès que le jeu est suivi).
  playtimeBtn: {
    minHeight: SIZES.touchComfortable,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.sm,
    marginTop: SPACE.sm,
    paddingHorizontal: SPACE.sm,
    paddingVertical: SPACE.xs,
    borderRadius: RADIUS.control,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    backgroundColor: COLORS.surfaceMuted,
  },
  playtimeBtnPressed: { opacity: 0.75 },
  playtimeIcon: {
    width: 32, height: 32, borderRadius: RADIUS.pill, backgroundColor: COLORS.yellow,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  playtimeLabel: { color: COLORS.textMuted, fontSize: 11.5, fontFamily: FONTS.bold, letterSpacing: 0.3, textTransform: 'uppercase' },
  playtimeValue: { color: COLORS.text, fontSize: 15, fontFamily: FONTS.bold, marginTop: 1 },
  factRow: {
    minHeight: 52,
    paddingVertical: SPACE.xs,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.borderLight,
  },
  factIcon: {
    width: 36,
    height: 36,
    borderRadius: RADIUS.control,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primarySoft,
  },
  factCopy: {
    flex: 1,
    minWidth: 0,
  },
  fact: {
    marginTop: 1,
    color: COLORS.textMuted,
    fontFamily: FONTS.regular,
    fontSize: 14,
    lineHeight: 19,
  },
  factLabel: {
    color: COLORS.text,
    fontFamily: FONTS.bold,
    fontSize: 12.5,
  },
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
  relatedSection: {
    paddingHorizontal: 0,
    paddingBottom: SPACE.md,
    overflow: 'hidden',
  },
  relatedHeading: {
    paddingHorizontal: SPACE.md,
  },
  relatedContent: {
    gap: SPACE.sm,
    paddingHorizontal: SPACE.md,
    paddingBottom: SPACE.xxs,
  },
  relCard: {
    width: 152,
    overflow: 'hidden',
    borderRadius: RADIUS.poster,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surfaceMuted,
  },
  relCover: {
    width: 150,
    height: 200,
    overflow: 'hidden',
    backgroundColor: COLORS.imagePlaceholder,
  },
  relCoverEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  relBadge: {
    position: 'absolute',
    top: SPACE.xs,
    right: SPACE.xs,
    width: 32,
    height: 32,
    borderRadius: RADIUS.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary,
    ...SHADOW.card,
  },
  relBusy: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(12,7,28,0.48)',
  },
  relCap: {
    minHeight: 72,
    paddingHorizontal: SPACE.sm,
    paddingVertical: SPACE.xs,
  },
  relName: {
    color: COLORS.text,
    fontFamily: FONTS.bold,
    fontSize: 13.5,
    lineHeight: 18,
  },
  relKind: {
    marginTop: SPACE.xxs,
    color: COLORS.textMuted,
    fontFamily: FONTS.regular,
    fontSize: 11.5,
  },
  commentsRow: {
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  commentsRowPressed: {
    opacity: 0.78,
  },
  commentsCopy: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.sm,
  },
  commentsTitle: {
    color: COLORS.text,
    fontFamily: FONTS.extraBold,
    fontSize: 17,
  },
  commentsArrow: {
    width: SIZES.touch,
    height: SIZES.touch,
    borderRadius: RADIUS.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primarySoft,
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
