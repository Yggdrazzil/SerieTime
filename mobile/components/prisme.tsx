import React from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type PressableProps,
  type ScrollViewProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, FONTS, RADIUS, SHADOW, SIZES, SPACE } from '@/lib/theme';

type FeatherName = React.ComponentProps<typeof Feather>['name'];

export type ScreenShellProps = {
  children: React.ReactNode;
  scroll?: boolean;
  safeTop?: boolean;
  safeBottom?: boolean;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  scrollProps?: Omit<ScrollViewProps, 'style' | 'contentContainerStyle'>;
  testID?: string;
};

export function ScreenShell({
  children,
  scroll = false,
  safeTop = true,
  safeBottom = false,
  style,
  contentContainerStyle,
  scrollProps,
  testID,
}: ScreenShellProps) {
  const insets = useSafeAreaInsets();
  const safeAreaStyle = {
    paddingTop: safeTop ? insets.top : 0,
    paddingBottom: safeBottom ? insets.bottom : 0,
  };

  if (scroll) {
    return (
      <View style={[styles.shell, safeAreaStyle, style]} testID={testID}>
        <ScrollView
          {...scrollProps}
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps={scrollProps?.keyboardShouldPersistTaps ?? 'handled'}
          showsVerticalScrollIndicator={scrollProps?.showsVerticalScrollIndicator ?? false}
        >
          <View style={[styles.content, contentContainerStyle]}>{children}</View>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={[styles.shell, safeAreaStyle, style]} testID={testID}>
      <View style={[styles.content, styles.contentFill, contentContainerStyle]}>{children}</View>
    </View>
  );
}

export type ScreenHeaderProps = {
  title: string;
  eyebrow?: string;
  subtitle?: string;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
};

export function ScreenHeader({ title, eyebrow, subtitle, leading, trailing, style }: ScreenHeaderProps) {
  return (
    <View style={[styles.screenHeader, style]}>
      {leading ? <View style={styles.headerAction}>{leading}</View> : null}
      <View style={styles.headerCopy}>
        {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
        <Text accessibilityRole="header" style={styles.screenTitle} numberOfLines={2}>
          {title}
        </Text>
        {subtitle ? <Text style={styles.screenSubtitle}>{subtitle}</Text> : null}
      </View>
      {trailing ? <View style={styles.headerAction}>{trailing}</View> : null}
    </View>
  );
}

// En-tête compact des ONGLETS (décision design 2026-07-20) : titre seul,
// centré, petit — ni eyebrow ni sous-titre. Les grands ScreenHeader restent
// pour les écrans poussés (avec bouton retour / contexte).
export function TabHeader({ title, trailing }: { title: string; trailing?: React.ReactNode }) {
  return (
    <View style={styles.tabHeader}>
      <Text accessibilityRole="header" style={styles.tabHeaderTitle} numberOfLines={1}>
        {title}
      </Text>
      {trailing ? <View style={styles.tabHeaderTrailing}>{trailing}</View> : null}
    </View>
  );
}

export type IconActionProps = Omit<PressableProps, 'children' | 'style'> & {
  icon: FeatherName;
  label: string;
  tone?: 'ghost' | 'soft' | 'primary';
  color?: string;
  iconSize?: number;
  style?: StyleProp<ViewStyle>;
};

export function IconAction({
  icon,
  label,
  tone = 'ghost',
  color,
  iconSize = 20,
  style,
  disabled,
  accessibilityState,
  ...pressableProps
}: IconActionProps) {
  const toneStyle = tone === 'primary' ? styles.iconPrimary : tone === 'soft' ? styles.iconSoft : styles.iconGhost;
  const iconColor = color ?? (tone === 'primary' ? COLORS.onPrimary : COLORS.text);

  return (
    <Pressable
      {...pressableProps}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ ...accessibilityState, disabled: Boolean(disabled) }}
      style={({ pressed }) => [styles.iconAction, toneStyle, style, pressed && !disabled && styles.pressed, disabled && styles.disabled]}
    >
      <Feather name={icon} size={iconSize} color={iconColor} />
    </Pressable>
  );
}

export type SectionHeaderProps = {
  title: string;
  eyebrow?: string;
  actionLabel?: string;
  onAction?: () => void;
  trailing?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
};

export function SectionHeader({ title, eyebrow, actionLabel, onAction, trailing, style }: SectionHeaderProps) {
  return (
    <View style={[styles.sectionHeader, style]}>
      <View style={styles.sectionCopy}>
        {eyebrow ? <Text style={styles.sectionEyebrow}>{eyebrow}</Text> : null}
        <Text accessibilityRole="header" style={styles.sectionTitle}>{title}</Text>
      </View>
      {trailing ?? (actionLabel && onAction ? (
        <Pressable
          onPress={onAction}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          hitSlop={4}
          style={({ pressed }) => [styles.sectionAction, pressed && styles.actionPressed]}
        >
          <Text style={styles.sectionActionText}>{actionLabel}</Text>
          <Feather name="chevron-right" size={17} color={COLORS.primary} />
        </Pressable>
      ) : null)}
    </View>
  );
}

export type SegmentedOption<T extends string> = {
  value: T;
  label: string;
  accessibilityLabel?: string;
};

export type SegmentedFilterProps<T extends string> = {
  options: ReadonlyArray<SegmentedOption<T>>;
  value: T;
  onChange: (value: T) => void;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
};

export function SegmentedFilter<T extends string>({
  options,
  value,
  onChange,
  accessibilityLabel,
  style,
}: SegmentedFilterProps<T>) {
  return (
    <View style={[styles.segmented, style]} accessibilityLabel={accessibilityLabel}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            accessibilityRole="tab"
            accessibilityLabel={option.accessibilityLabel ?? option.label}
            accessibilityState={{ selected }}
            style={({ pressed }) => [
              styles.segment,
              selected && styles.segmentSelected,
              pressed && styles.segmentPressed,
            ]}
          >
            <Text style={[styles.segmentLabel, selected && styles.segmentLabelSelected]} numberOfLines={1}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export type PrismeCardProps = {
  children: React.ReactNode;
  onPress?: PressableProps['onPress'];
  accessibilityLabel?: string;
  accessibilityHint?: string;
  elevated?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export function PrismeCard({
  children,
  onPress,
  accessibilityLabel,
  accessibilityHint,
  elevated = false,
  disabled = false,
  style,
  testID,
}: PrismeCardProps) {
  const cardStyle = [styles.card, elevated && SHADOW.card, style];
  if (!onPress) return <View style={cardStyle} testID={testID}>{children}</View>;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}
      testID={testID}
      style={({ pressed }) => [cardStyle, pressed && !disabled && styles.cardPressed, disabled && styles.disabled]}
    >
      {children}
    </Pressable>
  );
}

export type ProgressBarProps = {
  value: number;
  max?: number;
  label?: string;
  showValue?: boolean;
  color?: string;
  trackColor?: string;
  height?: number;
  style?: StyleProp<ViewStyle>;
};

export function ProgressBar({
  value,
  max = 100,
  label = 'Progression',
  showValue = false,
  color = COLORS.primary,
  trackColor = COLORS.primarySoft,
  height = 7,
  style,
}: ProgressBarProps) {
  const safeMax = Number.isFinite(max) && max > 0 ? max : 100;
  const safeValue = Number.isFinite(value) ? Math.min(safeMax, Math.max(0, value)) : 0;
  const percent = Math.round((safeValue / safeMax) * 100);

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: safeMax, now: safeValue, text: `${percent}%` }}
      style={style}
    >
      {showValue ? (
        <View style={styles.progressHeader}>
          <Text style={styles.progressLabel}>{label}</Text>
          <Text style={styles.progressValue}>{percent}%</Text>
        </View>
      ) : null}
      <View style={[styles.progressTrack, { height, backgroundColor: trackColor }]}>
        <View style={[styles.progressFill, { width: `${percent}%`, backgroundColor: color }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: COLORS.bg },
  scroll: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  content: {
    width: '100%',
    maxWidth: SIZES.contentMax,
    alignSelf: 'center',
    paddingHorizontal: SPACE.md,
    paddingBottom: SPACE.lg,
  },
  contentFill: { flex: 1 },
  screenHeader: {
    minHeight: SIZES.header,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACE.sm,
    paddingTop: SPACE.sm,
    paddingBottom: SPACE.md,
  },
  headerAction: { minWidth: SIZES.touch, minHeight: SIZES.touch, alignItems: 'center', justifyContent: 'center' },
  headerCopy: { flex: 1, minWidth: 0 },
  tabHeader: { height: 48, alignItems: 'center', justifyContent: 'center' },
  tabHeaderTitle: { color: COLORS.text, fontFamily: FONTS.extraBold, fontSize: 18 },
  tabHeaderTrailing: { position: 'absolute', right: SPACE.md, height: '100%', justifyContent: 'center' },
  eyebrow: {
    color: COLORS.primary,
    fontFamily: FONTS.bold,
    fontSize: 11,
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    marginBottom: SPACE.xxs,
  },
  screenTitle: { color: COLORS.text, fontFamily: FONTS.extraBold, fontSize: 28, lineHeight: 34, letterSpacing: -0.5 },
  screenSubtitle: { color: COLORS.textMuted, fontFamily: FONTS.regular, fontSize: 14, lineHeight: 20, marginTop: SPACE.xxs },
  iconAction: {
    width: SIZES.touch,
    height: SIZES.touch,
    borderRadius: RADIUS.control,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconGhost: { backgroundColor: 'transparent' },
  iconSoft: { backgroundColor: COLORS.surfaceMuted, borderWidth: 1, borderColor: COLORS.borderLight },
  iconPrimary: { backgroundColor: COLORS.primary },
  pressed: { opacity: 0.78, transform: [{ scale: 0.96 }] },
  disabled: { opacity: 0.45 },
  sectionHeader: {
    minHeight: SIZES.touch,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACE.sm,
    marginTop: SPACE.sm,
    marginBottom: SPACE.xs,
  },
  sectionCopy: { flex: 1 },
  sectionEyebrow: { color: COLORS.primary, fontFamily: FONTS.bold, fontSize: 10, letterSpacing: 0.9, textTransform: 'uppercase' },
  sectionTitle: { color: COLORS.text, fontFamily: FONTS.bold, fontSize: 19, lineHeight: 25 },
  sectionAction: {
    minHeight: SIZES.touch,
    minWidth: SIZES.touch,
    paddingHorizontal: SPACE.xs,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    borderRadius: RADIUS.control,
  },
  sectionActionText: { color: COLORS.primary, fontFamily: FONTS.bold, fontSize: 13 },
  actionPressed: { backgroundColor: COLORS.primarySoft },
  segmented: {
    flexDirection: 'row',
    alignItems: 'stretch',
    padding: SPACE.xxs,
    gap: SPACE.xxs,
    borderRadius: RADIUS.control,
    backgroundColor: COLORS.surfaceMuted,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
  },
  segment: {
    flex: 1,
    minHeight: SIZES.touch,
    paddingHorizontal: SPACE.sm,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: RADIUS.small,
  },
  segmentSelected: { backgroundColor: COLORS.surface, ...SHADOW.card },
  segmentPressed: { opacity: 0.76 },
  segmentLabel: { color: COLORS.textMuted, fontFamily: FONTS.semiBold, fontSize: 13 },
  segmentLabelSelected: { color: COLORS.primary, fontFamily: FONTS.bold },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.card,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    padding: SPACE.md,
  },
  cardPressed: { opacity: 0.9, transform: [{ scale: 0.99 }] },
  progressHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SPACE.sm, marginBottom: SPACE.xs },
  progressLabel: { color: COLORS.textMuted, fontFamily: FONTS.semiBold, fontSize: 12 },
  progressValue: { color: COLORS.text, fontFamily: FONTS.bold, fontSize: 12 },
  progressTrack: { width: '100%', borderRadius: RADIUS.pill, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: RADIUS.pill },
});
