import React, { useEffect, useRef } from 'react';
import { Animated, Easing, PanResponder, Platform, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { COLORS } from '@/lib/theme';
import { useReduceMotion } from '@/lib/useReduceMotion';

const NATIVE = Platform.OS !== 'web';
const TRIGGER = 64; // distance (déjà amortie) qui déclenche l'actualisation
const HOLD = 56; // position de maintien de la pastille pendant l'actualisation
const MAX = 130; // étirement maximal (résistance élastique)

// Tirer-pour-actualiser compatible WEB + natif (le RefreshControl de React Native
// est inopérant sur la web app). Variante du composant `components/PullToRefresh`
// pour un enfant qui gère SON PROPRE défilement (ex. une FlatList paginée
// virtualisée) : le parent nous transmet l'offset de scroll via `scrollYRef`, et
// on ne capte le geste que si l'enfant est tout en haut et qu'on tire vers le bas
// (les swipes vers le haut / paging restent à l'enfant).
export function PullToRefreshView({
  refreshing,
  onRefresh,
  scrollYRef,
  children,
  style,
}: {
  refreshing: boolean;
  onRefresh: () => void;
  scrollYRef: React.MutableRefObject<number>;
  children: React.ReactNode;
  style?: object;
}) {
  const reduce = useReduceMotion();
  const pull = useRef(new Animated.Value(0)).current;
  const dist = useRef(0);
  const refreshingRef = useRef(refreshing);
  refreshingRef.current = refreshing;
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  // Rotation continue de la pastille pendant l'actualisation.
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!refreshing) return;
    spin.setValue(0);
    const loop = Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: 800, easing: Easing.linear, useNativeDriver: NATIVE }),
    );
    loop.start();
    return () => loop.stop();
  }, [refreshing, spin]);

  // Fin d'actualisation : la page remonte en ressort.
  const was = useRef(refreshing);
  useEffect(() => {
    if (was.current && !refreshing) {
      Animated.spring(pull, { toValue: 0, friction: 6, tension: 60, useNativeDriver: NATIVE }).start();
    }
    was.current = refreshing;
  }, [refreshing, pull]);

  const settle = (to: number) =>
    Animated.spring(pull, { toValue: to, friction: to === 0 ? 5 : 7, tension: 90, useNativeDriver: NATIVE }).start();

  const release = () => {
    if (dist.current >= TRIGGER && !refreshingRef.current) {
      settle(HOLD);
      onRefreshRef.current();
    } else if (!refreshingRef.current) {
      settle(0);
    } else {
      settle(HOLD);
    }
    dist.current = 0;
  };

  const pan = useRef(
    PanResponder.create({
      // Ne vole le geste que si l'enfant est tout en haut et qu'on tire clairement
      // vers le bas (les gestes verticaux vers le haut = paging restent à l'enfant).
      onMoveShouldSetPanResponderCapture: (_e, g) =>
        scrollYRef.current <= 0 && g.dy > 8 && Math.abs(g.dy) > Math.abs(g.dx) * 1.6,
      onPanResponderMove: (_e, g) => {
        // Résistance élastique : plus on tire, moins ça avance (effet ressort).
        const d = g.dy <= 0 ? 0 : MAX * (1 - Math.exp(-g.dy / 140));
        dist.current = d;
        pull.setValue(refreshingRef.current ? Math.max(HOLD, d) : d);
      },
      onPanResponderRelease: release,
      onPanResponderTerminate: release,
    }),
  ).current;

  const opacity = pull.interpolate({ inputRange: [0, 24, TRIGGER], outputRange: [0, 0.35, 1], extrapolate: 'clamp' });
  const scale = pull.interpolate({ inputRange: [0, TRIGGER], outputRange: [0.55, 1], extrapolate: 'clamp' });
  const rotPull = pull.interpolate({ inputRange: [0, MAX], outputRange: ['0deg', '300deg'] });
  const rotSpin = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <Animated.View style={[{ flex: 1, overflow: 'hidden' }, style]} {...(reduce ? {} : pan.panHandlers)}>
      {/* Pastille : cachée au-dessus, elle descend avec la traction. */}
      <Animated.View style={[styles.spinnerWrap, { transform: [{ translateY: pull }] }]} pointerEvents="none">
        <Animated.View style={[styles.spinner, { opacity, transform: [{ scale }, { rotate: rotPull }, { rotate: rotSpin }] }]}>
          <Feather name="refresh-cw" size={17} color={COLORS.black} />
        </Animated.View>
      </Animated.View>
      <Animated.View style={{ flex: 1, transform: [{ translateY: pull }] }}>{children}</Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  spinnerWrap: { position: 'absolute', top: -48, left: 0, right: 0, alignItems: 'center', zIndex: 10 },
  spinner: {
    width: 38, height: 38, borderRadius: 19, backgroundColor: COLORS.white,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.22, shadowRadius: 6, elevation: 5,
  },
});
