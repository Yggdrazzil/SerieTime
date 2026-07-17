import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator, Platform } from 'react-native';
import { Feather, AntDesign } from '@expo/vector-icons';
import * as Google from 'expo-auth-session/providers/google';
import { api } from '@/lib/api';
import { COLORS, FONTS } from '@/lib/theme';
import {
  ssoNativeAvailable,
  completeAuthSession,
  nativeDiscordLogin,
  nativeAppleLogin,
  appleSignInAvailable,
} from '@/lib/ssoNative';

type Providers = {
  google: boolean;
  googleClientId: string;
  googleIosClientId: string;
  googleAndroidClientId: string;
  discord: boolean;
  discordClientId: string;
  apple: boolean;
};

export type NativeSsoProvider = 'google' | 'discord' | 'apple';

// Boutons « Continuer avec Apple / Google / Discord » pour les builds NATIFS
// (le web garde SsoButtons + SDK officiels). Chaque bouton n'apparaît que si
// le serveur expose la config correspondante (/api/auth/providers) — sans
// credentials, le composant rend null et l'écran garde le formulaire e-mail.
// onToken reçoit le jeton du fournisseur (+ displayName pour Apple, fourni
// uniquement au premier login) : à l'appelant d'appeler /api/auth/oauth.
export function NativeSsoButtons({
  onToken,
  onAvailability,
  separator = 'ou',
}: {
  onToken: (provider: NativeSsoProvider, token: string, displayName?: string | null) => void;
  // Prévient l'écran parent qu'au moins un provider natif est utilisable
  // (permet de basculer l'inscription en « SSO uniquement » comme sur le web).
  onAvailability?: (hasAny: boolean) => void;
  separator?: string | null;
}) {
  const [cfg, setCfg] = useState<Providers | null>(null);
  const [appleReady, setAppleReady] = useState(false);
  const [dcBusy, setDcBusy] = useState(false);
  const [apBusy, setApBusy] = useState(false);

  useEffect(() => {
    if (!ssoNativeAvailable()) return;
    completeAuthSession();
    let cancelled = false;
    api.get<Providers>('/api/auth/providers').then((p) => !cancelled && setCfg(p)).catch(() => undefined);
    appleSignInAvailable().then((ok) => !cancelled && setAppleReady(ok)).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const googleClientId =
    Platform.OS === 'ios' ? cfg?.googleIosClientId : Platform.OS === 'android' ? cfg?.googleAndroidClientId : '';
  const showGoogle = Boolean(googleClientId);
  const showDiscord = Boolean(cfg?.discord && cfg.discordClientId);
  const showApple = Boolean(cfg?.apple && appleReady);
  const hasAny = showGoogle || showDiscord || showApple;

  useEffect(() => {
    if (cfg) onAvailability?.(hasAny);
  }, [cfg, hasAny, onAvailability]);

  if (!ssoNativeAvailable() || !cfg || !hasAny) return null;

  const dc = async () => {
    if (!cfg.discordClientId || dcBusy) return;
    setDcBusy(true);
    try {
      const token = await nativeDiscordLogin(cfg.discordClientId);
      if (token) onToken('discord', token);
    } catch {
      /* annulé / échec réseau : l'écran parent garde son état */
    } finally {
      setDcBusy(false);
    }
  };

  const ap = async () => {
    if (apBusy) return;
    setApBusy(true);
    try {
      const res = await nativeAppleLogin();
      if (res) onToken('apple', res.identityToken, res.displayName);
    } catch {
      /* annulé */
    } finally {
      setApBusy(false);
    }
  };

  return (
    <View style={{ marginTop: 24, gap: 12 }}>
      {separator ? (
        <View style={styles.sep}>
          <View style={styles.line} />
          <Text style={styles.sepText}>{separator}</Text>
          <View style={styles.line} />
        </View>
      ) : null}
      {showApple ? <AppleButton onPress={ap} busy={apBusy} /> : null}
      {showGoogle && googleClientId ? (
        <GoogleNativeButton clientId={googleClientId} onToken={(t) => onToken('google', t)} />
      ) : null}
      {showDiscord ? (
        <Pressable
          style={styles.dc}
          onPress={dc}
          disabled={dcBusy}
          accessibilityRole="button"
          accessibilityLabel="Continuer avec Discord"
        >
          {dcBusy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Feather name="message-circle" size={18} color="#fff" />
              <Text style={styles.btnTextLight}>Continuer avec Discord</Text>
            </>
          )}
        </Pressable>
      ) : null}
    </View>
  );
}

// Google via expo-auth-session (code + PKCE, échange automatique → idToken).
// NB serveur : les client IDs iOS/Android doivent AUSSI figurer dans
// GOOGLE_CLIENT_IDS (contrôle d'audience du jeton dans verifyGoogleToken).
function GoogleNativeButton({ clientId, onToken }: { clientId: string; onToken: (idToken: string) => void }) {
  const [request, response, promptAsync] = Google.useAuthRequest({
    iosClientId: Platform.OS === 'ios' ? clientId : undefined,
    androidClientId: Platform.OS === 'android' ? clientId : undefined,
    scopes: ['openid', 'profile', 'email'],
  });

  useEffect(() => {
    if (response?.type === 'success') {
      const idToken =
        response.authentication?.idToken ?? (response.params?.id_token as string | undefined);
      if (idToken) onToken(idToken);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [response]);

  return (
    <Pressable
      style={[styles.gg, !request && { opacity: 0.4 }]}
      onPress={() => promptAsync()}
      disabled={!request}
      accessibilityRole="button"
      accessibilityLabel="Continuer avec Google"
    >
      <AntDesign name="google" size={18} color={COLORS.text} />
      <Text style={styles.btnTextDark}>Continuer avec Google</Text>
    </Pressable>
  );
}

// Bouton Apple OFFICIEL (noir, exigé par la guideline 4.8) — le module natif
// est chargé dynamiquement : jamais présent dans le bundle web/Android.
function AppleButton({ onPress, busy }: { onPress: () => void; busy: boolean }) {
  const [Apple, setApple] = useState<typeof import('expo-apple-authentication') | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    let cancelled = false;
    import('expo-apple-authentication')
      .then((mod) => !cancelled && setApple(mod))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  if (!Apple) return null;
  if (busy) {
    return (
      <View style={[styles.appleFallback, { justifyContent: 'center' }]}>
        <ActivityIndicator color="#fff" />
      </View>
    );
  }
  return (
    <Apple.AppleAuthenticationButton
      buttonType={Apple.AppleAuthenticationButtonType.CONTINUE}
      buttonStyle={Apple.AppleAuthenticationButtonStyle.BLACK}
      cornerRadius={999}
      style={styles.apple}
      onPress={onPress}
    />
  );
}

const styles = StyleSheet.create({
  sep: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8 },
  line: { flex: 1, height: 1, backgroundColor: COLORS.borderLight },
  sepText: { color: COLORS.text, fontFamily: FONTS.regular, fontSize: 13 },
  apple: { width: '100%', height: 46 },
  appleFallback: { backgroundColor: '#000', borderRadius: 999, height: 46, alignItems: 'center' },
  gg: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: COLORS.white, borderWidth: 1, borderColor: COLORS.border, borderRadius: 999, paddingVertical: 13 },
  dc: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: '#5865F2', borderRadius: 999, paddingVertical: 13 },
  btnTextLight: { color: '#fff', fontFamily: FONTS.bold, fontSize: 15 },
  btnTextDark: { color: COLORS.text, fontFamily: FONTS.bold, fontSize: 15 },
});
