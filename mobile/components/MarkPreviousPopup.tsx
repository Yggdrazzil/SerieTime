import React from 'react';
import { View, Text, StyleSheet, Pressable, Modal } from 'react-native';
import { Feather } from '@expo/vector-icons';
import type { EpisodeDto } from '@/lib/types';
import { COLORS, FONTS, RADIUS, SHADOW, SIZES, SPACE } from '@/lib/theme';
import { PopIn } from '@/components/anim';
import { useReduceMotion } from '@/lib/useReduceMotion';
import { useBackClose } from '@/lib/useBackClose';

// Mini pop-up « Cocher aussi les épisodes précédents ? » (règle produit) :
// quand l'utilisateur coche un épisode alors que des épisodes ANTÉRIEURS
// diffusés ne sont pas vus, on lui propose de les cocher aussi. C'est le seul
// cas où des épisodes se cochent sans geste direct — et seulement après OUI.

type EpisodeRef = Pick<EpisodeDto, 'id' | 'seasonNumber' | 'episodeNumber' | 'watched' | 'airDate'>;

const aired = (e: EpisodeRef) => !e.airDate || new Date(e.airDate).getTime() <= Date.now();

// Y a-t-il des épisodes réguliers diffusés NON VUS avant `ep` ? (spéciaux exclus)
export function hasUnwatchedPrevious(
  seasons: { seasonNumber: number; episodes: EpisodeRef[] }[],
  ep: EpisodeRef,
): boolean {
  if (ep.seasonNumber <= 0) return false;
  return seasons.some(
    (s) =>
      s.seasonNumber > 0 &&
      s.episodes.some(
        (e) =>
          !e.watched &&
          e.id !== ep.id &&
          aired(e) &&
          (e.seasonNumber < ep.seasonNumber ||
            (e.seasonNumber === ep.seasonNumber && e.episodeNumber < ep.episodeNumber)),
      ),
  );
}

export function MarkPreviousPopup({
  visible,
  onYes,
  onNo,
}: {
  visible: boolean;
  onYes: () => void;
  onNo: () => void;
}) {
  const reduce = useReduceMotion();
  useBackClose(visible, onNo);
  if (!visible) return null;
  return (
    <Modal visible transparent animationType={reduce ? 'none' : 'fade'} onRequestClose={onNo}>
      <Pressable
        style={styles.overlay}
        onPress={onNo}
        accessibilityRole="button"
        accessibilityLabel="Fermer la confirmation"
      />
      <View style={styles.wrap} pointerEvents="box-none">
        <PopIn style={styles.card}>
          <View accessibilityViewIsModal onAccessibilityEscape={onNo}>
            <View style={styles.iconWrap}>
              <Feather name="check-square" size={22} color={COLORS.primary} />
            </View>
            <Text accessibilityRole="header" style={styles.title}>{'Marquer les pr\u00e9c\u00e9dents ?'}</Text>
            <Text style={styles.message}>
              Souhaitez-vous aussi marquer tous les épisodes précédents comme vus ?
            </Text>
            <View style={styles.buttons}>
              <Pressable
                style={({ pressed }) => [styles.button, styles.noBtn, pressed && styles.buttonPressed]}
                onPress={onNo}
                accessibilityRole="button"
                accessibilityLabel={'Ne pas marquer les \u00e9pisodes pr\u00e9c\u00e9dents'}
              >
                <Text style={styles.noText}>NON</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.button, styles.yesBtn, pressed && styles.buttonPressed]}
                onPress={onYes}
                accessibilityRole="button"
                accessibilityLabel={'Marquer les \u00e9pisodes pr\u00e9c\u00e9dents comme vus'}
              >
                <Text style={styles.yesText}>OUI</Text>
              </Pressable>
            </View>
          </View>
        </PopIn>
      </View>
    </Modal>
  );
}

// Cotes alignées sur nos feuilles (boutons pilule 13 extrabold, carte radius 14).
const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: COLORS.overlay },
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SPACE.lg },
  card: {
    backgroundColor: COLORS.sheet, borderRadius: RADIUS.sheet, borderWidth: 1, borderColor: COLORS.borderLight,
    padding: SPACE.lg, width: '100%', maxWidth: 420, ...SHADOW.card,
  },
  iconWrap: {
    width: SIZES.touch, height: SIZES.touch, alignSelf: 'center', alignItems: 'center', justifyContent: 'center',
    borderRadius: RADIUS.control, backgroundColor: COLORS.primarySoft, marginBottom: SPACE.sm,
  },
  title: { color: COLORS.text, fontSize: 20, lineHeight: 26, fontFamily: FONTS.extraBold, textAlign: 'center', marginBottom: SPACE.xs },
  message: { color: COLORS.textMuted, fontSize: 15, fontFamily: FONTS.regular, lineHeight: 22, textAlign: 'center' },
  buttons: { flexDirection: 'row', gap: SPACE.sm, marginTop: SPACE.lg },
  button: { flex: 1, minHeight: SIZES.touch, borderRadius: RADIUS.pill, alignItems: 'center', justifyContent: 'center', paddingHorizontal: SPACE.sm },
  buttonPressed: { opacity: 0.78, transform: [{ scale: 0.98 }] },
  noBtn: { borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surfaceMuted },
  noText: { color: COLORS.text, fontSize: 13, fontFamily: FONTS.extraBold, letterSpacing: 0.5 },
  yesBtn: { backgroundColor: COLORS.primary },
  yesText: { color: COLORS.onPrimary, fontSize: 13, fontFamily: FONTS.extraBold, letterSpacing: 0.5 },
});
