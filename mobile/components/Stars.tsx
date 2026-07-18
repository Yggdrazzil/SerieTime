import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, RADIUS, SPACE } from '@/lib/theme';

// Rangée de note façon TV Time : pastille sombre « S » + 5 étoiles + « x,x/5 ».
// `rating10` = note TMDb sur 10 (convertie en /5, demi-étoiles gérées).
export function Stars({ rating10, size = 19 }: { rating10: number; size?: number }) {
  const outOf5 = Math.max(0, Math.min(5, rating10 / 2));
  const full = Math.floor(outOf5 + 0.25);
  const half = outOf5 - full >= 0.25;
  const value = outOf5.toFixed(1).replace('.', ',');
  return (
    <View
      style={styles.row}
      accessible
      accessibilityRole="text"
      accessibilityLabel={`Note ${value} sur 5`}
    >
      <View style={[styles.badge, { width: size + 5, height: size + 5 }]}>
        <Ionicons name="sparkles" size={size * 0.7} color={COLORS.primary} />
      </View>
      <View style={styles.stars} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {[0, 1, 2, 3, 4].map((i) => {
          const filled = i < full || (i === full && half);
          return (
            <Ionicons
              key={i}
              name={i < full ? 'star' : i === full && half ? 'star-half' : 'star-outline'}
              size={size}
              color={filled ? COLORS.tertiary : COLORS.textSoft}
            />
          );
        })}
      </View>
      <Text style={styles.value}>{value}/5</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: SPACE.xs, marginTop: SPACE.sm },
  badge: { borderRadius: RADIUS.small, backgroundColor: COLORS.primarySoft, alignItems: 'center', justifyContent: 'center' },
  stars: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  value: { color: COLORS.text, fontSize: 14, fontFamily: FONTS.bold },
});
