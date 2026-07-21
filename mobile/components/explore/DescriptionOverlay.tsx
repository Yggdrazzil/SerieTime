import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { api } from '@/lib/api';
import { COLORS, FONTS, RADIUS, SHADOW, SIZES, SPACE } from '@/lib/theme';
import { SlideUpBar } from '@/components/anim';
import { useHideTabBar } from '@/lib/tabBarHidden';
import type { FeedItem } from './types';

type DetailInfo = {
  media?: { genres?: string | null };
  show?: { network?: string | null; platform?: string | null } | null;
  cast?: { name: string }[];
  providers?: { name: string }[];
  creators?: string[];
  // Fiche JEU (GET /api/games/:id) — champs à plat.
  platforms?: string | null;
  developer?: string | null;
  publisher?: string | null;
  gameModes?: string | null;
};

function InfoLine({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <Text style={styles.infoLine}>
      <Text style={styles.infoLabel}>{label} : </Text>
      {value}
    </Text>
  );
}

export function DescriptionOverlay({
  item,
  visible,
  onClose,
  onOpenFiche,
  resolveMedia,
}: {
  item: FeedItem;
  visible: boolean;
  onClose: () => void;
  onOpenFiche: (item: FeedItem) => void;
  resolveMedia: (item: FeedItem) => Promise<string>;
}) {
  const [info, setInfo] = useState<DetailInfo | null>(null);
  const [loading, setLoading] = useState(false);
  // Sheet du bas : la tab bar flottante passerait devant le bouton
  // « Voir la fiche » — on la cache tant que le panneau est ouvert.
  useHideTabBar(visible);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setInfo(null);
    setLoading(true);
    (async () => {
      try {
        const mediaId = await resolveMedia(item);
        const d = await api.get<DetailInfo>(
          item.igdbId
            ? `/api/games/${mediaId}`
            : item.type === 'movie'
              ? `/api/movies/${mediaId}`
              : `/api/shows/${mediaId}`,
        );
        if (!cancelled) setInfo(d);
      } catch {
        if (!cancelled) setInfo(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, item, resolveMedia]);

  const isGame = Boolean(item.igdbId);
  const meta = [
    item.year,
    isGame ? 'Jeu' : item.category === 'anime' ? 'Animé' : item.type === 'show' ? 'Série' : 'Film',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <SlideUpBar visible={visible} style={styles.sheet} distance={160}>
      <Pressable
        style={({ pressed }) => [styles.grip, pressed && styles.gripPressed]}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Fermer les détails"
      >
        <View style={styles.handle} />
        <Feather name="chevron-down" size={20} color={COLORS.textMuted} />
      </Pressable>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.metaPill}>
          <Feather name={isGame ? 'command' : item.type === 'show' ? 'tv' : 'film'} size={13} color={COLORS.primary} />
          <Text style={styles.meta}>{meta}</Text>
        </View>
        <Text accessibilityRole="header" style={styles.title}>{item.title}</Text>
        <Text style={styles.desc}>{item.overview || 'Pas de description disponible.'}</Text>
        {loading ? (
          <ActivityIndicator style={styles.loader} color={COLORS.primary} />
        ) : info ? (
          <View style={styles.infoCard}>
            {isGame ? (
              <>
                <InfoLine label="Plateformes" value={info.platforms ?? undefined} />
                <InfoLine label="Développeur" value={info.developer ?? undefined} />
                <InfoLine label="Éditeur" value={info.publisher ?? undefined} />
                <InfoLine label="Modes" value={info.gameModes ?? undefined} />
              </>
            ) : (
              <>
                <InfoLine label="Genres" value={info.media?.genres ?? undefined} />
                <InfoLine
                  label={item.type === 'movie' ? 'Réalisation' : 'Création'}
                  value={info.creators?.join(', ')}
                />
                <InfoLine label="Diffusion" value={info.show?.network ?? info.show?.platform ?? undefined} />
                <InfoLine label="Casting" value={info.cast?.slice(0, 6).map((c) => c.name).join(', ')} />
                <InfoLine label="Où regarder" value={info.providers?.map((p) => p.name).join(', ')} />
              </>
            )}
          </View>
        ) : null}
        <Pressable
          style={({ pressed }) => [styles.ficheBtn, pressed && styles.ficheBtnPressed]}
          onPress={() => onOpenFiche(item)}
          accessibilityRole="button"
          accessibilityLabel={`Accéder à la fiche de ${item.title}`}
        >
          <Text style={styles.ficheText}>Accéder à la fiche</Text>
        </Pressable>
      </ScrollView>
    </SlideUpBar>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '26%',
    bottom: 0,
    overflow: 'hidden',
    // Fond des détails : `sheet` (quasi opaque en Glass) — le voile translucide
    // de `surface` laissait l'affiche transparaître et rendait le texte
    // illisible (retour Étienne 2026-07-21).
    backgroundColor: COLORS.sheet,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: COLORS.borderLight,
    borderTopLeftRadius: RADIUS.sheet,
    borderTopRightRadius: RADIUS.sheet,
    zIndex: 20,
    ...SHADOW.season,
  },
  grip: {
    width: 64,
    height: SIZES.touch,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    gap: 2,
    borderRadius: RADIUS.control,
  },
  gripPressed: { backgroundColor: COLORS.surfaceMuted },
  handle: {
    width: 34,
    height: 4,
    backgroundColor: COLORS.border,
    borderRadius: RADIUS.pill,
  },
  content: {
    paddingHorizontal: SPACE.lg,
    paddingTop: SPACE.xs,
    paddingBottom: SPACE.xl,
  },
  metaPill: {
    minHeight: 30,
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingHorizontal: 10,
    backgroundColor: COLORS.primarySoft,
    borderRadius: RADIUS.pill,
  },
  title: {
    marginTop: SPACE.sm,
    color: COLORS.text,
    fontSize: 25,
    lineHeight: 31,
    fontFamily: FONTS.extraBold,
  },
  meta: {
    color: COLORS.primary,
    fontFamily: FONTS.extraBold,
    fontSize: 11.5,
    letterSpacing: 0.35,
  },
  desc: {
    marginTop: SPACE.sm,
    color: COLORS.text,
    fontFamily: FONTS.regular,
    fontSize: 15,
    lineHeight: 23,
  },
  loader: {
    marginTop: SPACE.md,
    alignSelf: 'flex-start',
  },
  infoCard: {
    gap: SPACE.xs,
    marginTop: SPACE.md,
    padding: SPACE.md,
    backgroundColor: COLORS.surfaceMuted,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: RADIUS.card,
  },
  infoLine: {
    color: COLORS.text,
    fontFamily: FONTS.regular,
    fontSize: 14,
    lineHeight: 21,
  },
  infoLabel: {
    color: COLORS.primary,
    fontFamily: FONTS.extraBold,
  },
  ficheBtn: {
    minHeight: SIZES.touchComfortable,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACE.xs,
    marginTop: SPACE.lg,
    paddingHorizontal: SPACE.lg,
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.pill,
  },
  ficheBtnPressed: { opacity: 0.8 },
  ficheText: {
    color: COLORS.onPrimary,
    fontFamily: FONTS.extraBold,
    fontSize: 12.5,
    letterSpacing: 0.45,
  },
});
