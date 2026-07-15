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
      <Divider />
      {/* Comme TV Time : la liaison des comptes vit derrière une rangée dédiée. */}
      <SectionTitle>Réseaux sociaux</SectionTitle>
      <Row label="Modifier les comptes liés" onPress={() => router.push('/linked-accounts')} />
      <Divider />
      <SectionTitle>Import & sauvegarde</SectionTitle>
      <Row label="Importer mes données TV Time" onPress={() => router.push('/import')} />
      <Row label="Exporter mes données SerieTime" onPress={exportData} />
      <ResyncLibraryRow />
      <Divider />
      <SectionTitle>Jeux — Steam</SectionTitle>
      <SteamImportBlock />
      <Divider />
      <SectionTitle>Vie privée</SectionTitle>
      <PrivateProfileToggle />
      <Divider />
      {/* Boutons TV Time : SE DÉCONNECTER en jaune pleine largeur, SUPPRIMER en bleu. */}
      <View style={{ gap: 22, paddingVertical: 20 }}>
        <Pressable style={styles.logoutBtn} onPress={logout}>
          <Text style={styles.logoutText}>SE DÉCONNECTER</Text>
        </Pressable>
        <Pressable onPress={() => setDelOpen(true)}>
          <Text style={styles.deleteText}>SUPPRIMER LE COMPTE</Text>
        </Pressable>
      </View>

      {pwOpen ? <PasswordModal onClose={() => setPwOpen(false)} /> : null}
      {delOpen ? <DeleteAccountModal onClose={() => setDelOpen(false)} onDeleted={logout} /> : null}
    </View>
  );
}

// « Définir le profil comme privé » (TV Time) : seuls les abonnés voient
// l'activité. Bascule optimiste sur /api/profile.
function PrivateProfileToggle() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['profile'],
    queryFn: () => api.get<{ user: { isPrivate?: boolean } }>('/api/profile'),
  });
  const isPrivate = data?.user?.isPrivate ?? false;
  const mut = useMutation({
    mutationFn: (v: boolean) => api.post('/api/profile', { isPrivate: v }),
    onMutate: async (v: boolean) => {
      await qc.cancelQueries({ queryKey: ['profile'] });
      const prev = qc.getQueryData<{ user: { isPrivate?: boolean } }>(['profile']);
      if (prev?.user) qc.setQueryData(['profile'], { ...prev, user: { ...prev.user, isPrivate: v } });
      return { prev };
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(['profile'], ctx.prev); },
    onSettled: () => qc.invalidateQueries({ queryKey: ['profile'] }),
  });
  return (
    <ToggleRow
      label="Définir le profil comme privé"
      sub={"Lorsque votre profil est privé, vous devez approuver vos demandes d'abonnements. Seuls vos abonnés peuvent voir votre activité."}
      on={isPrivate}
      onToggle={(v) => mut.mutate(v)}
    />
  );
}

// « Connecter Steam » : SteamID (ou URL de profil, résolu côté serveur) +
// import de la bibliothèque possédée. Le profil Steam doit être public.
function SteamImportBlock() {
  const qc = useQueryClient();
  const [steamId, setSteamId] = useState('');
  const mut = useMutation({
    mutationFn: (id: string) => api.post<{ imported: number; error?: string }>('/api/games/steam/import', { steamId: id }),
    onSuccess: (res) => {
      // Succès de l'appel = profil résolu, jeux importés (ou 0 jeu) : on
      // invalide la bibliothèque. Si `error` est présent (SteamID invalide),
      // rien n'a été importé, mais l'invalidation reste sans effet notable.
      if (!res.error) qc.invalidateQueries({ queryKey: ['games', 'library'] });
    },
  });
  const canSubmit = steamId.trim().length >= 2 && !mut.isPending;
  const result = mut.data;
  return (
    <View style={{ paddingHorizontal: 24, paddingBottom: 8 }}>
      <Text style={styles.steamHint}>
        Connectez votre compte Steam (profil public requis) pour importer votre bibliothèque de jeux possédés.
      </Text>
      <TextInput
        style={styles.mInput}
        placeholder="SteamID ou URL de profil"
        placeholderTextColor={COLORS.textSoft}
        value={steamId}
        onChangeText={(v) => {
          setSteamId(v);
          mut.reset();
        }}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Pressable
        style={[styles.mBtn, !canSubmit && { opacity: 0.4 }]}
        disabled={!canSubmit}
        onPress={() => mut.mutate(steamId.trim())}
      >
        {mut.isPending ? <ActivityIndicator color={COLORS.black} /> : <Text style={styles.mBtnText}>IMPORTER MA BIBLIOTHÈQUE</Text>}
      </Pressable>
      {result?.error ? (
        <Text style={styles.errMsg}>
          {result.error === 'steam_id_invalide' ? 'SteamID ou URL de profil invalide (le profil doit être public).' : result.error}
        </Text>
      ) : result ? (
        <Text style={styles.okMsg}>
          {result.imported} jeu{result.imported > 1 ? 'x' : ''} importé{result.imported > 1 ? 's' : ''}
        </Text>
      ) : mut.isError ? (
        <Text style={styles.errMsg}>Impossible de contacter le serveur.</Text>
      ) : null}
    </View>
  );
}

// Rattrape d'un coup les dates de diffusion des épisodes (l'import ne les récupère
// pas → des séries en cours n'apparaissent pas dans « À voir »). Lance le resync
// en fond côté serveur ; la liste se remplit sur quelques minutes.
function ResyncLibraryRow() {
  const qc = useQueryClient();
  const mut = useMutation({
    mutationFn: () => api.post<{ started: boolean; alreadyRunning?: boolean }>('/api/shows/resync-all'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['shows'] }),
  });
  const res = mut.data;
  return (
    <View style={{ paddingHorizontal: 24, paddingVertical: 8 }}>
      <Pressable
        style={[styles.mBtn, mut.isPending && { opacity: 0.4 }]}
        disabled={mut.isPending}
        onPress={() => mut.mutate()}
      >
        {mut.isPending ? (
          <ActivityIndicator color={COLORS.black} />
        ) : (
          <Text style={styles.mBtnText}>RESYNCHRONISER MA BIBLIOTHÈQUE</Text>
        )}
      </Pressable>
      {res ? (
        <Text style={styles.okMsg}>
          {res.alreadyRunning
            ? 'Resynchronisation déjà en cours…'
            : 'Resynchronisation lancée — ta liste « À voir » se met à jour dans quelques minutes.'}
        </Text>
      ) : mut.isError ? (
        <Text style={styles.errMsg}>Impossible de contacter le serveur.</Text>
      ) : (
        <Text style={styles.steamHint}>
          Rattrape les dates de diffusion manquantes après un import (séries qui n'apparaissent pas dans « À voir »).
        </Text>
      )}
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
            <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Fermer">
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
      <Text style={{ fontFamily: FONTS.regular, fontSize: 14 }}>{label}</Text>
      <Text style={{ fontFamily: FONTS.regular, fontSize: 14, color: blue ? COLORS.blue : COLORS.textMuted }}>{value}</Text>
    </View>
  );
}
function Row({ label, onPress }: { label: string; onPress?: () => void }) {
  return (
    <Pressable style={styles.row} onPress={onPress}>
      <Text style={{ fontFamily: FONTS.regular, fontSize: 14 }}>{label}</Text>
      <Feather name="chevron-right" size={20} color={COLORS.black} />
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
        <Text style={{ fontFamily: FONTS.regular, fontSize: 14 }}>{label}</Text>
        {sub ? <Text style={{ fontFamily: FONTS.regular, fontSize: 12.5, color: COLORS.textMuted, lineHeight: 17, marginTop: 2 }}>{sub}</Text> : null}
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
  // Radio TV Time : anneau fin, point noir quand sélectionné.
  return (
    <Pressable style={[styles.row, { justifyContent: 'flex-start', gap: 18 }]} onPress={onPress}>
      <View style={[styles.radio, on && styles.radioSel]}>
        {on ? (
          <PopIn>
            <View style={styles.radioDot} />
          </PopIn>
        ) : null}
      </View>
      <Text style={{ fontFamily: FONTS.regular, fontSize: 14 }}>{label}</Text>
    </Pressable>
  );
}
function Divider() {
  return <View style={styles.divider} />;
}

const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: COLORS.borderLight },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 12 },
  tabText: { fontSize: 13, fontFamily: FONTS.extraBold, letterSpacing: 0.5, color: COLORS.textSoft },
  tabActive: { color: COLORS.black },
  under: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 4, backgroundColor: 'transparent' },
  underActive: { backgroundColor: COLORS.black },
  sectionTitle: { fontSize: 16, fontFamily: FONTS.extraBold, paddingHorizontal: 24, paddingTop: 16 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24, paddingVertical: 11 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 24, paddingVertical: 11, gap: 16 },
  toggle: { width: 52, height: 30, borderRadius: 15, padding: 3 },
  knob: { width: 24, height: 24, borderRadius: 12 },
  radio: { width: 26, height: 26, borderRadius: 13, borderWidth: 2.5, borderColor: '#4a4a52', alignItems: 'center', justifyContent: 'center' },
  radioSel: { borderColor: COLORS.black },
  radioDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: COLORS.black },
  divider: { height: 1, backgroundColor: COLORS.borderLight, marginVertical: 12 },
  logoutBtn: { backgroundColor: COLORS.yellow, borderRadius: 999, marginHorizontal: 16, paddingVertical: 14, alignItems: 'center' },
  logoutText: { fontSize: 15, fontFamily: FONTS.extraBold, letterSpacing: 0.6 },
  deleteText: { fontSize: 14, fontFamily: FONTS.extraBold, letterSpacing: 0.6, color: COLORS.blue, textAlign: 'center' },
  cacheBtn: { backgroundColor: COLORS.yellow, borderRadius: 999, paddingVertical: 13, alignItems: 'center' },
  cacheText: { fontSize: 14, fontFamily: FONTS.extraBold, letterSpacing: 0.6 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', paddingHorizontal: 24 },
  sheet: { backgroundColor: COLORS.white, borderRadius: 16, padding: 20 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  sheetTitle: { fontSize: 16, fontFamily: FONTS.extraBold },
  steamHint: { fontSize: 14, fontFamily: FONTS.regular, color: COLORS.textMuted, lineHeight: 19, marginBottom: 10 },
  mLabel: { fontSize: 14, fontFamily: FONTS.bold, marginTop: 14 },
  mInput: { borderBottomWidth: 1, borderBottomColor: COLORS.border, fontSize: 15, fontFamily: FONTS.regular, paddingVertical: 9, marginTop: 6 },
  mBtn: { backgroundColor: COLORS.yellow, borderRadius: 999, paddingVertical: 12, alignItems: 'center', marginTop: 22 },
  mBtnText: { fontSize: 13, fontFamily: FONTS.extraBold, letterSpacing: 0.6 },
  okMsg: { fontSize: 14, fontFamily: FONTS.bold, color: COLORS.green, textAlign: 'center', paddingVertical: 16 },
  errMsg: { color: COLORS.red, fontSize: 14, fontFamily: FONTS.regular, marginTop: 12 },
  warn: { fontSize: 15, fontFamily: FONTS.regular, color: COLORS.textMuted, lineHeight: 21, marginBottom: 8 },
  version: { textAlign: 'center', paddingVertical: 24, fontSize: 13, fontFamily: FONTS.bold, color: COLORS.textMuted, letterSpacing: 1 },
});
