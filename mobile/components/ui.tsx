import React, { useEffect, useRef } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator, Image, Animated, Platform } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { COLORS, RADIUS, FONTS, SHADOW, SPACE, SIZES, MOTION } from '@/lib/theme';
import { useReduceMotion } from '@/lib/useReduceMotion';
import { PressableScale } from '@/components/anim';

const ANIM_NATIVE = Platform.OS !== 'web';

export function PillHeader({ label }: { label: string }) {
  return (
    <View style={styles.pillHdr} accessibilityRole="header">
      <Text style={styles.pillText}>{label}</Text>
    </View>
  );
}

export function ShowPill({ label, onPress }: { label: string; onPress?: () => void }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.showPill, pressed && styles.showPillPressed]}
      onPress={(event) => {
        event.stopPropagation();
        onPress?.();
      }}
      disabled={!onPress}
      hitSlop={4}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={onPress ? `Ouvrir ${label}` : undefined}
    >
      <Text style={styles.showPillText} numberOfLines={1}>
        {label.toUpperCase()}
      </Text>
      <Feather name="chevron-right" size={14} color={COLORS.primary} />
    </Pressable>
  );
}

// Les deux variantes conservent leur sémantique tout en suivant la palette.
export function Badge({ label, variant }: { label: string; variant: 'black' | 'yellow' }) {
  return (
    <View style={[styles.badge, { backgroundColor: variant === 'yellow' ? COLORS.yellow : COLORS.black }]}>
      <Text style={[styles.badgeText, { color: variant === 'yellow' ? COLORS.onAccent : COLORS.white }]}>{label}</Text>
    </View>
  );
}

export function CheckCircle({
  checked,
  onPress,
  size = 52,
  checkedBg = COLORS.green,
  checkedFg = COLORS.white,
}: {
  checked?: boolean;
  onPress?: () => void;
  size?: number;
  // L'état coché reste vert à coche blanche ; l'accent de progression conserve
  // ainsi une fonction visuelle distincte.
  checkedBg?: string;
  checkedFg?: string;
}) {
  const reduce = useReduceMotion();
  const scale = useRef(new Animated.Value(1)).current;
  const prev = useRef(checked);
  const targetSize = Math.max(size, SIZES.touch);
  // Pop ressort quand l'état coché change (feedback « vivant » du visionnage).
  useEffect(() => {
    if (prev.current === checked) return;
    prev.current = checked;
    if (reduce) return;
    Animated.sequence([
      Animated.timing(scale, {
        toValue: 0.8,
        duration: Math.round(MOTION.fast * 0.56),
        useNativeDriver: ANIM_NATIVE,
      }),
      Animated.spring(scale, { toValue: 1, friction: 4, tension: 150, useNativeDriver: ANIM_NATIVE }),
    ]).start();
  }, [checked, reduce, scale]);
  return (
    <Pressable
      style={[styles.checkTarget, { width: targetSize, height: targetSize }]}
      onPress={(event) => {
        event.stopPropagation();
        onPress?.();
      }}
      disabled={!onPress}
      accessibilityRole="button"
      accessibilityLabel={checked ? 'Marquer comme non vu' : 'Marquer comme vu'}
      accessibilityState={{ checked: !!checked, disabled: !onPress }}
      // Léger enfoncement pendant l'appui, en plus du pop au changement d'état.
      onPressIn={() =>
        onPress &&
        !reduce &&
        Animated.spring(scale, { toValue: 0.9, useNativeDriver: ANIM_NATIVE, friction: 6, tension: 200 }).start()
      }
      onPressOut={() =>
        onPress &&
        !reduce &&
        Animated.spring(scale, { toValue: 1, useNativeDriver: ANIM_NATIVE, friction: 5, tension: 160 }).start()
      }
    >
      <Animated.View
        style={[
          styles.check,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: checked ? checkedBg : COLORS.checkBg,
            borderColor: checked ? checkedBg : COLORS.border,
            transform: [{ scale }],
          },
        ]}
      >
        <Feather name="check" size={size * 0.42} color={checked ? checkedFg : COLORS.textSoft} />
      </Animated.View>
    </Pressable>
  );
}

export function Poster({ title, uri, onPress, width }: { title: string; uri: string | null; onPress?: () => void; width?: number }) {
  return (
    <PressableScale
      style={[styles.poster, width ? { width } : { flex: 1 }]}
      onPress={onPress}
      accessibilityRole={onPress ? 'button' : 'image'}
      accessibilityLabel={title}
      accessibilityHint={onPress ? `Ouvre ${title}` : undefined}
    >
      {uri ? (
        // L'image couvre TOUT le cadre (pas de padding -> pas de bord gris, comme TV Time).
        <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      ) : (
        <View style={styles.posterEmpty}>
          <Feather name="image" size={26} color="#b4b4b4" />
          <Text style={styles.posterTitle} numberOfLines={3}>
            {title}
          </Text>
        </View>
      )}
    </PressableScale>
  );
}

export function EmptyState({ title, message }: { title: string; message?: string }) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon} accessible={false}>
        <Feather name="inbox" size={24} color={COLORS.primary} />
      </View>
      <Text style={styles.emptyTitle} accessibilityRole="header">
        {title}
      </Text>
      {message ? <Text style={styles.emptyMsg}>{message}</Text> : null}
    </View>
  );
}

// Échec de chargement (réseau coupé, web app réveillée par iOS, erreur serveur) :
// message clair + bouton réessayer, au lieu d'un spinner infini ou d'un faux « vide ».
export function LoadError({ onRetry, busy }: { onRetry: () => void; busy?: boolean }) {
  return (
    <View style={styles.empty} accessibilityRole="alert" accessibilityLiveRegion="polite">
      <View style={[styles.emptyIcon, styles.errorIcon]} accessible={false}>
        <Feather name="wifi-off" size={24} color={COLORS.danger} />
      </View>
      <Text style={styles.emptyTitle}>Impossible de charger</Text>
      <Text style={styles.emptyMsg}>Vérifie ta connexion, puis réessaie.</Text>
      <Pressable
        onPress={onRetry}
        disabled={busy}
        style={({ pressed }) => [styles.retryBtn, pressed && styles.retryBtnPressed, busy && styles.retryBtnBusy]}
        accessibilityRole="button"
        accessibilityLabel="Réessayer le chargement"
        accessibilityState={{ disabled: !!busy, busy: !!busy }}
      >
        {busy ? (
          <ActivityIndicator size="small" color={COLORS.onPrimary} />
        ) : (
          <Text style={styles.retryText}>RÉESSAYER</Text>
        )}
      </Pressable>
    </View>
  );
}

export function Loading() {
  return (
    <View style={styles.loading}>
      <ActivityIndicator color={COLORS.black} />
    </View>
  );
}

export function TopTabs({
  tabs,
  active,
  onChange,
}: {
  tabs: string[];
  active: string;
  onChange: (t: string) => void;
}) {
  return (
    <View style={styles.topTabs}>
      {tabs.map((t) => {
        const isActive = t === active;
        return (
          <Pressable key={t} style={styles.topTab} onPress={() => onChange(t)}>
            <Text style={[styles.topTabText, isActive && styles.topTabActive]}>{t}</Text>
            <View style={[styles.topTabUnder, isActive && styles.topTabUnderActive]} />
          </Pressable>
        );
      })}
    </View>
  );
}

// Composants partagés : rayons, espacements et cibles suivent le socle Prisme.
const styles = StyleSheet.create({
  pillHdr: { alignItems: 'center', paddingVertical: SPACE.sm },
  pillText: {
    overflow: 'hidden',
    paddingHorizontal: SPACE.sm,
    paddingVertical: 6,
    backgroundColor: COLORS.primarySoft,
    color: COLORS.primary,
    borderRadius: RADIUS.pill,
    fontSize: 11,
    lineHeight: 15,
    fontFamily: FONTS.extraBold,
    letterSpacing: 0.7,
    textTransform: 'uppercase',
  },
  showPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    minHeight: 36,
    maxWidth: '100%',
    gap: SPACE.xxs,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: COLORS.primarySoft,
    borderWidth: 1,
    borderColor: COLORS.primary,
    borderRadius: RADIUS.pill,
  },
  showPillPressed: { opacity: 0.78 },
  showPillText: {
    flexShrink: 1,
    color: COLORS.primary,
    fontSize: 10.5,
    lineHeight: 14,
    fontFamily: FONTS.extraBold,
    letterSpacing: 0.5,
  },
  badge: {
    minHeight: 22,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACE.xs,
    paddingVertical: 2,
    borderRadius: RADIUS.pill,
  },
  badgeText: { fontSize: 10, lineHeight: 13, fontFamily: FONTS.extraBold, letterSpacing: 0.45 },
  checkTarget: { alignItems: 'center', justifyContent: 'center' },
  check: { alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  poster: {
    aspectRatio: 2 / 3, backgroundColor: COLORS.imagePlaceholder, borderRadius: RADIUS.poster, overflow: 'hidden',
  },
  posterEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6, gap: 6 },
  posterTitle: { fontSize: 12, fontFamily: FONTS.bold, color: '#777', textAlign: 'center' },
  empty: {
    alignItems: 'center',
    marginHorizontal: SPACE.md,
    marginVertical: SPACE.md,
    paddingVertical: SPACE.xl,
    paddingHorizontal: SPACE.lg,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: RADIUS.card,
    ...SHADOW.card,
  },
  emptyIcon: {
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACE.md,
    backgroundColor: COLORS.primarySoft,
    borderRadius: 26,
  },
  errorIcon: { backgroundColor: COLORS.surfaceMuted },
  emptyTitle: { color: COLORS.text, fontSize: 20, lineHeight: 26, fontFamily: FONTS.extraBold, textAlign: 'center' },
  emptyMsg: {
    marginTop: SPACE.xs,
    color: COLORS.textMuted,
    fontFamily: FONTS.regular,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
  },
  retryBtn: {
    minHeight: SIZES.touch,
    minWidth: 132,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: SPACE.md,
    paddingHorizontal: SPACE.lg,
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.pill,
  },
  retryBtnPressed: { opacity: 0.86 },
  retryBtnBusy: { opacity: 0.7 },
  retryText: { color: COLORS.onPrimary, fontSize: 14, fontFamily: FONTS.extraBold, letterSpacing: 0.5 },
  loading: { paddingVertical: 60, alignItems: 'center' },
  topTabs: { flexDirection: 'row', height: 42, backgroundColor: COLORS.white },
  topTab: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  topTabText: { fontSize: 14, fontFamily: FONTS.bold, letterSpacing: 1, color: COLORS.textSoft },
  topTabActive: { color: COLORS.black },
  topTabUnder: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 3, backgroundColor: 'transparent' },
  // Soulignement actif : noir façon TV Time, JAUNE du logo en thème Nuit.
  topTabUnderActive: { backgroundColor: COLORS.navActive },
});
