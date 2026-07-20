import React from 'react';
import { ScrollView, Pressable, Text, StyleSheet } from 'react-native';
import { COLORS, FONTS, RADIUS, SPACE } from '@/lib/theme';

// Ligne de suivi partagée (fiches jeu / série / film / animé) : les statuts
// tiennent sur UNE seule ligne de petites pilules ; si l'écran est trop étroit,
// la ligne défile horizontalement (pas de retour à la ligne).
// `allowDeselect` : re-taper le statut actif le retire (onChange(null)) —
// activé uniquement quand l'API le permet sans effet destructeur.
export type StatusOption = { value: string; label: string };

export function StatusLine({
  options,
  value,
  onChange,
  accessibilityLabel,
  disabled,
  allowDeselect,
}: {
  options: StatusOption[];
  value: string | null;
  onChange: (value: string | null) => void;
  accessibilityLabel: string;
  disabled?: boolean;
  allowDeselect?: boolean;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      accessibilityRole="radiogroup"
      accessibilityLabel={accessibilityLabel}
      contentContainerStyle={styles.row}
    >
      {options.map((o) => {
        const selected = value === o.value;
        return (
          <Pressable
            key={o.value}
            style={({ pressed }) => [
              styles.pill,
              selected && styles.pillSel,
              pressed && styles.pillPressed,
              disabled && styles.pillDisabled,
            ]}
            onPress={() => {
              if (selected) {
                if (allowDeselect) onChange(null);
                return;
              }
              onChange(o.value);
            }}
            disabled={disabled}
            // Pilules compactes (34) : hitSlop vertical pour garder une cible
            // tactile confortable (~44) sans épaissir la ligne.
            hitSlop={{ top: 6, bottom: 6 }}
            accessibilityRole="radio"
            accessibilityLabel={o.label}
            accessibilityHint={
              selected && allowDeselect ? 'Re-taper retire ce statut' : undefined
            }
            accessibilityState={{ checked: selected, disabled: !!disabled, busy: !!disabled }}
          >
            <Text style={[styles.pillText, selected && styles.pillTextSel]} numberOfLines={1}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.xs,
    // ScrollView : petite marge de fin pour que la dernière pilule ne colle
    // pas au bord quand la ligne défile.
    paddingRight: SPACE.xs,
  },
  pill: {
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACE.sm,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    backgroundColor: COLORS.surfaceMuted,
  },
  pillSel: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primary,
  },
  pillPressed: {
    opacity: 0.78,
  },
  pillDisabled: {
    opacity: 0.48,
  },
  pillText: {
    color: COLORS.text,
    fontFamily: FONTS.semiBold,
    fontSize: 13,
  },
  pillTextSel: {
    color: COLORS.onPrimary,
  },
});
