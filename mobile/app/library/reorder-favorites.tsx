import React, { useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Image } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, tmdbImage } from '@/lib/api';
import type { MediaDto } from '@/lib/types';
import { COLORS, FONTS } from '@/lib/theme';
import { CELL_W, type LibraryShow } from '@/components/library';
import { DragGrid } from '@/components/DragGrid';
import { AnimatedFill, Pop } from '@/components/anim';
import { GridSkeleton } from '@/components/skeletons';
import { LoadError, EmptyState } from '@/components/ui';
import { useFavoritesData, sortFavorites } from '@/components/favorites';

const CELL_H = CELL_W * 1.5;

// Écran « Faites glisser et déposez pour réorganiser votre liste » (TV Time).
// L'ordre est sauvegardé à chaque dépôt ; « Terminé » referme l'écran.
export default function ReorderFavoritesScreen() {
  const { type } = useLocalSearchParams<{ type?: string }>();
  const kind = type === 'movie' ? 'movie' : 'show';
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const scrollRef = useRef<ScrollView>(null);
  const scrollOffset = useRef(0);
  const [scrollLocked, setScrollLocked] = useState(false);

  const { favs, isLoading, isError, hasData, refetch, isRefetching } = useFavoritesData(kind);
  // Ordre d'ouverture de l'écran : l'ordre utilisateur courant. Le DragGrid
  // devient ensuite la source de vérité locale (pas re-trié à chaque refetch).
  const initial = useMemo(() => sortFavorites(favs, 'user'), [favs]);

  const save = useMutation({
    mutationFn: (ids: string[]) => api.post('/api/profile/favorites/reorder', { type: kind, ids }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: kind === 'movie' ? ['movies', 'library', 'all'] : ['shows', 'library'] });
      qc.invalidateQueries({ queryKey: ['profile'] });
    },
  });

  return (
    <Pop style={{ backgroundColor: COLORS.white }}>
      <View style={[styles.topBar, { paddingTop: insets.top + 6 }]}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.topBtn}>
          <Feather name="chevron-left" size={28} color={COLORS.black} />
        </Pressable>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Text style={styles.done}>Terminé</Text>
        </Pressable>
      </View>
      {isLoading ? (
        <GridSkeleton />
      ) : isError && !hasData ? (
        <LoadError onRetry={refetch} busy={isRefetching} />
      ) : (
        <ScrollView
          ref={scrollRef}
          scrollEnabled={!scrollLocked}
          scrollEventThrottle={16}
          onScroll={(e) => { scrollOffset.current = e.nativeEvent.contentOffset.y; }}
          contentContainerStyle={{ paddingBottom: 32 }}
        >
          <Text style={styles.title}>Faites glisser et déposez pour réorganiser votre liste</Text>
          <View style={styles.divider} />
          {initial.length === 0 ? (
            <EmptyState title="Aucun favori à réorganiser" />
          ) : (
            <DragGrid
              data={initial}
              keyOf={(m) => m.id}
              cellHeight={CELL_H}
              renderItem={(m) => <ReorderCell media={m} isShow={kind === 'show'} />}
              onReorder={(items) => save.mutate(items.map((m) => m.id))}
              onDragStateChange={setScrollLocked}
              scrollRef={scrollRef}
              scrollOffsetRef={scrollOffset}
            />
          )}
        </ScrollView>
      )}
    </Pop>
  );
}

// Affiche seule (avec barre de progression pour les séries) : pas de tap fiche
// ici, l'écran est dédié au glisser-déposer.
function ReorderCell({ media, isShow }: { media: MediaDto; isShow: boolean }) {
  const uri = tmdbImage(media.posterPath);
  const progress = (media as LibraryShow).progress;
  const started = isShow && progress && progress.watched > 0;
  const done = started && progress.total > 0 && progress.watched >= progress.total;
  const pct = started && progress.total > 0 ? Math.min(100, (progress.watched / progress.total) * 100) : 0;
  return (
    <View style={styles.posterBox}>
      {uri ? (
        <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      ) : (
        <View style={styles.posterEmpty}>
          <Feather name={isShow ? 'tv' : 'film'} size={22} color="#b4b4b4" />
          <Text style={styles.posterTitle} numberOfLines={3}>{media.title}</Text>
        </View>
      )}
      {started ? (
        <View style={styles.barTrack}>
          <AnimatedFill pct={pct} color={done ? COLORS.green : COLORS.yellow} style={styles.barFill} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingBottom: 2, paddingRight: 16 },
  topBtn: { width: 46, paddingVertical: 8, justifyContent: 'center' },
  done: { color: COLORS.blue, fontSize: 17, fontFamily: FONTS.regular },
  title: { fontSize: 19, fontFamily: FONTS.extraBold, lineHeight: 26, paddingHorizontal: 16, marginTop: 6, marginBottom: 14 },
  divider: { height: 1, backgroundColor: COLORS.borderLight, marginBottom: 12 },
  posterBox: { flex: 1, borderRadius: 6, overflow: 'hidden', backgroundColor: '#e5e5e5' },
  posterEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6, gap: 6 },
  posterTitle: { fontSize: 11, fontFamily: FONTS.bold, color: '#777', textAlign: 'center' },
  barTrack: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 4, backgroundColor: 'rgba(255,212,0,0.30)' },
  barFill: { position: 'absolute', left: 0, bottom: 0, top: 0 },
});
