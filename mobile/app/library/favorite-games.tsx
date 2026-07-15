import React from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';
import { useRouter, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { api, tmdbImage } from '@/lib/api';
import type { MediaDto } from '@/lib/types';
import { COLORS, FONTS } from '@/lib/theme';
import { EmptyState, Loading, Poster } from '@/components/ui';

// Jeux préférés (profil → « Jeux préférés ») : grille simple, tap = fiche jeu.
// Le favori se bascule depuis le menu « ⋯ » de la fiche ; pas de drag & drop
// ici en V1 (contrairement aux séries/films) — l'ordre suit celui des favoris.
export default function FavoriteGamesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { data, isLoading } = useQuery({
    queryKey: ['profile', 'favorites', 'game'],
    queryFn: () => api.get<{ favorites: MediaDto[] }>('/api/profile/favorites?type=game'),
  });
  const favs = data?.favorites ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.white, paddingTop: insets.top }}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.headSide}>
          <Feather name="chevron-left" size={26} color={COLORS.black} />
        </Pressable>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Ionicons name="game-controller-outline" size={18} color={COLORS.black} />
          <Text style={styles.title}>Jeux préférés</Text>
        </View>
        <View style={styles.headSide} />
      </View>
      {isLoading ? (
        <Loading />
      ) : favs.length === 0 ? (
        <EmptyState
          title="Aucun jeu en favori"
          message="Ajoute tes jeux préférés depuis le menu « ⋯ » d'une fiche jeu."
        />
      ) : (
        <ScrollView contentContainerStyle={styles.grid}>
          {favs.map((g) => (
            <View key={g.id} style={styles.cell}>
              <Poster
                title={g.title}
                uri={tmdbImage(g.posterPath)}
                onPress={() => router.push(`/game/${g.id}` as Href)}
              />
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.borderLight,
  },
  headSide: { width: 40, alignItems: 'center' },
  title: { fontSize: 17, fontFamily: FONTS.extraBold },
  grid: { flexDirection: 'row', flexWrap: 'wrap', padding: 12, gap: 10 },
  cell: { width: '31%' },
});
