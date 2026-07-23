import React from 'react';
import { View, Text, Modal, Pressable, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, FONTS, RADIUS, SHADOW, SIZES, SPACE } from '@/lib/theme';
import { useReduceMotion } from '@/lib/useReduceMotion';
import { useBackClose } from '@/lib/useBackClose';

// Modal de confirmation « Signaler » — partagé par les fiches série/film
// (mobile/app/show/[id].tsx), jeu (mobile/app/game/[id].tsx) et les
// commentaires (mobile/components/comments/CommentCard.tsx, via title/body).
// Le POST /api/report est déclenché par l'appelant (onConfirm).
export function ReportModal({
  visible,
  onClose,
  onConfirm,
  title = 'Signaler cette œuvre',
  body = 'Contenu inapproprié (ex. pornographie / hentai) ? Notre équipe vérifiera.',
}: {
  visible: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title?: string;
  body?: string;
}) {
  const insets = useSafeAreaInsets();
  const reduce = useReduceMotion();
  useBackClose(visible, onClose);
  return (
    <Modal visible={visible} transparent animationType={reduce ? 'none' : 'fade'} onRequestClose={onClose}>
      <Pressable
        style={styles.overlay}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Fermer le signalement"
      />
      <View style={[styles.wrap, { paddingBottom: insets.bottom + SPACE.xs }]} pointerEvents="box-none">
      <View style={styles.card} accessibilityViewIsModal onAccessibilityEscape={onClose}>
        <View style={styles.handle} />
        <View style={styles.iconWrap}>
          <Feather name="flag" size={21} color={COLORS.danger} />
        </View>
        <Text accessibilityRole="header" style={styles.title}>{title}</Text>
        <Text style={styles.body}>{body}</Text>
        <View style={styles.actions}>
          <Pressable
            style={({ pressed }) => [styles.btn, styles.btnGhost, pressed && styles.btnPressed]}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Annuler le signalement"
          >
            <Text style={styles.btnGhostText}>Annuler</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.btn, styles.btnPrimary, pressed && styles.btnPressed]}
            onPress={onConfirm}
            accessibilityRole="button"
            accessibilityLabel="Confirmer le signalement"
          >
            <Text style={styles.btnPrimaryText}>Signaler</Text>
          </Pressable>
        </View>
      </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: COLORS.overlay },
  wrap: { ...StyleSheet.absoluteFillObject, justifyContent: 'flex-end', alignItems: 'center', paddingHorizontal: SPACE.sm },
  card: {
    width: '100%', maxWidth: 520, backgroundColor: COLORS.sheet, borderRadius: RADIUS.sheet,
    borderWidth: 1, borderColor: COLORS.borderLight, padding: SPACE.lg, paddingTop: SPACE.sm, ...SHADOW.card,
  },
  handle: { width: 40, height: 4, alignSelf: 'center', borderRadius: RADIUS.pill, backgroundColor: COLORS.border, marginBottom: SPACE.md },
  iconWrap: {
    width: SIZES.touch, height: SIZES.touch, borderRadius: RADIUS.control, backgroundColor: COLORS.surfaceMuted,
    alignItems: 'center', justifyContent: 'center', marginBottom: SPACE.sm,
  },
  title: { color: COLORS.text, fontSize: 20, lineHeight: 26, fontFamily: FONTS.extraBold, marginBottom: SPACE.xs },
  body: { color: COLORS.textMuted, fontSize: 15, fontFamily: FONTS.regular, lineHeight: 22, marginBottom: SPACE.lg },
  actions: { flexDirection: 'row', gap: SPACE.sm },
  btn: { flex: 1, minHeight: SIZES.touch, paddingHorizontal: SPACE.md, borderRadius: RADIUS.pill, alignItems: 'center', justifyContent: 'center' },
  btnPressed: { opacity: 0.78, transform: [{ scale: 0.98 }] },
  btnGhost: { backgroundColor: COLORS.surfaceMuted, borderWidth: 1, borderColor: COLORS.borderLight },
  btnGhostText: { color: COLORS.text, fontFamily: FONTS.bold, fontSize: 14 },
  btnPrimary: { backgroundColor: COLORS.danger },
  btnPrimaryText: { color: COLORS.onPrimary, fontFamily: FONTS.extraBold, fontSize: 14 },
});
