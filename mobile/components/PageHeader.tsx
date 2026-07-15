import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, FONTS } from '@/lib/theme';

export function PageHeader({ title, right }: { title: string; right?: React.ReactNode }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.wrap, { paddingTop: insets.top }]}>
      <View style={styles.bar}>
        <Pressable style={styles.back} onPress={() => router.back()} hitSlop={8} accessibilityRole="button" accessibilityLabel="Retour">
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
  title: { fontSize: 16, fontFamily: FONTS.bold },
  right: { position: 'absolute', right: 12 },
});
