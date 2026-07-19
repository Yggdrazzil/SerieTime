import { createElement, useEffect, useRef, useState } from 'react';
import { Text, View, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { GamificationMeDto } from '@/lib/types';
import { COLORS, FONTS, RADIUS, SHADOW, SPACE } from '@/lib/theme';
import { SlideUpBar } from '@/components/anim';

// Gamification (spec 2026-07-16 §10) — toast de déblocage global : les
// mutations de visionnage invalident `['gamification','me']` (cf. index.tsx,
// EpisodeSheet.tsx, show/[id].tsx, game/[id].tsx) ; comme cette requête est
// montée en permanence ici, l'invalidation la refait fetcher et ce hook
// compare l'ancienne/nouvelle valeur pour détecter les nouveautés.
// NB : fichier en .ts (pas .tsx, cf. brief) — le rendu utilise createElement
// plutôt que JSX.
const TIER_LABELS: Record<number, string> = { 1: 'bronze', 2: 'argent', 3: 'or', 4: 'platine' };

function diffMessages(prev: GamificationMeDto, next: GamificationMeDto): string[] {
  const messages: string[] = [];
  if (next.level > prev.level) {
    messages.push(`⬆️ Niveau ${next.level} — ${next.levelTitle} !`);
  }
  const prevTierById = new Map(prev.badges.map((b) => [b.id, b.tier]));
  for (const badge of next.badges) {
    const prevTier = prevTierById.get(badge.id) ?? 0;
    if (badge.tier > prevTier) {
      const tierLabel = TIER_LABELS[badge.tier] ?? `palier ${badge.tier}`;
      messages.push(`🏆 Badge débloqué : ${badge.label} (${tierLabel})`);
    }
  }
  return messages;
}

// Hook seul (sans rendu) — utile si un écran veut connaître le message courant.
export function useGamificationToasts(): string | null {
  const { data } = useQuery({
    queryKey: ['gamification', 'me'],
    queryFn: () => api.get<GamificationMeDto>('/api/gamification/me'),
    staleTime: 30_000,
  });
  const prevRef = useRef<GamificationMeDto | null>(null);
  const queueRef = useRef<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const advance = () => {
    const next = queueRef.current.shift();
    setMessage(next ?? null);
    if (next) {
      timerRef.current = setTimeout(() => {
        setMessage(null);
        timerRef.current = setTimeout(advance, 320);
      }, 2800);
    }
  };

  useEffect(() => {
    if (!data) return;
    const prev = prevRef.current;
    prevRef.current = data;
    // Pas de comparaison au tout premier chargement (sinon on « toasterait »
    // tout l'historique du compte à chaque ouverture de l'app).
    if (!prev) return;
    const messages = diffMessages(prev, data);
    if (messages.length === 0) return;
    queueRef.current.push(...messages);
    if (!timerRef.current && !message) advance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  return message;
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    alignItems: 'center', paddingHorizontal: SPACE.md, zIndex: 1000, elevation: 12,
  },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE.sm,
    width: '100%', maxWidth: 520,
    backgroundColor: COLORS.surface, borderRadius: RADIUS.card,
    borderWidth: 1, borderColor: COLORS.borderLight,
    paddingVertical: SPACE.sm, paddingHorizontal: SPACE.md,
    ...SHADOW.card,
  },
  iconWrap: {
    width: 34, height: 34, borderRadius: 17, flexShrink: 0,
    alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.primarySoft,
  },
  text: { flex: 1, fontSize: 14, fontFamily: FONTS.extraBold, color: COLORS.text, letterSpacing: 0.2 },
});

// Composant à monter UNE fois, en dehors de la navigation (root layout) pour
// rester visible quel que soit l'écran affiché — web ET natif (SlideUpBar
// gère déjà les deux, cf. components/anim.tsx).
export function GamificationToastHost() {
  const message = useGamificationToasts();
  const insets = useSafeAreaInsets();
  return createElement(SlideUpBar, {
    visible: !!message,
    style: [styles.bar, { paddingBottom: insets.bottom + 16 }],
    children: createElement(
      View,
      { style: styles.card },
      createElement(
        View,
        { style: styles.iconWrap },
        createElement(Feather, { name: 'award', size: 17, color: COLORS.primary }),
      ),
      createElement(Text, { style: styles.text }, message),
    ),
  });
}
