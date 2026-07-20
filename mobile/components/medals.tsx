import React from 'react';
import { View, Text, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';
import Svg, { Circle, Ellipse, Defs, LinearGradient as SvgGradient, Stop } from 'react-native-svg';
import { COLORS, FONTS } from '@/lib/theme';

// ---------------------------------------------------------------------------
// Médailles PlotTime (Trophées / Badges) — demande produit 2026-07-20 :
// remplacer les pastilles plates par de vraies médailles. Chaque médaille est
// un « jeton » métallique en SVG : dégradé par palier, arête claire, reflet
// spéculaire, et anneau de PROGRESSION circulaire vers le prochain palier
// (dégradé rose → violet Prisme). Verrouillé = étain désaturé + cadenas.
// ---------------------------------------------------------------------------

export type MedalTier = 0 | 1 | 2 | 3 | 4;

export const TIER_LABELS: Record<MedalTier, string> = {
  0: 'Non débloqué',
  1: 'Bronze',
  2: 'Argent',
  3: 'Or',
  4: 'Platine',
};

// Dégradés « métal » par palier : [haut clair, cœur, bas profond].
const TIER_METAL: Record<MedalTier, [string, string, string]> = {
  0: ['#E3E0E8', '#C7C2CE', '#A9A3B3'],
  1: ['#F6C08A', '#C97C36', '#8C4F1D'],
  2: ['#F7FAFC', '#C3CCD4', '#8F9AA3'],
  3: ['#FFE9A0', '#F5BE3D', '#C8860D'],
  4: ['#EFFDFF', '#A5E4F0', '#5FB7D4'],
};

// Couleur du texte/icône posé sur le métal (contraste par palier).
const TIER_INK: Record<MedalTier, string> = {
  0: '#7A7484',
  1: '#5A3210',
  2: '#4A545D',
  3: '#6B4A05',
  4: '#155A70',
};

let medalSeq = 0;

// Médaille de badge. `progress` (0..1) remplit l'anneau vers le PROCHAIN
// palier ; à 1 (palier max), l'anneau est plein et doré.
export function MedalBadge({
  tier,
  icon,
  progress = 0,
  size = 68,
  locked,
  style,
}: {
  tier: MedalTier;
  icon: keyof typeof Feather.glyphMap;
  progress?: number;
  size?: number;
  locked?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  // Ids SVG uniques par instance (les Defs sont globaux au document sur web).
  const uid = React.useRef(`medal${medalSeq++}`).current;
  const isLocked = locked ?? tier === 0;
  const metal = TIER_METAL[isLocked ? 0 : tier];
  const ink = TIER_INK[isLocked ? 0 : tier];
  const ringW = Math.max(3, size * 0.055);
  const ringR = (size - ringW) / 2;
  const coinR = size / 2 - ringW - Math.max(2, size * 0.045);
  const c = size / 2;
  const circ = 2 * Math.PI * ringR;
  const pct = Math.max(0, Math.min(1, progress));

  return (
    <View style={[{ width: size, height: size }, style]}>
      <Svg width={size} height={size}>
        <Defs>
          <SvgGradient id={`${uid}-coin`} x1="0" y1="0" x2="0.35" y2="1">
            <Stop offset="0" stopColor={metal[0]} />
            <Stop offset="0.55" stopColor={metal[1]} />
            <Stop offset="1" stopColor={metal[2]} />
          </SvgGradient>
          <SvgGradient id={`${uid}-ring`} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={COLORS.secondary} />
            <Stop offset="1" stopColor={COLORS.primary} />
          </SvgGradient>
        </Defs>
        {/* Piste de l'anneau */}
        <Circle cx={c} cy={c} r={ringR} stroke={COLORS.borderLight} strokeWidth={ringW} fill="none" />
        {/* Progression vers le prochain palier (part de midi, sens horaire) */}
        {pct > 0 ? (
          <Circle
            cx={c}
            cy={c}
            r={ringR}
            stroke={`url(#${uid}-ring)`}
            strokeWidth={ringW}
            strokeLinecap="round"
            fill="none"
            strokeDasharray={`${circ * pct} ${circ}`}
            transform={`rotate(-90 ${c} ${c})`}
          />
        ) : null}
        {/* Jeton métallique */}
        <Circle cx={c} cy={c} r={coinR} fill={`url(#${uid}-coin)`} />
        {/* Arête claire (relief) */}
        <Circle cx={c} cy={c} r={coinR} stroke="rgba(255,255,255,0.65)" strokeWidth={1.4} fill="none" />
        <Circle cx={c} cy={c} r={coinR - 2.4} stroke="rgba(0,0,0,0.10)" strokeWidth={1} fill="none" />
        {/* Reflet spéculaire */}
        <Ellipse cx={c - coinR * 0.28} cy={c - coinR * 0.42} rx={coinR * 0.52} ry={coinR * 0.26} fill="rgba(255,255,255,0.34)" />
      </Svg>
      {/* Icône du badge, gravée dans le métal */}
      <View style={styles.center} pointerEvents="none">
        <Feather name={icon} size={size * 0.34} color={ink} />
      </View>
      {/* Cadenas des badges verrouillés */}
      {isLocked ? (
        <View style={[styles.lock, { right: size * 0.02, bottom: size * 0.02 }]} pointerEvents="none">
          <Feather name="lock" size={Math.max(10, size * 0.17)} color="#FFFFFF" />
        </View>
      ) : null}
    </View>
  );
}

// Grand médaillon de NIVEAU (héro des Trophées) : jeton or PlotTime + anneau
// d'XP vers le prochain niveau + numéro gravé.
export function LevelMedal({
  level,
  progress,
  size = 116,
  style,
}: {
  level: number;
  progress: number;
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const uid = React.useRef(`level${medalSeq++}`).current;
  const ringW = Math.max(5, size * 0.06);
  const ringR = (size - ringW) / 2;
  const coinR = size / 2 - ringW - Math.max(3, size * 0.05);
  const c = size / 2;
  const circ = 2 * Math.PI * ringR;
  const pct = Math.max(0, Math.min(1, progress));

  return (
    <View style={[{ width: size, height: size }, style]}>
      <Svg width={size} height={size}>
        <Defs>
          <SvgGradient id={`${uid}-coin`} x1="0" y1="0" x2="0.35" y2="1">
            <Stop offset="0" stopColor="#FFE9A0" />
            <Stop offset="0.55" stopColor="#FBAE00" />
            <Stop offset="1" stopColor="#C8860D" />
          </SvgGradient>
          <SvgGradient id={`${uid}-ring`} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={COLORS.secondary} />
            <Stop offset="1" stopColor={COLORS.primary} />
          </SvgGradient>
        </Defs>
        <Circle cx={c} cy={c} r={ringR} stroke="rgba(255,255,255,0.22)" strokeWidth={ringW} fill="none" />
        {pct > 0 ? (
          <Circle
            cx={c}
            cy={c}
            r={ringR}
            stroke={`url(#${uid}-ring)`}
            strokeWidth={ringW}
            strokeLinecap="round"
            fill="none"
            strokeDasharray={`${circ * pct} ${circ}`}
            transform={`rotate(-90 ${c} ${c})`}
          />
        ) : null}
        <Circle cx={c} cy={c} r={coinR} fill={`url(#${uid}-coin)`} />
        <Circle cx={c} cy={c} r={coinR} stroke="rgba(255,255,255,0.7)" strokeWidth={1.6} fill="none" />
        <Circle cx={c} cy={c} r={coinR - 3} stroke="rgba(0,0,0,0.12)" strokeWidth={1.1} fill="none" />
        <Ellipse cx={c - coinR * 0.28} cy={c - coinR * 0.44} rx={coinR * 0.55} ry={coinR * 0.27} fill="rgba(255,255,255,0.36)" />
      </Svg>
      <View style={styles.center} pointerEvents="none">
        <Text style={[styles.levelNumber, { fontSize: size * 0.32 }]} allowFontScaling={false}>
          {level}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  lock: {
    position: 'absolute',
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(58,52,68,0.92)',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  levelNumber: { color: '#5C3E03', fontFamily: FONTS.extraBold },
});
