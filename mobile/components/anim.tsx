import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, Pressable, type ViewStyle, type StyleProp } from 'react-native';
import { useReduceMotion } from '@/lib/useReduceMotion';

// Le fil natif accélère opacity/transform sur mobile ; sur le web (plateforme
// principale) il n'est pas supporté → JS driver pour éviter les warnings.
const NATIVE = Platform.OS !== 'web';

// Barre de progression dont le remplissage s'ANIME quand la valeur change
// (ex. cocher un épisode → la barre se remplit en douceur). `pct` de 0 à 100.
export function AnimatedFill({
  pct,
  color,
  style,
  duration = 480,
}: {
  pct: number;
  color: string;
  style?: StyleProp<ViewStyle>;
  duration?: number;
}) {
  const reduce = useReduceMotion();
  const v = useRef(new Animated.Value(pct)).current;
  useEffect(() => {
    Animated.timing(v, {
      toValue: pct,
      duration: reduce ? 0 : duration,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false, // largeur = propriété de layout, jamais le driver natif
    }).start();
  }, [pct, reduce, duration, v]);
  const width = v.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'], extrapolate: 'clamp' });
  return <Animated.View style={[style, { width, backgroundColor: color }]} />;
}

// Entrée « pop » d'un écran : léger fondu + montée + scale au montage. Fluide
// et disponible partout (web + natif), contrairement aux transitions natives.
export function Pop({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const reduce = useReduceMotion();
  const v = useRef(new Animated.Value(reduce ? 1 : 0)).current;
  useEffect(() => {
    if (reduce) { v.setValue(1); return; }
    Animated.timing(v, { toValue: 1, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: NATIVE }).start();
  }, [reduce, v]);
  return (
    <Animated.View
      style={[
        { flex: 1, opacity: v },
        {
          transform: [
            { translateY: v.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) },
            { scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.985, 1] }) },
          ],
        },
        style,
      ]}
    >
      {children}
    </Animated.View>
  );
}

// Apparition en cascade d'un élément de liste (fondu + petite montée). Le délai
// est plafonné pour que le bas d'une longue liste n'attende pas trop.
export function AppearItem({
  index = 0,
  children,
  style,
}: {
  index?: number;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const reduce = useReduceMotion();
  const v = useRef(new Animated.Value(reduce ? 1 : 0)).current;
  useEffect(() => {
    if (reduce) { v.setValue(1); return; }
    Animated.timing(v, {
      toValue: 1,
      duration: 300,
      delay: Math.min(index, 8) * 45,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: NATIVE,
    }).start();
  }, [reduce, index, v]);
  return (
    <Animated.View
      style={[
        { opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [18, 0] }) }] },
        style,
      ]}
    >
      {children}
    </Animated.View>
  );
}

// Pressable avec léger enfoncement (scale) au press : retour tactile « vivant ».
// Le transform est appliqué au Pressable lui-même → aucun impact sur le layout
// (utilisable directement sur une affiche, une carte, un bouton).
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
export function PressableScale({
  children,
  onPress,
  style,
  scaleTo = 0.96,
  disabled,
}: {
  children: React.ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  scaleTo?: number;
  disabled?: boolean;
}) {
  const reduce = useReduceMotion();
  const scale = useRef(new Animated.Value(1)).current;
  const to = (val: number, friction: number) =>
    Animated.spring(scale, { toValue: val, useNativeDriver: NATIVE, friction, tension: 200 }).start();
  return (
    <AnimatedPressable
      onPress={onPress}
      disabled={disabled}
      onPressIn={() => !reduce && to(scaleTo, 7)}
      onPressOut={() => !reduce && to(1, 5)}
      style={[style, { transform: [{ scale }] }]}
    >
      {children}
    </AnimatedPressable>
  );
}

// Apparition « ressort » d'un petit élément (coche, badge, pastille) : scale +
// fondu avec léger rebond. À monter quand l'état apparaît (ex. + devient ✓).
export function PopIn({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const reduce = useReduceMotion();
  const v = useRef(new Animated.Value(reduce ? 1 : 0)).current;
  useEffect(() => {
    if (reduce) { v.setValue(1); return; }
    Animated.spring(v, { toValue: 1, useNativeDriver: NATIVE, friction: 5, tension: 180 }).start();
  }, [reduce, v]);
  return (
    <Animated.View
      style={[
        style,
        {
          // Le spring dépasse 1 (rebond) : on borne l'opacité, pas le scale.
          opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: 'clamp' }),
          transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

// Fondu + léger glissement latéral à chaque changement de `trigger` (ex. bascule
// des onglets hauts À VOIR / À VENIR). Le contenu n'est pas remonté, juste animé.
export function FadeSwitch({
  trigger,
  children,
  style,
}: {
  trigger: string | number;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const reduce = useReduceMotion();
  const v = useRef(new Animated.Value(1)).current;
  const first = useRef(true);
  useEffect(() => {
    if (reduce) { v.setValue(1); return; }
    if (first.current) { first.current = false; return; }
    v.setValue(0);
    Animated.timing(v, { toValue: 1, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: NATIVE }).start();
  }, [trigger, reduce, v]);
  return (
    <Animated.View
      style={[
        { flex: 1, opacity: v, transform: [{ translateX: v.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }] },
        style,
      ]}
    >
      {children}
    </Animated.View>
  );
}

// Bloc « squelette » qui pulse doucement pendant les chargements (à la place
// d'un simple spinner) : l'app paraît réactive et le layout ne saute pas.
export function Skeleton({ style }: { style?: StyleProp<ViewStyle> }) {
  const reduce = useReduceMotion();
  const v = useRef(new Animated.Value(0.5)).current;
  useEffect(() => {
    if (reduce) { v.setValue(0.7); return; }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: 750, easing: Easing.inOut(Easing.ease), useNativeDriver: NATIVE }),
        Animated.timing(v, { toValue: 0.5, duration: 750, easing: Easing.inOut(Easing.ease), useNativeDriver: NATIVE }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [reduce, v]);
  return <Animated.View style={[{ backgroundColor: '#e4e4e4', borderRadius: 6, opacity: v }, style]} />;
}

// Barre qui remonte depuis le bas avec fondu selon `visible` (ex. bandeau
// « AJOUTÉE ! » de TV Time). Reste montée mais inerte quand cachée.
export function SlideUpBar({
  visible,
  children,
  style,
  distance = 90,
}: {
  visible: boolean;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  distance?: number;
}) {
  const reduce = useReduceMotion();
  const v = useRef(new Animated.Value(visible ? 1 : 0)).current;
  useEffect(() => {
    if (reduce) { v.setValue(visible ? 1 : 0); return; }
    Animated.spring(v, { toValue: visible ? 1 : 0, useNativeDriver: NATIVE, friction: 9, tension: 90 }).start();
  }, [visible, reduce, v]);
  return (
    <Animated.View
      pointerEvents={visible ? 'auto' : 'none'}
      style={[
        style,
        { opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }) }] },
      ]}
    >
      {children}
    </Animated.View>
  );
}
