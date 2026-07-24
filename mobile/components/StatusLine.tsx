import React from 'react';
import { View, Pressable, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { COLORS, FONTS, RADIUS, SPACE } from '@/lib/theme';

// Ligne de suivi partagée (fiches jeu / série / film / animé) — refonte
// maquettes 2026-07-23 : contrôle SEGMENTÉ sur toute la largeur (icône au-
// dessus du libellé), segment actif en pilule violette pleine. Même API
// qu'avant (options/value/onChange/allowDeselect) : aucune logique changée.
// `allowDeselect` : re-taper le statut actif le retire (onChange(null)) —
// activé uniquement quand l'API le permet sans effet destructeur.
export type StatusOption = { value: string; label: string; icon?: keyof typeof Feather.glyphMap };

// Icônes par défaut par statut (série/film/jeu partagent les mêmes valeurs).
const STATUS_ICONS: Record<string, keyof typeof Feather.glyphMap> = {
  watchlist: 'bookmark',
  wishlist: 'bookmark',
  watching: 'play-circle',
  playing: 'play-circle',
  completed: 'check-circle',
  abandoned: 'x-circle',
};

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
    <View
      style={styles.track}
      accessibilityRole="radiogroup"
      accessibilityLabel={accessibilityLabel}
    >
      {options.map((o) => {
        const selected = value === o.value;
        const icon = o.icon ?? STATUS_ICONS[o.value] ?? 'circle';
        return (
          <Pressable
            key={o.value}
            style={({ pressed }) => [
              styles.segment,
              selected && styles.segmentSel,
              pressed && !disabled && styles.segmentPressed,
              disabled && styles.segmentDisabled,
            ]}
            onPress={() => {
              if (selected) {
                if (allowDeselect) onChange(null);
                return;
              }
              onChange(o.value);
            }}
            disabled={disabled}
            accessibilityRole="radio"
            accessibilityLabel={o.label}
            accessibilityHint={
              selected && allowDeselect ? 'Re-taper retire ce statut' : undefined
            }
            accessibilityState={{ checked: selected, disabled: !!disabled, busy: !!disabled }}
          >
            <Feather
              name={icon}
              size={17}
              color={selected ? COLORS.onPrimary : COLORS.textMuted}
            />
            <Text
              style={[styles.segmentText, selected && styles.segmentTextSel]}
              numberOfLines={1}
            >
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    padding: 4,
    gap: 2,
    borderRadius: RADIUS.card,
    backgroundColor: COLORS.surfaceMuted,
  },
  segment: {
    flex: 1,
    minWidth: 0,
    minHeight: 58,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: 2,
    paddingVertical: SPACE.xs,
    borderRadius: RADIUS.card - 4,
  },
  segmentSel: {
    backgroundColor: COLORS.primary,
  },
  segmentPressed: {
    opacity: 0.78,
  },
  segmentDisabled: {
    opacity: 0.48,
  },
  segmentText: {
    maxWidth: '100%',
    color: COLORS.text,
    fontFamily: FONTS.semiBold,
    fontSize: 12,
  },
  segmentTextSel: {
    color: COLORS.onPrimary,
    fontFamily: FONTS.bold,
  },
});
