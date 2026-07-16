import React, { useRef, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { COLORS, FONTS } from '@/lib/theme';
import { PopIn } from '@/components/anim';

// Pastille de section FLOTTANTE (façon TV Time) : suit le défilement et change
// de libellé au passage d'une section. Extraite de l'onglet Séries pour servir
// aussi aux pages bibliothèque du profil (Séries / Films) et à l'onglet Jeux.
//
// Usage :
//   const { registerSection, onListScroll, floatLabel } = useFloatingSection();
//   <View style={{ flex: 1 }}>
//     <ScrollView onScroll={onListScroll} scrollEventThrottle={16}>
//       <View onLayout={registerSection('En cours')}>… entête EN DUR + grille …</View>
//     </ScrollView>
//     <FloatingSectionPill label={floatLabel} />
//   </View>
export function useFloatingSection() {
  // Position y de chaque entête de section (mesurée au layout) + libellé
  // courant selon le défilement.
  const sectionYs = useRef<{ label: string; y: number }[]>([]);
  const [floatLabel, setFloatLabel] = useState<string | null>(null);
  const floatRef = useRef<string | null>(null);
  const registerSection = (label: string) => (e: { nativeEvent: { layout: { y: number } } }) => {
    const arr = sectionYs.current.filter((s) => s.label !== label);
    arr.push({ label, y: e.nativeEvent.layout.y });
    arr.sort((a, b) => a.y - b.y);
    sectionYs.current = arr;
  };
  const onListScroll = (e: { nativeEvent: { contentOffset: { y: number } } }) => {
    const y = e.nativeEvent.contentOffset.y;
    // Section courante = dernière entête arrivée en haut ; la pastille flotte
    // seulement quand l'entête EN DUR est sortie de l'écran (sinon doublon).
    let current: { label: string; rel: number } | null = null;
    for (const s of sectionYs.current) {
      const rel = s.y - y;
      if (rel <= 8) current = { label: s.label, rel };
    }
    const next = current && current.rel <= -34 ? current.label : null;
    if (next !== floatRef.current) {
      floatRef.current = next;
      setFloatLabel(next);
    }
  };
  return { registerSection, onListScroll, floatLabel };
}

// Superposition à poser en frère de la ScrollView (dans un parent flex: 1).
export function FloatingSectionPill({ label }: { label: string | null }) {
  if (!label) return null;
  return (
    <View style={styles.wrap} pointerEvents="none">
      <PopIn key={label} style={styles.pill}>
        <Text style={styles.text}>{label.toUpperCase()}</Text>
      </PopIn>
    </View>
  );
}

// Mêmes cotes que la pastille en dur (police 11, hauteur ~19dp), légère ombre
// pour se détacher des cartes.
const styles = StyleSheet.create({
  wrap: { position: 'absolute', top: 8, left: 0, right: 0, alignItems: 'center' },
  pill: {
    backgroundColor: COLORS.pillBg, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 4,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 5, elevation: 4,
  },
  text: { color: COLORS.pillFg, fontSize: 11, fontFamily: FONTS.bold, letterSpacing: 0.8 },
});
