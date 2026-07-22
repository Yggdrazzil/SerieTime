import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { type Href } from 'expo-router';
import { goBack } from '@/lib/nav';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, FONTS } from '@/lib/theme';

// `backFallback` : écran de repli quand l'historique est vide (reload web / lien
// direct). Défaut « /profile » (les écrans sociaux viennent du Profil) ; les
// Notifications, ouvertes depuis l'Accueil, passent '/'.
export function PageHeader({ title, right, backFallback = '/profile' }: { title: string; right?: React.ReactNode; backFallback?: Href }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.wrap, { paddingTop: insets.top }]}>
      <View style={styles.bar}>
        <Pressable style={styles.back} onPress={() => goBack(backFallback)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Retour">
          <Feather name="chevron-left" size={28} color={COLORS.black} />
        </Pressable>
        <Text style={styles.title}>{title}</Text>
        {right ? <View style={styles.right}>{right}</View> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: COLORS.white },
  bar: { height: 52, alignItems: 'center', justifyContent: 'center' },
  back: { position: 'absolute', left: 8, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { color: COLORS.text, fontSize: 16, fontFamily: FONTS.bold },
  right: { position: 'absolute', right: 12 },
});
