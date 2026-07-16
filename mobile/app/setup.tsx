import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView, Image } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, checkHealth, ApiError } from '@/lib/api';
import { useAppStore } from '@/lib/store';
import { CONFIGURED_SERVER_URL } from '@/lib/config';
import { COLORS, FONTS } from '@/lib/theme';
import { SsoButtons } from '@/components/SsoButtons';
import { ssoWebAvailable } from '@/lib/sso';

type Step = 'server' | 'auth';
type Mode = 'login' | 'register';

export default function Setup() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { serverUrl, setServerUrl, setAuth } = useAppStore();

  // L'étape « serveur » n'apparaît qu'en développement : en production une URL
  // est « bakée » dans l'app (config.ts), l'utilisateur va donc droit au compte.
  const needsServerStep = !CONFIGURED_SERVER_URL && !serverUrl;
  const [step, setStep] = useState<Step>(needsServerStep ? 'server' : 'auth');

  // --- Étape serveur (dev uniquement) ---
  const [url, setUrl] = useState(serverUrl ?? '');
  const [testing, setTesting] = useState(false);
  const [ok, setOk] = useState(false);

  // --- Étape compte ---
  const [mode, setMode] = useState<Mode>('register');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const [error, setError] = useState<string | null>(null);

  const test = async () => {
    setTesting(true);
    setError(null);
    setOk(false);
    try {
      await checkHealth(url);
      setOk(true);
    } catch (e) {
      setError(
        e instanceof ApiError && (e.code === 'invalid_server' || e.code === 'invalid_response')
          ? 'Réponse serveur invalide'
          : 'Serveur inaccessible',
      );
    } finally {
      setTesting(false);
    }
  };

  const proceed = () => {
    setServerUrl(url);
    setError(null);
    setStep('auth');
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res =
        mode === 'register'
          ? await api.post<{ token: string; user: any }>('/api/auth/register', {
              displayName,
              email: email.trim(),
              password,
            })
          : await api.post<{ token: string; user: any }>('/api/auth/login', {
              email: email.trim(),
              password,
            });
      setAuth(res.token, res.user);
      router.replace('/(tabs)');
    } catch (e) {
      if (e instanceof ApiError && e.code === 'email_taken') {
        setError('Un compte existe déjà avec cet e-mail.');
      } else if (e instanceof ApiError && e.code === 'invalid_credentials') {
        setError('E-mail ou mot de passe incorrect.');
      } else if (e instanceof ApiError && e.code === 'validation_error') {
        setError('Vérifiez l’e-mail et un mot de passe d’au moins 6 caractères.');
      } else {
        setError(mode === 'register' ? 'Impossible de créer le compte.' : 'Connexion impossible.');
      }
    } finally {
      setBusy(false);
    }
  };

  // Connexion / inscription via SSO (Google, Facebook) : un jeton du fournisseur
  // suffit — le serveur crée le compte ou retrouve/lie un compte existant.
  const oauth = async (provider: 'google' | 'facebook' | 'discord', token: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ token: string; user: any }>('/api/auth/oauth', { provider, token });
      setAuth(res.token, res.user);
      router.replace('/(tabs)');
    } catch {
      setError('Connexion via ce compte impossible.');
    } finally {
      setBusy(false);
    }
  };

  const canSubmit =
    !busy &&
    /\S+@\S+\.\S+/.test(email) &&
    password.length >= 6 &&
    (mode === 'login' || displayName.trim().length > 0);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: COLORS.white }}
      contentContainerStyle={{ paddingTop: insets.top + 40, paddingHorizontal: 24, paddingBottom: 40 }}
      keyboardShouldPersistTaps="handled"
    >
      {/* Logo de marque au-dessus du titre (icône ronde du pack). */}
      <View style={styles.brandRow}>
        <Image source={require('../assets/branding/pwa-icon-192.png')} style={styles.brandLogo} resizeMode="cover" />
        <Text style={styles.brand}>SerieTime</Text>
      </View>

      {step === 'server' ? (
        <>
          <Text style={styles.lead}>Connectez l’application à votre serveur.</Text>
          <Text style={styles.label}>URL du serveur</Text>
          <TextInput
            style={styles.input}
            placeholder="http://192.168.1.42:4000"
            placeholderTextColor={COLORS.textSoft}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            value={url}
            onChangeText={(t) => {
              setUrl(t);
              setOk(false);
            }}
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          {ok ? <Text style={styles.success}>Connexion réussie</Text> : null}
          <Pressable
            style={[styles.btnOutline, (!url || testing) && styles.disabled]}
            onPress={test}
            disabled={!url || testing}
          >
            <Text style={styles.btnOutlineText}>{testing ? 'TEST EN COURS…' : 'TESTER LA CONNEXION'}</Text>
          </Pressable>
          <Pressable style={[styles.btnYellow, !ok && styles.disabled]} onPress={proceed} disabled={!ok}>
            <Text style={styles.btnYellowText}>CONTINUER</Text>
          </Pressable>
        </>
      ) : (
        <>
          <Text style={styles.lead}>
            {mode === 'register' ? 'Créez votre compte.' : 'Connectez-vous.'}
          </Text>

          {/* Inscription (web) : Google / Discord UNIQUEMENT — aucun mot de passe
              à créer ni à perdre. Les comptes e-mail existants gardent la
              connexion classique (onglet « Se connecter »). Sur natif (Expo Go),
              le SSO est web-only : on garde le formulaire e-mail en secours. */}
          {mode === 'register' && ssoWebAvailable() ? (
            <>
              <Text style={styles.ssoNote}>
                Inscris-toi en un clic avec Google ou Discord — pas de mot de passe à retenir,
                et tu récupères ton compte à tout moment.
              </Text>
              <SsoButtons onToken={oauth} separator={null} />
              {error ? <Text style={styles.error}>{error}</Text> : null}
              <Pressable
                onPress={() => {
                  setMode('login');
                  setError(null);
                }}
              >
                <Text style={styles.link}>J’ai déjà un compte — Se connecter</Text>
              </Pressable>
            </>
          ) : (
            <>
              {mode === 'register' ? (
                <>
                  <Text style={styles.label}>Nom d’affichage</Text>
                  <TextInput
                    style={styles.input}
                    value={displayName}
                    onChangeText={setDisplayName}
                    autoCapitalize="words"
                  />
                </>
              ) : null}

              <Text style={styles.label}>E-mail</Text>
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                placeholder="vous@exemple.com"
                placeholderTextColor={COLORS.textSoft}
              />

              <Text style={styles.label}>Mot de passe</Text>
              <TextInput
                style={styles.input}
                secureTextEntry
                value={password}
                onChangeText={setPassword}
                onSubmitEditing={() => canSubmit && submit()}
                placeholder="6 caractères minimum"
                placeholderTextColor={COLORS.textSoft}
              />

              {error ? <Text style={styles.error}>{error}</Text> : null}

              <Pressable style={[styles.btnYellow, !canSubmit && styles.disabled]} onPress={submit} disabled={!canSubmit}>
                <Text style={styles.btnYellowText}>
                  {busy
                    ? mode === 'register'
                      ? 'CRÉATION…'
                      : 'CONNEXION…'
                    : mode === 'register'
                      ? 'CRÉER MON COMPTE'
                      : 'SE CONNECTER'}
                </Text>
              </Pressable>

              <Pressable
                onPress={() => {
                  setMode(mode === 'register' ? 'login' : 'register');
                  setError(null);
                }}
              >
                <Text style={styles.link}>
                  {mode === 'register' ? 'J’ai déjà un compte — Se connecter' : 'Créer un nouveau compte'}
                </Text>
              </Pressable>

              {/* SSO (web app) : Google / Discord. Masqué s'ils ne sont pas configurés. */}
              <SsoButtons onToken={oauth} separator="ou" />
            </>
          )}

          {needsServerStep ? (
            <Pressable onPress={() => setStep('server')}>
              <Text style={styles.linkMuted}>Changer de serveur</Text>
            </Pressable>
          ) : null}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  brandLogo: { width: 52, height: 52, borderRadius: 14 },
  brand: { color: COLORS.text, fontSize: 34, fontFamily: FONTS.extraBold },
  lead: { fontFamily: FONTS.regular, fontSize: 16, color: COLORS.textMuted, marginTop: 24 },
  ssoNote: { fontFamily: FONTS.regular, fontSize: 14, color: COLORS.textMuted, marginTop: 16, marginBottom: 4, lineHeight: 20 },
  label: { color: COLORS.text, fontSize: 14, fontFamily: FONTS.bold, marginTop: 24 },
  input: { color: COLORS.text, borderBottomWidth: 1, borderBottomColor: COLORS.border, fontFamily: FONTS.regular, fontSize: 17, paddingVertical: 10, marginTop: 6 },
  error: { color: COLORS.red, fontFamily: FONTS.regular, fontSize: 15, marginTop: 12 },
  success: { color: COLORS.green, fontSize: 15, fontFamily: FONTS.semiBold, marginTop: 12 },
  btnOutline: { borderWidth: 2, borderColor: COLORS.black, borderRadius: 999, paddingVertical: 15, marginTop: 36, alignItems: 'center' },
  btnOutlineText: { color: COLORS.text, fontSize: 15, fontFamily: FONTS.extraBold, letterSpacing: 0.6 },
  btnYellow: { backgroundColor: COLORS.yellow, borderRadius: 999, paddingVertical: 15, marginTop: 28, alignItems: 'center' },
  btnYellowText: { color: COLORS.onAccent, fontSize: 15, fontFamily: FONTS.extraBold, letterSpacing: 0.6 },
  disabled: { opacity: 0.4 },
  link: { color: COLORS.blue, fontFamily: FONTS.regular, fontSize: 15, marginTop: 24 },
  linkMuted: { color: COLORS.textSoft, fontFamily: FONTS.regular, fontSize: 14, marginTop: 20 },
});
