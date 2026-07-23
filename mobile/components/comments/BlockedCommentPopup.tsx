import React from 'react';
import { View, Text, StyleSheet, Pressable, Modal } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { COLORS, FONTS, RADIUS, SHADOW, SIZES, SPACE } from '@/lib/theme';
import { useReduceMotion } from '@/lib/useReduceMotion';
import { useBackClose } from '@/lib/useBackClose';

// Petite popup centrée (ton complice) affichée quand un commentaire/réponse est
// rejeté par la modération (400 comment_blocked). Le message vient du serveur.
export function BlockedCommentPopup({ message, onClose }: { message: string | null; onClose: () => void }) {
  const reduce = useReduceMotion();
  useBackClose(!!message, onClose);
  return (
    <Modal visible={!!message} transparent animationType={reduce ? 'none' : 'fade'} onRequestClose={onClose}>
      <Pressable
        style={styles.overlay}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Fermer le message"
      />
      <View style={styles.wrap} pointerEvents="box-none">
        <View style={styles.card} accessibilityViewIsModal onAccessibilityEscape={onClose}>
          <View style={styles.iconWrap} accessible={false}>
            <Feather name="alert-circle" size={24} color={COLORS.danger} />
          </View>
          <Text accessibilityRole="header" style={styles.title}>Action impossible</Text>
          <Text style={styles.message}>{message}</Text>
          <Pressable
            style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Fermer le message"
          >
            <Text style={styles.buttonText}>J’AI COMPRIS</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: COLORS.overlay },
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACE.lg,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    alignItems: 'center',
    padding: SPACE.lg,
    backgroundColor: COLORS.sheet,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: RADIUS.sheet,
    ...SHADOW.card,
  },
  iconWrap: {
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACE.sm,
    backgroundColor: COLORS.surfaceMuted,
    borderRadius: 26,
  },
  title: {
    marginBottom: SPACE.xs,
    color: COLORS.text,
    fontFamily: FONTS.extraBold,
    fontSize: 20,
    lineHeight: 26,
    textAlign: 'center',
  },
  message: {
    color: COLORS.textMuted,
    fontFamily: FONTS.regular,
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  button: {
    minHeight: SIZES.touchComfortable,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: SPACE.lg,
    paddingHorizontal: SPACE.lg,
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.pill,
  },
  buttonPressed: { opacity: 0.78, transform: [{ scale: 0.98 }] },
  buttonText: {
    color: COLORS.onPrimary,
    fontFamily: FONTS.extraBold,
    fontSize: 13,
    letterSpacing: 0.4,
  },
});
