import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { COLORS, FONTS } from '@/lib/theme';

const ICONS: Record<string, keyof typeof Feather.glyphMap> = {
  index: 'tv',
  movies: 'film',
  explore: 'search',
  profile: 'user',
};
const LABELS: Record<string, string> = {
  index: 'Séries',
  movies: 'Films',
  explore: 'Explorer',
  profile: 'Profil',
};

export function TabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  return (
    <View style={[styles.bar, { paddingBottom: insets.bottom, height: 56 + insets.bottom }]}>
      {state.routes.map((route, i) => {
        const focused = state.index === i;
        const onPress = () => {
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
          // Re-clic sur l'onglet déjà actif : actualiser la page (façon TV Time).
          // Invalider toutes les requêtes re-fetch celles montées à l'écran.
          if (focused) qc.invalidateQueries();
        };
        return (
          <Pressable key={route.key} style={styles.item} onPress={onPress}>
            <View>
              <Feather name={ICONS[route.name] ?? 'circle'} size={23} color={focused ? COLORS.black : COLORS.textMuted} />
              {route.name === 'explore' && !focused ? <View style={styles.dot} /> : null}
            </View>
            <Text style={[styles.label, { color: focused ? COLORS.black : COLORS.textMuted }]}>
              {LABELS[route.name] ?? route.name}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// Cotes TV Time : barre 56dp (+ zone gestes), icônes 23, libellés 10.5.
const styles = StyleSheet.create({
  bar: { flexDirection: 'row', backgroundColor: COLORS.white, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.border },
  item: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3, paddingTop: 6 },
  label: { fontFamily: FONTS.regular, fontSize: 10.5 },
  dot: { position: 'absolute', top: -2, right: -4, width: 7, height: 7, borderRadius: 4, backgroundColor: COLORS.red },
});
