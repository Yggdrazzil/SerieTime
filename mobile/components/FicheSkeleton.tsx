import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Skeleton } from './anim';
import { COLORS } from '@/lib/theme';

// Squelette des fiches (série/film/jeu) : évite le flash blanc + spinner
// pendant le chargement — la silhouette de l'écran apparaît immédiatement
// (bannière, jaquette, lignes de texte), puis le contenu la remplace.
export function FicheSkeleton({ heroHeight = 220 }: { heroHeight?: number }) {
  return (
    <View style={{ flex: 1, backgroundColor: COLORS.white }}>
      <Skeleton style={{ height: heroHeight, borderRadius: 0 }} />
      <View style={styles.headRow}>
        <Skeleton style={styles.poster} />
        <View style={{ flex: 1, gap: 10, paddingTop: 54 }}>
          <Skeleton style={{ height: 20, width: '85%' }} />
          <Skeleton style={{ height: 14, width: '55%' }} />
        </View>
      </View>
      <View style={styles.lines}>
        <Skeleton style={{ height: 12, width: '70%' }} />
        <Skeleton style={{ height: 12, width: '60%' }} />
        <Skeleton style={{ height: 12, width: '80%' }} />
      </View>
      <View style={styles.chips}>
        <Skeleton style={styles.chip} />
        <Skeleton style={styles.chip} />
        <Skeleton style={styles.chip} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  headRow: { flexDirection: 'row', gap: 14, paddingHorizontal: 20, marginTop: -50 },
  poster: { width: 100, aspectRatio: 2 / 3, borderRadius: 8 },
  lines: { paddingHorizontal: 20, paddingTop: 16, gap: 9 },
  chips: { flexDirection: 'row', gap: 10, paddingHorizontal: 20, paddingTop: 22 },
  chip: { width: 86, height: 32, borderRadius: 999 },
});
