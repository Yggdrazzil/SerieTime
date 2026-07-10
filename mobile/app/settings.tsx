import React, { useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Modal, TextInput, ActivityIndicator, Animated, Easing, Platform } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { useAppStore } from '@/lib/store';
import { COLORS, FONTS } from '@/lib/theme';
import { PageHeader } from '@/components/PageHeader';
import { FadeSwitch, PopIn } from '@/components/anim';
import { useReduceMotion } from '@/lib/useReduceMotion';
import { ssoWebAvailable, initGoogleButton, facebookLogin } from '@/lib/sso';

const NATIVE = Platform.OS !== 'web';

const TABS = ['COMPTE', 'APPLICATION', 'À VENIR'];

export default function Settings() {
  const [tab, setTab] = useState('COMPTE');
  return (
    <View style={{ flex: 1, backgroundColor: COLORS.white }}>
      <PageHeader title="Paramètres" />
      <View style={styles.tabs}>
        {TABS.map((t) => (
          <Pressable key={t} style={styles.tab} onPress={() => setTab(t)}>
            <Text style={[styles.tabText, tab === t && styles.tabActive]}>{t}</Text>
            <View style={[styles.under, tab === t && styles.underActive]} />
          </Pressable>
        ))}
      </View>
      {/* Bascule d'onglet en fondu, comme les onglets hauts des autres écrans. */}
      <FadeSwitch trigger={tab}>
        <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
          {tab === 'COMPTE' ? <AccountTab /> : tab === 'APPLICATION' ? <AppTab /> : <UpcomingTab />}
        </ScrollView>
      </FadeSwitch>
    </View>
  );
}

function AccountTab() {
  const router = useRouter();
  const { user, logout } = useAppStore();
  const [pwOpen, setPwOpen] = useState(false);
  const [delOpen, setDelOpen] = useState(false);

  // Exporter : télécharge un JSON de toutes ses données (web) / partage (natif).
  const exportData = async () => {
    try {
      const data = await api.get<Record<string, unknown>>('/api/backup/export');
      const json = JSON.stringify(data, null, 2);
      if (typeof document !== 'undefined') {
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'serietime-sauvegarde.json';
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch {
      /* silencieux : bouton best-effort */
    }
  };

  return (
    <View>
      <SectionTitle>Identification</SectionTitle>
      <View style={{ paddingHorizontal: 24, paddingBottom: 8 }}>
        <Field label="Nom d'utilisateur" value={user?.displayName ?? ''} blue />
        <Field label="Adresse e-mail" value={user?.email || '—'} blue />
        <Field label="Identifiant utilisateur" value={user?.id ?? ''} />
      </View>
      <Row label="Modifier le mot de passe" onPress={() => setPwOpen(true)} />
      <LinkedAccounts />
      <Divider />
      <SectionTitle>Import & sauvegarde</SectionTitle>
      <Row label="Importer mes données TV Time" onPress={() => router.push('/import')} />
      <Row label="Exporter mes données SerieTime" onPress={exportData} />
      <Divider />
      <View style={{ alignItems: 'center', gap: 24, paddingVertical: 32 }}>
        <Pressable onPress={logout}>
          <Text style={styles.logout}>SE DÉCONNECTER</Text>
        </Pressable>
        <Pressable onPress={() => setDelOpen(true)}>
          <Text style={[styles.logout, { color: COLORS.red }]}>SUPPRIMER LE COMPTE</Text>
        </Pressable>
      </View>

      {pwOpen ? <PasswordModal onClose={() => setPwOpen(false)} /> : null}
      {delOpen ? <DeleteAccountModal onClose={() => setDelOpen(false)} onDeleted={logout} /> : null}
    </View>
  );
}

type Providers = { google: boolean; googleClientId: string; facebook: boolean; facebookAppId: string };

// Section « Comptes liés » : lier/délier Google et Facebook au compte courant
// (web app). Masquée si aucun fournisseur n'est configuré côté serveur.
function LinkedAccounts() {
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

  const link = async (provider: 'google' | 'facebook', tok: string) => {
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
  const unlink = async (provider: 'google' | 'facebook') => {
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

  if (!ssoWebAvailable() || !cfg || (!cfg.google && !cfg.facebook)) return null;

  return (
    <>
      <Divider />
      <SectionTitle>Comptes liés</SectionTitle>
      <View style={{ paddingHorizontal: 24, gap: 12, paddingBottom: 8 }}>
        {cfg.google ? (
          linked.google ? (
            <LinkedRow label="Google" busy={busy === 'google'} onUnlink={() => unlink('google')} />
          ) : (
            <View ref={gRef} style={{ alignItems: 'flex-start', paddingVertical: 4 }} />
          )
        ) : null}
        {cfg.facebook ? (
          linked.facebook ? (
            <LinkedRow label="Facebook" busy={busy === 'facebook'} onUnlink={() => unlink('facebook')} />
          ) : (
            <Pressable
              style={styles.fbLink}
              disabled={busy === 'facebook'}
              onPress={() => facebookLogin(cfg.facebookAppId).then((t) => link('facebook', t)).catch(() => undefined)}
            >
              <Feather name="facebook" size={16} color="#fff" />
              <Text style={styles.fbLinkText}>Lier Facebook</Text>
            </Pressable>
          )
        ) : null}
        {err ? <Text style={{ color: COLORS.red, fontFamily: FONTS.regular, fontSize: 14 }}>{err}</Text> : null}
      </View>
    </>
  );
}

function LinkedRow({ label, busy, onUnlink }: { label: string; busy: boolean; onUnlink: () => void }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Feather name="check-circle" size={18} color={COLORS.green} />
        <Text style={{ fontFamily: FONTS.bold, fontSize: 16 }}>{label} lié</Text>
      </View>
      <Pressable onPress={onUnlink} disabled={busy}>
        {busy ? <ActivityIndicator size="small" color={COLORS.textMuted} /> : <Text style={{ color: COLORS.red, fontFamily: FONTS.bold, fontSize: 14 }}>Délier</Text>}
      </Pressable>
    </View>
  );
}

function PasswordModal({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const mut = useMutation({
    mutationFn: () => api.post('/api/auth/password', { currentPassword: current, newPassword: next }),
    onSuccess: () => {
      setDone(true);
      setTimeout(onClose, 1200);
    },
    onError: (e: unknown) =>
      setError(
        e instanceof ApiError && e.code === 'invalid_credentials'
          ? 'Mot de passe actuel incorrect.'
          : e instanceof ApiError && e.code === 'validation_error'
            ? 'Nouveau mot de passe : 8 caractères minimum.'
            : 'Impossible de modifier le mot de passe.',
      ),
  });
  const canSubmit = current.length > 0 && next.length >= 8 && !mut.isPending;
  return (
    <Sheet title="Modifier le mot de passe" onClose={onClose}>
      {done ? (
        <Text style={styles.okMsg}>Mot de passe modifié ✓</Text>
      ) : (
        <>
          <Text style={styles.mLabel}>Mot de passe actuel</Text>
          <TextInput style={styles.mInput} secureTextEntry value={current} onChangeText={setCurrent} autoCapitalize="none" />
          <Text style={styles.mLabel}>Nouveau mot de passe</Text>
          <TextInput style={styles.mInput} secureTextEntry value={next} onChangeText={setNext} autoCapitalize="none" placeholder="8 caractères minimum" placeholderTextColor={COLORS.textSoft} />
          {error ? <Text style={styles.errMsg}>{error}</Text> : null}
          <Pressable style={[styles.mBtn, !canSubmit && { opacity: 0.4 }]} disabled={!canSubmit} onPress={() => { setError(null); mut.mutate(); }}>
            {mut.isPending ? <ActivityIndicator color={COLORS.black} /> : <Text style={styles.mBtnText}>ENREGISTRER</Text>}
          </Pressable>
        </>
      )}
    </Sheet>
  );
}

function DeleteAccountModal({ onClose, onDeleted }: { onClose: () => void; onDeleted: () => void }) {
  const [confirm, setConfirm] = useState('');
  const mut = useMutation({
    mutationFn: () => api.del('/api/auth/account'),
    onSuccess: onDeleted, // déconnexion → retour à l'écran de connexion
  });
  return (
    <Sheet title="Supprimer le compte" onClose={onClose}>
      <Text style={styles.warn}>
        Cette action est définitive : ton compte, ta bibliothèque, ta progression et tes commentaires seront
        supprimés. Tape SUPPRIMER pour confirmer.
      </Text>
      <TextInput style={styles.mInput} value={confirm} onChangeText={setConfirm} autoCapitalize="characters" placeholder="SUPPRIMER" placeholderTextColor={COLORS.textSoft} />
      <Pressable
        style={[styles.mBtn, { backgroundColor: COLORS.red }, confirm !== 'SUPPRIMER' && { opacity: 0.4 }]}
        disabled={confirm !== 'SUPPRIMER' || mut.isPending}
        onPress={() => mut.mutate()}
      >
        {mut.isPending ? <ActivityIndicator color="#fff" /> : <Text style={[styles.mBtnText, { color: '#fff' }]}>SUPPRIMER DÉFINITIVEMENT</Text>}
      </Pressable>
    </Sheet>
  );
}

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const reduce = useReduceMotion();
  // Entrée de la carte : léger ressort (montée + scale) par-dessus le fondu du Modal.
  const v = useRef(new Animated.Value(reduce ? 1 : 0)).current;
  useEffect(() => {
    if (reduce) { v.setValue(1); return; }
    Animated.spring(v, { toValue: 1, useNativeDriver: NATIVE, friction: 8, tension: 120 }).start();
  }, [reduce, v]);
  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Animated.View
          style={{
            opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: 'clamp' }),
            transform: [
              { translateY: v.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) },
              { scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) },
            ],
          }}
        >
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Feather name="x" size={24} color={COLORS.black} />
            </Pressable>
          </View>
          {children}
        </Pressable>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

function AppTab() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['settings'], queryFn: () => api.get<{ settings: any }>('/api/settings') });
  const update = useMutation({
    mutationFn: (patch: any) => api.post('/api/settings', patch),
    onSettled: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  });
  const s = data?.settings ?? {};
  return (
    <View>
      <SectionTitle>Titres</SectionTitle>
      <ToggleRow label="Afficher dans votre langue" sub="Les titres s'affichent par défaut en anglais" on={s.titlesInUserLanguage ?? true} onToggle={(v) => update.mutate({ titlesInUserLanguage: v })} />
      <Divider />
      <SectionTitle>Thème</SectionTitle>
      {[['system', "Suivre le thème défini sur l'appareil"], ['light', 'Thème clair'], ['dark', 'Thème sombre']].map(([v, l]) => (
        <RadioRow key={v} label={l} on={(s.theme ?? 'light') === v} onPress={() => update.mutate({ theme: v })} />
      ))}
      <Divider />
      <SectionTitle>Cache</SectionTitle>
      <View style={{ padding: 16 }}>
        <Pressable style={styles.cacheBtn} onPress={() => api.post('/api/cache/clear').catch(() => {})}>
          <Text style={styles.cacheText}>VIDER LE CACHE</Text>
        </Pressable>
      </View>
      <Text style={styles.version}>VERSION 1.0.0</Text>
    </View>
  );
}

function UpcomingTab() {
  return (
    <View>
      <SectionTitle>Épisodes à afficher</SectionTitle>
      <Row label="Choix des chaînes" />
      <ToggleRow label="Masquer les épisodes vus" on={false} onToggle={() => {}} />
    </View>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}
function Field({ label, value, blue }: { label: string; value: string; blue?: boolean }) {
  return (
    <View style={{ paddingVertical: 12 }}>
      <Text style={{ fontFamily: FONTS.regular, fontSize: 17 }}>{label}</Text>
      <Text style={{ fontFamily: FONTS.regular, fontSize: 17, color: blue ? COLORS.blue : COLORS.textMuted }}>{value}</Text>
    </View>
  );
}
function Row({ label, onPress }: { label: string; onPress?: () => void }) {
  return (
    <Pressable style={styles.row} onPress={onPress}>
      <Text style={{ fontFamily: FONTS.regular, fontSize: 19 }}>{label}</Text>
      <Feather name="chevron-right" size={22} color={COLORS.black} />
    </Pressable>
  );
}
function ToggleRow({ label, sub, on, onToggle }: { label: string; sub?: string; on: boolean; onToggle: (v: boolean) => void }) {
  const reduce = useReduceMotion();
  // Le bouton glisse et la piste change de couleur au lieu de sauter d'un état
  // à l'autre. Couleurs interpolées → driver JS obligatoire.
  const v = useRef(new Animated.Value(on ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(v, { toValue: on ? 1 : 0, duration: reduce ? 0 : 180, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [on, reduce, v]);
  return (
    <View style={styles.toggleRow}>
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: FONTS.regular, fontSize: 19 }}>{label}</Text>
        {sub ? <Text style={{ fontFamily: FONTS.regular, fontSize: 14, color: COLORS.textMuted }}>{sub}</Text> : null}
      </View>
      <Pressable onPress={() => onToggle(!on)} hitSlop={8}>
        <Animated.View style={[styles.toggle, { backgroundColor: v.interpolate({ inputRange: [0, 1], outputRange: ['#dddddd', COLORS.yellow] }) }]}>
          <Animated.View
            style={[
              styles.knob,
              {
                backgroundColor: v.interpolate({ inputRange: [0, 1], outputRange: ['#ffffff', '#000000'] }),
                transform: [{ translateX: v.interpolate({ inputRange: [0, 1], outputRange: [0, 22] }) }],
              },
            ]}
          />
        </Animated.View>
      </Pressable>
    </View>
  );
}
function RadioRow({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.row, { justifyContent: 'flex-start', gap: 16 }]} onPress={onPress}>
      <View style={[styles.radio, on && styles.radioOn]}>
        {on ? (
          <PopIn>
            <Feather name="check" size={14} color={COLORS.black} />
          </PopIn>
        ) : null}
      </View>
      <Text style={{ fontFamily: FONTS.regular, fontSize: 18 }}>{label}</Text>
    </Pressable>
  );
}
function Divider() {
  return <View style={styles.divider} />;
}

const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: COLORS.borderLight },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 15 },
  tabText: { fontSize: 15, fontFamily: FONTS.extraBold, letterSpacing: 0.5, color: COLORS.textSoft },
  tabActive: { color: COLORS.black },
  under: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 4, backgroundColor: 'transparent' },
  underActive: { backgroundColor: COLORS.black },
  sectionTitle: { fontSize: 23, fontFamily: FONTS.extraBold, paddingHorizontal: 24, paddingTop: 28 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24, paddingVertical: 16 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 24, paddingVertical: 16, gap: 16 },
  toggle: { width: 52, height: 30, borderRadius: 15, padding: 3 },
  knob: { width: 24, height: 24, borderRadius: 12 },
  radio: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: COLORS.border, alignItems: 'center', justifyContent: 'center' },
  radioOn: { backgroundColor: COLORS.yellow, borderColor: COLORS.yellow },
  divider: { height: 1, backgroundColor: COLORS.borderLight, marginVertical: 12 },
  logout: { fontSize: 15, fontFamily: FONTS.extraBold, letterSpacing: 0.6 },
  fbLink: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#1877F2', borderRadius: 999, paddingVertical: 10, paddingHorizontal: 18, alignSelf: 'flex-start' },
  fbLinkText: { color: '#fff', fontFamily: FONTS.bold, fontSize: 14 },
  cacheBtn: { borderWidth: 2, borderColor: COLORS.black, borderRadius: 999, paddingVertical: 14, alignItems: 'center' },
  cacheText: { fontSize: 14, fontFamily: FONTS.extraBold, letterSpacing: 0.6 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', paddingHorizontal: 24 },
  sheet: { backgroundColor: COLORS.white, borderRadius: 16, padding: 20 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  sheetTitle: { fontSize: 20, fontFamily: FONTS.extraBold },
  mLabel: { fontSize: 14, fontFamily: FONTS.bold, marginTop: 14 },
  mInput: { borderBottomWidth: 1, borderBottomColor: COLORS.border, fontSize: 18, fontFamily: FONTS.regular, paddingVertical: 10, marginTop: 6 },
  mBtn: { backgroundColor: COLORS.yellow, borderRadius: 999, paddingVertical: 14, alignItems: 'center', marginTop: 22 },
  mBtnText: { fontSize: 14, fontFamily: FONTS.extraBold, letterSpacing: 0.6 },
  okMsg: { fontSize: 16, fontFamily: FONTS.bold, color: COLORS.green, textAlign: 'center', paddingVertical: 20 },
  errMsg: { color: COLORS.red, fontSize: 14, fontFamily: FONTS.regular, marginTop: 12 },
  warn: { fontSize: 15, fontFamily: FONTS.regular, color: COLORS.textMuted, lineHeight: 21, marginBottom: 8 },
  version: { textAlign: 'center', paddingVertical: 24, fontSize: 13, fontFamily: FONTS.bold, color: COLORS.textMuted, letterSpacing: 1 },
});
