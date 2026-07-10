import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS } from '@/lib/theme';

// Rangée de note façon TV Time : pastille sombre « S » + 5 étoiles + « x,x/5 ».
// `rating10` = note TMDb sur 10 (convertie en /5, demi-étoiles gérées).
export function Stars({ rating10, size = 19 }: { rating10: number; size?: number }) {
  const outOf5 = Math.max(0, Math.min(5, rating10 / 2));
  const full = Math.floor(outOf5 + 0.25);
  const half = outOf5 - full >= 0.25;
  return (
    <View style={styles.row}>
      <View style={[styles.badge, { width: size + 5, height: size + 5 }]}>
        <Text style={[styles.badgeText, { fontSize: size * 0.68 }]}>S</Text>
      </View>
      {[0, 1, 2, 3, 4].map((i) => (
        <Ionicons
          key={i}
          name={i < full ? 'star' : i === full && half ? 'star-half' : 'star-outline'}
          size={size}
          color={COLORS.yellow}
        />
      ))}
      <Text style={styles.value}>{outOf5.toFixed(1).replace('.', ',')}/5</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 10 },
  badge: { borderRadius: 5, backgroundColor: '#26262c', alignItems: 'center', justifyContent: 'center', marginRight: 6 },
  badgeText: { color: COLORS.yellow, fontFamily: FONTS.extraBold },
  value: { fontSize: 14, fontFamily: FONTS.bold, marginLeft: 6 },
});
