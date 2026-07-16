import React, { useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { api, ApiError } from '@/lib/api';
import { useAppStore } from '@/lib/store';
import { COLORS, FONTS } from '@/lib/theme';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState } from '@/components/ui';
import { Pop } from '@/components/anim';
import { ssoWebAvailable, initGoogleButton, facebookLogin, discordLogin } from '@/lib/sso';

type Providers = {
  google: boolean; googleClientId: string;
  facebook: boolean; facebookAppId: string;
  discord: boolean; discordClientId: string;
};

// Sous-page « Comptes liés » (Paramètres > Réseaux sociaux > Modifier les
// comptes liés, comme TV Time) : lier/délier Google, Discord, Facebook.
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
    <Pop style={{ backgroundColor: COLORS.white }}>
      <PageHeader title="Comptes liés" />
      {none ? (
        <EmptyState
          title="Aucun compte à lier"
          message="La connexion Google / Discord / Facebook n'est pas configurée sur ce serveur."
        />
      ) : (
        <ScrollView contentContainerStyle={{ padding: 24, gap: 14 }}>
          <Text style={styles.lead}>
            Lie un réseau pour te connecter à PlotTime en un clic.
          </Text>
          {cfg.google ? (
            linked.google ? (
              <LinkedRow label="Google" busy={busy === 'google'} onUnlink={() => unlink('google')} />
            ) : (
              <View ref={gRef} style={{ alignItems: 'flex-start', paddingVertical: 4 }} />
            )
          ) : null}
          {cfg.discord ? (
            linked.discord ? (
              <LinkedRow label="Discord" busy={busy === 'discord'} onUnlink={() => unlink('discord')} />
            ) : (
              <Pressable
                style={[styles.ssoBtn, { backgroundColor: '#5865F2' }]}
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
              <LinkedRow label="Facebook" busy={busy === 'facebook'} onUnlink={() => unlink('facebook')} />
            ) : (
              <Pressable
                style={[styles.ssoBtn, { backgroundColor: '#1877F2' }]}
                disabled={busy === 'facebook'}
                onPress={() => facebookLogin(cfg.facebookAppId).then((t) => link('facebook', t)).catch(() => undefined)}
              >
                <Feather name="facebook" size={16} color="#fff" />
                <Text style={styles.ssoText}>Lier Facebook</Text>
              </Pressable>
            )
          ) : null}
          {err ? <Text style={styles.err}>{err}</Text> : null}
        </ScrollView>
      )}
    </Pop>
  );
}

function LinkedRow({ label, busy, onUnlink }: { label: string; busy: boolean; onUnlink: () => void }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Feather name="check-circle" size={18} color={COLORS.green} />
        <Text style={{ color: COLORS.text, fontFamily: FONTS.bold, fontSize: 16 }}>{label} lié</Text>
      </View>
      <Pressable onPress={onUnlink} disabled={busy}>
        {busy ? <ActivityIndicator size="small" color={COLORS.textMuted} /> : <Text style={{ color: COLORS.red, fontFamily: FONTS.bold, fontSize: 14 }}>Délier</Text>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  lead: { fontFamily: FONTS.regular, fontSize: 15, color: COLORS.textMuted, marginBottom: 4 },
  ssoBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 999, paddingVertical: 10, paddingHorizontal: 18, alignSelf: 'flex-start' },
  ssoText: { color: '#fff', fontFamily: FONTS.bold, fontSize: 13 },
  err: { color: COLORS.red, fontFamily: FONTS.regular, fontSize: 14 },
});
