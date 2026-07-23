import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Modal, RefreshControl } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { MediaDto } from '@/lib/types';
import { COLORS, FONTS, RADIUS, SHADOW, SIZES, SPACE } from '@/lib/theme';
import { LoadError, EmptyState } from '@/components/ui';
import { LibHeader, SectionPill, Grid, MovieCell } from '@/components/library';
import { AppearItem, Pop } from '@/components/anim';
import { useFloatingSection, FloatingSectionPill } from '@/components/FloatingSection';
import { GridSkeleton } from '@/components/skeletons';
import { usePullRefresh } from '@/lib/usePullRefresh';
import { useBackClose } from '@/lib/useBackClose';

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
  const insets = useSafeAreaInsets();
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
  const { registerSection, onListScroll, floatLabel } = useFloatingSection();
  const refreshCtl = (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={onRefresh}
      tintColor={COLORS.primary}
      colors={[COLORS.primary]}
    />
  );
  const sortLabel = SORT_OPTS.find((option) => option.key === sort)?.label ?? '';
  const filterLabel = FILTER_OPTS.find((option) => option.key === filter)?.label ?? '';
  const filtersActive = sort !== 'last_watched' || filter !== 'all';
  const filterA11y = `Filtres. Tri : ${sortLabel}. Avancement : ${filterLabel}`;

  return (
    <Pop style={styles.screen}>
      <LibHeader
        title="Films"
        right={
          <Pressable
            style={({ pressed }) => [styles.headerFilter, pressed && styles.controlPressed]}
            onPress={() => setSheet(true)}
            accessibilityRole="button"
            accessibilityLabel={filterA11y}
            accessibilityHint="Ouvre les options de tri et d'avancement"
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
      ) : seen.length === 0 && unseen.length === 0 ? (
        <ScrollView
          refreshControl={refreshCtl}
          contentContainerStyle={styles.emptyScroll}
          showsVerticalScrollIndicator={false}
        >
          <EmptyState
            title={filter === 'all' ? 'Aucun film' : 'Aucun film correspondant'}
            message={filter === 'all'
              ? 'Ajoutez des films depuis Explorer.'
              : 'Choisissez un autre avancement pour retrouver le reste de votre collection.'}
          />
        </ScrollView>
      ) : (
        <View style={styles.body}>
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            refreshControl={refreshCtl}
            onScroll={onListScroll}
            scrollEventThrottle={16}
            showsVerticalScrollIndicator={false}
          >
            {seen.length > 0 ? (
              <View onLayout={registerSection('Vu')}>
                <AppearItem index={0}>
                  <SectionPill label="Vu" />
                  <Grid>{seen.map((movie) => <MovieCell key={movie.id} movie={movie} />)}</Grid>
                </AppearItem>
              </View>
            ) : null}
            {unseen.length > 0 ? (
              <View onLayout={registerSection('Non vu')}>
                <AppearItem index={1}>
                  <SectionPill label="Non vu" />
                  <Grid>{unseen.map((movie) => <MovieCell key={movie.id} movie={movie} />)}</Grid>
                </AppearItem>
              </View>
            ) : null}
          </ScrollView>
          <FloatingSectionPill label={floatLabel} />
        </View>
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
        accessibilityHint="Ouvre les options de tri et d'avancement"
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

function FilterSheet({
  visible, sort, filter, onClose, onApply,
}: {
  visible: boolean; sort: Sort; filter: Filter; onClose: () => void; onApply: (s: Sort, f: Filter) => void;
}) {
  const insets = useSafeAreaInsets();
  const [s, setS] = useState<Sort>(sort);
  const [f, setF] = useState<Filter>(filter);
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
              <Text accessibilityRole="header" style={styles.sheetTitle}>Organiser les films</Text>
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

          <Text style={styles.sheetSectionTitle}>Avancement</Text>
          <ScrollView style={styles.radioScroll} showsVerticalScrollIndicator={false}>
            {FILTER_OPTS.map((option) => {
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
              onPress={() => { setS('last_watched'); setF('all'); }}
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
  radioScroll: { maxHeight: 220, flexShrink: 1 },
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
