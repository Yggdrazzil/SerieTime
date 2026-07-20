import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { api, ApiError } from '@/lib/api';
import { useAppStore } from '@/lib/store';
import { COLORS, FONTS, RADIUS, SIZES, SPACE } from '@/lib/theme';
import { goBack } from '@/lib/nav';
import { ScreenShell, ScreenHeader, PrismeCard, IconAction } from '@/components/prisme';
import { EmptyState } from '@/components/ui';
import { ssoWebAvailable, initGoogleButton, facebookLogin, discordLogin } from '@/lib/sso';

type Providers = {
  google: boolean; googleClientId: string;
  facebook: boolean; facebookAppId: string;
  discord: boolean; discordClientId: string;
};

// Sous-page « Comptes liés » (Paramètres > Réseaux sociaux > Modifier les
// comptes liés) : lier/délier Google, Discord, Facebook.
export default function LinkedAccountsScreen() {
  const { token, user, setAuth } = useAppStore();
  const [cfg, setCfg] = useState<Providers | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const gRef = useRef<View>(null);
  const linked = ((user as { linkedProviders?: Record<string, boolean> } | null)?.linkedProviders) ?? {};

  useEffect(() => {
    let cancelled = false;
    api.get<Providers>('/api/auth/providers').then((p) => !cancelled && setCfg(p)).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  const link = async (provider: 'google' | 'facebook' | 'discord', tok: string) => {
    if (!token) return;
    setBusy(provider);
    setErr(null);
    try {
      const res = await api.post<{ user: unknown }>('/api/auth/link', { provider, token: tok });
      setAuth(token, res.user as never);
    } catch (e) {
      setErr(e instanceof ApiError && e.code === 'already_linked_other_account'
        ? 'Ce compte est déjà lié à un autre utilisateur.'
        : 'Liaison impossible.');
    } finally {
      setBusy(null);
    }
  };
  const unlink = async (provider: 'google' | 'facebook' | 'discord') => {
    if (!token) return;
    setBusy(provider);
    setErr(null);
    try {
      const res = await api.post<{ user: unknown }>('/api/auth/unlink', { provider });
      setAuth(token, res.user as never);
    } catch (e) {
      setErr(e instanceof ApiError && e.code === 'last_login_method'
        ? 'Impossible : c’est ta seule méthode de connexion.'
        : 'Impossible de délier.');
    } finally {
      setBusy(null);
    }
  };

  // Bouton officiel Google, rendu seulement s'il est configuré et pas déjà lié.
  useEffect(() => {
    if (!cfg?.google || linked.google || !ssoWebAvailable() || !gRef.current) return;
    initGoogleButton(cfg.googleClientId, gRef.current as unknown as HTMLElement, (t) => link('google', t)).catch(
      () => undefined,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg, linked.google]);

  const none = !ssoWebAvailable() || !cfg || (!cfg.google && !cfg.facebook && !cfg.discord);

  return (
    <ScreenShell scroll={!none}>
      <ScreenHeader
        title="Comptes liés"
        leading={<IconAction icon="chevron-left" label="Retour" onPress={() => goBack('/profile')} />}
      />
      {none ? (
        <EmptyState
          title="Aucun compte à lier"
          message="La connexion Google / Discord / Facebook n'est pas configurée sur ce serveur."
        />
      ) : (
        <>
          <Text style={styles.lead}>
            Lie un réseau pour te connecter à PlotTime en un clic.
          </Text>
          <PrismeCard elevated style={styles.providersCard}>
            {cfg.google ? (
              linked.google ? (
                <LinkedRow label="Google" icon="chrome" busy={busy === 'google'} onUnlink={() => unlink('google')} />
              ) : (
                <View ref={gRef} style={{ alignItems: 'flex-start', paddingVertical: SPACE.xs }} />
              )
            ) : null}
            {cfg.discord ? (
              linked.discord ? (
                <LinkedRow label="Discord" icon="message-circle" busy={busy === 'discord'} onUnlink={() => unlink('discord')} />
              ) : (
                <Pressable
                  style={({ pressed }) => [styles.ssoBtn, { backgroundColor: '#5865F2' }, pressed && styles.btnPressed]}
                  disabled={busy === 'discord'}
                  onPress={() => discordLogin(cfg.discordClientId).then((t) => link('discord', t)).catch(() => undefined)}
                >
                  <Feather name="message-circle" size={16} color="#fff" />
                  <Text style={styles.ssoText}>Lier Discord</Text>
                </Pressable>
              )
            ) : null}
            {cfg.facebook ? (
              linked.facebook ? (
                <LinkedRow label="Facebook" icon="facebook" busy={busy === 'facebook'} onUnlink={() => unlink('facebook')} />
              ) : (
                <Pressable
                  style={({ pressed }) => [styles.ssoBtn, { backgroundColor: '#1877F2' }, pressed && styles.btnPressed]}
                  disabled={busy === 'facebook'}
                  onPress={() => facebookLogin(cfg.facebookAppId).then((t) => link('facebook', t)).catch(() => undefined)}
                >
                  <Feather name="facebook" size={16} color="#fff" />
                  <Text style={styles.ssoText}>Lier Facebook</Text>
                </Pressable>
              )
            ) : null}
          </PrismeCard>
          {err ? <Text style={styles.err}>{err}</Text> : null}
        </>
      )}
    </ScreenShell>
  );
}

function LinkedRow({ label, icon, busy, onUnlink }: { label: string; icon: keyof typeof Feather.glyphMap; busy: boolean; onUnlink: () => void }) {
  return (
    <View style={styles.linkedRow}>
      <View style={styles.linkedIcon}>
        <Feather name={icon} size={18} color={COLORS.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.linkedLabel}>{label}</Text>
        <View style={styles.linkedStatus}>
          <Feather name="check-circle" size={13} color={COLORS.success} />
          <Text style={styles.linkedStatusText}>Lié</Text>
        </View>
      </View>
      <Pressable style={({ pressed }) => [styles.unlinkBtn, pressed && styles.btnPressed]} onPress={onUnlink} disabled={busy} accessibilityRole="button" accessibilityLabel={`Délier ${label}`}>
        {busy ? <ActivityIndicator size="small" color={COLORS.textMuted} /> : <Text style={styles.unlinkText}>Délier</Text>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  lead: { fontFamily: FONTS.regular, fontSize: 15, color: COLORS.textMuted, marginBottom: SPACE.sm, lineHeight: 21 },
  providersCard: { gap: SPACE.sm },
  linkedRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, minHeight: SIZES.touch },
  linkedIcon: { width: 38, height: 38, borderRadius: RADIUS.control, backgroundColor: COLORS.primarySoft, alignItems: 'center', justifyContent: 'center' },
  linkedLabel: { color: COLORS.text, fontFamily: FONTS.bold, fontSize: 16 },
  linkedStatus: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 1 },
  linkedStatusText: { color: COLORS.success, fontFamily: FONTS.semiBold, fontSize: 12 },
  unlinkBtn: { minHeight: 36, justifyContent: 'center', paddingHorizontal: SPACE.sm, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: COLORS.border },
  unlinkText: { color: COLORS.danger, fontFamily: FONTS.bold, fontSize: 13 },
  ssoBtn: { minHeight: SIZES.touch, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACE.xs, borderRadius: RADIUS.pill, paddingVertical: 10, paddingHorizontal: 18 },
  ssoText: { color: '#fff', fontFamily: FONTS.bold, fontSize: 14 },
  btnPressed: { opacity: 0.86, transform: [{ scale: 0.99 }] },
  err: { color: COLORS.danger, fontFamily: FONTS.regular, fontSize: 14, marginTop: SPACE.sm },
});
