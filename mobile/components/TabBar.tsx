import React, { useEffect, useRef } from 'react';
import { View, Text, Pressable, StyleSheet, Animated, Platform } from 'react-native';
import { Feather } from '@expo/vector-icons';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { COLORS, FONTS, RADIUS, SHADOW } from '@/lib/theme';
import { useTabResetStore } from '@/lib/tabReset';
import { useReduceMotion } from '@/lib/useReduceMotion';

const NATIVE = Platform.OS !== 'web';

const VISIBLE_ROUTES = new Set(['index', 'agenda', 'explore', 'community', 'profile']);
const ICONS: Record<string, keyof typeof Feather.glyphMap> = {
  index: 'home',
  agenda: 'calendar',
  explore: 'search',
  community: 'users',
  profile: 'user',
};
const LABELS: Record<string, string> = {
  index: 'Accueil',
  agenda: 'Agenda',
  explore: 'Explorer',
  community: 'Communauté',
  profile: 'Profil',
};

export function TabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const bumpReset = useTabResetStore((s) => s.bump);
  const activeRouteName = state.routes[state.index]?.name;
  const visibleRoutes = state.routes.filter((route) => VISIBLE_ROUTES.has(route.name));

  return (
    <View style={[styles.shell, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      <View style={styles.bar}>
        {visibleRoutes.map((route) => {
          const actuallyFocused = activeRouteName === route.name;
          const focused =
            actuallyFocused ||
            // Jeux (onglet masqué) vit dans les collections du Profil.
            (route.name === 'profile' && activeRouteName === 'games');
          const onPress = () => {
            const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            if (!actuallyFocused && !event.defaultPrevented) {
              navigation.navigate(route.name);
              if (route.name === 'explore') qc.invalidateQueries({ queryKey: ['explore'] });
            }
            if (actuallyFocused) {
              qc.invalidateQueries();
              bumpReset(route.name);
            }
          };
          const onLongPress = () => navigation.emit({ type: 'tabLongPress', target: route.key });

          return (
            <Pressable
              key={route.key}
              style={({ pressed }) => [styles.item, focused && styles.itemActive, pressed && styles.itemPressed]}
              onPress={onPress}
              onLongPress={onLongPress}
              accessibilityRole="tab"
              accessibilityLabel={LABELS[route.name] ?? route.name}
              accessibilityState={{ selected: focused }}
            >
              <TabIcon
                name={ICONS[route.name] ?? 'circle'}
                focused={focused}
                showDot={route.name === 'explore' && !focused}
              />
              <Text
                numberOfLines={1}
                style={[styles.label, focused && styles.labelActive, { color: focused ? COLORS.navActive : COLORS.textMuted }]}
              >
                {LABELS[route.name] ?? route.name}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function TabIcon({ name, focused, showDot }: { name: keyof typeof Feather.glyphMap; focused: boolean; showDot: boolean }) {
  const reduce = useReduceMotion();
  const scale = useRef(new Animated.Value(focused ? 1 : 0.92)).current;
  const color = focused ? COLORS.navActive : COLORS.textMuted;
  useEffect(() => {
    if (reduce) {
      scale.setValue(focused ? 1 : 0.92);
      return;
    }
    Animated.spring(scale, { toValue: focused ? 1 : 0.92, useNativeDriver: NATIVE, friction: 6, tension: 190 }).start();
  }, [focused, reduce, scale]);
  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Feather name={name} size={22} color={color} />
      {showDot ? <View style={styles.dot} /> : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  shell: { backgroundColor: 'transparent', paddingHorizontal: 12, paddingTop: 6 },
  bar: {
    flexDirection: 'row',
    minHeight: 64,
    backgroundColor: COLORS.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
    borderRadius: RADIUS.sheet,
    paddingHorizontal: 4,
    paddingVertical: 5,
    ...SHADOW.card,
  },
  item: {
    flex: 1,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    borderRadius: RADIUS.card,
  },
  itemActive: { backgroundColor: COLORS.primarySoft },
  itemPressed: { opacity: 0.72 },
  label: { color: COLORS.text, fontFamily: FONTS.regular, fontSize: 10.5 },
  labelActive: { fontFamily: FONTS.bold },
  dot: { position: 'absolute', top: -2, right: -4, width: 7, height: 7, borderRadius: 4, backgroundColor: COLORS.notif },
});
