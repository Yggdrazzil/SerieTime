import React, { useRef, useState } from 'react';
import { View, Text, StyleSheet, Image, Pressable, Platform } from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter, type Href } from 'expo-router';
import { api, tmdbImage } from '@/lib/api';
import { COLORS, FONTS, RADIUS, SPACE } from '@/lib/theme';
import { shareMedia } from '@/lib/share';
import { ActionRail, type RailState } from './ActionRail';
import { DescriptionOverlay } from './DescriptionOverlay';
import type { FeedItem } from './types';

export function TikTokCard({
  item,
  height,
  resolveMedia,
  onOpenComments,
  onAdvance,
  onInvalidateLibrary,
  onDetailToggle,
  commentBump = 0,
}: {
  item: FeedItem;
  height: number;
  resolveMedia: (item: FeedItem) => Promise<string>;
  onOpenComments: (item: FeedItem) => void;
  // Passe à la carte suivante — appelé dès qu'une action « traite » la
  // proposition (❤️ à voir, 👁 déjà vu, 👎 pas intéressé), façon TikTok.
  onAdvance: () => void;
  onInvalidateLibrary: () => void;
  // Prévient le flux quand l'overlay détails s'ouvre/ferme (il masque alors la
  // barre « Ajouter un commentaire » qui recouvrait le texte de l'overlay).
  onDetailToggle?: (open: boolean) => void;
  // Incrément du compteur de commentaires (commentaires publiés depuis la sheet
  // pour cette carte) — le flux le fait remonter, la carte l'ajoute au total serveur.
  commentBump?: number;
}) {
  const router = useRouter();
  const [detail, setDetail] = useState(false);
  // Une action réseau à la fois par carte : un double-tap rapide sur ❤️/👁 (ou
  // ❤️ puis 👁 pendant l'appel) déclenchait deux mutations concurrentes → états
  // et compteurs incohérents, impressions de « rollback ».
  const actionPending = useRef(false);
  // État optimiste local, initialisé depuis les stats serveur.
  const [state, setState] = useState<RailState>({
    liked: item.me?.liked ?? false,
    watched: item.me?.watched ?? false,
    likes: item.stats?.likes ?? 0,
    watchedCount: item.stats?.watched ?? 0,
    comments: item.stats?.comments ?? 0,
  });

  // Portrait plein écran : l'AFFICHE (poster) est cadrée pour ce format, en haute
  // résolution et affichée ENTIÈRE (contain → aucun rognage). Un fond flouté
  // (backdrop, sinon l'affiche) remplit l'écran derrière pour l'immersion.
  const isGame = Boolean(item.igdbId);
  // w780 suffit largement pour un écran de téléphone (l'« original » TMDb fait
  // plusieurs Mo → 3-4 s de carte noire au chargement). Le fond est flouté à
  // 30px : w300 est indiscernable et quasi instantané.
  const poster = tmdbImage(item.posterPath, 'w780') ?? tmdbImage(item.backdropPath, 'w1280');
  const bg = tmdbImage(item.backdropPath, 'w300') ?? tmdbImage(item.posterPath, 'w300');
  const kind = isGame ? 'Jeu' : item.category === 'anime' ? 'Animé' : item.type === 'show' ? 'Série' : 'Film';
  const meta = item.year ? String(item.year) : 'Date à confirmer';

  // Ouvre/ferme l'overlay de détails (utilisé par le tap plein écran ET par le
  // libellé « Touchez pour déplier » — qui, dans la légende `box-none`,
  // interceptait le tap sans le transmettre au Pressable de fond : zone morte).
  const toggleDetail = () =>
    setDetail((d) => {
      onDetailToggle?.(!d);
      return !d;
    });

  const openFiche = async (f: FeedItem) => {
    try {
      const id = await resolveMedia(f);
      router.push((f.igdbId ? `/game/${id}` : `/show/${id}${f.type === 'movie' ? '?type=movie' : ''}`) as Href);
    } catch {
      /* best-effort */
    }
  };

  // Like = « À voir » (watchlist), vrai TOGGLE réversible. Le retrait « untrack »
  // est sûr ici : le flux exclut déjà les œuvres en bibliothèque, donc l'item ne
  // porte que l'état posé dans cette session. Statut unique côté serveur : passer
  // en « à voir » annule un éventuel « déjà vu ». Optimiste avec rollback.
  const onLike = async () => {
    if (actionPending.current) return;
    actionPending.current = true;
    const prev = state;
    const wasLiked = prev.liked;
    setState({
      ...prev,
      liked: !wasLiked,
      likes: prev.likes + (wasLiked ? -1 : 1),
      watched: wasLiked ? prev.watched : false,
      watchedCount: prev.watchedCount - (!wasLiked && prev.watched ? 1 : 0),
    });
    // Proposition traitée → carte suivante tout de suite (la requête continue
    // en arrière-plan). Un dé-like (toggle off) ne fait pas avancer.
    if (!wasLiked) onAdvance();
    try {
      const id = await resolveMedia(item);
      if (wasLiked) {
        await api.del(
          isGame ? `/api/games/${id}/tracking` : item.type === 'movie' ? `/api/movies/${id}/tracking` : `/api/shows/${id}/tracking`,
        );
      } else if (isGame) {
        await api.post(`/api/games/${id}/status`, { status: 'wishlist' });
      } else {
        await api.post(item.type === 'movie' ? `/api/movies/${id}/watchlist` : `/api/shows/${id}/watchlater`);
      }
      onInvalidateLibrary();
    } catch {
      setState(prev);
    } finally {
      actionPending.current = false;
    }
  };

  // Déjà vu = « vu » (completed), vrai TOGGLE réversible. Passer en « déjà vu »
  // annule un éventuel « à voir » ; untrack pour dé-marquer.
  const onWatched = async () => {
    if (actionPending.current) return;
    actionPending.current = true;
    const prev = state;
    const wasWatched = prev.watched;
    setState({
      ...prev,
      watched: !wasWatched,
      watchedCount: prev.watchedCount + (wasWatched ? -1 : 1),
      liked: wasWatched ? prev.liked : false,
      likes: prev.likes - (!wasWatched && prev.liked ? 1 : 0),
    });
    if (!wasWatched) onAdvance();
    try {
      const id = await resolveMedia(item);
      if (wasWatched) {
        await api.del(
          isGame ? `/api/games/${id}/tracking` : item.type === 'movie' ? `/api/movies/${id}/tracking` : `/api/shows/${id}/tracking`,
        );
      } else if (isGame) {
        await api.post(`/api/games/${id}/status`, { status: 'completed' });
      } else if (item.type === 'movie') {
        await api.post(`/api/movies/${id}/watched`, {});
      } else {
        await api.post(`/api/shows/${id}/mark-all-watched`, {});
        await api.post(`/api/shows/${id}/status`, { status: 'completed' });
      }
      onInvalidateLibrary();
    } catch {
      setState(prev);
    } finally {
      actionPending.current = false;
    }
  };

  const onDislike = () => {
    if (actionPending.current) return;
    actionPending.current = true;
    onAdvance(); // carte suivante immédiatement, la requête part en arrière-plan
    void (async () => {
      try {
        const id = await resolveMedia(item);
        await api.post(`/api/disliked/${id}`, { hidden: true });
      } catch {
        /* best-effort */
      } finally {
        actionPending.current = false;
      }
    })();
  };

  return (
    <View style={[styles.card, { height }]}>
      {/* Fond flouté plein écran (immersion, cache l'upscale). Blur natif via
          blurRadius ; sur le web react-native-web ignore blurRadius → filtre CSS. */}
      {bg ? (
        <Image
          source={{ uri: bg }}
          style={[
            StyleSheet.absoluteFill,
            Platform.OS === 'web' ? ({ filter: 'blur(30px)', transform: [{ scale: 1.15 }] } as never) : null,
          ]}
          resizeMode="cover"
          blurRadius={Platform.OS === 'web' ? 0 : 30}
          accessible={false}
        />
      ) : null}
      <View style={styles.bgDim} pointerEvents="none" />
      <View style={styles.prismPrimary} pointerEvents="none" />
      <View style={styles.prismSecondary} pointerEvents="none" />
      {/* L'affiche reste entière, mais vit désormais dans un cadre Prisme distinct. */}
      <View style={styles.artFrame} pointerEvents="none">
        {poster ? (
          <Image source={{ uri: poster }} style={StyleSheet.absoluteFill} resizeMode="contain" accessible={false} />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.noImg]}>
            <Feather name="image" size={48} color="rgba(255,255,255,0.5)" />
          </View>
        )}
      </View>
      {/* Scrims en DÉGRADÉ : les blocs unis créaient une bande grise à bord net
          sur les fonds clairs (limite du flou). */}
      <LinearGradient
        colors={['rgba(0,0,0,0.55)', 'rgba(0,0,0,0)']}
        style={styles.scrimTop}
        pointerEvents="none"
      />
      <LinearGradient
        colors={['rgba(0,0,0,0)', 'rgba(7,4,12,0.82)']}
        style={styles.scrimBottom}
        pointerEvents="none"
      />

      {/* Zone tap = ouvre/ferme l'overlay de description. */}
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={toggleDetail}
        accessibilityRole="button"
        accessibilityLabel={`Afficher les détails de ${item.title}`}
        accessibilityHint="Ouvre le résumé et les informations complémentaires"
        accessibilityState={{ expanded: detail }}
      />

      <View style={styles.caption} pointerEvents="box-none">
        <View style={styles.kindBadge}>
          {isGame ? (
            <Ionicons name="game-controller" size={13} color={COLORS.onPrimary} />
          ) : (
            <Feather name={item.type === 'show' ? 'tv' : 'film'} size={13} color={COLORS.onPrimary} />
          )}
          <Text style={styles.kindText}>{kind.toLocaleUpperCase('fr-FR')}</Text>
        </View>

        <Text accessibilityRole="header" style={styles.title} numberOfLines={2}>
          {item.title}
        </Text>

        <View style={styles.metaRow}>
          <Text style={styles.meta}>{meta}</Text>
          {typeof item.voteAverage === 'number' && item.voteAverage > 0 ? (
            <View style={styles.ratingPill}>
              <Feather name="star" size={12} color={COLORS.tertiary} />
              <Text style={styles.ratingText}>{item.voteAverage.toFixed(1).replace('.', ',')}</Text>
            </View>
          ) : null}
        </View>

        {item.overview ? (
          <Text style={styles.overview} numberOfLines={2}>
            {item.overview}
          </Text>
        ) : null}
        {/* Bouton à part entière (et non simple texte dans la légende `box-none`,
            qui créait une zone morte pile sur l'invite) : cible confortable
            grâce au hitSlop. */}
        <Pressable
          style={({ pressed }) => [styles.hintRow, pressed && styles.hintRowPressed]}
          onPress={toggleDetail}
          hitSlop={{ top: 12, bottom: 14, left: 16, right: 24 }}
          accessibilityRole="button"
          accessibilityLabel={`Afficher les détails de ${item.title}`}
          accessibilityState={{ expanded: detail }}
        >
          <Feather name="chevron-up" size={13} color="rgba(255,255,255,0.72)" />
          <Text style={styles.hint}>Touchez pour déplier les détails</Text>
        </Pressable>
      </View>

      <ActionRail
        item={item}
        state={{ ...state, comments: (item.stats?.comments ?? 0) + commentBump }}
        isGame={isGame}
        onLike={onLike}
        onDislike={onDislike}
        onWatched={onWatched}
        onComment={() => onOpenComments(item)}
        onShare={() => shareMedia(item.title)}
        onFiche={() => openFiche(item)}
      />

      <DescriptionOverlay
        item={item}
        visible={detail}
        onClose={() => {
          setDetail(false);
          onDetailToggle?.(false);
        }}
        onOpenFiche={openFiche}
        resolveMedia={resolveMedia}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '100%',
    justifyContent: 'flex-end',
    overflow: 'hidden',
    backgroundColor: '#0D0A14',
  },
  noImg: { alignItems: 'center', justifyContent: 'center' },
  bgDim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(7,4,12,0.56)',
  },
  prismPrimary: {
    position: 'absolute',
    top: 96,
    left: -48,
    width: 150,
    height: 150,
    backgroundColor: COLORS.primary,
    borderRadius: 34,
    opacity: 0.3,
    transform: [{ rotate: '24deg' }],
  },
  prismSecondary: {
    position: 'absolute',
    right: -46,
    bottom: 82,
    width: 138,
    height: 138,
    backgroundColor: COLORS.secondary,
    borderRadius: 69,
    opacity: 0.22,
  },
  artFrame: {
    position: 'absolute',
    top: 70,
    left: SPACE.sm,
    right: SPACE.sm,
    bottom: SPACE.sm,
    overflow: 'hidden',
    backgroundColor: 'rgba(7,4,12,0.34)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    borderRadius: RADIUS.sheet,
  },
  scrimTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 180,
  },
  scrimBottom: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 340,
  },
  caption: {
    position: 'absolute',
    left: 20,
    right: 92,
    // Au-dessus de la tab bar flottante (même repère que le rail d'actions).
    bottom: 108,
  },
  kindBadge: {
    minHeight: 28,
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 5,
    paddingHorizontal: 10,
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.pill,
  },
  kindText: {
    color: COLORS.onPrimary,
    fontFamily: FONTS.extraBold,
    fontSize: 10.5,
    letterSpacing: 0.65,
  },
  title: {
    flexShrink: 1,
    marginTop: SPACE.xs,
    color: '#FFFFFF',
    fontSize: 25,
    lineHeight: 30,
    fontFamily: FONTS.extraBold,
    textShadowColor: 'rgba(0,0,0,0.52)',
    textShadowRadius: 8,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.xs,
    marginTop: 6,
  },
  meta: {
    color: 'rgba(255,255,255,0.86)',
    fontFamily: FONTS.bold,
    fontSize: 13.5,
  },
  ratingPill: {
    minHeight: 26,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    backgroundColor: 'rgba(7,4,12,0.68)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.24)',
    borderRadius: RADIUS.pill,
  },
  ratingText: { color: '#FFFFFF', fontFamily: FONTS.extraBold, fontSize: 12 },
  overview: {
    marginTop: SPACE.xs,
    color: 'rgba(255,255,255,0.94)',
    fontFamily: FONTS.regular,
    fontSize: 14.5,
    lineHeight: 20,
    textShadowColor: 'rgba(0,0,0,0.58)',
    textShadowRadius: 6,
  },
  hintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    marginTop: SPACE.xs,
    // Petit padding vertical : élargit la cible tactile réelle du bouton.
    paddingVertical: 4,
  },
  hintRowPressed: { opacity: 0.6 },
  hint: {
    color: 'rgba(255,255,255,0.72)',
    fontFamily: FONTS.semiBold,
    fontSize: 11.5,
  },
});
