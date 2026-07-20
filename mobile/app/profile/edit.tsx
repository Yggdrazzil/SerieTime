import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Image, TextInput, ActivityIndicator, Alert, Modal } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { goBack } from '@/lib/nav';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, tmdbImage } from '@/lib/api';
import { COUNTRIES, countryName } from '@/lib/countries';
import { useAppStore } from '@/lib/store';
import { COLORS, FONTS, RADIUS, SIZES, SPACE } from '@/lib/theme';
import { Loading } from '@/components/ui';
import { ScreenShell, ScreenHeader, SectionHeader, PrismeCard, IconAction } from '@/components/prisme';
import type { ProfileUser } from '@/app/(tabs)/profile';

const GENDERS = [
  { value: 'male', label: 'Homme' },
  { value: 'female', label: 'Femme' },
  { value: 'other', label: 'Autre' },
];

export default function EditProfile() {
  const router = useRouter();
  const qc = useQueryClient();
  const { coverPick, setCoverPick } = useAppStore();

  const profile = useQuery({
    queryKey: ['profile'],
    queryFn: () => api.get<{ user: ProfileUser }>('/api/profile'),
  });

  const [displayName, setDisplayName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [birthYear, setBirthYear] = useState('');
  const [gender, setGender] = useState<string | null>(null);
  const [country, setCountry] = useState('FR');
  const [initialized, setInitialized] = useState(false);
  const [saving, setSaving] = useState(false);
  const [genderOpen, setGenderOpen] = useState(false);
  const [countryOpen, setCountryOpen] = useState(false);

  // Pré-remplit depuis le profil chargé.
  useEffect(() => {
    if (!profile.data || initialized) return;
    const u = profile.data.user;
    setDisplayName(u.displayName ?? '');
    setAvatarUrl(u.avatarUrl ?? null);
    setCoverUrl(u.coverUrl ?? null);
    setBirthYear(u.birthYear ? String(u.birthYear) : '');
    setGender(u.gender ?? null);
    setCountry(u.countryCode ?? 'FR');
    setInitialized(true);
  }, [profile.data, initialized]);

  // Récupère la couverture choisie dans /profile/cover.
  useEffect(() => {
    if (coverPick) {
      setCoverUrl(coverPick);
      setCoverPick(null);
    }
  }, [coverPick, setCoverPick]);

  const pickAvatar = async () => {
    try {
      // Chargés à la demande : ne peuvent pas impacter le démarrage de l'app.
      const ImagePicker = await import('expo-image-picker');
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Autorisation requise', 'Autorisez l’accès aux photos pour choisir une image.');
        return;
      }
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 1,
        base64: false,
      });
      const asset = res.canceled ? null : res.assets[0];
      if (!asset?.uri) return;
      // Une photo brute peut peser plusieurs Mo en base64 (échec silencieux 413
      // côté serveur) : on la réduit à 512 px avant envoi (~50-150 Ko).
      const { manipulateAsync, SaveFormat } = await import('expo-image-manipulator');
      const small = await manipulateAsync(asset.uri, [{ resize: { width: 512 } }], {
        compress: 0.7,
        format: SaveFormat.JPEG,
        base64: true,
      });
      if (!small.base64) return;
      setAvatarUrl(`data:image/jpeg;base64,${small.base64}`);
    } catch {
      Alert.alert('Indisponible', 'Le sélecteur de photos n’a pas pu s’ouvrir.');
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.post('/api/profile', {
        displayName: displayName.trim() || undefined,
        avatarUrl,
        coverUrl,
        birthYear: birthYear ? Number(birthYear) : null,
        gender,
        countryCode: (country || 'FR').slice(0, 2).toUpperCase(),
      });
      await qc.invalidateQueries({ queryKey: ['profile'] });
      // Le store local (Paramètres « Nom d'utilisateur », entêtes…) suit le
      // nouveau nom d'affichage immédiatement.
      const newName = displayName.trim();
      if (newName) {
        useAppStore.setState((st) => ({ user: st.user ? { ...st.user, displayName: newName } : st.user }));
      }
      goBack('/profile');
    } catch (e) {
      // Jamais d'échec silencieux : l'utilisateur doit savoir que rien n'est enregistré.
      Alert.alert(
        'Échec de la sauvegarde',
        e instanceof Error && e.message === 'unauthorized'
          ? 'Session expirée — reconnectez-vous.'
          : 'Le profil n’a pas pu être enregistré. Vérifiez la connexion au serveur et réessayez.',
      );
    } finally {
      setSaving(false);
    }
  };

  if (profile.isLoading || !profile.data) return <Loading />;

  return (
    <>
      <ScreenShell scroll>
        <ScreenHeader
          title="Modifier le profil"
          leading={<IconAction icon="chevron-left" label="Retour" onPress={() => goBack('/profile')} />}
          trailing={
            <Pressable
              style={({ pressed }) => [styles.saveBtn, pressed && styles.btnPressed, saving && styles.saveBtnBusy]}
              onPress={save}
              disabled={saving}
              accessibilityRole="button"
              accessibilityLabel="Sauvegarder"
            >
              {saving ? <ActivityIndicator color={COLORS.onPrimary} /> : <Text style={styles.saveText}>SAUVEGARDER</Text>}
            </Pressable>
          }
        />

        <View style={styles.list}>
          {/* Photos */}
          <PrismeCard elevated>
            <View style={styles.mediaRow}>
              {avatarUrl ? (
                <Image source={{ uri: tmdbImage(avatarUrl, 'w185') ?? avatarUrl }} style={styles.avatar} />
              ) : (
                <View style={[styles.avatar, styles.mediaEmpty]}>
                  <Feather name="user" size={26} color={COLORS.textSoft} />
                </View>
              )}
              <Pressable style={{ flex: 1 }} onPress={pickAvatar} accessibilityRole="button" accessibilityLabel="Choisir une photo de profil">
                <Text style={styles.link}>Choisir une photo de profil</Text>
              </Pressable>
              {avatarUrl ? (
                <Pressable onPress={() => setAvatarUrl(null)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Supprimer la photo de profil">
                  <Feather name="x-circle" size={24} color={COLORS.textMuted} />
                </Pressable>
              ) : null}
            </View>
            <View style={[styles.mediaRow, styles.mediaRowBorder]}>
              {coverUrl ? (
                <Image source={{ uri: tmdbImage(coverUrl, 'w185') ?? coverUrl }} style={styles.cover} resizeMode="cover" />
              ) : (
                <View style={[styles.cover, styles.mediaEmpty]}>
                  <Feather name="image" size={24} color={COLORS.textSoft} />
                </View>
              )}
              <Pressable style={{ flex: 1 }} onPress={() => router.push('/profile/cover')} accessibilityRole="button" accessibilityLabel="Choisir une photo de couverture">
                <Text style={styles.link}>Choisir une photo de couverture</Text>
              </Pressable>
              {coverUrl ? (
                <Pressable onPress={() => setCoverUrl(null)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Supprimer la photo de couverture">
                  <Feather name="x-circle" size={24} color={COLORS.textMuted} />
                </Pressable>
              ) : null}
            </View>
          </PrismeCard>

          {/* Nom d'affichage */}
          <PrismeCard elevated>
            <Text style={styles.label}>Nom d'affichage</Text>
            <TextInput style={styles.input} value={displayName} onChangeText={setDisplayName} placeholder="Votre nom" placeholderTextColor={COLORS.textSoft} />
          </PrismeCard>

          {/* Informations personnelles */}
          <PrismeCard elevated>
            <SectionHeader title="Informations personnelles" style={styles.cardSectionHeader} />

            <View style={styles.field}>
              <Text style={styles.label}>Année de naissance</Text>
              <TextInput
                style={styles.input}
                value={birthYear}
                onChangeText={(t) => setBirthYear(t.replace(/[^0-9]/g, '').slice(0, 4))}
                keyboardType="number-pad"
                placeholder="Ex. 1993"
                placeholderTextColor={COLORS.textSoft}
              />
            </View>

            {/* Sexe — menu déroulant */}
            <Pressable style={styles.selectRow} onPress={() => setGenderOpen(true)} accessibilityRole="button" accessibilityLabel="Sexe">
              <Text style={styles.label}>Sexe</Text>
              <View style={styles.selectValue}>
                <Text style={[styles.value, !gender && styles.valueEmpty]}>
                  {GENDERS.find((g) => g.value === gender)?.label ?? 'Choisir'}
                </Text>
                <Feather name="chevron-down" size={18} color={COLORS.textMuted} />
              </View>
            </Pressable>

            {/* Pays — menu déroulant avec noms complets */}
            <Pressable style={styles.selectRow} onPress={() => setCountryOpen(true)} accessibilityRole="button" accessibilityLabel="Pays">
              <Text style={styles.label}>Pays</Text>
              <View style={styles.selectValue}>
                <Text style={styles.value}>{countryName(country) ?? 'Choisir'}</Text>
                <Feather name="chevron-down" size={18} color={COLORS.textMuted} />
              </View>
            </Pressable>
          </PrismeCard>
        </View>
      </ScreenShell>

      {/* Menu déroulant Sexe */}
      <Modal visible={genderOpen} transparent animationType="fade" onRequestClose={() => setGenderOpen(false)}>
        <Pressable style={styles.overlay} onPress={() => setGenderOpen(false)} accessibilityRole="button" accessibilityLabel="Fermer" />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          {GENDERS.map((g, i) => (
            <Pressable
              key={g.value}
              style={[styles.sheetItem, i === GENDERS.length - 1 && { borderBottomWidth: 0 }]}
              onPress={() => { setGender(g.value); setGenderOpen(false); }}
              accessibilityRole="radio"
              accessibilityState={{ checked: gender === g.value }}
            >
              <Text style={styles.sheetLabel}>{g.label}</Text>
              {gender === g.value ? <Feather name="check" size={22} color={COLORS.primary} /> : null}
            </Pressable>
          ))}
        </View>
      </Modal>

      {/* Menu déroulant Pays (liste complète, noms en toutes lettres) */}
      <Modal visible={countryOpen} animationType="slide" onRequestClose={() => setCountryOpen(false)}>
        <ScreenShell scroll>
          <ScreenHeader
            title="Pays"
            leading={<IconAction icon="chevron-left" label="Fermer" onPress={() => setCountryOpen(false)} />}
          />
          {COUNTRIES.map((c) => (
            <Pressable
              key={c.code}
              style={styles.countryRow}
              onPress={() => { setCountry(c.code); setCountryOpen(false); }}
              accessibilityRole="radio"
              accessibilityState={{ checked: country === c.code }}
            >
              <Text style={[styles.countryName, country === c.code && styles.countrySelected]}>{c.name}</Text>
              {country === c.code ? <Feather name="check" size={22} color={COLORS.primary} /> : null}
            </Pressable>
          ))}
        </ScreenShell>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  list: { gap: SPACE.sm, paddingBottom: SPACE.xl },
  cardSectionHeader: { marginTop: 0, marginBottom: SPACE.xs },
  saveBtn: { minHeight: 36, justifyContent: 'center', paddingHorizontal: SPACE.sm, backgroundColor: COLORS.primary, borderRadius: RADIUS.pill },
  saveText: { color: COLORS.onPrimary, fontSize: 13, fontFamily: FONTS.extraBold, letterSpacing: 0.4 },
  saveBtnBusy: { opacity: 0.6 },
  btnPressed: { opacity: 0.86, transform: [{ scale: 0.98 }] },
  mediaRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE.md, paddingVertical: SPACE.xs },
  mediaRowBorder: { borderTopWidth: 1, borderTopColor: COLORS.borderLight, marginTop: SPACE.xs, paddingTop: SPACE.sm },
  avatar: { width: 60, height: 60, borderRadius: 30, backgroundColor: COLORS.imagePlaceholder },
  mediaEmpty: { alignItems: 'center', justifyContent: 'center' },
  cover: { width: 92, height: 60, borderRadius: RADIUS.poster, backgroundColor: COLORS.imagePlaceholder },
  link: { color: COLORS.primary, fontFamily: FONTS.semiBold, fontSize: 15 },
  field: { paddingTop: SPACE.sm },
  label: { fontFamily: FONTS.medium, fontSize: 13, color: COLORS.textMuted },
  input: { fontFamily: FONTS.regular, fontSize: 16, color: COLORS.text, backgroundColor: COLORS.surfaceMuted, borderWidth: 1, borderColor: COLORS.borderLight, borderRadius: RADIUS.control, paddingHorizontal: SPACE.sm, paddingVertical: 10, marginTop: 6 },
  selectRow: { minHeight: SIZES.touch, paddingTop: SPACE.sm },
  selectValue: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SPACE.xs, backgroundColor: COLORS.surfaceMuted, borderWidth: 1, borderColor: COLORS.borderLight, borderRadius: RADIUS.control, paddingHorizontal: SPACE.sm, paddingVertical: 11, marginTop: 6 },
  value: { fontFamily: FONTS.regular, fontSize: 16, color: COLORS.text },
  valueEmpty: { color: COLORS.textSoft },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: COLORS.overlay },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: COLORS.surface, borderTopLeftRadius: RADIUS.sheet, borderTopRightRadius: RADIUS.sheet, paddingTop: SPACE.xs, paddingBottom: SPACE.lg, width: '100%', maxWidth: SIZES.contentMax, alignSelf: 'center' },
  sheetHandle: { width: 42, height: 4, alignSelf: 'center', marginBottom: SPACE.sm, borderRadius: RADIUS.pill, backgroundColor: COLORS.border },
  sheetItem: { minHeight: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SPACE.lg, borderBottomWidth: 1, borderBottomColor: COLORS.borderLight },
  sheetLabel: { color: COLORS.text, fontFamily: FONTS.regular, fontSize: 16 },
  countryRow: { minHeight: SIZES.touch, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SPACE.xs, paddingVertical: SPACE.sm, borderBottomWidth: 1, borderBottomColor: COLORS.borderLight },
  countryName: { color: COLORS.text, fontFamily: FONTS.regular, fontSize: 16 },
  countrySelected: { color: COLORS.primary, fontFamily: FONTS.bold },
});
