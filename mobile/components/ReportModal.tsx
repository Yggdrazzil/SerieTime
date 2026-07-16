import React from 'react';
import { View, Text, Modal, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, FONTS } from '@/lib/theme';

// Modal de confirmation « Signaler cette œuvre » — partagé par les fiches
// série/film (mobile/app/show/[id].tsx) et jeu (mobile/app/game/[id].tsx).
// Le POST /api/report est déclenché par l'appelant (onConfirm).
export function ReportModal({
  visible,
  onClose,
  onConfirm,
}: {
  visible: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose} accessibilityLabel="Fermer" />
      <View style={[styles.card, { bottom: insets.bottom + 8 }]}>
        <Text style={styles.title}>Signaler cette œuvre</Text>
        <Text style={styles.body}>
          Contenu inapproprié (ex. pornographie / hentai) ? Notre équipe vérifiera.
        </Text>
        <View style={styles.actions}>
          <Pressable
            style={[styles.btn, styles.btnGhost]}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Annuler le signalement"
          >
            <Text style={styles.btnGhostText}>Annuler</Text>
          </Pressable>
          <Pressable
            style={[styles.btn, styles.btnPrimary]}
            onPress={onConfirm}
            accessibilityRole="button"
            accessibilityLabel="Confirmer le signalement"
          >
            <Text style={styles.btnPrimaryText}>Signaler</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: COLORS.overlay },
  card: { position: 'absolute', left: 8, right: 8, bottom: 8, backgroundColor: COLORS.white, borderRadius: 14, padding: 22 },
  title: { color: COLORS.text, fontSize: 18, fontFamily: FONTS.extraBold, marginBottom: 10 },
  body: { color: COLORS.textMuted, fontSize: 15, fontFamily: FONTS.regular, lineHeight: 21, marginBottom: 20 },
  actions: { flexDirection: 'row', gap: 10, justifyContent: 'flex-end' },
  btn: { paddingHorizontal: 20, paddingVertical: 11, borderRadius: 999 },
  btnGhost: { backgroundColor: COLORS.chipGrey },
  btnGhostText: { color: COLORS.text, fontFamily: FONTS.bold, fontSize: 14 },
  btnPrimary: { backgroundColor: COLORS.yellow },
  btnPrimaryText: { color: COLORS.onAccent, fontFamily: FONTS.extraBold, fontSize: 14 },
});
