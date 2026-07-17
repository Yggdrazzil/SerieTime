import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView, Image, useWindowDimensions } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, checkHealth, ApiError } from '@/lib/api';
import { useAppStore } from '@/lib/store';
import { CONFIGURED_SERVER_URL } from '@/lib/config';
import { COLORS, FONTS, RADIUS, SHADOW, SIZES, SPACE } from '@/lib/theme';
import { SsoButtons } from '@/components/SsoButtons';
import { NativeSsoButtons } from '@/components/NativeSsoButtons';
import { ssoWebAvailable } from '@/lib/sso';
import { ssoNativeAvailable } from '@/lib/ssoNative';

type Step = 'server' | 'auth';
type Mode = 'login' | 'register';

export default function Setup() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
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

  // Builds natifs : vrai dès qu'au moins un provider SSO natif est configuré
  // côté serveur (Apple/Google/Discord — voir NativeSsoButtons). Tant que les
  // credentials n'existent pas, l'écran garde le formulaire e-mail (secours dev).
  const [nativeSsoReady, setNativeSsoReady] = useState(false);

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

  // Connexion / inscription via SSO : un jeton du fournisseur suffit — le
  // serveur crée le compte ou retrouve/lie un compte existant. displayName
  // (Apple uniquement, fourni au premier login) ne sert qu'à la création.
  const oauth = async (
    provider: 'google' | 'facebook' | 'discord' | 'apple',
    token: string,
    displayName?: string | null,
  ) => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ token: string; user: any }>('/api/auth/oauth', {
        provider,
        token,
        ...(displayName ? { displayName } : {}),
      });
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
  const compact = width < 480;

  return (
    <View style={styles.screen}>
      <View pointerEvents="none" style={styles.decor}>
        <View style={styles.decorPrimary} />
        <View style={styles.decorSecondary} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          compact && styles.scrollContentCompact,
          { paddingTop: insets.top + SPACE.lg, paddingBottom: insets.bottom + SPACE.xl },
        ]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.content}>
          <View style={styles.brandRow}>
            <View style={styles.brandLogoFrame}>
              <Image
                source={require('../assets/branding/pwa-icon-192.png')}
                style={styles.brandLogo}
                resizeMode="cover"
                accessibilityLabel="Logo PlotTime"
              />
            </View>
            <View style={styles.brandCopy}>
              <Text style={styles.brand}>PlotTime</Text>
              <Text style={styles.brandTagline}>Vos histoires, à votre rythme</Text>
            </View>
          </View>

          <View style={styles.hero}>
            <View style={styles.eyebrowRow}>
              <Feather name={step === 'server' ? 'server' : 'aperture'} size={14} color={COLORS.primary} />
              <Text style={styles.eyebrow}>{step === 'server' ? 'Configuration' : 'Votre espace personnel'}</Text>
            </View>
            <Text accessibilityRole="header" style={[styles.title, compact && styles.titleCompact]}>
              {step === 'server'
                ? 'Reliez votre univers.'
                : mode === 'register'
                  ? 'Commencez votre histoire.'
                  : 'Heureux de vous revoir.'}
            </Text>
            <Text style={styles.lead}>
              {step === 'server'
                ? 'Indiquez l’adresse de votre serveur PlotTime pour accéder à votre bibliothèque.'
                : mode === 'register'
                  ? 'Séries, films, animés et jeux : retrouvez tout ce qui compte pour vous au même endroit.'
                  : 'Reprenez votre suivi exactement là où vous l’avez laissé.'}
            </Text>
          </View>

          <View style={[styles.card, compact && styles.cardCompact]}>
            {step === 'server' ? (
              <>
                <View style={styles.cardHeading}>
                  <View style={styles.cardIcon}>
                    <Feather name="link-2" size={20} color={COLORS.primary} />
                  </View>
                  <View style={styles.cardHeadingCopy}>
                    <Text style={styles.cardEyebrow}>Étape de développement</Text>
                    <Text style={styles.cardTitle}>Connexion au serveur</Text>
                  </View>
                </View>

                <Text style={styles.helper}>L’adresse est testée avant d’être enregistrée sur cet appareil.</Text>
                <Text style={styles.label}>URL du serveur</Text>
                <View style={styles.inputShell}>
                  <Feather name="globe" size={18} color={COLORS.textMuted} />
                  <TextInput
                    style={styles.input}
                    placeholder="http://192.168.1.42:4000"
                    placeholderTextColor={COLORS.text}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="url"
                    returnKeyType="done"
                    accessibilityLabel="URL du serveur"
                    value={url}
                    onChangeText={(t) => {
                      setUrl(t);
                      setOk(false);
                    }}
                  />
                </View>

                {error ? (
                  <View style={[styles.feedback, styles.feedbackError]} accessibilityRole="alert">
                    <Feather name="alert-circle" size={17} color={COLORS.danger} />
                    <Text style={[styles.feedbackText, styles.error]}>{error}</Text>
                  </View>
                ) : null}
                {ok ? (
                  <View style={[styles.feedback, styles.feedbackSuccess]} accessibilityRole="alert">
                    <Feather name="check-circle" size={17} color={COLORS.success} />
                    <Text style={[styles.feedbackText, styles.success]}>Connexion réussie</Text>
                  </View>
                ) : null}

                <Pressable
                  style={({ pressed }) => [
                    styles.secondaryButton,
                    pressed && styles.pressed,
                    (!url || testing) && styles.disabled,
                  ]}
                  onPress={test}
                  disabled={!url || testing}
                  accessibilityRole="button"
                  accessibilityLabel={testing ? 'Test de la connexion en cours' : 'Tester la connexion au serveur'}
                  accessibilityState={{ disabled: !url || testing, busy: testing }}
                >
                  <Feather name="activity" size={18} color={COLORS.primary} />
                  <Text style={styles.secondaryButtonText}>{testing ? 'Test en cours…' : 'Tester la connexion'}</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed, !ok && styles.disabled]}
                  onPress={proceed}
                  disabled={!ok}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: !ok }}
                >
                  <Text style={styles.primaryButtonText}>Continuer</Text>
                  <Feather name="arrow-right" size={18} color={COLORS.onPrimary} />
                </Pressable>
              </>
            ) : (
              <>
                <View style={styles.modeSwitch} accessibilityLabel="Choisir le mode d’authentification">
                  <Pressable
                    onPress={() => {
                      setMode('register');
                      setError(null);
                    }}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: mode === 'register' }}
                    style={({ pressed }) => [
                      styles.modeOption,
                      mode === 'register' && styles.modeOptionSelected,
                      pressed && styles.modeOptionPressed,
                    ]}
                  >
                    <Text style={[styles.modeText, mode === 'register' && styles.modeTextSelected]}>Créer un compte</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      setMode('login');
                      setError(null);
                    }}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: mode === 'login' }}
                    style={({ pressed }) => [
                      styles.modeOption,
                      mode === 'login' && styles.modeOptionSelected,
                      pressed && styles.modeOptionPressed,
                    ]}
                  >
                    <Text style={[styles.modeText, mode === 'login' && styles.modeTextSelected]}>Se connecter</Text>
                  </Pressable>
                </View>

                {/* Inscription : SSO UNIQUEMENT — aucun mot de passe à créer ni à
                    perdre. Web : Google / Discord (SDK officiels, SsoButtons).
                    Natif : Apple / Google / Discord (NativeSsoButtons) dès que le
                    serveur expose la config ; sinon (dev sans credentials), le
                    formulaire e-mail reste en secours. Les comptes e-mail existants
                    gardent la connexion classique (onglet « Se connecter »). */}
                {mode === 'register' && (ssoWebAvailable() || nativeSsoReady) ? (
                  <>
                    <View style={styles.ssoIntro}>
                      <View style={styles.ssoIntroIcon}>
                        <Feather name="shield" size={18} color={COLORS.primary} />
                      </View>
                      <View style={styles.ssoIntroCopy}>
                        <Text style={styles.ssoTitle}>Une inscription simple et sûre</Text>
                        <Text style={styles.ssoNote}>
                          Inscris-toi en un clic — pas de mot de passe à retenir, et tu récupères ton compte à tout moment.
                        </Text>
                      </View>
                    </View>
                    {ssoWebAvailable() ? (
                      <SsoButtons onToken={oauth} separator={null} />
                    ) : (
                      <NativeSsoButtons onToken={oauth} onAvailability={setNativeSsoReady} separator={null} />
                    )}
                    {error ? (
                      <View style={[styles.feedback, styles.feedbackError]} accessibilityRole="alert">
                        <Feather name="alert-circle" size={17} color={COLORS.danger} />
                        <Text style={[styles.feedbackText, styles.error]}>{error}</Text>
                      </View>
                    ) : null}
                    <Pressable
                      style={({ pressed }) => [styles.linkButton, pressed && styles.linkPressed]}
                      onPress={() => {
                        setMode('login');
                        setError(null);
                      }}
                      accessibilityRole="button"
                    >
                      <Text style={styles.link}>J’ai déjà un compte</Text>
                      <Feather name="arrow-right" size={16} color={COLORS.primary} />
                    </Pressable>
                  </>
                ) : (
                  <>
                    {mode === 'register' ? (
                      <View style={styles.fieldGroup}>
                        <Text style={styles.label}>Nom d’affichage</Text>
                        <View style={styles.inputShell}>
                          <Feather name="user" size={18} color={COLORS.textMuted} />
                          <TextInput
                            style={styles.input}
                            value={displayName}
                            onChangeText={setDisplayName}
                            autoCapitalize="words"
                            autoComplete="name"
                            textContentType="name"
                            accessibilityLabel="Nom d’affichage"
                          />
                        </View>
                      </View>
                    ) : null}

                    <View style={styles.fieldGroup}>
                      <Text style={styles.label}>E-mail</Text>
                      <View style={styles.inputShell}>
                        <Feather name="mail" size={18} color={COLORS.textMuted} />
                        <TextInput
                          style={styles.input}
                          value={email}
                          onChangeText={setEmail}
                          autoCapitalize="none"
                          autoCorrect={false}
                          keyboardType="email-address"
                          autoComplete="email"
                          textContentType="emailAddress"
                          accessibilityLabel="E-mail"
                          placeholder="vous@exemple.com"
                          placeholderTextColor={COLORS.text}
                        />
                      </View>
                    </View>

                    <View style={styles.fieldGroup}>
                      <Text style={styles.label}>Mot de passe</Text>
                      <View style={styles.inputShell}>
                        <Feather name="lock" size={18} color={COLORS.textMuted} />
                        <TextInput
                          style={styles.input}
                          secureTextEntry
                          value={password}
                          onChangeText={setPassword}
                          onSubmitEditing={() => canSubmit && submit()}
                          autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                          textContentType={mode === 'register' ? 'newPassword' : 'password'}
                          returnKeyType="done"
                          accessibilityLabel="Mot de passe"
                          placeholder="6 caractères minimum"
                          placeholderTextColor={COLORS.text}
                        />
                      </View>
                    </View>

                    {error ? (
                      <View style={[styles.feedback, styles.feedbackError]} accessibilityRole="alert">
                        <Feather name="alert-circle" size={17} color={COLORS.danger} />
                        <Text style={[styles.feedbackText, styles.error]}>{error}</Text>
                      </View>
                    ) : null}

                    <Pressable
                      style={({ pressed }) => [
                        styles.primaryButton,
                        pressed && styles.pressed,
                        !canSubmit && styles.disabled,
                      ]}
                      onPress={submit}
                      disabled={!canSubmit}
                      accessibilityRole="button"
                      accessibilityState={{ disabled: !canSubmit, busy }}
                    >
                      <Text style={styles.primaryButtonText}>
                        {busy
                          ? mode === 'register'
                            ? 'Création…'
                            : 'Connexion…'
                          : mode === 'register'
                            ? 'Créer mon compte'
                            : 'Se connecter'}
                      </Text>
                      {!busy ? <Feather name="arrow-right" size={18} color={COLORS.onPrimary} /> : null}
                    </Pressable>

                    <Pressable
                      style={({ pressed }) => [styles.linkButton, pressed && styles.linkPressed]}
                      onPress={() => {
                        setMode(mode === 'register' ? 'login' : 'register');
                        setError(null);
                      }}
                      accessibilityRole="button"
                    >
                      <Text style={styles.link}>
                        {mode === 'register' ? 'J’ai déjà un compte' : 'Créer un nouveau compte'}
                      </Text>
                      <Feather name="arrow-right" size={16} color={COLORS.primary} />
                    </Pressable>

                    {/* SSO : Google / Discord (web) ou Apple / Google / Discord
                        (natif). Masqué si rien n'est configuré côté serveur. Monté
                        aussi en mode inscription : c'est lui qui détecte la config
                        native et fait basculer l'écran en « SSO uniquement ». */}
                    {ssoNativeAvailable() ? (
                      <NativeSsoButtons onToken={oauth} onAvailability={setNativeSsoReady} separator="ou" />
                    ) : (
                      <SsoButtons onToken={oauth} separator="ou" />
                    )}
                  </>
                )}

                {needsServerStep ? (
                  <View style={styles.serverFooter}>
                    <Pressable
                      style={({ pressed }) => [styles.serverLink, pressed && styles.linkPressed]}
                      onPress={() => setStep('server')}
                      accessibilityRole="button"
                    >
                      <Feather name="server" size={15} color={COLORS.textMuted} />
                      <Text style={styles.linkMuted}>Changer de serveur</Text>
                    </Pressable>
                  </View>
                ) : null}
              </>
            )}
          </View>

          <Text style={styles.footerNote}>Un suivi personnel, pensé pour durer.</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bg, overflow: 'hidden' },
  scroll: { flex: 1 },
  scrollContent: { flexGrow: 1, paddingHorizontal: SPACE.md },
  scrollContentCompact: { paddingHorizontal: SPACE.sm },
  content: { width: '100%', maxWidth: 560, alignSelf: 'center' },
  decor: { ...StyleSheet.absoluteFillObject },
  decorPrimary: {
    position: 'absolute',
    width: 260,
    height: 260,
    borderRadius: 130,
    top: -116,
    right: -86,
    backgroundColor: COLORS.primarySoft,
    opacity: 0.78,
  },
  decorSecondary: {
    position: 'absolute',
    width: 168,
    height: 168,
    borderRadius: 84,
    top: 94,
    right: -112,
    backgroundColor: COLORS.secondary,
    opacity: 0.1,
  },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm },
  brandLogoFrame: {
    width: 56,
    height: 56,
    padding: 3,
    borderRadius: RADIUS.card,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    ...SHADOW.card,
  },
  brandLogo: { width: '100%', height: '100%', borderRadius: RADIUS.poster },
  brandCopy: { flex: 1 },
  brand: {
    color: COLORS.text,
    fontSize: 27,
    lineHeight: 31,
    fontFamily: FONTS.extraBold,
    letterSpacing: -0.5,
  },
  brandTagline: { color: COLORS.text, fontSize: 12, lineHeight: 17, fontFamily: FONTS.semiBold },
  hero: { marginTop: SPACE.xl, marginBottom: SPACE.lg },
  eyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE.xs, marginBottom: SPACE.xs },
  eyebrow: {
    color: COLORS.primary,
    fontFamily: FONTS.bold,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  title: {
    color: COLORS.text,
    fontFamily: FONTS.extraBold,
    fontSize: 35,
    lineHeight: 41,
    letterSpacing: -1,
  },
  titleCompact: { fontSize: 31, lineHeight: 37 },
  lead: {
    color: COLORS.text,
    fontFamily: FONTS.regular,
    fontSize: 15,
    lineHeight: 23,
    marginTop: SPACE.sm,
    maxWidth: 500,
  },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.sheet,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    padding: SPACE.lg,
    ...SHADOW.card,
  },
  cardCompact: { padding: SPACE.sm },
  cardHeading: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, marginBottom: SPACE.md },
  cardIcon: {
    width: SIZES.touch,
    height: SIZES.touch,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: RADIUS.control,
    backgroundColor: COLORS.primarySoft,
  },
  cardHeadingCopy: { flex: 1 },
  cardEyebrow: {
    color: COLORS.primary,
    fontFamily: FONTS.bold,
    fontSize: 10,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  cardTitle: { color: COLORS.text, fontFamily: FONTS.extraBold, fontSize: 20, lineHeight: 26, marginTop: 1 },
  helper: {
    color: COLORS.text,
    fontFamily: FONTS.regular,
    fontSize: 13,
    lineHeight: 19,
    marginBottom: SPACE.md,
  },
  fieldGroup: { marginTop: SPACE.md },
  label: { color: COLORS.text, fontSize: 13, fontFamily: FONTS.bold, marginBottom: SPACE.xs },
  inputShell: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.sm,
    paddingHorizontal: SPACE.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.control,
    backgroundColor: COLORS.bg,
  },
  input: {
    flex: 1,
    minWidth: 0,
    color: COLORS.text,
    fontFamily: FONTS.regular,
    fontSize: 16,
    paddingVertical: SPACE.sm,
  },
  feedback: {
    minHeight: SIZES.touch,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.xs,
    borderRadius: RADIUS.control,
    borderWidth: 1,
    paddingHorizontal: SPACE.sm,
    paddingVertical: SPACE.xs,
    marginTop: SPACE.md,
  },
  feedbackError: { backgroundColor: COLORS.surfaceMuted, borderColor: COLORS.danger },
  feedbackSuccess: { backgroundColor: COLORS.surfaceMuted, borderColor: COLORS.success },
  feedbackText: { flex: 1, color: COLORS.text, fontFamily: FONTS.semiBold, fontSize: 13, lineHeight: 18 },
  error: { color: COLORS.text },
  success: { color: COLORS.text },
  secondaryButton: {
    minHeight: SIZES.touchComfortable,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACE.xs,
    borderWidth: 1,
    borderColor: COLORS.primary,
    borderRadius: RADIUS.pill,
    paddingHorizontal: SPACE.md,
    marginTop: SPACE.lg,
  },
  secondaryButtonText: { color: COLORS.primary, fontSize: 14, fontFamily: FONTS.bold },
  primaryButton: {
    minHeight: SIZES.touchComfortable,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACE.xs,
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.pill,
    paddingHorizontal: SPACE.md,
    marginTop: SPACE.sm,
  },
  primaryButtonText: { color: COLORS.onPrimary, fontSize: 14, fontFamily: FONTS.bold },
  pressed: { opacity: 0.82, transform: [{ scale: 0.99 }] },
  disabled: { opacity: 0.42 },
  modeSwitch: {
    flexDirection: 'row',
    gap: SPACE.xxs,
    padding: SPACE.xxs,
    borderRadius: RADIUS.control,
    backgroundColor: COLORS.surfaceMuted,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    marginBottom: SPACE.md,
  },
  modeOption: {
    flex: 1,
    minHeight: SIZES.touch,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACE.xs,
    borderRadius: RADIUS.small,
  },
  modeOptionSelected: { backgroundColor: COLORS.surface, ...SHADOW.card },
  modeOptionPressed: { opacity: 0.75 },
  modeText: { color: COLORS.text, fontFamily: FONTS.semiBold, fontSize: 13 },
  modeTextSelected: { color: COLORS.primary, fontFamily: FONTS.bold },
  ssoIntro: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACE.sm,
    backgroundColor: COLORS.primarySoft,
    borderRadius: RADIUS.card,
    padding: SPACE.md,
    marginTop: SPACE.xs,
  },
  ssoIntroIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.surface,
  },
  ssoIntroCopy: { flex: 1 },
  ssoTitle: { color: COLORS.text, fontFamily: FONTS.bold, fontSize: 14, lineHeight: 19 },
  ssoNote: { color: COLORS.text, fontFamily: FONTS.regular, fontSize: 13, lineHeight: 19, marginTop: 2 },
  linkButton: {
    minHeight: SIZES.touch,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACE.xs,
    paddingHorizontal: SPACE.sm,
    borderRadius: RADIUS.control,
    marginTop: SPACE.sm,
  },
  linkPressed: { backgroundColor: COLORS.primarySoft },
  link: { color: COLORS.primary, fontFamily: FONTS.bold, fontSize: 13 },
  serverFooter: {
    borderTopWidth: 1,
    borderTopColor: COLORS.borderLight,
    marginTop: SPACE.lg,
    paddingTop: SPACE.sm,
  },
  serverLink: {
    minHeight: SIZES.touch,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACE.xs,
    paddingHorizontal: SPACE.sm,
    borderRadius: RADIUS.control,
  },
  linkMuted: { color: COLORS.text, fontFamily: FONTS.semiBold, fontSize: 13 },
  footerNote: {
    color: COLORS.text,
    fontFamily: FONTS.semiBold,
    fontSize: 11,
    textAlign: 'center',
    marginTop: SPACE.lg,
  },
});
