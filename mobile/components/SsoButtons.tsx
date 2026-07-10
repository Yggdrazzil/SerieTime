import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { api } from '@/lib/api';
import { COLORS, FONTS } from '@/lib/theme';
import { ssoWebAvailable, initGoogleButton, facebookLogin, discordLogin } from '@/lib/sso';

type Providers = {
  google: boolean;
  googleClientId: string;
  facebook: boolean;
  facebookAppId: string;
  discord: boolean;
  discordClientId: string;
};

// Boutons « Continuer avec Google / Facebook » (web app). onToken est appelé
// avec le jeton du fournisseur : à l'appelant d'en faire une connexion
// (/api/auth/oauth) ou une liaison (/api/auth/link).
export function SsoButtons({
  onToken,
  separator = 'ou',
}: {
  onToken: (provider: 'google' | 'facebook' | 'discord', token: string) => void;
  separator?: string | null;
}) {
  const [cfg, setCfg] = useState<Providers | null>(null);
  const [fbBusy, setFbBusy] = useState(false);
  const [dcBusy, setDcBusy] = useState(false);
  const gRef = useRef<View>(null);

  useEffect(() => {
    let cancelled = false;
    api.get<Providers>('/api/auth/providers').then((p) => !cancelled && setCfg(p)).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!cfg?.google || !ssoWebAvailable() || !gRef.current) return;
    initGoogleButton(cfg.googleClientId, gRef.current as unknown as HTMLElement, (t) => onToken('google', t)).catch(
      () => undefined,
    );
  }, [cfg, onToken]);

  // Natif (Expo Go) : SSO web-only pour l'instant.
  if (!ssoWebAvailable() || !cfg || (!cfg.google && !cfg.facebook && !cfg.discord)) return null;

  const fb = async () => {
    if (!cfg.facebookAppId) return;
    setFbBusy(true);
    try {
      const token = await facebookLogin(cfg.facebookAppId);
      onToken('facebook', token);
    } catch {
      /* annulé */
    } finally {
      setFbBusy(false);
    }
  };

  const dc = async () => {
    if (!cfg.discordClientId) return;
    setDcBusy(true);
    try {
      const token = await discordLogin(cfg.discordClientId);
      onToken('discord', token);
    } catch {
      /* annulé */
    } finally {
      setDcBusy(false);
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
      {cfg.google ? <View ref={gRef} style={{ alignItems: 'center' }} /> : null}
      {cfg.discord ? (
        <Pressable style={styles.dc} onPress={dc} disabled={dcBusy}>
          {dcBusy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Feather name="message-circle" size={18} color="#fff" />
              <Text style={styles.fbText}>Continuer avec Discord</Text>
            </>
          )}
        </Pressable>
      ) : null}
      {cfg.facebook ? (
        <Pressable style={styles.fb} onPress={fb} disabled={fbBusy}>
          {fbBusy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Feather name="facebook" size={18} color="#fff" />
              <Text style={styles.fbText}>Continuer avec Facebook</Text>
            </>
          )}
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  sep: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8 },
  line: { flex: 1, height: 1, backgroundColor: COLORS.borderLight },
  sepText: { color: COLORS.textMuted, fontFamily: FONTS.regular, fontSize: 13 },
  fb: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: '#1877F2', borderRadius: 999, paddingVertical: 13 },
  dc: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: '#5865F2', borderRadius: 999, paddingVertical: 13 },
  fbText: { color: '#fff', fontFamily: FONTS.bold, fontSize: 15 },
});
