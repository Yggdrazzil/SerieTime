import React from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator, Image } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { COLORS, RADIUS, FONTS } from '@/lib/theme';

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
      <Feather name="chevron-right" size={12} color={COLORS.black} />
    </Pressable>
  );
}

export function Badge({ label, variant }: { label: string; variant: 'black' | 'yellow' }) {
  return (
    <View style={[styles.badge, { backgroundColor: variant === 'yellow' ? COLORS.yellow : COLORS.black }]}>
      <Text style={[styles.badgeText, { color: variant === 'yellow' ? COLORS.black : COLORS.white }]}>{label}</Text>
    </View>
  );
}

export function CheckCircle({
  checked,
  onPress,
  size = 52,
  checkedBg = COLORS.yellow,
  checkedFg = COLORS.black,
}: {
  checked?: boolean;
  onPress?: () => void;
  size?: number;
  // Couleurs de l'état coché : par défaut jaune façon TV Time, mais les
  // saisons terminées passent en vert (fond vert, coche blanche).
  checkedBg?: string;
  checkedFg?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      style={[
        styles.check,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: checked ? checkedBg : COLORS.checkBg },
      ]}
    >
      <Feather name="check" size={size * 0.42} color={checked ? checkedFg : '#9B9B9B'} />
    </Pressable>
  );
}

export function Poster({ title, uri, onPress, width }: { title: string; uri: string | null; onPress?: () => void; width?: number }) {
  return (
    <Pressable style={[styles.poster, width ? { width } : { flex: 1 }]} onPress={onPress}>
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
    </Pressable>
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

export const styles = StyleSheet.create({
  pillHdr: { alignItems: 'center', paddingVertical: 12 },
  pillText: {
    backgroundColor: COLORS.pillGrey, color: COLORS.white, borderRadius: 999,
    paddingHorizontal: 18, paddingVertical: 7, fontSize: 12, fontFamily: FONTS.extraBold,
    letterSpacing: 0.5, textTransform: 'uppercase', overflow: 'hidden',
  },
  showPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start',
    borderWidth: 2, borderColor: COLORS.black, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 3,
    backgroundColor: COLORS.white, maxWidth: '100%',
  },
  showPillText: { fontSize: 12, fontFamily: FONTS.extraBold, letterSpacing: 0.4, flexShrink: 1 },
  badge: { borderRadius: 3, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { fontSize: 12, fontFamily: FONTS.extraBold, letterSpacing: 0.4 },
  check: { alignItems: 'center', justifyContent: 'center' },
  poster: {
    aspectRatio: 2 / 3, backgroundColor: '#e5e5e5', borderRadius: RADIUS.poster, overflow: 'hidden',
  },
  posterEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6, gap: 6 },
  posterTitle: { fontSize: 12, fontFamily: FONTS.bold, color: '#777', textAlign: 'center' },
  empty: { alignItems: 'center', paddingVertical: 60, paddingHorizontal: 30 },
  emptyTitle: { fontSize: 20, fontFamily: FONTS.extraBold, textAlign: 'center' },
  emptyMsg: { fontFamily: FONTS.regular, fontSize: 15, color: COLORS.textMuted, marginTop: 8, textAlign: 'center' },
  retryBtn: { borderWidth: 2, borderColor: COLORS.black, borderRadius: 999, paddingVertical: 12, paddingHorizontal: 28, marginTop: 16 },
  retryText: { fontSize: 14, fontFamily: FONTS.extraBold, letterSpacing: 0.5 },
  loading: { paddingVertical: 60, alignItems: 'center' },
  topTabs: { flexDirection: 'row', height: 56, backgroundColor: COLORS.white },
  topTab: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  topTabText: { fontSize: 16, fontFamily: FONTS.extraBold, letterSpacing: 0.6, color: COLORS.textSoft },
  topTabActive: { color: COLORS.black },
  topTabUnder: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 4, backgroundColor: 'transparent' },
  topTabUnderActive: { backgroundColor: COLORS.black },
});
