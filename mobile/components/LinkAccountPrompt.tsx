import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, Modal } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { ssoWebAvailable } from '@/lib/sso';
import { COLORS, FONTS } from '@/lib/theme';
import { PopIn } from '@/components/anim';

// Popup de migration douce vers le SSO (spec du jour) : propose aux comptes
// e-mail connectés qui n'ont lié NI Google NI Discord de le faire, pour
// pouvoir récupérer leur compte sans mot de passe. Non bloquante — « Plus
// tard » referme sans persistance (re-proposée au prochain lancement de
// l'app). SSO étant web-only (cf. lib/sso.ts), ne s'affiche jamais côté
// natif : sur mobile l'utilisateur ne pourrait de toute façon pas lier.
// Montée une fois dans (tabs)/_layout.tsx (garantit un utilisateur connecté ;
// le root layout affiche aussi l'écran de connexion, où ça n'aurait pas de sens).

type MeResponse = { user?: { linkedProviders?: { google?: boolean; discord?: boolean } } };

export function LinkAccountPrompt() {
  const router = useRouter();
  const [dismissed, setDismissed] = useState(false);
  const { data } = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () => api.get<MeResponse>('/api/auth/me'),
    staleTime: 5 * 60_000,
    enabled: ssoWebAvailable(),
  });

  const linked = data?.user?.linkedProviders;
  const shouldShow = ssoWebAvailable() && !!data && !linked?.google && !linked?.discord && !dismissed;
  if (!shouldShow) return null;

  const close = () => setDismissed(true);
  const goLink = () => {
    close();
    router.push('/linked-accounts');
  };

  return (
    <Modal transparent animationType="fade" onRequestClose={close}>
      <Pressable style={styles.overlay} onPress={close}>
        <PopIn style={styles.card}>
          <Pressable onPress={(e) => e.stopPropagation()}>
            <Text style={styles.title}>Sécurise ton compte</Text>
            <Text style={styles.message}>
              Lie ton compte à Google ou Discord pour ne jamais le perdre : tu pourras le récupérer en
              un clic, sans mot de passe.
            </Text>
            <View style={styles.buttons}>
              <Pressable
                style={styles.primaryBtn}
                onPress={goLink}
                accessibilityRole="button"
                accessibilityLabel="Lier mon compte"
              >
                <Text style={styles.primaryText}>Lier mon compte</Text>
              </Pressable>
              <Pressable
                style={styles.laterBtn}
                onPress={close}
                accessibilityRole="button"
                accessibilityLabel="Plus tard"
              >
                <Text style={styles.laterText}>Plus tard</Text>
              </Pressable>
            </View>
          </Pressable>
        </PopIn>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: COLORS.overlay, alignItems: 'center', justifyContent: 'center', padding: 28 },
  card: { backgroundColor: COLORS.white, borderRadius: 14, padding: 20, width: '100%', maxWidth: 380 },
  title: { color: COLORS.text, fontSize: 18, fontFamily: FONTS.extraBold, textAlign: 'center', marginBottom: 8 },
  message: { color: COLORS.textMuted, fontSize: 15, fontFamily: FONTS.regular, lineHeight: 21, textAlign: 'center' },
  buttons: { gap: 10, marginTop: 18 },
  primaryBtn: { backgroundColor: COLORS.yellow, borderRadius: 999, paddingVertical: 12, alignItems: 'center' },
  primaryText: { color: COLORS.onAccent, fontSize: 14, fontFamily: FONTS.extraBold, letterSpacing: 0.3 },
  laterBtn: { paddingVertical: 8, alignItems: 'center' },
  laterText: { color: COLORS.textMuted, fontSize: 13, fontFamily: FONTS.semiBold },
});
