import React from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { ProfileStatsDto } from '@/lib/types';
import { COLORS, FONTS, RADIUS, SHADOW, SIZES } from '@/lib/theme';
import { useTabResetSeq } from '@/lib/tabReset';

type LibraryStats = Pick<ProfileStatsDto, 'showsCount' | 'moviesCount' | 'gamesCount'>;
type LibrarySummary = { stats: LibraryStats };
type FeatherName = React.ComponentProps<typeof Feather>['name'];
type Entry = {
  key: string;
  title: string;
  subtitle: string;
  icon: FeatherName;
  href: Href;
  color: string;
  count?: number;
};

export default function LibraryScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const resetSeq = useTabResetSeq('library');
  const summary = useQuery({
    queryKey: ['profile'],
    queryFn: () => api.get<LibrarySummary>('/api/profile'),
  });
  const stats = summary.data?.stats;
  const libraries: Entry[] = [
    {
      key: 'shows', title: 'Séries', subtitle: 'Progression et statuts', icon: 'tv',
      href: '/library/shows' as Href, color: COLORS.primary, count: stats?.showsCount,
    },
    {
      key: 'movies', title: 'Films', subtitle: 'Vus et à découvrir', icon: 'film',
      href: '/library/movies' as Href, color: COLORS.info, count: stats?.moviesCount,
    },
    {
      key: 'games', title: 'Jeux', subtitle: 'Envies, collection et parties', icon: 'play-circle',
      href: '/games' as Href, color: COLORS.secondary, count: stats?.gamesCount,
    },
  ];
  const favorites: Entry[] = [
    { key: 'fav-shows', title: 'Séries', subtitle: 'Voir la sélection', icon: 'heart', href: '/library/favorite-shows' as Href, color: COLORS.danger },
    { key: 'fav-movies', title: 'Films', subtitle: 'Voir la sélection', icon: 'heart', href: '/library/favorite-movies' as Href, color: COLORS.danger },
    { key: 'fav-games', title: 'Jeux', subtitle: 'Voir la sélection', icon: 'heart', href: '/library/favorite-games' as Href, color: COLORS.danger },
  ];

  return (
    <View key={resetSeq} style={styles.screen}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 12 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={summary.isRefetching}
            onRefresh={() => void summary.refetch()}
            tintColor={COLORS.primary}
            colors={[COLORS.primary]}
          />
        }
      >
        <Text style={styles.eyebrow}>TOUT CE QUE VOUS SUIVEZ</Text>
        <Text accessibilityRole="header" style={styles.title}>Bibliothèque</Text>
        <Text style={styles.subtitle}>Retrouvez vos séries, films et jeux sans changer vos habitudes.</Text>

        {summary.isError ? (
          <Pressable
            style={styles.error}
            onPress={() => void summary.refetch()}
            accessibilityRole="button"
            accessibilityLabel="Réessayer de charger les compteurs"
          >
            <Feather name="refresh-cw" size={17} color={COLORS.danger} />
            <Text style={styles.errorText}>Compteurs indisponibles — Réessayer</Text>
          </Pressable>
        ) : null}

        <View style={styles.grid}>
          {libraries.map((entry) => (
            <LibraryCard key={entry.key} entry={entry} onPress={() => router.push(entry.href)} />
          ))}
        </View>

        <View style={styles.sectionHeader}>
          <Text accessibilityRole="header" style={styles.sectionTitle}>Favoris</Text>
          <Text style={styles.sectionSubtitle}>Vos sélections personnelles</Text>
        </View>
        <View style={styles.favoriteList}>
          {favorites.map((entry) => (
            <FavoriteRow key={entry.key} entry={entry} onPress={() => router.push(entry.href)} />
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

function countLabel(count?: number) {
  if (count === undefined) return 'Ouvrir';
  return `${count} ${count > 1 ? 'éléments' : 'élément'}`;
}

function LibraryCard({ entry, onPress }: { entry: Entry; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${entry.title}, ${countLabel(entry.count)}`}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={[styles.iconBox, { backgroundColor: `${entry.color}18` }]}>
        <Feather name={entry.icon} size={22} color={entry.color} />
      </View>
      <Text style={styles.cardTitle}>{entry.title}</Text>
      <Text style={styles.cardSubtitle}>{entry.subtitle}</Text>
      <Text style={[styles.count, { color: entry.color }]}>{countLabel(entry.count)}</Text>
    </Pressable>
  );
}

function FavoriteRow({ entry, onPress }: { entry: Entry; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${entry.title} favoris, voir la sélection`}
      style={({ pressed }) => [styles.favoriteRow, pressed && styles.pressed]}
    >
      <View style={styles.favoriteIcon}>
        <Feather name={entry.icon} size={18} color={entry.color} />
      </View>
      <View style={styles.favoriteCopy}>
        <Text style={styles.favoriteTitle}>{entry.title}</Text>
        <Text style={styles.favoriteCount}>{entry.subtitle}</Text>
      </View>
      <Feather name="chevron-right" size={20} color={COLORS.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bg },
  content: {
    width: '100%',
    maxWidth: SIZES.contentMax,
    alignSelf: 'center',
    paddingHorizontal: 20,
    paddingBottom: 28,
  },
  eyebrow: { color: COLORS.primary, fontFamily: FONTS.bold, fontSize: 11, letterSpacing: 1.2 },
  title: { color: COLORS.text, fontFamily: FONTS.extraBold, fontSize: 30, lineHeight: 36 },
  subtitle: { color: COLORS.textMuted, fontFamily: FONTS.regular, fontSize: 13, lineHeight: 19, marginTop: 2, marginBottom: 20 },
  error: {
    minHeight: SIZES.touch, flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: COLORS.surface, borderRadius: RADIUS.control, paddingHorizontal: 12, marginBottom: 14,
  },
  errorText: { color: COLORS.danger, fontFamily: FONTS.semiBold, fontSize: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  card: {
    width: '47.8%', minHeight: 164, backgroundColor: COLORS.surface,
    borderRadius: RADIUS.card, borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border, padding: 16, ...SHADOW.card,
  },
  pressed: { opacity: 0.72, transform: [{ scale: 0.985 }] },
  iconBox: {
    width: 44, height: 44, borderRadius: RADIUS.control,
    alignItems: 'center', justifyContent: 'center', marginBottom: 14,
  },
  cardTitle: { color: COLORS.text, fontFamily: FONTS.bold, fontSize: 17 },
  cardSubtitle: { color: COLORS.textMuted, fontFamily: FONTS.regular, fontSize: 11.5, lineHeight: 16, marginTop: 3, flex: 1 },
  count: { fontFamily: FONTS.bold, fontSize: 12, marginTop: 10 },
  sectionHeader: { marginTop: 28, marginBottom: 10 },
  sectionTitle: { color: COLORS.text, fontFamily: FONTS.extraBold, fontSize: 20 },
  sectionSubtitle: { color: COLORS.textMuted, fontFamily: FONTS.regular, fontSize: 12, marginTop: 1 },
  favoriteList: {
    backgroundColor: COLORS.surface, borderRadius: RADIUS.card,
    borderWidth: StyleSheet.hairlineWidth, borderColor: COLORS.border, overflow: 'hidden',
  },
  favoriteRow: {
    minHeight: 62, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.borderLight,
  },
  favoriteIcon: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: COLORS.surfaceMuted,
    alignItems: 'center', justifyContent: 'center', marginRight: 12,
  },
  favoriteCopy: { flex: 1 },
  favoriteTitle: { color: COLORS.text, fontFamily: FONTS.bold, fontSize: 14 },
  favoriteCount: { color: COLORS.textMuted, fontFamily: FONTS.regular, fontSize: 11.5, marginTop: 1 },
});
