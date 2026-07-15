import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { api } from '@/lib/api';
import { COLORS, FONTS } from '@/lib/theme';
import { SlideUpBar } from '@/components/anim';
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
      <Pressable style={styles.grip} onPress={onClose} hitSlop={10}>
        <Feather name="chevron-down" size={26} color="#fff" />
      </Pressable>
      <ScrollView
        // Padding bas généreux : la barre « Ajouter un commentaire » du flux reste
        // affichée par-dessus — sans lui, « VOIR LA FICHE » passait dessous.
        contentContainerStyle={{ paddingHorizontal: 22, paddingTop: 4, paddingBottom: 110 }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.title}>{item.title}</Text>
        <Text style={styles.meta}>{meta}</Text>
        <Text style={styles.desc}>{item.overview || 'Pas de description disponible.'}</Text>
        {loading ? (
          <ActivityIndicator style={{ marginTop: 16, alignSelf: 'flex-start' }} color="#fff" />
        ) : info ? (
          <View style={{ marginTop: 14, gap: 8 }}>
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
        <Pressable style={styles.ficheBtn} onPress={() => onOpenFiche(item)}>
          <Feather name="external-link" size={18} color={COLORS.black} />
          <Text style={styles.ficheText}>VOIR LA FICHE</Text>
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
    top: '32%',
    bottom: 0,
    backgroundColor: 'rgba(8,8,12,0.98)',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    zIndex: 20,
  },
  grip: { alignSelf: 'center', paddingTop: 8, paddingBottom: 6 },
  title: { color: '#fff', fontSize: 25, fontFamily: FONTS.extraBold },
  meta: { color: 'rgba(255,255,255,0.8)', fontFamily: FONTS.bold, fontSize: 14, marginTop: 5 },
  desc: { color: 'rgba(255,255,255,0.92)', fontFamily: FONTS.regular, fontSize: 15, lineHeight: 22, marginTop: 14 },
  infoLine: { color: 'rgba(255,255,255,0.9)', fontFamily: FONTS.regular, fontSize: 14, lineHeight: 20 },
  infoLabel: { color: COLORS.yellow, fontFamily: FONTS.bold },
  ficheBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    backgroundColor: COLORS.yellow,
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 11,
    marginTop: 22,
  },
  ficheText: { fontFamily: FONTS.extraBold, fontSize: 13, letterSpacing: 0.5, color: COLORS.black },
});
