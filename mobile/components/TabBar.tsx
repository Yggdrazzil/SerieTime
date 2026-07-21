import React, { useEffect, useRef } from 'react';
import { View, Pressable, StyleSheet, Animated, Platform } from 'react-native';
import { Feather } from '@expo/vector-icons';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { COLORS, GLASS_BLUR, RADIUS, SHADOW, THEME } from '@/lib/theme';
import { useTabResetStore } from '@/lib/tabReset';
import { useTabBarHidden } from '@/lib/tabBarHidden';
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
  // Un sheet du bas est ouvert (détails Explorer…) : la barre flottante
  // masquerait ses boutons — on la retire le temps de l'overlay.
  const hidden = useTabBarHidden();
  if (hidden) return null;

  return (
    // `box-none` : les zones transparentes autour de la pilule laissent passer
    // les touches vers le contenu qui défile derrière (barre FLOTTANTE).
    // Barre MINI partout (retour Benjamin 2026-07-21) : icônes seules, hauteur
    // réduite — les libellés vivent dans accessibilityLabel.
    <View pointerEvents="box-none" style={[styles.shell, { paddingBottom: Math.max(insets.bottom, 4) }]}>
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
              // NE PAS invalider ['explore'] ici : le deck de l'Explorer est
              // FIGÉ pendant la session de l'onglet (règle produit) — l'écran
              // reste monté (web : display:none), l'invalidation refetchait
              // donc un deck ENTIÈREMENT NEUF à chaque retour sur l'onglet
              // (position perdue + choix ❤️/👁 « oubliés »). Renouvellement
              // uniquement via pull-to-refresh, carte de fin, ou re-tap ci-dessous.
            }
            if (actuallyFocused) {
              // Re-tap = rafraîchir l'onglet COURANT. Le deck Explorer (clés
              // ['explore', …]) est figé et son écran reste monté (donc actif) :
              // on ne l'invalide que si c'est bien l'onglet Explorer qu'on
              // re-tape — sinon un re-tap d'Accueil re-tirait le deck en douce.
              qc.invalidateQueries({
                predicate: (q) => route.name === 'explore' || q.queryKey[0] !== 'explore',
              });
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
      {/* Glass : l'icône active (violet marque) se distinguait mal sur la barre
          translucide posée au-dessus d'un feed sombre (onglet Explorer). Un halo
          clair l'entoure → lisible sur fond sombre, invisible sur fond clair
          (autres onglets). Icône seule, aucun autre changement. */}
      <Feather
        name={name}
        size={22}
        color={color}
        style={focused && THEME === 'glass' ? styles.iconGlow : undefined}
      />
      {showDot ? <View style={styles.dot} /> : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // Barre FLOTTANTE (demande produit 2026-07-20, tous thèmes) : posée en
  // absolu au-dessus des écrans — le contenu défile derrière la pilule (et se
  // devine à travers en thème Glass). Les onglets réservent l'espace via leur
  // paddingBottom (SIZES.tabBar + marge).
  shell: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'transparent',
    paddingHorizontal: 12,
    paddingTop: 6,
  },
  bar: {
    flexDirection: 'row',
    minHeight: 46,
    // Glass (web) : voile plus léger que `surface` (0.55) — le blur maintient la
    // lisibilité et le contenu transparaît davantage derrière la pilule
    // (équilibre demandé le 2026-07-20). Natif glass : pas de blur → on garde
    // le voile standard. Autres thèmes : inchangés.
    backgroundColor: THEME === 'glass' && !NATIVE ? 'rgba(255,255,255,0.36)' : COLORS.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
    borderRadius: RADIUS.sheet,
    paddingHorizontal: 4,
    paddingVertical: 3,
    ...SHADOW.card,
    ...GLASS_BLUR,
  },
  item: {
    flex: 1,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: RADIUS.card,
  },
  itemActive: { backgroundColor: COLORS.primarySoft },
  itemPressed: { opacity: 0.72 },
  // Halo lumineux de l'icône active en Glass (lisibilité sur fond sombre).
  iconGlow: { textShadowColor: 'rgba(255,255,255,0.95)', textShadowRadius: 7, textShadowOffset: { width: 0, height: 0 } },
  dot: { position: 'absolute', top: -2, right: -4, width: 7, height: 7, borderRadius: 4, backgroundColor: COLORS.notif },
});
