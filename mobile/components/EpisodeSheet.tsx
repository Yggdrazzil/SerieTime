import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, Pressable, Modal, Image, Animated,
  Dimensions, Share, Platform, useWindowDimensions,
} from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, tmdbImage } from '@/lib/api';
import type { EpisodeDto } from '@/lib/types';
import { episodeCode } from '@/lib/format';
import { COLORS, FONTS } from '@/lib/theme';
import { CheckCircle } from '@/components/ui';
import { Stars } from '@/components/Stars';
import { MarkPreviousPopup, hasUnwatchedPrevious } from '@/components/MarkPreviousPopup';
import { useReduceMotion } from '@/lib/useReduceMotion';

// Fenêtre « fiche épisode » (copie TV Time) ouverte depuis les cartes de
// l'onglet Séries : chevron ↓ + points de pagination, image de l'épisode
// (pastille série → fiche, partage), date + Vu/Pas vu + coche, Où regarder,
// note de la communauté + synopsis, rangée Commentaires. Swipe latéral pour
// passer d'un épisode au suivant (points façon TV Time, fenêtre de 5).

export type EpisodeSheetTarget = {
  mediaId: string;
  mediaTitle: string;
  posterPath?: string | null;
  episode: EpisodeDto;
};

type SeasonData = { seasonNumber: number; episodes: EpisodeDto[] };
type EpisodesData = { seasons: SeasonData[]; nextEpisode: EpisodeDto | null };

const isAired = (e: EpisodeDto) => !e.airDate || new Date(e.airDate).getTime() <= Date.now();
const dateFr = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : null;

export function EpisodeSheet({ target, onClose }: { target: EpisodeSheetTarget | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const reduce = useReduceMotion();
  const { width } = useWindowDimensions();
  const [index, setIndex] = useState(0);
  const pagerRef = useRef<ScrollView>(null);
  const alignedFor = useRef<string | null>(null);

  // Apparition : fond qui s'assombrit + panneau qui remonte en ressort.
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!target) return;
    if (reduce) { anim.setValue(1); return; }
    anim.setValue(0);
    Animated.spring(anim, { toValue: 1, useNativeDriver: Platform.OS !== 'web', friction: 10, tension: 70 }).start();
  }, [target, reduce, anim]);
  const close = () => {
    if (reduce) { onClose(); return; }
    Animated.timing(anim, { toValue: 0, duration: 180, useNativeDriver: Platform.OS !== 'web' }).start(() => onClose());
  };

  // Tous les épisodes DIFFUSÉS de la série (même cache que la fiche) : saisons
  // régulières puis spéciaux — ce sont les pages du swipe latéral.
  const episodesQ = useQuery({
    queryKey: ['show', target?.mediaId, 'episodes'],
    queryFn: () => api.get<EpisodesData>(`/api/shows/${target!.mediaId}/episodes`),
    enabled: !!target,
  });
  const pages: EpisodeDto[] = useMemo(() => {
    if (!target) return [];
    const seasons = episodesQ.data?.seasons;
    if (!seasons) return [target.episode];
    const sorted = [...seasons].sort((a, b) => {
      const sa = a.seasonNumber === 0 ? 1 : 0;
      const sb = b.seasonNumber === 0 ? 1 : 0;
      return sa - sb || a.seasonNumber - b.seasonNumber;
    });
    const list = sorted.flatMap((s) => s.episodes.filter(isAired));
    return list.length > 0 ? list : [target.episode];
  }, [episodesQ.data, target]);

  // À l'ouverture (puis quand les pages complètes arrivent) : se caler sur
  // l'épisode tapé, sans animation.
  useEffect(() => {
    if (!target) { alignedFor.current = null; return; }
    const key = `${target.episode.id}-${pages.length}`;
    if (alignedFor.current === key) return;
    alignedFor.current = key;
    const idx = Math.max(0, pages.findIndex((e) => e.id === target.episode.id));
    setIndex(idx);
    requestAnimationFrame(() => pagerRef.current?.scrollTo({ x: idx * width, animated: false }));
  }, [target, pages, width]);

  if (!target) return null;
  const ep = pages[Math.min(index, pages.length - 1)] ?? target.episode;

  return (
    <Modal visible transparent animationType="none" onRequestClose={close}>
      <Animated.View style={[styles.backdrop, { opacity: anim }]} />
      <Animated.View
        style={[
          styles.panel,
          { marginTop: insets.top + 6 },
          { transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [Dimensions.get('window').height, 0] }) }] },
        ]}
      >
        {/* Barre : chevron ↓ à gauche, points de pagination centrés (fenêtre de 5). */}
        <View style={styles.topBar}>
          <Pressable onPress={close} hitSlop={12} style={styles.closeBtn} accessibilityLabel="Fermer">
            <Feather name="chevron-down" size={30} color={COLORS.black} />
          </Pressable>
          <View style={styles.dotsWrap} pointerEvents="none">
            <Dots total={pages.length} index={index} />
          </View>
          <View style={styles.closeBtn} />
        </View>

        <ScrollView
          ref={pagerRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onScroll={(e) => {
            const i = Math.round(e.nativeEvent.contentOffset.x / width);
            if (i !== index && i >= 0 && i < pages.length) setIndex(i);
          }}
          scrollEventThrottle={16}
        >
          {pages.map((e) => (
            <View key={e.id} style={{ width }}>
              <EpisodePage
                episode={e}
                mediaId={target.mediaId}
                mediaTitle={target.mediaTitle}
                posterPath={target.posterPath}
                seasons={episodesQ.data?.seasons ?? []}
                onClose={onClose}
                bottomPad={insets.bottom + 24}
              />
            </View>
          ))}
        </ScrollView>
      </Animated.View>
    </Modal>
  );
}

// Points de pagination façon TV Time : fenêtre glissante de 5, point actif jaune.
function Dots({ total, index }: { total: number; index: number }) {
  if (total <= 1) return null;
  const size = Math.min(5, total);
  const start = Math.min(Math.max(0, index - 2), total - size);
  return (
    <View style={styles.dotsRow}>
      {Array.from({ length: size }, (_, i) => {
        const active = start + i === index;
        return <View key={i} style={[styles.dot, active && styles.dotOn]} />;
      })}
    </View>
  );
}

// Une page épisode : blocs blancs sur fond gris. Cotes HARMONISÉES avec le
// reste de l'app (cartes de l'onglet Séries : code 17-22, corps 13-14,
// titres de section 16) — les tailles lues sur les captures TV Time brutes
// rendaient « énormes » à l'écran (retour utilisateur récurrent).
function EpisodePage({
  episode, mediaId, mediaTitle, posterPath, seasons, onClose, bottomPad,
}: {
  episode: EpisodeDto;
  mediaId: string;
  mediaTitle: string;
  posterPath?: string | null;
  seasons: SeasonData[];
  onClose: () => void;
  bottomPad: number;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  // Pop-up « Cocher aussi les épisodes précédents ? » (si non vus avant celui-ci).
  const [askPrev, setAskPrev] = useState(false);

  // Plateformes : même cache que la fiche série (chargée en arrière-plan).
  const detail = useQuery({
    queryKey: ['show', mediaId],
    queryFn: () => api.get<{ providers: { name: string }[] }>(`/api/shows/${mediaId}`),
    staleTime: 5 * 60_000,
  });
  // Note de la communauté (moyenne des notes de cet épisode, sur 5).
  const ratings = useQuery({
    queryKey: ['community-ratings', mediaId],
    queryFn: () =>
      api.get<{ seasons: { seasonNumber: number; points: { episodeNumber: number; avg: number }[] }[] }>(
        `/api/shows/${mediaId}/community-ratings`,
      ),
    retry: false,
  });
  const comments = useQuery({
    queryKey: ['comments', mediaId],
    queryFn: () => api.get<{ comments: { replies?: unknown[] }[] }>(`/api/media/${mediaId}/comments`),
  });

  // Coche « vu » OPTIMISTE : bascule immédiate dans le cache des épisodes ;
  // la file « À voir » derrière est réconciliée en arrière-plan.
  const toggle = useMutation({
    mutationFn: (e: EpisodeDto) => api.post(`/api/episodes/${e.id}/${e.watched ? 'unwatched' : 'watched'}`),
    onMutate: async (e: EpisodeDto) => {
      await qc.cancelQueries({ queryKey: ['show', mediaId, 'episodes'] });
      const prev = qc.getQueryData<EpisodesData>(['show', mediaId, 'episodes']);
      if (prev) {
        qc.setQueryData<EpisodesData>(['show', mediaId, 'episodes'], {
          ...prev,
          seasons: prev.seasons.map((s) =>
            s.seasonNumber !== e.seasonNumber
              ? s
              : { ...s, episodes: s.episodes.map((x) => (x.id === e.id ? { ...x, watched: !e.watched } : x)) },
          ),
        });
      }
      return { prev };
    },
    onError: (_e: unknown, _v: EpisodeDto, ctx?: { prev?: EpisodesData }) => {
      if (ctx?.prev) qc.setQueryData(['show', mediaId, 'episodes'], ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['shows'] });
      qc.invalidateQueries({ queryKey: ['show', mediaId, 'episodes'] });
      qc.invalidateQueries({ queryKey: ['profile'] });
      qc.invalidateQueries({ queryKey: ['gamification'] }); // XP/badges/streak (spec 2026-07-16 §10)
    },
  });
  // OUI de la pop-up : coche tous les épisodes diffusés avant celui-ci
  // (saisons antérieures comprises, spéciaux exclus).
  const markPrevious = useMutation({
    mutationFn: () => api.post(`/api/episodes/${episode.id}/watched-previous`),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: ['show', mediaId, 'episodes'] });
      const prev = qc.getQueryData<EpisodesData>(['show', mediaId, 'episodes']);
      if (prev) {
        const isBefore = (e: EpisodeDto) =>
          e.seasonNumber < episode.seasonNumber ||
          (e.seasonNumber === episode.seasonNumber && e.episodeNumber < episode.episodeNumber);
        qc.setQueryData<EpisodesData>(['show', mediaId, 'episodes'], {
          ...prev,
          seasons: prev.seasons.map((s) =>
            s.seasonNumber <= 0
              ? s
              : { ...s, episodes: s.episodes.map((e) => (!e.watched && isBefore(e) && isAired(e) ? { ...e, watched: true } : e)) },
          ),
        });
      }
      return { prev };
    },
    onError: (_e: unknown, _v: void, ctx?: { prev?: EpisodesData }) => {
      if (ctx?.prev) qc.setQueryData(['show', mediaId, 'episodes'], ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['shows'] });
      qc.invalidateQueries({ queryKey: ['show', mediaId, 'episodes'] });
      qc.invalidateQueries({ queryKey: ['profile'] });
      qc.invalidateQueries({ queryKey: ['gamification'] }); // XP/badges/streak (spec 2026-07-16 §10)
    },
  });
  const pressCheck = () => {
    if (!episode.watched && hasUnwatchedPrevious(seasons, episode)) setAskPrev(true);
    toggle.mutate(episode);
  };

  const share = () => {
    const message = `« ${mediaTitle} » ${episodeCode(episode.seasonNumber, episode.episodeNumber)} — suivi avec SerieTime 📺`;
    if (Platform.OS === 'web') {
      const nav = typeof navigator !== 'undefined' ? (navigator as Navigator & { share?: (d: object) => Promise<void> }) : undefined;
      if (nav?.share) nav.share({ text: message }).catch(() => undefined);
      else nav?.clipboard?.writeText(message).catch(() => undefined);
      return;
    }
    Share.share({ message }).catch(() => undefined);
  };
  const openShow = () => {
    onClose();
    router.push(`/show/${mediaId}`);
  };

  const hero = tmdbImage(episode.stillPath, 'w780') ?? tmdbImage(posterPath, 'w500');
  const providers = detail.data?.providers ?? [];
  const avg = ratings.data?.seasons
    .find((s) => s.seasonNumber === episode.seasonNumber)
    ?.points.find((p) => p.episodeNumber === episode.episodeNumber)?.avg;
  const commentsTotal = (comments.data?.comments ?? []).reduce((n, c) => n + 1 + (c.replies?.length ?? 0), 0);

  return (
    <ScrollView style={{ backgroundColor: COLORS.pageMuted }} contentContainerStyle={{ paddingBottom: bottomPad }}>
      {/* Bloc image + date/vu/coche. */}
      <View style={styles.block}>
        <View style={styles.hero}>
          {hero ? (
            <Image source={{ uri: hero }} style={StyleSheet.absoluteFill} resizeMode="cover" />
          ) : (
            <View style={[StyleSheet.absoluteFill, styles.heroEmpty]}>
              <Feather name="image" size={34} color="#9a9a9a" />
            </View>
          )}
          <View style={styles.heroShade} />
          <View style={styles.heroTop}>
            <Pressable style={styles.seriesPill} onPress={openShow} hitSlop={6}>
              <Text style={styles.seriesPillText} numberOfLines={1}>{mediaTitle.toUpperCase()}</Text>
              <Feather name="chevron-right" size={12} color="#fff" />
            </Pressable>
            <Pressable onPress={share} hitSlop={10} accessibilityLabel="Partager">
              <Feather name="share" size={22} color="#fff" />
            </Pressable>
          </View>
          <View style={styles.heroCap}>
            <Text style={styles.heroCode}>{episodeCode(episode.seasonNumber, episode.episodeNumber)}</Text>
            {episode.title ? <Text style={styles.heroEpTitle} numberOfLines={1}>{episode.title}</Text> : null}
          </View>
        </View>
        <View style={styles.metaRow}>
          {episode.airDate ? (
            <View style={styles.metaItem}>
              <Feather name="calendar" size={16} color={COLORS.black} />
              <Text style={styles.metaText}>{dateFr(episode.airDate)}</Text>
            </View>
          ) : null}
          <View style={styles.metaItem}>
            <Ionicons name={episode.watched ? 'eye' : 'eye-outline'} size={18} color={COLORS.black} />
            <Text style={styles.metaText}>{episode.watched ? 'Vu' : 'Pas vu'}</Text>
          </View>
          <View style={{ flex: 1 }} />
          <CheckCircle size={40} checked={episode.watched} onPress={pressCheck} />
        </View>
      </View>

      {/* Où regarder. */}
      <View style={styles.block}>
        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>Où regarder</Text>
          <Feather name="settings" size={18} color={COLORS.black} />
        </View>
        {providers.length === 0 ? (
          <Text style={styles.muted}>{detail.isLoading ? 'Chargement…' : 'Non disponible'}</Text>
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

      {/* Informations sur l'épisode : note communauté + synopsis. */}
      {typeof avg === 'number' || episode.overview ? (
        <View style={styles.block}>
          <Text style={styles.sectionTitle}>Informations sur l'épisode</Text>
          {typeof avg === 'number' ? <Stars rating10={avg * 2} size={17} /> : null}
          {episode.overview ? <Text style={styles.overview}>{episode.overview}</Text> : null}
        </View>
      ) : null}

      {/* Commentaires (page dédiée de la série). */}
      <Pressable
        style={[styles.block, styles.commentsRow]}
        onPress={() => {
          onClose();
          router.push(`/comments/${mediaId}?title=${encodeURIComponent(mediaTitle)}`);
        }}
      >
        <Text style={styles.sectionTitle}>Commentaires</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={styles.commentsCount}>{commentsTotal}</Text>
          <Feather name="chevron-right" size={20} color={COLORS.black} />
        </View>
      </Pressable>

      <MarkPreviousPopup
        visible={askPrev}
        onYes={() => { setAskPrev(false); markPrevious.mutate(); }}
        onNo={() => setAskPrev(false)}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.6)' },
  panel: { flex: 1, backgroundColor: COLORS.white, borderTopLeftRadius: 18, borderTopRightRadius: 18, overflow: 'hidden' },
  topBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 10, backgroundColor: COLORS.white },
  closeBtn: { width: 46, height: 40, alignItems: 'center', justifyContent: 'center' },
  dotsWrap: { flex: 1, alignItems: 'center' },
  dotsRow: { flexDirection: 'row', gap: 9 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.chipSelected },
  dotOn: { backgroundColor: COLORS.yellow },
  block: { backgroundColor: COLORS.white, marginHorizontal: 12, marginBottom: 10, borderRadius: 12, overflow: 'hidden', padding: 14 },
  // Les marges négatives compensent le padding du bloc (image bord à bord).
  hero: { aspectRatio: 16 / 9, marginHorizontal: -14, marginTop: -14, backgroundColor: '#1a1a22', justifyContent: 'flex-end' },
  heroEmpty: { alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.imagePlaceholder },
  heroShade: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.28)' },
  heroTop: { position: 'absolute', top: 12, left: 14, right: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  seriesPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1.5, borderColor: '#fff',
    borderRadius: 999, paddingHorizontal: 12, paddingVertical: 3, flexShrink: 1,
  },
  seriesPillText: { color: '#fff', fontSize: 11, fontFamily: FONTS.bold, letterSpacing: 0.6, flexShrink: 1 },
  heroCap: { padding: 12 },
  heroCode: { color: '#fff', fontSize: 22, fontFamily: FONTS.extraBold },
  heroEpTitle: { color: 'rgba(255,255,255,0.95)', fontSize: 13, fontFamily: FONTS.regular, marginTop: 1 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 20, paddingTop: 12 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  metaText: { color: COLORS.text, fontSize: 14, fontFamily: FONTS.regular },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { color: COLORS.text, fontSize: 16, fontFamily: FONTS.extraBold },
  muted: { color: COLORS.textMuted, fontFamily: FONTS.regular, fontSize: 13.5, marginTop: 8 },
  provBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#101014', borderRadius: 999, paddingHorizontal: 16, paddingVertical: 9 },
  provText: { color: '#fff', fontSize: 12, fontFamily: FONTS.extraBold, letterSpacing: 0.3 },
  overview: { color: COLORS.text, fontFamily: FONTS.regular, fontSize: 13.5, lineHeight: 20, marginTop: 10 },
  commentsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  commentsCount: { fontSize: 14, fontFamily: FONTS.regular, color: COLORS.textMuted },
});
