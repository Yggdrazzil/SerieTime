import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Skeleton } from './anim';
import { COLORS, RADIUS, SIZES, SPACE } from '@/lib/theme';

// Squelette des fiches (série/film/jeu) : évite le flash blanc + spinner
// pendant le chargement — la silhouette de l'écran apparaît immédiatement
// (bannière, jaquette, lignes de texte), puis le contenu la remplace.
export function FicheSkeleton({ heroHeight = 220 }: { heroHeight?: number }) {
  return (
    <View
      style={styles.screen}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel="Chargement de la fiche"
    >
      <View style={styles.canvas}>
        <Skeleton style={[styles.hero, { height: heroHeight }, styles.skeleton]} />
        <View style={styles.headRow}>
          <Skeleton style={[styles.poster, styles.skeleton]} />
          <View style={styles.headCopy}>
            <Skeleton style={[styles.titleLine, styles.skeleton]} />
            <Skeleton style={[styles.metaLine, styles.skeleton]} />
            <Skeleton style={[styles.shortLine, styles.skeleton]} />
          </View>
        </View>
        <View style={styles.sectionCard}>
          <Skeleton style={[styles.sectionTitle, styles.skeleton]} />
          <Skeleton style={[styles.bodyLineWide, styles.skeleton]} />
          <Skeleton style={[styles.bodyLine, styles.skeleton]} />
          <Skeleton style={[styles.bodyLineShort, styles.skeleton]} />
        </View>
        <View style={styles.chips}>
          <Skeleton style={[styles.chip, styles.skeleton]} />
          <Skeleton style={[styles.chip, styles.skeleton]} />
          <Skeleton style={[styles.chip, styles.skeleton]} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bg },
  canvas: { width: '100%', maxWidth: SIZES.contentMax, alignSelf: 'center', paddingBottom: SPACE.xl },
  hero: { width: '100%', borderRadius: 0 },
  headRow: { flexDirection: 'row', alignItems: 'flex-start', gap: SPACE.md, paddingHorizontal: SPACE.md, marginTop: -SPACE.xxl },
  skeleton: { backgroundColor: COLORS.imagePlaceholder },
  poster: { width: 104, aspectRatio: 2 / 3, borderRadius: RADIUS.poster, borderWidth: 3, borderColor: COLORS.bg },
  headCopy: { flex: 1, gap: SPACE.xs, paddingTop: SPACE.xxl + SPACE.xs },
  titleLine: { height: 22, width: '86%', borderRadius: RADIUS.small },
  metaLine: { height: 14, width: '62%', borderRadius: RADIUS.small },
  shortLine: { height: 12, width: '42%', borderRadius: RADIUS.small },
  sectionCard: { marginHorizontal: SPACE.md, marginTop: SPACE.lg, gap: SPACE.sm, padding: SPACE.md, borderRadius: RADIUS.card, backgroundColor: COLORS.surface },
  sectionTitle: { width: '46%', height: 18, borderRadius: RADIUS.small },
  bodyLineWide: { width: '100%', height: 12, borderRadius: RADIUS.small },
  bodyLine: { width: '82%', height: 12, borderRadius: RADIUS.small },
  bodyLineShort: { width: '58%', height: 12, borderRadius: RADIUS.small },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.xs, paddingHorizontal: SPACE.md, paddingTop: SPACE.lg },
  chip: { width: 92, height: 36, borderRadius: RADIUS.pill },
});
