import React, { useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Modal, TextInput, ActivityIndicator, Animated, Easing, Platform, Linking, Alert, Share } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { useAppStore } from '@/lib/store';
import { COLORS, FONTS, GLASS_BLUR, RADIUS, SHADOW, SIZES, SPACE, applyThemePreference, getThemePreference, type ThemePreference } from '@/lib/theme';
import { ScreenShell, ScreenHeader, SectionHeader, SegmentedFilter, PrismeCard, IconAction } from '@/components/prisme';
import { goBack } from '@/lib/nav';
import { FadeSwitch, PopIn } from '@/components/anim';
import { useReduceMotion } from '@/lib/useReduceMotion';
import { ssoWebAvailable, initGoogleButton, discordLogin } from '@/lib/sso';
import { COUNTRIES, countryName } from '@/lib/countries';

const NATIVE = Platform.OS !== 'web';

// Pages légales servies par le serveur (publiques, exigées par les stores).
const LEGAL_BASE = 'https://serietime.studio-vives.fr/legal';

// Ouvre une URL externe : nouvel onglet sur web (ne pas quitter la SPA),
// navigateur système sur natif (même pattern que le lien X de person.tsx).
function openExternal(url: string) {
  if (Platform.OS === 'web' && typeof window !== 'undefined') window.open(url, '_blank', 'noopener');
  else Linking.openURL(url).catch(() => undefined);
}

type Tab = 'compte' | 'application';
const TAB_OPTIONS: { value: Tab; label: string; accessibilityLabel: string }[] = [
  { value: 'compte', label: 'Compte', accessibilityLabel: 'Onglet Compte' },
  { value: 'application', label: 'Application', accessibilityLabel: 'Onglet Application' },
];

export default function Settings() {
  const [tab, setTab] = useState<Tab>('compte');
  return (
    <ScreenShell scroll contentContainerStyle={styles.content}>
      {/* En-tête volontairement sobre (retour Étienne 2026-07-20) : titre seul. */}
      <ScreenHeader
        title="Paramètres"
        leading={<IconAction icon="chevron-left" label="Retour" onPress={() => goBack('/profile')} />}
      />
      <SegmentedFilter options={TAB_OPTIONS} value={tab} onChange={setTab} accessibilityLabel="Filtrer les paramètres" />
      {/* Bascule d'onglet en fondu, comme les onglets hauts des autres écrans. */}
      <FadeSwitch trigger={tab}>
        <View style={styles.list}>{tab === 'compte' ? <AccountTab /> : <AppTab />}</View>
      </FadeSwitch>
    </ScreenShell>
  );
}

function AccountTab() {
  const router = useRouter();
  const { user, logout } = useAppStore();
  const [pwOpen, setPwOpen] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const [nameOpen, setNameOpen] = useState(false);
  const [countryOpen, setCountryOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportingTvtime, setExportingTvtime] = useState(false);
  // Nom d'utilisateur = nom d'affichage COURANT (source : profil serveur).
  // Le store local est figé à la connexion : après « Modifier le profil »,
  // il affichait encore l'ancien nom.
  const profileQ = useQuery({
    queryKey: ['profile'],
    queryFn: () => api.get<{ user: { displayName?: string; countryCode?: string } }>('/api/profile'),
  });
  const displayName = profileQ.data?.user?.displayName ?? user?.displayName ?? '';
  const countryCode = profileQ.data?.user?.countryCode ?? 'FR';

  // Exporter : télécharge un JSON de toutes ses données (web) / partage (natif).
  const exportData = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const data = await api.post<Record<string, unknown>>('/api/backup/export');
      const json = JSON.stringify(data, null, 2);
      if (Platform.OS === 'web' && typeof document !== 'undefined') {
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'plottime-sauvegarde.json';
        a.click();
        URL.revokeObjectURL(url);
        return;
      }
      await Share.share({
        title: 'Sauvegarde PlotTime',
        message: json,
      });
    } catch {
      Alert.alert(
        'Export impossible',
        'La sauvegarde n’a pas pu être préparée. Vérifie ta connexion puis réessaie.',
      );
    } finally {
      setExporting(false);
    }
  };

  // Exporter au format TV Time : ZIP de CSV lisible par tout outil qui
  // comprend un export TV Time (et par notre propre import). Réponse binaire →
  // téléchargement direct sur web ; sur natif, le partage de fichier binaire
  // est peu fiable → on oriente vers la web app (choix simple assumé).
  const exportTvtime = async () => {
    if (exportingTvtime) return;
    if (Platform.OS !== 'web') {
      Alert.alert(
        'Export au format TV Time',
        'Le téléchargement du fichier ZIP est disponible sur la version web de PlotTime.',
      );
      return;
    }
    setExportingTvtime(true);
    try {
      const blob = await api.download('/api/backup/export-tvtime');
      if (typeof document !== 'undefined') {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'plottime-export-tvtime.zip';
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch {
      Alert.alert(
        'Export impossible',
        'Le fichier au format TV Time n’a pas pu être préparé. Vérifie ta connexion puis réessaie.',
      );
    } finally {
      setExportingTvtime(false);
    }
  };

  return (
    <>
      <Section title="Identification">
        <Field label="Nom d'utilisateur" value={displayName} accent />
        <Field label="Adresse e-mail" value={user?.email || '—'} accent />
        <Field label="Identifiant utilisateur" value={user?.id ?? ''} />
        {/* Nom d'affichage et pays édités ICI (déplacés depuis « Modifier le
            profil », demande produit 2026-07-20). */}
        <Row label="Modifier le nom d'affichage" onPress={() => setNameOpen(true)} />
        <RowWithValue label="Pays" value={countryName(countryCode) ?? countryCode} onPress={() => setCountryOpen(true)} />
        <Row label="Modifier le mot de passe" onPress={() => setPwOpen(true)} />
      </Section>

      {/* La liaison des comptes vit derrière une rangée dédiée. */}
      <Section title="Réseaux sociaux">
        <Row label="Modifier les comptes liés" onPress={() => router.push('/linked-accounts')} />
      </Section>

      <Section title="Import & sauvegarde">
        <Row label="Importer mes données TV Time" onPress={() => router.push('/import')} />
        <Row label={exporting ? 'Préparation de la sauvegarde…' : 'Exporter mes données PlotTime'} onPress={exporting ? undefined : exportData} />
        <Row
          label={exportingTvtime ? 'Préparation de l’export TV Time…' : 'Exporter au format TV Time'}
          onPress={exportingTvtime ? undefined : exportTvtime}
        />
        <ResyncLibraryRow />
      </Section>

      <Section title="Steam">
        <SteamImportBlock />
      </Section>

      <Section title="Vie privée">
        <PrivateProfileToggle />
      </Section>

      {/* Zone sensible isolée (recommandation Prisme : danger à part). */}
      <PrismeCard elevated style={styles.dangerCard}>
        <Pressable style={({ pressed }) => [styles.logoutBtn, pressed && styles.btnPressed]} onPress={logout} accessibilityRole="button" accessibilityLabel="Se déconnecter">
          <Feather name="log-out" size={17} color={COLORS.onPrimary} />
          <Text style={styles.logoutText}>SE DÉCONNECTER</Text>
        </Pressable>
        <Pressable style={({ pressed }) => [styles.deleteBtn, pressed && styles.deletePressed]} onPress={() => setDelOpen(true)} accessibilityRole="button" accessibilityLabel="Supprimer le compte">
          <Text style={styles.deleteText}>SUPPRIMER LE COMPTE</Text>
        </Pressable>
      </PrismeCard>

      {pwOpen ? <PasswordModal onClose={() => setPwOpen(false)} /> : null}
      {nameOpen ? <DisplayNameModal current={displayName} onClose={() => setNameOpen(false)} /> : null}
      {countryOpen ? <CountryModal current={countryCode} onClose={() => setCountryOpen(false)} /> : null}
      {delOpen ? <DeleteAccountModal onClose={() => setDelOpen(false)} onDeleted={logout} /> : null}
    </>
  );
}

// Changement du nom d'affichage : le pseudo doit être DISPONIBLE (unique,
// vérifié côté serveur — 409 display_name_taken sinon). Chiffres et
// caractères spéciaux autorisés.
function DisplayNameModal({ current, onClose }: { current: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(current);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const mut = useMutation({
    mutationFn: (displayName: string) => api.post<{ user: { displayName: string } }>('/api/profile', { displayName }),
    onSuccess: (res) => {
      // Le store local (en-têtes, Paramètres…) suit le nouveau nom immédiatement.
      useAppStore.setState((st) => ({ user: st.user ? { ...st.user, displayName: res.user.displayName } : st.user }));
      qc.invalidateQueries({ queryKey: ['profile'] });
      setDone(true);
      setTimeout(onClose, 1200);
    },
    onError: (e: unknown) =>
      setError(
        e instanceof ApiError && e.code === 'display_name_taken'
          ? 'Ce nom est déjà utilisé par quelqu’un d’autre.'
          : e instanceof ApiError && e.code === 'validation_error'
            ? 'Le nom doit faire entre 1 et 80 caractères.'
            : 'Impossible de modifier le nom. Réessaie.',
      ),
  });
  const trimmed = name.trim();
  const canSubmit = trimmed.length > 0 && trimmed !== current && !mut.isPending;
  return (
    <Sheet title="Modifier le nom d'affichage" onClose={onClose}>
      {done ? (
        <Text style={styles.okMsg}>Nom d’affichage modifié ✓</Text>
      ) : (
        <>
          <Text style={styles.hint}>
            Chiffres et caractères spéciaux autorisés. Le nom doit être disponible (non utilisé par un autre compte).
          </Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={(v) => {
              setName(v);
              setError(null);
            }}
            placeholder="Votre nouveau nom"
            placeholderTextColor={COLORS.textSoft}
            autoFocus
            maxLength={80}
            accessibilityLabel="Nouveau nom d'affichage"
          />
          {error ? <Text style={styles.errMsg}>{error}</Text> : null}
          <Pressable
            style={({ pressed }) => [styles.actionBtn, !canSubmit && styles.actionBtnDisabled, pressed && canSubmit && styles.btnPressed]}
            disabled={!canSubmit}
            onPress={() => {
              setError(null);
              mut.mutate(trimmed);
            }}
            accessibilityRole="button"
            accessibilityLabel="Enregistrer le nom d'affichage"
          >
            {mut.isPending ? <ActivityIndicator color={COLORS.onPrimary} /> : <Text style={styles.actionBtnText}>ENREGISTRER</Text>}
          </Pressable>
        </>
      )}
    </Sheet>
  );
}

// Choix du pays (déplacé depuis « Modifier le profil ») : liste complète,
// noms en toutes lettres, coche sur le pays courant.
function CountryModal({ current, onClose }: { current: string; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [error, setError] = useState(false);
  const mut = useMutation({
    mutationFn: (countryCode: string) => api.post('/api/profile', { countryCode }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['profile'] });
      onClose();
    },
    onError: () => setError(true),
  });
  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={[styles.countryScreen, { paddingTop: insets.top }]}>
        <View style={styles.countryHeader}>
          <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Fermer" style={styles.countryBack}>
            <Feather name="chevron-left" size={26} color={COLORS.text} />
          </Pressable>
          <Text style={styles.countryTitle}>Pays</Text>
          <View style={{ width: SIZES.touch }} />
        </View>
        {error ? <Text style={[styles.errMsg, { textAlign: 'center' }]}>Impossible d’enregistrer le pays. Réessaie.</Text> : null}
        <ScrollView>
          <View style={styles.countryCanvas}>
            {COUNTRIES.map((c) => (
              <Pressable
                key={c.code}
                style={({ pressed }) => [styles.countryRow, pressed && styles.rowPressed]}
                onPress={() => {
                  setError(false);
                  mut.mutate(c.code);
                }}
                disabled={mut.isPending}
                accessibilityRole="button"
                accessibilityLabel={c.name}
                accessibilityState={{ selected: current === c.code, disabled: mut.isPending }}
              >
                <Text style={[styles.countryName, current === c.code && styles.countrySelected]}>{c.name}</Text>
                {current === c.code ? <Feather name="check" size={22} color={COLORS.primary} /> : null}
              </Pressable>
            ))}
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

// « Définir le profil comme privé » : seuls les abonnés voient
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
    <View style={styles.block}>
      <Text style={styles.hint}>
        Connectez votre compte Steam (profil public requis) pour importer votre bibliothèque de jeux possédés.
      </Text>
      <TextInput
        style={styles.input}
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
        style={({ pressed }) => [styles.actionBtn, !canSubmit && styles.actionBtnDisabled, pressed && canSubmit && styles.btnPressed]}
        disabled={!canSubmit}
        onPress={() => mut.mutate(steamId.trim())}
      >
        {mut.isPending ? <ActivityIndicator color={COLORS.onPrimary} /> : <Text style={styles.actionBtnText}>IMPORTER MA BIBLIOTHÈQUE</Text>}
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
    <View style={styles.block}>
      <Pressable
        style={({ pressed }) => [styles.actionBtn, mut.isPending && styles.actionBtnDisabled, pressed && !mut.isPending && styles.btnPressed]}
        disabled={mut.isPending}
        onPress={() => mut.mutate()}
      >
        {mut.isPending ? (
          <ActivityIndicator color={COLORS.onPrimary} />
        ) : (
          <Text style={styles.actionBtnText}>RESYNCHRONISER MA BIBLIOTHÈQUE</Text>
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
        <Text style={[styles.hint, { marginTop: SPACE.sm }]}>
          Rattrape les dates de diffusion manquantes après un import (séries qui n'apparaissent pas dans « À voir »).
        </Text>
      )}
    </View>
  );
}

// Providers SSO configurés côté serveur (sous-ensemble utile au reset).
type SsoProviders = {
  google: boolean; googleClientId: string;
  discord: boolean; discordClientId: string;
};

function PasswordModal({ onClose }: { onClose: () => void }) {
  const { user } = useAppStore();
  const linked = ((user as { linkedProviders?: Record<string, boolean> } | null)?.linkedProviders) ?? {};
  const hasSso = Boolean(linked.google || linked.discord);
  // Le lien « mot de passe oublié » n'apparaît que si un compte Google/Discord
  // est lié ET configuré côté serveur — et seulement sur le web (comme le SSO).
  const providersQ = useQuery({
    queryKey: ['auth', 'providers'],
    queryFn: () => api.get<SsoProviders>('/api/auth/providers'),
    enabled: ssoWebAvailable() && hasSso,
  });
  const cfg = providersQ.data;
  const canReset = ssoWebAvailable() && Boolean((linked.google && cfg?.google) || (linked.discord && cfg?.discord));
  const [resetMode, setResetMode] = useState(false);
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
  if (resetMode && cfg) {
    return <ResetPasswordSheet cfg={cfg} linked={linked} onClose={onClose} />;
  }
  return (
    <Sheet title="Modifier le mot de passe" onClose={onClose}>
      {done ? (
        <Text style={styles.okMsg}>Mot de passe modifié ✓</Text>
      ) : (
        <>
          <Text style={styles.mLabel}>Mot de passe actuel</Text>
          <TextInput style={styles.input} secureTextEntry value={current} onChangeText={setCurrent} autoCapitalize="none" />
          <Text style={styles.mLabel}>Nouveau mot de passe</Text>
          <TextInput style={styles.input} secureTextEntry value={next} onChangeText={setNext} autoCapitalize="none" placeholder="8 caractères minimum" placeholderTextColor={COLORS.textSoft} />
          {error ? <Text style={styles.errMsg}>{error}</Text> : null}
          <Pressable style={({ pressed }) => [styles.actionBtn, !canSubmit && styles.actionBtnDisabled, pressed && canSubmit && styles.btnPressed]} disabled={!canSubmit} onPress={() => { setError(null); mut.mutate(); }}>
            {mut.isPending ? <ActivityIndicator color={COLORS.onPrimary} /> : <Text style={styles.actionBtnText}>ENREGISTRER</Text>}
          </Pressable>
          {canReset ? (
            <Pressable
              onPress={() => setResetMode(true)}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel="Mot de passe oublié — réinitialiser via Google ou Discord"
            >
              <Text style={styles.resetLink}>Mot de passe oublié ? Réinitialiser via Google ou Discord</Text>
            </Pressable>
          ) : null}
        </>
      )}
    </Sheet>
  );
}

// Réinitialisation SANS ancien mot de passe : ré-authentification via un compte
// SSO lié (même mécanique web que le login), puis le jeton de reset (10 min,
// usage unique) délivré par le serveur autorise la pose du nouveau mot de passe.
function ResetPasswordSheet({ cfg, linked, onClose }: { cfg: SsoProviders; linked: Record<string, boolean>; onClose: () => void }) {
  const [resetToken, setResetToken] = useState<string | null>(null);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const gRef = useRef<View>(null);

  // Jeton du provider obtenu → le serveur vérifie l'identité (provider, id)
  // et délivre le jeton de réinitialisation.
  const initReset = async (provider: 'google' | 'discord', tok: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ resetToken: string }>('/api/auth/reset-password/init', { provider, token: tok });
      setResetToken(res.resetToken);
    } catch (e) {
      setError(
        e instanceof ApiError && e.code === 'no_account_for_identity'
          ? 'Ce compte Google/Discord n’est lié à aucun compte PlotTime.'
          : 'Vérification impossible. Réessaie.',
      );
    } finally {
      setBusy(false);
    }
  };

  // Bouton officiel Google (même rendu que l'écran « Comptes liés »).
  useEffect(() => {
    if (resetToken || done || !cfg.google || !linked.google || !ssoWebAvailable() || !gRef.current) return;
    initGoogleButton(cfg.googleClientId, gRef.current as unknown as HTMLElement, (t) => initReset('google', t)).catch(
      () => undefined,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg, resetToken, done]);

  const mut = useMutation({
    mutationFn: () => api.post('/api/auth/reset-password', { resetToken, newPassword: pw }),
    onSuccess: () => {
      setDone(true);
      setTimeout(onClose, 1200);
    },
    onError: (e: unknown) =>
      setError(
        e instanceof ApiError && (e.code === 'reset_token_expired' || e.code === 'invalid_reset_token')
          ? 'Session de réinitialisation expirée — recommence.'
          : e instanceof ApiError && e.code === 'validation_error'
            ? 'Nouveau mot de passe : 8 caractères minimum.'
            : 'Impossible de réinitialiser le mot de passe.',
      ),
  });
  const canSubmit = pw.length >= 8 && pw === pw2 && !mut.isPending;

  return (
    <Sheet title="Réinitialiser le mot de passe" onClose={onClose}>
      {done ? (
        <Text style={styles.okMsg}>Mot de passe réinitialisé ✓</Text>
      ) : resetToken ? (
        <>
          <Text style={styles.mLabel}>Nouveau mot de passe</Text>
          <TextInput style={styles.input} secureTextEntry value={pw} onChangeText={setPw} autoCapitalize="none" placeholder="8 caractères minimum" placeholderTextColor={COLORS.textSoft} />
          <Text style={styles.mLabel}>Confirmer le nouveau mot de passe</Text>
          <TextInput style={styles.input} secureTextEntry value={pw2} onChangeText={setPw2} autoCapitalize="none" />
          {pw2.length > 0 && pw !== pw2 ? (
            <Text style={styles.errMsg}>Les deux mots de passe ne correspondent pas.</Text>
          ) : error ? (
            <Text style={styles.errMsg}>{error}</Text>
          ) : null}
          <Pressable style={({ pressed }) => [styles.actionBtn, !canSubmit && styles.actionBtnDisabled, pressed && canSubmit && styles.btnPressed]} disabled={!canSubmit} onPress={() => { setError(null); mut.mutate(); }}>
            {mut.isPending ? <ActivityIndicator color={COLORS.onPrimary} /> : <Text style={styles.actionBtnText}>RÉINITIALISER</Text>}
          </Pressable>
        </>
      ) : (
        <>
          <Text style={styles.warn}>
            Confirme ton identité avec un compte lié : tu pourras ensuite choisir un nouveau mot de passe, sans
            saisir l’ancien.
          </Text>
          {cfg.google && linked.google ? <View ref={gRef} style={{ alignItems: 'flex-start', paddingVertical: 4 }} /> : null}
          {cfg.discord && linked.discord ? (
            <Pressable
              style={[styles.ssoResetBtn, busy && { opacity: 0.4 }]}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Continuer avec Discord"
              onPress={() => discordLogin(cfg.discordClientId).then((t) => initReset('discord', t)).catch(() => undefined)}
            >
              <Feather name="message-circle" size={16} color="#fff" />
              <Text style={styles.ssoResetText}>Continuer avec Discord</Text>
            </Pressable>
          ) : null}
          {busy ? <ActivityIndicator size="small" color={COLORS.textMuted} style={{ marginTop: 10 }} /> : null}
          {error ? <Text style={styles.errMsg}>{error}</Text> : null}
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
      <TextInput style={styles.input} value={confirm} onChangeText={setConfirm} autoCapitalize="characters" placeholder="SUPPRIMER" placeholderTextColor={COLORS.textSoft} />
      <Pressable
        style={({ pressed }) => [styles.actionBtn, styles.dangerAction, confirm !== 'SUPPRIMER' && styles.actionBtnDisabled, pressed && confirm === 'SUPPRIMER' && styles.btnPressed]}
        disabled={confirm !== 'SUPPRIMER' || mut.isPending}
        onPress={() => mut.mutate()}
      >
        {mut.isPending ? <ActivityIndicator color="#fff" /> : <Text style={[styles.actionBtnText, { color: '#fff' }]}>SUPPRIMER DÉFINITIVEMENT</Text>}
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
            width: '100%',
            maxWidth: 420,
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
              <Feather name="x" size={24} color={COLORS.text} />
            </Pressable>
          </View>
          {children}
        </Pressable>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

// Langues de contenu : les titres (et résumés quand disponibles) des séries et
// films s'affichent dans cette langue partout. Même liste que le serveur.
const CONTENT_LANGS: [string, string][] = [
  ['fr', 'Français'],
  ['en', 'English'],
  ['es', 'Español'],
  ['de', 'Deutsch'],
  ['it', 'Italiano'],
  ['pt', 'Português'],
];

function AppTab() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['settings'], queryFn: () => api.get<{ settings: any }>('/api/settings') });
  const update = useMutation({
    mutationFn: (patch: any) => api.post('/api/settings', patch),
    onSettled: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  });
  const s = data?.settings ?? {};
  // Langue de contenu : la valeur courante vient du serveur (User.language) ;
  // sélection optimiste le temps de l'aller-retour.
  const [langSel, setLangSel] = useState<string | null>(null);
  const [langMsg, setLangMsg] = useState<string | null>(null);
  const lang = langSel ?? s.language ?? 'fr';
  const pickLang = async (v: string) => {
    if (v === lang) return;
    setLangSel(v);
    setLangMsg(null);
    try {
      await api.post('/api/settings', { language: v });
      if (v !== 'fr') setLangMsg('Bibliothèque en cours de traduction…');
      // Les titres changent PARTOUT (À voir, À venir, bibliothèque, fiches,
      // recherche, explorer…) : tout le cache est re-fetché.
      qc.invalidateQueries();
    } catch {
      setLangSel(null);
      setLangMsg('Impossible de changer la langue. Réessaie.');
    }
  };
  // Thème : la préférence EFFECTIVE vient du stockage local (c'est elle qui a
  // servi à peindre cette session) ; le serveur n'en garde qu'une copie.
  const [themePref, setThemePref] = useState<ThemePreference>(getThemePreference());
  const pickTheme = async (v: ThemePreference) => {
    if (v === themePref) return;
    setThemePref(v);
    // Sauvegarde serveur d'abord (le rechargement web coupe les requêtes en vol).
    try { await api.post('/api/settings', { theme: v }); } catch { /* best-effort */ }
    qc.invalidateQueries({ queryKey: ['settings'] });
    // Puis application : les couleurs étant figées dans les styles au
    // chargement, la web app se recharge (comme le fait X/Twitter).
    applyThemePreference(v);
  };
  return (
    <>
      <Section title="Titres">
        <ToggleRow label="Afficher dans votre langue" sub="Les titres s'affichent par défaut en anglais" on={s.titlesInUserLanguage ?? true} onToggle={(v) => update.mutate({ titlesInUserLanguage: v })} />
      </Section>

      <Section title="Thème">
        {(
          [
            ['system', "Suivre le thème défini sur l'appareil"],
            ['light', 'Thème clair'],
            ['dark', 'Thème sombre'],
            ['sunset', 'Thème Sunset'],
            ['midnight', 'Thème Nuit — les couleurs PlotTime'],
            ['glass', 'Thème Glass — verre liquide translucide'],
          ] as [ThemePreference, string][]
        ).map(([v, l]) => (
          <RadioRow key={v} label={l} on={themePref === v} onPress={() => pickTheme(v)} />
        ))}
        {Platform.OS !== 'web' ? (
          <Text style={styles.note}>
            Sur l'app native, le thème suit l'appareil ; le choix explicite s'applique sur la web app.
          </Text>
        ) : null}
      </Section>

      <Section title="Langue">
        {CONTENT_LANGS.map(([v, l]) => (
          <RadioRow key={v} label={l} on={lang === v} onPress={() => pickLang(v)} />
        ))}
        {langMsg ? <Text style={styles.note}>{langMsg}</Text> : null}
      </Section>

      <Section title="Cache">
        <View style={styles.block}>
          <Pressable style={({ pressed }) => [styles.actionBtn, pressed && styles.btnPressed]} onPress={() => api.post('/api/cache/clear').catch(() => {})}>
            <Text style={styles.actionBtnText}>VIDER LE CACHE</Text>
          </Pressable>
        </View>
      </Section>

      {/* À propos : liens légaux (exigés par Apple/Google) + attributions des
          sources de données (mentions obligatoires TMDb/TheTVDB/IGDB — cf.
          docs/STORES.md A2/A3). */}
      <Section title="À propos">
        <Row label="Politique de confidentialité" onPress={() => openExternal(`${LEGAL_BASE}/privacy`)} external />
        <Row label="Conditions d'utilisation" onPress={() => openExternal(`${LEGAL_BASE}/terms`)} external />
        <View style={styles.block}>
          <Text style={styles.attribution}>Les informations sur les œuvres proviennent de :</Text>
          <Text style={styles.attribution}>This product uses the TMDB API but is not endorsed or certified by TMDB.</Text>
          <Text style={styles.attribution}>Metadata provided by TheTVDB. Please consider adding missing information or subscribing.</Text>
          <Text style={styles.attribution}>Game data provided by IGDB.com.</Text>
        </View>
      </Section>

      <Text style={styles.version}>VERSION 1.0.0</Text>
    </>
  );
}

// Section : UN seul titre (retour Étienne 2026-07-21 — l'ancienne paire
// eyebrow + titre semait la confusion) au-dessus d'une carte regroupant les
// rangées liées.
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <SectionHeader title={title} />
      <PrismeCard elevated style={styles.sectionCard}>{children}</PrismeCard>
    </View>
  );
}
function Field({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={[styles.fieldValue, accent && { color: COLORS.primary, fontFamily: FONTS.semiBold }]}>{value}</Text>
    </View>
  );
}
function Row({ label, onPress, external }: { label: string; onPress?: () => void; external?: boolean }) {
  return (
    <Pressable style={({ pressed }) => [styles.row, pressed && onPress && styles.rowPressed]} onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Feather name={external ? 'external-link' : 'chevron-right'} size={19} color={COLORS.textMuted} />
    </Pressable>
  );
}
// Rangée avec valeur courante à droite (ex. Pays : France ›).
function RowWithValue({ label, value, onPress }: { label: string; value: string; onPress: () => void }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label} : ${value}`}
    >
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} numberOfLines={1}>
        {value}
      </Text>
      <Feather name="chevron-right" size={19} color={COLORS.textMuted} />
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
        <Text style={styles.rowLabel}>{label}</Text>
        {sub ? <Text style={styles.rowSub}>{sub}</Text> : null}
      </View>
      <Pressable
        onPress={() => onToggle(!on)}
        hitSlop={8}
        accessibilityRole="switch"
        accessibilityLabel={label}
        accessibilityState={{ checked: on }}
      >
        <Animated.View style={[styles.toggle, { backgroundColor: v.interpolate({ inputRange: [0, 1], outputRange: [COLORS.chipSelected, COLORS.primary] }) }]}>
          <Animated.View
            style={[
              styles.knob,
              {
                backgroundColor: v.interpolate({ inputRange: [0, 1], outputRange: ['#ffffff', '#ffffff'] }),
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
    <Pressable style={({ pressed }) => [styles.radioRow, pressed && styles.rowPressed]} onPress={onPress} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={label}>
      <View style={[styles.radio, on && styles.radioSel]}>
        {on ? (
          <PopIn>
            <View style={styles.radioDot} />
          </PopIn>
        ) : null}
      </View>
      <Text style={styles.rowLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 0 },
  list: { paddingTop: SPACE.xs, gap: SPACE.sm },
  section: { gap: 0 },
  sectionCard: { padding: SPACE.md, gap: 0 },
  field: { paddingVertical: SPACE.sm, borderTopWidth: 1, borderTopColor: COLORS.borderLight },
  fieldLabel: { color: COLORS.textMuted, fontFamily: FONTS.medium, fontSize: 13 },
  fieldValue: { fontFamily: FONTS.regular, fontSize: 15, color: COLORS.text, marginTop: 2 },
  row: { minHeight: SIZES.touch, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SPACE.sm, paddingVertical: SPACE.sm, borderTopWidth: 1, borderTopColor: COLORS.borderLight },
  rowPressed: { opacity: 0.6 },
  rowLabel: { flex: 1, color: COLORS.text, fontFamily: FONTS.regular, fontSize: 15 },
  rowValue: { flexShrink: 1, maxWidth: '50%', color: COLORS.primary, fontFamily: FONTS.semiBold, fontSize: 14 },
  // Sélecteur de pays plein écran.
  countryScreen: { flex: 1, backgroundColor: COLORS.bg },
  countryHeader: {
    minHeight: SIZES.header,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACE.md,
    backgroundColor: COLORS.surface,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderLight,
  },
  countryBack: { width: SIZES.touch, height: SIZES.touch, alignItems: 'flex-start', justifyContent: 'center' },
  countryTitle: { flex: 1, textAlign: 'center', color: COLORS.text, fontSize: 17, fontFamily: FONTS.extraBold },
  countryCanvas: { width: '100%', maxWidth: SIZES.contentMax, alignSelf: 'center', paddingBottom: SPACE.xl },
  countryRow: { minHeight: SIZES.touch, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SPACE.lg, paddingVertical: SPACE.sm, borderBottomWidth: 1, borderBottomColor: COLORS.borderLight },
  countryName: { color: COLORS.text, fontFamily: FONTS.regular, fontSize: 16 },
  countrySelected: { color: COLORS.primary, fontFamily: FONTS.bold },
  rowSub: { fontFamily: FONTS.regular, fontSize: 12.5, color: COLORS.textMuted, lineHeight: 17, marginTop: 2 },
  toggleRow: { minHeight: SIZES.touch, flexDirection: 'row', alignItems: 'center', paddingVertical: SPACE.sm, gap: SPACE.md, borderTopWidth: 1, borderTopColor: COLORS.borderLight },
  toggle: { width: 52, height: 30, borderRadius: 15, padding: 3 },
  knob: { width: 24, height: 24, borderRadius: 12 },
  radioRow: { minHeight: SIZES.touch, flexDirection: 'row', alignItems: 'center', gap: SPACE.md, paddingVertical: SPACE.sm, borderTopWidth: 1, borderTopColor: COLORS.borderLight },
  radio: { width: 24, height: 24, borderRadius: 12, borderWidth: 2.5, borderColor: COLORS.textMuted, alignItems: 'center', justifyContent: 'center' },
  radioSel: { borderColor: COLORS.primary },
  radioDot: { width: 11, height: 11, borderRadius: 6, backgroundColor: COLORS.primary },
  block: { paddingVertical: SPACE.sm, borderTopWidth: 1, borderTopColor: COLORS.borderLight },
  // Zone sensible isolée.
  dangerCard: { gap: SPACE.sm },
  logoutBtn: { minHeight: SIZES.touchComfortable, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACE.xs, backgroundColor: COLORS.primary, borderRadius: RADIUS.pill, paddingVertical: SPACE.sm },
  logoutText: { color: COLORS.onPrimary, fontSize: 15, fontFamily: FONTS.extraBold, letterSpacing: 0.6 },
  deleteBtn: { minHeight: SIZES.touch, alignItems: 'center', justifyContent: 'center', borderRadius: RADIUS.pill, borderWidth: 1.5, borderColor: COLORS.danger },
  deletePressed: { backgroundColor: 'rgba(200,63,96,0.08)' },
  deleteText: { fontSize: 13, fontFamily: FONTS.extraBold, letterSpacing: 0.6, color: COLORS.danger, textAlign: 'center' },
  btnPressed: { opacity: 0.86, transform: [{ scale: 0.99 }] },
  overlay: { flex: 1, backgroundColor: COLORS.overlay, justifyContent: 'center', alignItems: 'center', paddingHorizontal: SPACE.lg },
  sheet: { backgroundColor: COLORS.sheet, borderRadius: RADIUS.sheet, padding: SPACE.lg, ...SHADOW.card, ...GLASS_BLUR },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: SPACE.sm },
  sheetTitle: { color: COLORS.text, fontSize: 17, fontFamily: FONTS.extraBold },
  hint: { fontSize: 14, fontFamily: FONTS.regular, color: COLORS.textMuted, lineHeight: 19, marginBottom: SPACE.sm },
  mLabel: { color: COLORS.text, fontSize: 14, fontFamily: FONTS.bold, marginTop: SPACE.sm },
  input: { color: COLORS.text, backgroundColor: COLORS.surfaceMuted, borderWidth: 1, borderColor: COLORS.borderLight, borderRadius: RADIUS.control, fontSize: 15, fontFamily: FONTS.regular, paddingHorizontal: SPACE.sm, paddingVertical: 11, marginTop: 6 },
  actionBtn: { minHeight: SIZES.touchComfortable, backgroundColor: COLORS.primary, borderRadius: RADIUS.pill, paddingVertical: SPACE.sm, alignItems: 'center', justifyContent: 'center', marginTop: SPACE.md },
  actionBtnDisabled: { opacity: 0.4 },
  actionBtnText: { color: COLORS.onPrimary, fontSize: 13, fontFamily: FONTS.extraBold, letterSpacing: 0.6 },
  dangerAction: { backgroundColor: COLORS.danger },
  okMsg: { fontSize: 14, fontFamily: FONTS.bold, color: COLORS.success, textAlign: 'center', paddingVertical: SPACE.md },
  resetLink: { color: COLORS.primary, fontSize: 13, fontFamily: FONTS.bold, textAlign: 'center', marginTop: SPACE.md },
  ssoResetBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACE.xs, backgroundColor: '#5865F2', borderRadius: RADIUS.pill, paddingVertical: 10, paddingHorizontal: 18, alignSelf: 'flex-start', marginTop: SPACE.xs },
  ssoResetText: { color: '#fff', fontFamily: FONTS.bold, fontSize: 13 },
  errMsg: { color: COLORS.danger, fontSize: 14, fontFamily: FONTS.regular, marginTop: SPACE.sm },
  warn: { fontSize: 15, fontFamily: FONTS.regular, color: COLORS.textMuted, lineHeight: 21, marginBottom: SPACE.xs },
  version: { textAlign: 'center', paddingVertical: SPACE.lg, fontSize: 13, fontFamily: FONTS.bold, color: COLORS.textMuted, letterSpacing: 1 },
  note: { fontSize: 13, fontFamily: FONTS.regular, color: COLORS.textMuted, paddingTop: SPACE.sm, lineHeight: 18, borderTopWidth: 1, borderTopColor: COLORS.borderLight, marginTop: 0 },
  attribution: { fontSize: 12, fontFamily: FONTS.regular, color: COLORS.textMuted, lineHeight: 17, marginBottom: 6 },
});
