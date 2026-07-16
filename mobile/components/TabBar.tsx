import React, { useEffect, useRef } from 'react';
import { View, Text, Pressable, StyleSheet, Animated, Platform } from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { COLORS, FONTS } from '@/lib/theme';
import { useTabResetStore } from '@/lib/tabReset';
import { useReduceMotion } from '@/lib/useReduceMotion';

const NATIVE = Platform.OS !== 'web';

const ICONS: Record<string, keyof typeof Feather.glyphMap> = {
  index: 'tv',
  movies: 'film',
  explore: 'search',
  profile: 'user',
};
// L'onglet Jeux utilise une vraie icône manette (Ionicons — Feather n'en a pas).
const GAMES_ICON: keyof typeof Ionicons.glyphMap = 'game-controller-outline';
const LABELS: Record<string, string> = {
  index: 'Séries',
  movies: 'Films',
  games: 'Jeux',
  explore: 'Explorer',
  profile: 'Profil',
};

export function TabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const bumpReset = useTabResetStore((s) => s.bump);
  return (
    <View style={[styles.bar, { paddingBottom: insets.bottom, height: 56 + insets.bottom }]}>
      {state.routes.map((route, i) => {
        const focused = state.index === i;
        const onPress = () => {
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) {
            navigation.navigate(route.name);
            // Arriver sur Explorer = nouveau tirage du flux (règle produit).
            // Fait ici (changement d'onglet) et non au focus : revenir d'une
            // fiche ne doit pas re-mélanger le flux en pleine navigation.
            if (route.name === 'explore') qc.invalidateQueries({ queryKey: ['explore'] }); // feed + jeux
          }
          // Re-clic sur l'onglet déjà actif (façon TV Time) : actualiser les
          // données ET remonter l'écran à son état par défaut (via `bump` +
          // `key` dans chaque écran d'onglet).
          if (focused) {
            qc.invalidateQueries();
            bumpReset(route.name);
          }
        };
        return (
          <Pressable
            key={route.key}
            style={styles.item}
            onPress={onPress}
            accessibilityRole="tab"
            accessibilityLabel={LABELS[route.name] ?? route.name}
            accessibilityState={{ selected: focused }}
          >
            <TabIcon
              name={route.name === 'games' ? undefined : ICONS[route.name] ?? 'circle'}
              ionicon={route.name === 'games' ? GAMES_ICON : undefined}
              focused={focused}
              showDot={route.name === 'explore' && !focused}
            />
            <Text style={[styles.label, { color: focused ? COLORS.black : COLORS.textMuted }]}>
              {LABELS[route.name] ?? route.name}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// Icône d'onglet : petit « pop » élastique quand l'onglet devient actif.
function TabIcon({ name, ionicon, focused, showDot }: { name?: keyof typeof Feather.glyphMap; ionicon?: keyof typeof Ionicons.glyphMap; focused: boolean; showDot: boolean }) {
  const reduce = useReduceMotion();
  const scale = useRef(new Animated.Value(focused ? 1 : 0.92)).current;
  const color = focused ? COLORS.black : COLORS.textMuted;
  useEffect(() => {
    if (reduce) { scale.setValue(focused ? 1 : 0.92); return; }
    Animated.spring(scale, { toValue: focused ? 1 : 0.92, useNativeDriver: NATIVE, friction: 5, tension: 200 }).start();
  }, [focused, reduce, scale]);
  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      {ionicon ? (
        <Ionicons name={ionicon} size={24} color={color} />
      ) : (
        <Feather name={name ?? 'circle'} size={23} color={color} />
      )}
      {showDot ? <View style={styles.dot} /> : null}
    </Animated.View>
  );
}

// Cotes TV Time : barre 56dp (+ zone gestes), icônes 23, libellés 10.5.
const styles = StyleSheet.create({
  bar: { flexDirection: 'row', backgroundColor: COLORS.white, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.border },
  item: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3, paddingTop: 6 },
  label: { color: COLORS.text, fontFamily: FONTS.regular, fontSize: 10.5 },
  dot: { position: 'absolute', top: -2, right: -4, width: 7, height: 7, borderRadius: 4, backgroundColor: COLORS.notif },
});
