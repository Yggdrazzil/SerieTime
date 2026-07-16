import React from 'react';
import { View, Text, Pressable, StyleSheet, Image, Dimensions } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { goBack } from '@/lib/nav';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { tmdbImage } from '@/lib/api';
import type { MediaDto } from '@/lib/types';
import { COLORS, FONTS, STATUS_BAR } from '@/lib/theme';
import { AnimatedFill, PressableScale } from '@/components/anim';

// Progression d'une série basée sur les épisodes DIFFUSÉS (fournie par l'API).
export type LibraryShow = MediaDto & {
  progress: { watched: number; total: number };
  addedAt: string;
  lastWatchedAt: string | null;
};

const GAP = 8;
const SIDE = 12;
export const COLS = 3;
// Cotes exportées pour la grille réordonnable (DragGrid) : mêmes espacements.
export const GRID_GAP = GAP;
export const GRID_SIDE = SIDE;
// Largeur d'une affiche pour une grille de 3 colonnes (cotes TV Time).
export const CELL_W = (Dimensions.get('window').width - SIDE * 2 - GAP * (COLS - 1)) / COLS;

// En-tête de page profil : flèche retour, titre centré, action à droite (icône œil).
export function LibHeader({ title, right }: { title: string; right?: React.ReactNode }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
      <Pressable onPress={() => goBack('/profile')} hitSlop={10} style={styles.headerSide} accessibilityRole="button" accessibilityLabel="Retour">
        <Feather name="chevron-left" size={26} color={COLORS.black} />
      </Pressable>
      <Text style={styles.headerTitle} numberOfLines={1}>
        {title}
      </Text>
      <View style={[styles.headerSide, { alignItems: 'flex-end' }]}>{right}</View>
    </View>
  );
}

// Pastille grise de section (EN COURS, PAS COMMENCÉ, VU…), centrée façon TV Time.
export function SectionPill({ label }: { label: string }) {
  return (
    <View style={styles.pillWrap}>
      <Text style={styles.pill}>{label}</Text>
    </View>
  );
}

// Grille 3 colonnes (paddings TV Time).
export function Grid({ children }: { children: React.ReactNode }) {
  return <View style={styles.grid}>{children}</View>;
}

// Affiche d'une série avec barre de progression (diffusés), colorée par STATUT
// (réfs TV Time) : jaune En cours, vert À jour, BLEU Terminé (pleine), ORANGE
// Regarder plus tard, ROUGE Arrêté — la barre montre où on s'est arrêté.
export function ShowCell({ show, bar = true }: { show: LibraryShow; bar?: boolean }) {
  const router = useRouter();
  const uri = tmdbImage(show.posterPath);
  const { watched, total } = show.progress ?? { watched: 0, total: 0 };
  const started = watched > 0;
  const done = total > 0 && watched >= total;
  const kind: keyof typeof STATUS_BAR =
    show.userStatus === 'abandoned' ? 'stopped'
    : show.userStatus === 'completed' ? 'completed'
    : show.userStatus === 'watchlist' ? 'watchlist'
    : done ? 'upToDate' : 'watching';
  // Terminé = barre pleine (TV Time) ; sinon avancement réel dans les diffusés.
  const pct = kind === 'completed' ? 100 : total > 0 ? Math.min(100, (watched / total) * 100) : 0;
  const showBar = bar && (kind === 'completed' || started);
  return (
    <PressableScale style={styles.cell} onPress={() => router.push(`/show/${show.id}`)}>
      <View style={styles.posterBox}>
        {uri ? (
          <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        ) : (
          <View style={styles.posterEmpty}>
            <Feather name="tv" size={22} color="#b4b4b4" />
            <Text style={styles.posterTitle} numberOfLines={3}>
              {show.title}
            </Text>
          </View>
        )}
        {showBar ? (
          <View style={[styles.barTrack, { backgroundColor: STATUS_BAR[kind].track }]}>
            <AnimatedFill pct={pct} color={STATUS_BAR[kind].fill} style={styles.barFill} />
          </View>
        ) : null}
      </View>
    </PressableScale>
  );
}

// Affiche d'un film (pas de barre de progression).
export function MovieCell({ movie }: { movie: MediaDto }) {
  const router = useRouter();
  const uri = tmdbImage(movie.posterPath);
  return (
    <PressableScale style={styles.cell} onPress={() => router.push(`/show/${movie.id}?type=movie`)}>
      <View style={styles.posterBox}>
        {uri ? (
          <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        ) : (
          <View style={styles.posterEmpty}>
            <Feather name="film" size={22} color="#b4b4b4" />
            <Text style={styles.posterTitle} numberOfLines={3}>
              {movie.title}
            </Text>
          </View>
        )}
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingBottom: 12,
    backgroundColor: COLORS.white, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.border,
  },
  headerSide: { width: 46, justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 18, fontFamily: FONTS.bold, color: COLORS.black },
  pillWrap: { alignItems: 'center', paddingVertical: 12 },
  // Mêmes rôles que les pastilles de l'onglet Séries (rose en Nuit, gris sinon).
  pill: {
    backgroundColor: COLORS.pillBg, color: COLORS.pillFg, borderRadius: 999,
    paddingHorizontal: 14, paddingVertical: 4, fontSize: 11, fontFamily: FONTS.bold,
    letterSpacing: 0.8, textTransform: 'uppercase', overflow: 'hidden',
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: SIDE, gap: GAP },
  cell: { width: CELL_W },
  posterBox: { width: '100%', aspectRatio: 2 / 3, borderRadius: 6, overflow: 'hidden', backgroundColor: COLORS.imagePlaceholder },
  posterEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6, gap: 6 },
  posterTitle: { fontSize: 11, fontFamily: FONTS.bold, color: '#777', textAlign: 'center' },
  barTrack: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 4, backgroundColor: 'rgba(255,212,0,0.30)' },
  barFill: { position: 'absolute', left: 0, bottom: 0, top: 0 },
});
