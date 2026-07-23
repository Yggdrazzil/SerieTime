import React, { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBackClose } from '@/lib/useBackClose';
import { COLORS, FONTS, RADIUS, SHADOW, SIZES, SPACE } from '@/lib/theme';

// Filtre/tri des résultats de recherche Explorer — reprend le design des filtres
// des bibliothèques (pilule flottante « FILTRER » + feuille tri + filtre unique).

export type FilterOption = { key: string; label: string };
// Filtre appliqué affiché en badge amovible au-dessus du bouton FILTRER.
export type ActiveChip = { key: string; label: string; onRemove: () => void };

// Barre flottante : les badges des filtres actifs (chacun avec une croix pour le
// retirer) empilés au-dessus de la pilule « FILTRER » (violette). `bottom` doit
// dégager la barre de navigation.
export function FilterBar({
  active,
  chips,
  onOpen,
  bottom,
}: {
  active: boolean;
  chips: ActiveChip[];
  onOpen: () => void;
  bottom: number;
}) {
  return (
    <View style={[styles.bar, { bottom }]} pointerEvents="box-none">
      {chips.length > 0 ? (
        <View style={styles.chipsWrap}>
          {chips.map((c) => (
            <Pressable
              key={c.key}
              style={({ pressed }) => [styles.activeChip, pressed && styles.activeChipPressed]}
              onPress={c.onRemove}
              accessibilityRole="button"
              accessibilityLabel={`Retirer le filtre : ${c.label}`}
            >
              <Text style={styles.activeChipText} numberOfLines={1}>{c.label}</Text>
              <Feather name="x" size={14} color={COLORS.primary} />
            </Pressable>
          ))}
        </View>
      ) : null}
      <Pressable
        style={({ pressed }) => [styles.fab, pressed && styles.fabPressed]}
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={active ? 'Filtres actifs. Modifier le tri et le filtre' : 'Filtrer et trier les résultats'}
        accessibilityState={{ selected: active }}
      >
        <Feather name="sliders" size={18} color={COLORS.onPrimary} />
        <Text style={styles.fabText}>{active ? 'FILTRES ACTIFS' : 'FILTRER'}</Text>
      </Pressable>
    </View>
  );
}

// Feuille tri (chips) + un filtre à choix unique (radios). Brouillon interne,
// appliqué au bouton APPLIQUER (comme la feuille des bibliothèques).
export function SearchFilterSheet({
  visible,
  onClose,
  title,
  sortOptions,
  sort,
  filterTitle,
  filterOptions,
  filter,
  reset,
  onApply,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  sortOptions: FilterOption[];
  sort: string;
  filterTitle: string;
  filterOptions: FilterOption[];
  filter: string;
  reset: { sort: string; filter: string };
  onApply: (sort: string, filter: string) => void;
}) {
  const insets = useSafeAreaInsets();
  // Retour (PWA/Android) : ferme la feuille de filtres au lieu de reculer le
  // routeur (qui quittait la web app depuis l'onglet Explorer).
  useBackClose(visible, onClose);
  const [s, setS] = useState(sort);
  const [f, setF] = useState(filter);
  useEffect(() => {
    if (visible) {
      setS(sort);
      setF(filter);
    }
  }, [visible, sort, filter]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.overlay} onPress={onClose} accessibilityRole="button" accessibilityLabel="Fermer les filtres" />
      <View style={styles.dock} pointerEvents="box-none">
        <View style={[styles.sheet, { paddingBottom: insets.bottom + SPACE.sm }]} accessibilityViewIsModal>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text accessibilityRole="header" style={styles.title}>{title}</Text>
            </View>
            <Pressable
              style={({ pressed }) => [styles.closeBtn, pressed && styles.pressed]}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Fermer les filtres"
            >
              <Feather name="x" size={20} color={COLORS.text} />
            </Pressable>
          </View>

          <Text style={styles.sectionTitle}>Trier par</Text>
          <View style={styles.chipRow}>
            {sortOptions.map((o) => {
              const sel = s === o.key;
              return (
                <Pressable
                  key={o.key}
                  style={({ pressed }) => [styles.chip, sel && styles.chipOn, pressed && styles.optPressed]}
                  onPress={() => setS(o.key)}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: sel }}
                >
                  <Text style={[styles.chipText, sel && styles.chipTextOn]}>{o.label}</Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.sectionTitle}>{filterTitle}</Text>
          <ScrollView style={styles.radioScroll} showsVerticalScrollIndicator={false}>
            {filterOptions.map((o) => {
              const sel = f === o.key;
              return (
                <Pressable
                  key={o.key}
                  style={({ pressed }) => [styles.radioRow, pressed && styles.optPressed]}
                  onPress={() => setF(o.key)}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: sel }}
                >
                  <Text style={styles.radioLabel} numberOfLines={1}>{o.label}</Text>
                  <View style={[styles.radio, sel && styles.radioOn]}>
                    {sel ? <Feather name="check" size={15} color={COLORS.onPrimary} /> : null}
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>

          <View style={styles.btns}>
            <Pressable
              style={({ pressed }) => [styles.resetBtn, pressed && styles.optPressed]}
              onPress={() => { setS(reset.sort); setF(reset.filter); }}
              accessibilityRole="button"
              accessibilityLabel="Réinitialiser les filtres"
            >
              <Text style={styles.resetText}>RÉINITIALISER</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.applyBtn, pressed && styles.pressed]}
              onPress={() => onApply(s, f)}
              accessibilityRole="button"
            >
              <Text style={styles.applyText}>APPLIQUER</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  // Conteneur flottant (badges + pilule), centré, laisse défiler derrière.
  bar: { position: 'absolute', left: 0, right: 0, alignItems: 'center', paddingHorizontal: SPACE.md },
  chipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: SPACE.xs,
    marginBottom: SPACE.xs,
    maxWidth: SIZES.contentMax,
  },
  activeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 34,
    paddingLeft: SPACE.sm,
    paddingRight: SPACE.xs,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.surface,
    borderWidth: 1.5,
    borderColor: COLORS.primary,
    ...SHADOW.card,
  },
  activeChipPressed: { opacity: 0.8, transform: [{ scale: 0.97 }] },
  activeChipText: { color: COLORS.primary, fontSize: 12, fontFamily: FONTS.bold, maxWidth: 200 },
  fab: {
    alignSelf: 'center',
    minHeight: SIZES.touchComfortable,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.xs,
    paddingHorizontal: SPACE.lg,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.primary,
    ...SHADOW.card,
  },
  fabPressed: { opacity: 0.84, transform: [{ scale: 0.97 }] },
  fabText: { color: COLORS.onPrimary, fontSize: 13, fontFamily: FONTS.extraBold, letterSpacing: 0.6 },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: COLORS.overlay },
  dock: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center' },
  sheet: {
    width: '100%',
    maxWidth: 620,
    maxHeight: '92%',
    paddingHorizontal: SPACE.md,
    paddingTop: SPACE.xs,
    borderTopLeftRadius: RADIUS.sheet,
    borderTopRightRadius: RADIUS.sheet,
    backgroundColor: COLORS.sheet,
    ...SHADOW.card,
  },
  handle: { width: 42, height: 4, alignSelf: 'center', marginBottom: SPACE.sm, borderRadius: RADIUS.pill, backgroundColor: COLORS.border },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: SPACE.sm },
  headerCopy: { flex: 1, minWidth: 0 },
  title: { color: COLORS.text, fontSize: 19, lineHeight: 25, fontFamily: FONTS.bold },
  closeBtn: { width: SIZES.touch, height: SIZES.touch, alignItems: 'center', justifyContent: 'center', borderRadius: RADIUS.control, backgroundColor: COLORS.surfaceMuted },
  pressed: { opacity: 0.84, transform: [{ scale: 0.97 }] },
  sectionTitle: { color: COLORS.text, fontSize: 15, lineHeight: 20, fontFamily: FONTS.extraBold, marginTop: SPACE.md, marginBottom: SPACE.xs },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.xs },
  chip: {
    minHeight: SIZES.touch,
    justifyContent: 'center',
    paddingHorizontal: SPACE.md,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.surfaceMuted,
  },
  chipOn: { borderColor: COLORS.primary, backgroundColor: COLORS.primary },
  chipText: { fontSize: 13, fontFamily: FONTS.semiBold, color: COLORS.text },
  chipTextOn: { color: COLORS.onPrimary, fontFamily: FONTS.bold },
  radioScroll: { maxHeight: 300, flexShrink: 1 },
  radioRow: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACE.sm,
    paddingHorizontal: SPACE.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.borderLight,
    borderRadius: RADIUS.small,
  },
  optPressed: { backgroundColor: COLORS.primarySoft },
  radioLabel: { flex: 1, color: COLORS.text, fontSize: 15, lineHeight: 20, fontFamily: FONTS.regular },
  radio: { width: 26, height: 26, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: COLORS.border, borderRadius: 13 },
  radioOn: { borderColor: COLORS.primary, backgroundColor: COLORS.primary },
  btns: { flexDirection: 'row', gap: SPACE.sm, marginTop: SPACE.md },
  resetBtn: { flex: 1, minHeight: SIZES.touchComfortable, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: COLORS.border, borderRadius: RADIUS.pill },
  resetText: { color: COLORS.text, fontSize: 12, fontFamily: FONTS.extraBold, letterSpacing: 0.45 },
  applyBtn: { flex: 1, minHeight: SIZES.touchComfortable, alignItems: 'center', justifyContent: 'center', borderRadius: RADIUS.pill, backgroundColor: COLORS.primary },
  applyText: { color: COLORS.onPrimary, fontSize: 12, fontFamily: FONTS.extraBold, letterSpacing: 0.45 },
});
