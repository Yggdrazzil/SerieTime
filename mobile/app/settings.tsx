import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Modal, TextInput, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { useAppStore } from '@/lib/store';
import { COLORS, FONTS } from '@/lib/theme';
import { PageHeader } from '@/components/PageHeader';

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
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        {tab === 'COMPTE' ? <AccountTab /> : tab === 'APPLICATION' ? <AppTab /> : <UpcomingTab />}
      </ScrollView>
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
  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Feather name="x" size={24} color={COLORS.black} />
            </Pressable>
          </View>
          {children}
        </Pressable>
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
  return (
    <View style={styles.toggleRow}>
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: FONTS.regular, fontSize: 19 }}>{label}</Text>
        {sub ? <Text style={{ fontFamily: FONTS.regular, fontSize: 14, color: COLORS.textMuted }}>{sub}</Text> : null}
      </View>
      <Pressable style={[styles.toggle, on && styles.toggleOn]} onPress={() => onToggle(!on)}>
        <View style={[styles.knob, on && styles.knobOn]} />
      </Pressable>
    </View>
  );
}
function RadioRow({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.row, { justifyContent: 'flex-start', gap: 16 }]} onPress={onPress}>
      <View style={[styles.radio, on && styles.radioOn]}>{on ? <Feather name="check" size={14} color={COLORS.black} /> : null}</View>
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
  toggle: { width: 52, height: 30, borderRadius: 15, backgroundColor: '#ddd', padding: 3 },
  toggleOn: { backgroundColor: COLORS.yellow },
  knob: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#fff' },
  knobOn: { backgroundColor: '#000', transform: [{ translateX: 22 }] },
  radio: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: COLORS.border, alignItems: 'center', justifyContent: 'center' },
  radioOn: { backgroundColor: COLORS.yellow, borderColor: COLORS.yellow },
  divider: { height: 1, backgroundColor: COLORS.borderLight, marginVertical: 12 },
  logout: { fontSize: 15, fontFamily: FONTS.extraBold, letterSpacing: 0.6 },
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
