import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Modal, RefreshControl } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { COLORS, FONTS } from '@/lib/theme';
import { LoadError, EmptyState } from '@/components/ui';
import { LibHeader, SectionPill, Grid, ShowCell, type LibraryShow } from '@/components/library';
import { Pop, AppearItem } from '@/components/anim';
import { GridSkeleton } from '@/components/skeletons';
import { usePullRefresh } from '@/lib/usePullRefresh';

type Sort = 'default' | 'added' | 'alpha';
type Progress = 'all' | 'watching' | 'not_started' | 'watchlist' | 'up_to_date' | 'completed' | 'abandoned';

const PROGRESS_OPTS: { key: Progress; label: string }[] = [
  { key: 'all', label: 'Tout' },
  { key: 'watching', label: 'Vos séries en cours' },
  { key: 'not_started', label: "N'a pas encore commencé" },
  { key: 'watchlist', label: 'Regarder plus tard' },
  { key: 'up_to_date', label: 'À jour' },
  { key: 'completed', label: 'Terminé' },
  { key: 'abandoned', label: 'Arrêté' },
];
const SORT_OPTS: { key: Sort; label: string }[] = [
  { key: 'default', label: 'Ordre TV Time' },
  { key: 'added', label: 'Dernier ajout' },
  { key: 'alpha', label: 'Ordre alphabétique' },
];
// Sections par défaut (façon TV Time), dans l'ordre.
const GROUP_ORDER = ['en_cours', 'a_jour', 'termine', 'pas_commence', 'arretees'] as const;
const GROUP_LABEL: Record<string, string> = {
  en_cours: 'En cours',
  a_jour: 'À jour',
  termine: 'Terminé',
  pas_commence: 'Pas commencé',
  arretees: 'Arrêté',
};

const remaining = (s: LibraryShow) => Math.max(0, s.progress.total - s.progress.watched);

function groupOf(s: LibraryShow): (typeof GROUP_ORDER)[number] {
  if (s.userStatus === 'abandoned') return 'arretees';
  if (s.userStatus === 'completed') return 'termine';
  if (s.userStatus === 'not_started' || s.userStatus === 'watchlist') return 'pas_commence';
  return remaining(s) === 0 ? 'a_jour' : 'en_cours';
}

function matchesFilter(s: LibraryShow, f: Progress): boolean {
  switch (f) {
    case 'all': return true;
    case 'watching': return s.userStatus === 'watching' || s.userStatus === 'paused';
    case 'not_started': return s.userStatus === 'not_started';
    case 'watchlist': return s.userStatus === 'watchlist';
    case 'up_to_date': return (s.userStatus === 'watching' || s.userStatus === 'paused') && remaining(s) === 0;
    case 'completed': return s.userStatus === 'completed';
    case 'abandoned': return s.userStatus === 'abandoned';
  }
}

function sortItems(items: LibraryShow[], sort: Sort): LibraryShow[] {
  const arr = [...items];
  if (sort === 'alpha') arr.sort((a, b) => a.title.localeCompare(b.title, 'fr'));
  else if (sort === 'added') arr.sort((a, b) => new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime());
  else arr.sort((a, b) => (new Date(b.lastWatchedAt ?? 0).getTime()) - (new Date(a.lastWatchedAt ?? 0).getTime()));
  return arr;
}

export default function LibraryShowsScreen() {
  const [sheet, setSheet] = useState(false);
  const [sort, setSort] = useState<Sort>('default');
  const [filter, setFilter] = useState<Progress>('all');
  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['shows', 'library'],
    queryFn: () => api.get<{ items: LibraryShow[] }>('/api/shows/library'),
  });
  const { refreshing, onRefresh } = usePullRefresh([refetch]);
  const refreshCtl = <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.yellow} colors={[COLORS.yellow]} />;

  return (
    <Pop style={{ backgroundColor: COLORS.white }}>
      <LibHeader
        title="Séries"
        right={
          <Pressable style={styles.eye} onPress={() => setSheet(true)}>
            <Feather name="eye" size={20} color={COLORS.black} />
          </Pressable>
        }
      />
      {isLoading ? (
        <GridSkeleton />
      ) : isError && !data ? (
        <LoadError onRetry={refetch} busy={isRefetching} />
      ) : (
        <Body items={data?.items ?? []} sort={sort} filter={filter} refreshCtl={refreshCtl} />
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

function Body({ items, sort, filter, refreshCtl }: { items: LibraryShow[]; sort: Sort; filter: Progress; refreshCtl: React.ComponentProps<typeof ScrollView>['refreshControl'] }) {
  if (items.length === 0) return <EmptyState title="Aucune série suivie" message="Ajoutez des séries depuis Explorer." />;

  // Filtre actif : grille à plat. Sinon : sections par statut (façon TV Time).
  if (filter !== 'all') {
    const list = sortItems(items.filter((s) => matchesFilter(s, filter)), sort);
    return (
      <ScrollView contentContainerStyle={{ paddingBottom: 120 }} refreshControl={refreshCtl}>
        <Grid>{list.map((s) => <ShowCell key={s.id} show={s} />)}</Grid>
      </ScrollView>
    );
  }

  const groups = new Map<string, LibraryShow[]>();
  items.forEach((s) => {
    const g = groupOf(s);
    groups.set(g, [...(groups.get(g) ?? []), s]);
  });
  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 120 }} refreshControl={refreshCtl}>
      {GROUP_ORDER.filter((g) => groups.has(g)).map((g, gi) => (
        <AppearItem key={g} index={gi}>
          <SectionPill label={GROUP_LABEL[g]!} />
          <Grid>{sortItems(groups.get(g)!, sort).map((s) => <ShowCell key={s.id} show={s} />)}</Grid>
        </AppearItem>
      ))}
    </ScrollView>
  );
}

function FilterSheet({
  visible, sort, filter, onClose, onApply,
}: {
  visible: boolean; sort: Sort; filter: Progress; onClose: () => void; onApply: (s: Sort, f: Progress) => void;
}) {
  const insets = useSafeAreaInsets();
  const [s, setS] = useState<Sort>(sort);
  const [f, setF] = useState<Progress>(filter);
  // Réaligner l'état local à l'ouverture.
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
        <Text style={[styles.sheetTitle, { marginTop: 18 }]}>Progression</Text>
        <ScrollView style={{ maxHeight: 320 }}>
          {PROGRESS_OPTS.map((o) => (
            <Pressable key={o.key} style={styles.radioRow} onPress={() => setF(o.key)}>
              <Text style={styles.radioLabel}>{o.label}</Text>
              <View style={[styles.radio, f === o.key && styles.radioOn]}>
                {f === o.key ? <Feather name="check" size={16} color={COLORS.black} /> : null}
              </View>
            </Pressable>
          ))}
        </ScrollView>
        <View style={styles.sheetBtns}>
          <Pressable style={styles.resetBtn} onPress={() => { setS('default'); setF('all'); }}>
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
    backgroundColor: COLORS.yellow, borderRadius: 999, paddingHorizontal: 26, paddingVertical: 13, ...({ elevation: 4 }),
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
