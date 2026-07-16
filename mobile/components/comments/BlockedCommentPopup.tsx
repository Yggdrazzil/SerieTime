import React from 'react';
import { View, Text, StyleSheet, Pressable, Modal } from 'react-native';
import { COLORS, FONTS } from '@/lib/theme';

// Petite popup centrée (ton complice) affichée quand un commentaire/réponse est
// rejeté par la modération (400 comment_blocked). Le message vient du serveur.
export function BlockedCommentPopup({ message, onClose }: { message: string | null; onClose: () => void }) {
  return (
    <Modal visible={!!message} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose} />
      <View style={styles.wrap} pointerEvents="box-none">
        <View style={styles.card}>
          <Text style={styles.emoji}>🙅</Text>
          <Text style={styles.message}>{message}</Text>
          <Pressable
            style={styles.button}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="OK compris, fermer le message"
          >
            <Text style={styles.buttonText}>OK compris</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: COLORS.overlay },
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  card: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: COLORS.white,
    borderRadius: 18,
    paddingHorizontal: 22,
    paddingTop: 22,
    paddingBottom: 18,
    alignItems: 'center',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
  },
  emoji: { fontSize: 34, marginBottom: 10 },
  message: { fontFamily: FONTS.medium, fontSize: 15, lineHeight: 21, color: COLORS.text, textAlign: 'center' },
  button: {
    marginTop: 18,
    backgroundColor: COLORS.yellow,
    borderRadius: 999,
    paddingHorizontal: 28,
    paddingVertical: 11,
    alignSelf: 'stretch',
    alignItems: 'center',
  },
  buttonText: { fontFamily: FONTS.extraBold, fontSize: 14, letterSpacing: 0.3, color: COLORS.onAccent },
});
