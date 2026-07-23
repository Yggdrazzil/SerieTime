import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Modal, RefreshControl } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { COLORS, FONTS, RADIUS, SHADOW, SIZES, SPACE } from '@/lib/theme';
import { LoadError, EmptyState } from '@/components/ui';
import { LibHeader, SectionPill, Grid, ShowCell, type LibraryShow } from '@/components/library';
import { Pop, AppearItem } from '@/components/anim';
import { useFloatingSection, FloatingSectionPill } from '@/components/FloatingSection';
import { GridSkeleton } from '@/components/skeletons';
import { usePullRefresh } from '@/lib/usePullRefresh';
import { useBackClose } from '@/lib/useBackClose';

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
  { key: 'default', label: 'Ordre personnalisé' },
  { key: 'added', label: 'Dernier ajout' },
  { key: 'alpha', label: 'Ordre alphabétique' },
];
// Sections par défaut, dans l'ordre. « Regarder plus tard » garde sa propre
// section et son code couleur.
const GROUP_ORDER = ['en_cours', 'a_jour', 'termine', 'plus_tard', 'pas_commence', 'arretees'] as const;
const GROUP_LABEL: Record<string, string> = {
  en_cours: 'En cours',
  a_jour: 'À jour',
  termine: 'Terminé',
  plus_tard: 'Regarder plus tard',
  pas_commence: 'Pas commencé',
  arretees: 'Arrêté',
};
// Libellé court du repère de section quand un filtre est actif.
const FILTER_PILL: Record<Exclude<Progress, 'all'>, string> = {
  watching: 'En cours',
  not_started: 'Pas commencé',
  watchlist: 'Regarder plus tard',
  up_to_date: 'À jour',
  completed: 'Terminé',
  abandoned: 'Arrêté',
};

const remaining = (s: LibraryShow) => Math.max(0, s.progress.total - s.progress.watched);

function groupOf(s: LibraryShow): (typeof GROUP_ORDER)[number] {
  if (s.userStatus === 'abandoned') return 'arretees';
  if (s.userStatus === 'completed') return 'termine';
  if (s.userStatus === 'watchlist') return 'plus_tard';
  if (s.userStatus === 'not_started') return 'pas_commence';
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
  const insets = useSafeAreaInsets();
  const [sheet, setSheet] = useState(false);
  const [sort, setSort] = useState<Sort>('default');
  const [filter, setFilter] = useState<Progress>('all');
  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['shows', 'library'],
    queryFn: () => api.get<{ items: LibraryShow[] }>('/api/shows/library'),
  });
  const { refreshing, onRefresh } = usePullRefresh([refetch]);
  const refreshCtl = (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={onRefresh}
      tintColor={COLORS.primary}
      colors={[COLORS.primary]}
    />
  );
  const sortLabel = SORT_OPTS.find((option) => option.key === sort)?.label ?? '';
  const filterLabel = filter === 'all' ? 'Tous les statuts' : FILTER_PILL[filter];
  const filtersActive = sort !== 'default' || filter !== 'all';
  const filterA11y = `Filtres. Tri : ${sortLabel}. Progression : ${filterLabel}`;

  return (
    <Pop style={styles.screen}>
      <LibHeader
        title="Séries"
        right={
          <Pressable
            style={({ pressed }) => [styles.headerFilter, pressed && styles.controlPressed]}
            onPress={() => setSheet(true)}
            accessibilityRole="button"
            accessibilityLabel={filterA11y}
            accessibilityHint="Ouvre les options de tri et de progression"
            accessibilityState={{ selected: filtersActive }}
          >
            <Feather name="sliders" size={19} color={COLORS.primary} />
            {filtersActive ? <View style={styles.activeDot} /> : null}
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
      <Pressable
        style={({ pressed }) => [
          styles.filtersBtn,
          { bottom: Math.max(insets.bottom, SPACE.md) },
          pressed && styles.filtersPressed,
        ]}
        onPress={() => setSheet(true)}
        accessibilityRole="button"
        accessibilityLabel={filterA11y}
        accessibilityHint="Ouvre les options de tri et de progression"
        accessibilityState={{ selected: filtersActive }}
      >
        <Feather name="sliders" size={18} color={COLORS.onPrimary} />
        <Text style={styles.filtersText}>{filtersActive ? 'FILTRES ACTIFS' : 'FILTRER'}</Text>
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

function Body({
  items,
  sort,
  filter,
  refreshCtl,
}: {
  items: LibraryShow[];
  sort: Sort;
  filter: Progress;
  refreshCtl: React.ComponentProps<typeof ScrollView>['refreshControl'];
}) {
  const { registerSection, onListScroll, floatLabel } = useFloatingSection();
  if (items.length === 0) {
    return (
      <ScrollView
        refreshControl={refreshCtl}
        contentContainerStyle={styles.emptyScroll}
        showsVerticalScrollIndicator={false}
      >
        <EmptyState title="Aucune série suivie" message="Ajoutez des séries depuis Explorer." />
      </ScrollView>
    );
  }

  if (filter !== 'all') {
    const list = sortItems(items.filter((s) => matchesFilter(s, filter)), sort);
    const label = FILTER_PILL[filter];
    return (
      <View style={styles.body}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          refreshControl={refreshCtl}
          onScroll={onListScroll}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={false}
        >
          <View onLayout={registerSection(label)}>
            <SectionPill label={label} />
            {list.length > 0 ? (
              <Grid>{list.map((show) => <ShowCell key={show.id} show={show} />)}</Grid>
            ) : (
              <View style={styles.emptyFilter}>
                <EmptyState
                  title="Aucune série dans ce filtre"
                  message="Choisissez une autre progression pour retrouver le reste de votre collection."
                />
              </View>
            )}
          </View>
        </ScrollView>
        <FloatingSectionPill label={floatLabel} />
      </View>
    );
  }

  const groups = new Map<string, LibraryShow[]>();
  items.forEach((s) => {
    const g = groupOf(s);
    groups.set(g, [...(groups.get(g) ?? []), s]);
  });
  return (
    <View style={styles.body}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={refreshCtl}
        onScroll={onListScroll}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
      >
        {GROUP_ORDER.filter((g) => groups.has(g)).map((g, gi) => (
          <View key={g} onLayout={registerSection(GROUP_LABEL[g]!)}>
            <AppearItem index={gi}>
              <SectionPill label={GROUP_LABEL[g]!} />
              <Grid>{sortItems(groups.get(g)!, sort).map((show) => <ShowCell key={show.id} show={show} />)}</Grid>
            </AppearItem>
          </View>
        ))}
      </ScrollView>
      <FloatingSectionPill label={floatLabel} />
    </View>
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
  React.useEffect(() => { if (visible) { setS(sort); setF(filter); } }, [visible, sort, filter]);
  useBackClose(visible, onClose);
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable
        style={styles.overlay}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Fermer les filtres"
      />
      <View style={styles.sheetDock} pointerEvents="box-none">
        <View
          style={[styles.sheet, { paddingBottom: insets.bottom + SPACE.sm }]}
          accessibilityViewIsModal
        >
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <View style={styles.sheetCopy}>
              <Text accessibilityRole="header" style={styles.sheetTitle}>Organiser les séries</Text>
            </View>
            <Pressable
              style={({ pressed }) => [styles.closeBtn, pressed && styles.controlPressed]}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Fermer les filtres"
            >
              <Feather name="x" size={20} color={COLORS.text} />
            </Pressable>
          </View>

          <Text style={styles.sheetSectionTitle}>Trier par</Text>
          <View style={styles.chipRow}>
            {SORT_OPTS.map((option) => {
              const selected = s === option.key;
              return (
                <Pressable
                  key={option.key}
                  style={({ pressed }) => [
                    styles.chip,
                    selected && styles.chipOn,
                    pressed && styles.optionPressed,
                  ]}
                  onPress={() => setS(option.key)}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                >
                  <Text style={[styles.chipText, selected && styles.chipTextOn]}>{option.label}</Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.sheetSectionTitle}>Progression</Text>
          <ScrollView style={styles.radioScroll} showsVerticalScrollIndicator={false}>
            {PROGRESS_OPTS.map((option) => {
              const selected = f === option.key;
              return (
                <Pressable
                  key={option.key}
                  style={({ pressed }) => [styles.radioRow, pressed && styles.optionPressed]}
                  onPress={() => setF(option.key)}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                >
                  <Text style={styles.radioLabel}>{option.label}</Text>
                  <View style={[styles.radio, selected && styles.radioOn]}>
                    {selected ? <Feather name="check" size={15} color={COLORS.onPrimary} /> : null}
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>

          <View style={styles.sheetBtns}>
            <Pressable
              style={({ pressed }) => [styles.resetBtn, pressed && styles.optionPressed]}
              onPress={() => { setS('default'); setF('all'); }}
              accessibilityRole="button"
              accessibilityLabel="Réinitialiser les filtres"
            >
              <Text style={styles.resetText}>RÉINITIALISER</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.applyBtn, pressed && styles.filtersPressed]}
              onPress={() => onApply(s, f)}
              accessibilityRole="button"
            >
              <Text style={styles.applyText}>APPLIQUER</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: COLORS.bg },
  body: { flex: 1 },
  scrollContent: { paddingBottom: 120 },
  emptyScroll: { flexGrow: 1, justifyContent: 'center', paddingBottom: 88 },
  emptyFilter: { width: '100%', maxWidth: SIZES.contentMax, alignSelf: 'center' },
  headerFilter: {
    width: SIZES.touch,
    height: SIZES.touch,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: RADIUS.control,
    backgroundColor: COLORS.primarySoft,
  },
  activeDot: {
    position: 'absolute',
    top: 7,
    right: 7,
    width: 8,
    height: 8,
    borderWidth: 2,
    borderColor: COLORS.primarySoft,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.secondary,
  },
  controlPressed: { opacity: 0.76, transform: [{ scale: 0.96 }] },
  filtersBtn: {
    position: 'absolute',
    alignSelf: 'center',
    minHeight: SIZES.touchComfortable,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.xs,
    paddingHorizontal: SPACE.lg,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.primary,
    ...SHADOW.card,
  },
  filtersPressed: { opacity: 0.84, transform: [{ scale: 0.97 }] },
  filtersText: {
    color: COLORS.onPrimary,
    fontSize: 13,
    fontFamily: FONTS.extraBold,
    letterSpacing: 0.6,
  },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: COLORS.overlay },
  sheetDock: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center' },
  sheet: {
    width: '100%',
    maxWidth: 620,
    maxHeight: '92%',
    paddingHorizontal: SPACE.md,
    paddingTop: SPACE.xs,
    borderTopLeftRadius: RADIUS.sheet,
    borderTopRightRadius: RADIUS.sheet,
    backgroundColor: COLORS.sheet,
    ...SHADOW.card,
  },
  sheetHandle: {
    width: 42,
    height: 4,
    alignSelf: 'center',
    marginBottom: SPACE.sm,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.border,
  },
  sheetHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: SPACE.sm },
  sheetCopy: { flex: 1, minWidth: 0 },
  sheetTitle: { color: COLORS.text, fontSize: 19, lineHeight: 25, fontFamily: FONTS.bold },
  closeBtn: {
    width: SIZES.touch,
    height: SIZES.touch,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: RADIUS.control,
    backgroundColor: COLORS.surfaceMuted,
  },
  sheetSectionTitle: {
    color: COLORS.text,
    fontSize: 15,
    lineHeight: 20,
    fontFamily: FONTS.extraBold,
    marginTop: SPACE.md,
    marginBottom: SPACE.xs,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.xs },
  chip: {
    minHeight: SIZES.touch,
    justifyContent: 'center',
    paddingHorizontal: SPACE.md,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.surfaceMuted,
  },
  chipOn: { borderColor: COLORS.primary, backgroundColor: COLORS.primary },
  chipText: { fontSize: 13, fontFamily: FONTS.semiBold, color: COLORS.text },
  chipTextOn: { color: COLORS.onPrimary, fontFamily: FONTS.bold },
  radioScroll: { maxHeight: 320, flexShrink: 1 },
  radioRow: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACE.sm,
    paddingHorizontal: SPACE.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.borderLight,
    borderRadius: RADIUS.small,
  },
  optionPressed: { backgroundColor: COLORS.primarySoft },
  radioLabel: { flex: 1, color: COLORS.text, fontSize: 15, lineHeight: 20, fontFamily: FONTS.regular },
  radio: {
    width: 26,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: COLORS.border,
    borderRadius: 13,
  },
  radioOn: { borderColor: COLORS.primary, backgroundColor: COLORS.primary },
  sheetBtns: { flexDirection: 'row', gap: SPACE.sm, marginTop: SPACE.md },
  resetBtn: {
    flex: 1,
    minHeight: SIZES.touchComfortable,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: COLORS.border,
    borderRadius: RADIUS.pill,
  },
  resetText: { color: COLORS.text, fontSize: 12, fontFamily: FONTS.extraBold, letterSpacing: 0.45 },
  applyBtn: {
    flex: 1,
    minHeight: SIZES.touchComfortable,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.primary,
  },
  applyText: { color: COLORS.onPrimary, fontSize: 12, fontFamily: FONTS.extraBold, letterSpacing: 0.45 },
});
