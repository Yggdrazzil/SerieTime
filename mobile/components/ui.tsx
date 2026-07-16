import React, { useEffect, useRef } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator, Image, Animated, Platform } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { COLORS, RADIUS, FONTS } from '@/lib/theme';
import { useReduceMotion } from '@/lib/useReduceMotion';
import { PressableScale } from '@/components/anim';

const ANIM_NATIVE = Platform.OS !== 'web';

export function PillHeader({ label }: { label: string }) {
  return (
    <View style={styles.pillHdr}>
      <Text style={styles.pillText}>{label}</Text>
    </View>
  );
}

export function ShowPill({ label, onPress }: { label: string; onPress?: () => void }) {
  return (
    <Pressable style={styles.showPill} onPress={onPress} hitSlop={6}>
      <Text style={styles.showPillText} numberOfLines={1}>
        {label.toUpperCase()}
      </Text>
      <Feather name="chevron-right" size={11} color={COLORS.black} />
    </Pressable>
  );
}

// Badge noir : noir FIXE quel que soit le thème (PREMIERE façon TV Time) ;
// badge jaune : accent du thème + texte onAccent.
export function Badge({ label, variant }: { label: string; variant: 'black' | 'yellow' }) {
  return (
    <View style={[styles.badge, { backgroundColor: variant === 'yellow' ? COLORS.yellow : '#101014' }]}>
      <Text style={[styles.badgeText, { color: variant === 'yellow' ? COLORS.onAccent : '#FFFFFF' }]}>{label}</Text>
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
  // État coché : TOUJOURS vert à coche blanche (règle TV Time — le jaune est
  // réservé aux barres de progression en cours, jamais aux coches).
  checkedBg?: string;
  checkedFg?: string;
}) {
  const reduce = useReduceMotion();
  const scale = useRef(new Animated.Value(1)).current;
  const prev = useRef(checked);
  // Pop ressort quand l'état coché change (feedback « vivant » du visionnage).
  useEffect(() => {
    if (prev.current === checked) return;
    prev.current = checked;
    if (reduce) return;
    Animated.sequence([
      Animated.timing(scale, { toValue: 0.8, duration: 90, useNativeDriver: ANIM_NATIVE }),
      Animated.spring(scale, { toValue: 1, friction: 4, tension: 150, useNativeDriver: ANIM_NATIVE }),
    ]).start();
  }, [checked, reduce, scale]);
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={checked ? 'Marquer comme non vu' : 'Marquer comme vu'}
      // Léger enfoncement pendant l'appui, en plus du pop au changement d'état.
      onPressIn={() => !reduce && Animated.spring(scale, { toValue: 0.9, useNativeDriver: ANIM_NATIVE, friction: 6, tension: 200 }).start()}
      onPressOut={() => !reduce && Animated.spring(scale, { toValue: 1, useNativeDriver: ANIM_NATIVE, friction: 5, tension: 160 }).start()}
    >
      <Animated.View
        style={[
          styles.check,
          { width: size, height: size, borderRadius: size / 2, backgroundColor: checked ? checkedBg : COLORS.checkBg, transform: [{ scale }] },
        ]}
      >
        <Feather name="check" size={size * 0.42} color={checked ? checkedFg : '#9B9B9B'} />
      </Animated.View>
    </Pressable>
  );
}

export function Poster({ title, uri, onPress, width }: { title: string; uri: string | null; onPress?: () => void; width?: number }) {
  return (
    <PressableScale style={[styles.poster, width ? { width } : { flex: 1 }]} onPress={onPress}>
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
      <Text style={styles.emptyTitle}>{title}</Text>
      {message ? <Text style={styles.emptyMsg}>{message}</Text> : null}
    </View>
  );
}

// Échec de chargement (réseau coupé, web app réveillée par iOS, erreur serveur) :
// message clair + bouton réessayer, au lieu d'un spinner infini ou d'un faux « vide ».
export function LoadError({ onRetry, busy }: { onRetry: () => void; busy?: boolean }) {
  return (
    <View style={styles.empty}>
      <Feather name="wifi-off" size={40} color={COLORS.textMuted} />
      <Text style={[styles.emptyTitle, { marginTop: 14 }]}>Impossible de charger</Text>
      <Text style={styles.emptyMsg}>Vérifie ta connexion, puis réessaie.</Text>
      <Pressable onPress={onRetry} disabled={busy} style={styles.retryBtn} hitSlop={6}>
        {busy ? (
          <ActivityIndicator size="small" color={COLORS.black} />
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

// Cotes calquées sur TV Time (mesures px sur captures 393dp) : pastille de
// section 19dp / police 11, pastille de série 17dp / police 10.5 / bord 1.5,
// badges 15dp / police 10, onglets hauts 42dp / police 14 / soulignement 3.
export const styles = StyleSheet.create({
  pillHdr: { alignItems: 'center', paddingVertical: 10 },
  // Pastilles de section : rose du logo en thème Nuit, gris TV Time sinon
  // (rôles pillBg/pillFg — le thème décide).
  pillText: {
    backgroundColor: COLORS.pillBg, color: COLORS.pillFg, borderRadius: 999,
    paddingHorizontal: 14, paddingVertical: 4, fontSize: 11, fontFamily: FONTS.bold,
    letterSpacing: 0.8, textTransform: 'uppercase', overflow: 'hidden',
  },
  showPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start',
    borderWidth: 1.5, borderColor: COLORS.black, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 2,
    backgroundColor: COLORS.white, maxWidth: '100%',
  },
  showPillText: { color: COLORS.text, fontSize: 10.5, fontFamily: FONTS.bold, letterSpacing: 0.6, flexShrink: 1 },
  badge: { borderRadius: 4, paddingHorizontal: 7, paddingVertical: 2 },
  badgeText: { color: COLORS.text, fontSize: 10, fontFamily: FONTS.bold, letterSpacing: 0.5 },
  check: { alignItems: 'center', justifyContent: 'center' },
  poster: {
    aspectRatio: 2 / 3, backgroundColor: COLORS.imagePlaceholder, borderRadius: RADIUS.poster, overflow: 'hidden',
  },
  posterEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6, gap: 6 },
  posterTitle: { fontSize: 12, fontFamily: FONTS.bold, color: '#777', textAlign: 'center' },
  empty: { alignItems: 'center', paddingVertical: 60, paddingHorizontal: 30 },
  emptyTitle: { color: COLORS.text, fontSize: 18, fontFamily: FONTS.extraBold, textAlign: 'center' },
  emptyMsg: { fontFamily: FONTS.regular, fontSize: 15, color: COLORS.textMuted, marginTop: 8, textAlign: 'center' },
  retryBtn: { borderWidth: 2, borderColor: COLORS.black, borderRadius: 999, paddingVertical: 12, paddingHorizontal: 28, marginTop: 16 },
  retryText: { color: COLORS.text, fontSize: 14, fontFamily: FONTS.extraBold, letterSpacing: 0.5 },
  loading: { paddingVertical: 60, alignItems: 'center' },
  topTabs: { flexDirection: 'row', height: 42, backgroundColor: COLORS.white },
  topTab: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  topTabText: { fontSize: 14, fontFamily: FONTS.bold, letterSpacing: 1, color: COLORS.textSoft },
  topTabActive: { color: COLORS.black },
  topTabUnder: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 3, backgroundColor: 'transparent' },
  topTabUnderActive: { backgroundColor: COLORS.black },
});
