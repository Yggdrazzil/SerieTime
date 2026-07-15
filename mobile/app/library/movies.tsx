import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Modal, RefreshControl } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { MediaDto } from '@/lib/types';
import { COLORS, FONTS } from '@/lib/theme';
import { LoadError, EmptyState } from '@/components/ui';
import { LibHeader, SectionPill, Grid, MovieCell } from '@/components/library';
import { Pop } from '@/components/anim';
import { GridSkeleton } from '@/components/skeletons';
import { usePullRefresh } from '@/lib/usePullRefresh';

type Sort = 'last_watched' | 'last_added' | 'alpha';
type Filter = 'all' | 'seen' | 'unseen';

const SORT_OPTS: { key: Sort; label: string }[] = [
  { key: 'last_watched', label: 'Dernier visionnage' },
  { key: 'last_added', label: 'Dernier ajout' },
  { key: 'alpha', label: 'Ordre alphabétique' },
];
const FILTER_OPTS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'Tous' },
  { key: 'seen', label: 'Vu' },
  { key: 'unseen', label: 'Non vu' },
];

export default function LibraryMoviesScreen() {
  const [sheet, setSheet] = useState(false);
  const [sort, setSort] = useState<Sort>('last_watched');
  const [filter, setFilter] = useState<Filter>('all');
  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['movies', 'library', sort, filter],
    queryFn: () => api.get<{ seen: MediaDto[]; unseen: MediaDto[] }>(`/api/movies/profile?sort=${sort}&filter=${filter}`),
  });
  const seen = data?.seen ?? [];
  const unseen = data?.unseen ?? [];
  const { refreshing, onRefresh } = usePullRefresh([refetch]);

  return (
    <Pop style={{ backgroundColor: COLORS.white }}>
      <LibHeader
        title="Films"
        right={
          <Pressable style={styles.eye} onPress={() => setSheet(true)} accessibilityRole="button" accessibilityLabel="Filtres">
            <Feather name="eye" size={20} color={COLORS.black} />
          </Pressable>
        }
      />
      {isLoading ? (
        <GridSkeleton />
      ) : isError && !data ? (
        <LoadError onRetry={refetch} busy={isRefetching} />
      ) : seen.length === 0 && unseen.length === 0 ? (
        <EmptyState title="Aucun film" message="Ajoutez des films depuis Explorer." />
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: 120 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.yellow} colors={[COLORS.yellow]} />}
        >
          {seen.length > 0 ? (
            <View>
              <SectionPill label="Vu" />
              <Grid>{seen.map((m) => <MovieCell key={m.id} movie={m} />)}</Grid>
            </View>
          ) : null}
          {unseen.length > 0 ? (
            <View>
              <SectionPill label="Non vu" />
              <Grid>{unseen.map((m) => <MovieCell key={m.id} movie={m} />)}</Grid>
            </View>
          ) : null}
        </ScrollView>
      )}
      <Pressable style={styles.filtresBtn} onPress={() => setSheet(true)}>
        <Feather name="sliders" size={18} color={COLORS.black} />
        <Text style={styles.filtresText}>FILTRES</Text>
      </Pressable>
      <FilterSheet
        visible={sheet}
        sort={sort}
        filter={filter}
        onClose={() => setSheet(false)}
        onApply={(s, f) => { setSort(s); setFilter(f); setSheet(false); }}
      />
    </Pop>
  );
}

function FilterSheet({
  visible, sort, filter, onClose, onApply,
}: {
  visible: boolean; sort: Sort; filter: Filter; onClose: () => void; onApply: (s: Sort, f: Filter) => void;
}) {
  const insets = useSafeAreaInsets();
  const [s, setS] = useState<Sort>(sort);
  const [f, setF] = useState<Filter>(filter);
  React.useEffect(() => { if (visible) { setS(sort); setF(filter); } }, [visible, sort, filter]);
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]}>
        <Text style={styles.sheetTitle}>Trier par</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingHorizontal: 4 }}>
          {SORT_OPTS.map((o) => (
            <Pressable key={o.key} style={[styles.chip, s === o.key && styles.chipOn]} onPress={() => setS(o.key)}>
              <Text style={[styles.chipText, s === o.key && styles.chipTextOn]}>{o.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
        <Text style={[styles.sheetTitle, { marginTop: 18 }]}>Avancement</Text>
        {FILTER_OPTS.map((o) => (
          <Pressable key={o.key} style={styles.radioRow} onPress={() => setF(o.key)}>
            <Text style={styles.radioLabel}>{o.label}</Text>
            <View style={[styles.radio, f === o.key && styles.radioOn]}>
              {f === o.key ? <Feather name="check" size={16} color={COLORS.black} /> : null}
            </View>
          </Pressable>
        ))}
        <View style={styles.sheetBtns}>
          <Pressable style={styles.resetBtn} onPress={() => { setS('last_watched'); setF('all'); }}>
            <Text style={styles.resetText}>RÉINITIALISER</Text>
          </Pressable>
          <Pressable style={styles.applyBtn} onPress={() => onApply(s, f)}>
            <Text style={styles.applyText}>APPLIQUER</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  eye: { width: 40, height: 40, borderRadius: 10, backgroundColor: COLORS.yellow, alignItems: 'center', justifyContent: 'center' },
  filtresBtn: {
    position: 'absolute', bottom: 24, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: COLORS.yellow, borderRadius: 999, paddingHorizontal: 26, paddingVertical: 13, elevation: 4,
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.2, shadowRadius: 8,
  },
  filtresText: { fontSize: 14, fontFamily: FONTS.extraBold, letterSpacing: 0.6 },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: COLORS.overlay },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: COLORS.white, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 20 },
  sheetTitle: { fontSize: 18, fontFamily: FONTS.extraBold, marginBottom: 10 },
  chip: { backgroundColor: COLORS.chipGrey, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 9 },
  chipOn: { backgroundColor: COLORS.yellow },
  chipText: { fontSize: 13, fontFamily: FONTS.semiBold, color: '#333' },
  chipTextOn: { color: COLORS.black },
  radioRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.borderLight },
  radioLabel: { fontSize: 15, fontFamily: FONTS.regular },
  radio: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: COLORS.border, alignItems: 'center', justifyContent: 'center' },
  radioOn: { backgroundColor: COLORS.yellow, borderColor: COLORS.yellow },
  sheetBtns: { flexDirection: 'row', gap: 12, marginTop: 14 },
  resetBtn: { flex: 1, borderWidth: 1.5, borderColor: COLORS.border, borderRadius: 999, paddingVertical: 11, alignItems: 'center' },
  resetText: { fontSize: 13, fontFamily: FONTS.extraBold, letterSpacing: 0.5, color: '#666' },
  applyBtn: { flex: 1, backgroundColor: COLORS.yellow, borderRadius: 999, paddingVertical: 11, alignItems: 'center' },
  applyText: { fontSize: 13, fontFamily: FONTS.extraBold, letterSpacing: 0.5 },
});
