import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, FONTS } from '@/lib/theme';
import { useTabResetSeq } from '@/lib/tabReset';
import { UpcomingView } from './index';

export default function AgendaScreen() {
  const insets = useSafeAreaInsets();
  const resetSeq = useTabResetSeq('agenda');

  return (
    <View key={resetSeq} style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Text style={styles.eyebrow}>VOTRE PLANNING</Text>
        <Text accessibilityRole="header" style={styles.title}>Agenda</Text>
        <Text style={styles.subtitle}>Les prochaines sorties des séries que vous suivez.</Text>
      </View>
      <UpcomingView />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.pageMuted },
  header: {
    backgroundColor: COLORS.white,
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.borderLight,
  },
  eyebrow: { color: COLORS.primary, fontFamily: FONTS.bold, fontSize: 11, letterSpacing: 1.2 },
  title: { color: COLORS.text, fontFamily: FONTS.extraBold, fontSize: 30, lineHeight: 36 },
  subtitle: { color: COLORS.textMuted, fontFamily: FONTS.regular, fontSize: 13, marginTop: 2 },
});
