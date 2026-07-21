import React from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type RefreshControlProps,
  type ViewStyle,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { COLORS, FONTS, RADIUS, SIZES, SPACE } from '@/lib/theme';
import { useAppStore } from '@/lib/store';

// Vue « grille d'affiches » (retour Étienne 2026-07-21) : alternative aux cartes
// dans Accueil et Agenda, activée par le bouton d'en-tête (ViewModeToggle). Une
// préférence UNIQUE partagée par les deux onglets, persistée dans le store.

// Bascule cartes ⇄ grille : lit/écrit la préférence partagée (persistée).
export function useGridView(): boolean {
  return useAppStore((s) => s.gridView);
}

// Bouton d'en-tête (posé à gauche via TabHeader.leading) : icône grille quand on
// est en cartes (tap → grille), icône liste quand on est en grille (tap → cartes).
export function ViewModeToggle() {
  const grid = useAppStore((s) => s.gridView);
  const setGrid = useAppStore((s) => s.setGridView);
  return (
    <Pressable
      onPress={() => setGrid(!grid)}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={grid ? 'Afficher en liste de cartes' : "Afficher en grille d'affiches"}
      accessibilityState={{ selected: grid }}
      style={({ pressed }) => [styles.toggle, pressed && styles.togglePressed]}
    >
      <Feather name={grid ? 'list' : 'grid'} size={23} color={COLORS.text} />
    </Pressable>
  );
}

export type PosterCell = {
  key: string;
  title: string;
  sub?: string | null;
  uri: string | null;
  onPress: () => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  // Estompe la vignette (ex. sorties/épisodes passés dans l'Agenda).
  dimmed?: boolean;
};

export type PosterSection = {
  key: string;
  header?: React.ReactNode;
  cells: PosterCell[];
};

const GAP = SPACE.sm;

// Nombre de colonnes selon la largeur (téléphone 3, tablette 4, large 5).
function columnsFor(width: number): number {
  if (width >= 900) return 5;
  if (width >= 620) return 4;
  return 3;
}

export function PosterGrid({
  sections,
  refreshControl,
  contentStyle,
}: {
  sections: PosterSection[];
  refreshControl?: React.ReactElement<RefreshControlProps>;
  contentStyle?: ViewStyle;
}) {
  const { width } = useWindowDimensions();
  const cols = columnsFor(width);
  // Largeur utile : bornée à contentMax (contenu centré sur web/tablette).
  const inner = Math.min(width, SIZES.contentMax) - SPACE.md * 2;
  const cellW = Math.floor((inner - GAP * (cols - 1)) / cols);
  return (
    <ScrollView
      contentContainerStyle={[styles.content, contentStyle]}
      refreshControl={refreshControl}
      showsVerticalScrollIndicator={false}
    >
      {sections.map((s) => (
        <View key={s.key} style={styles.section}>
          {s.header}
          <View style={styles.grid}>
            {s.cells.map((c) => (
              <Cell key={c.key} cell={c} width={cellW} />
            ))}
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

function Cell({ cell, width }: { cell: PosterCell; width: number }) {
  return (
    <Pressable
      style={({ pressed }) => [{ width }, pressed && styles.cellPressed]}
      onPress={cell.onPress}
      accessibilityRole="button"
      accessibilityLabel={cell.accessibilityLabel ?? cell.title}
      accessibilityHint={cell.accessibilityHint}
    >
      {cell.uri ? (
        <Image
          source={{ uri: cell.uri }}
          style={[styles.poster, cell.dimmed && styles.posterDimmed]}
          resizeMode="cover"
          accessible={false}
        />
      ) : (
        <View style={[styles.poster, styles.posterEmpty, cell.dimmed && styles.posterDimmed]} accessible={false}>
          <Feather name="image" size={24} color={COLORS.textSoft} />
        </View>
      )}
      <Text style={styles.title} numberOfLines={2}>
        {cell.title}
      </Text>
      {cell.sub ? (
        <Text style={styles.sub} numberOfLines={1}>
          {cell.sub}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  toggle: { width: SIZES.touch, height: SIZES.touch, alignItems: 'flex-start', justifyContent: 'center' },
  togglePressed: { opacity: 0.55, transform: [{ scale: 0.94 }] },
  content: { alignItems: 'center', paddingTop: SPACE.sm, paddingBottom: SIZES.tabBar + SPACE.xl },
  section: { width: '100%', maxWidth: SIZES.contentMax, paddingHorizontal: SPACE.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP, paddingBottom: SPACE.xs },
  cellPressed: { opacity: 0.82, transform: [{ scale: 0.98 }] },
  poster: {
    width: '100%',
    aspectRatio: 2 / 3,
    borderRadius: RADIUS.poster,
    backgroundColor: COLORS.imagePlaceholder,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
  },
  posterEmpty: { alignItems: 'center', justifyContent: 'center' },
  posterDimmed: { opacity: 0.62 },
  title: { marginTop: SPACE.xs, color: COLORS.text, fontFamily: FONTS.semiBold, fontSize: 12.5, lineHeight: 16 },
  sub: { color: COLORS.textMuted, fontFamily: FONTS.regular, fontSize: 11, lineHeight: 15, marginTop: 1 },
});
