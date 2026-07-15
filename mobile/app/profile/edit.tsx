import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Image, TextInput, ActivityIndicator, Alert, Modal } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, tmdbImage } from '@/lib/api';
import { COUNTRIES, countryName } from '@/lib/countries';
import { useAppStore } from '@/lib/store';
import { COLORS, FONTS } from '@/lib/theme';
import { Loading } from '@/components/ui';
import type { ProfileUser } from '@/app/(tabs)/profile';

const GENDERS = [
  { value: 'male', label: 'Homme' },
  { value: 'female', label: 'Femme' },
  { value: 'other', label: 'Autre' },
];

export default function EditProfile() {
  const insets = useSafeAreaInsets();
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
      router.back();
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
    <View style={{ flex: 1, backgroundColor: COLORS.white, paddingTop: insets.top }}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Fermer">
          <Feather name="x" size={26} color={COLORS.black} />
        </Pressable>
        <Text style={styles.title}>Modifier le profil</Text>
        <Pressable onPress={save} disabled={saving} hitSlop={8}>
          {saving ? <ActivityIndicator color={COLORS.black} /> : <Text style={styles.save}>SAUVEGARDER</Text>}
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        {/* Photo de profil */}
        <View style={styles.row}>
          {avatarUrl ? (
            <Image source={{ uri: tmdbImage(avatarUrl, 'w185') ?? avatarUrl }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, styles.avatarEmpty]}>
              <Feather name="user" size={26} color="#999" />
            </View>
          )}
          <Pressable style={{ flex: 1 }} onPress={pickAvatar}>
            <Text style={styles.link}>Choisir une photo de profil</Text>
          </Pressable>
          {avatarUrl ? (
            <Pressable onPress={() => setAvatarUrl(null)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Supprimer la photo de profil">
              <Feather name="x-circle" size={24} color={COLORS.textMuted} />
            </Pressable>
          ) : null}
        </View>

        {/* Photo de couverture */}
        <View style={styles.row}>
          {coverUrl ? (
            <Image source={{ uri: tmdbImage(coverUrl, 'w185') ?? coverUrl }} style={styles.cover} resizeMode="cover" />
          ) : (
            <View style={[styles.cover, styles.avatarEmpty]}>
              <Feather name="image" size={24} color="#999" />
            </View>
          )}
          <Pressable style={{ flex: 1 }} onPress={() => router.push('/profile/cover')}>
            <Text style={styles.link}>Choisir une photo de couverture</Text>
          </Pressable>
          {coverUrl ? (
            <Pressable onPress={() => setCoverUrl(null)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Supprimer la photo de couverture">
              <Feather name="x-circle" size={24} color={COLORS.textMuted} />
            </Pressable>
          ) : null}
        </View>

        {/* Nom d'affichage */}
        <View style={styles.field}>
          <Text style={styles.label}>Nom d'affichage</Text>
          <TextInput style={styles.input} value={displayName} onChangeText={setDisplayName} placeholder="Votre nom" />
        </View>

        <Text style={styles.section}>Informations personnelles</Text>

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

        {/* Sexe — valeur bleue, menu déroulant (façon TV Time) */}
        <Pressable style={styles.field} onPress={() => setGenderOpen(true)}>
          <Text style={styles.label}>Sexe</Text>
          <Text style={[styles.value, !gender && styles.valueEmpty]}>
            {GENDERS.find((g) => g.value === gender)?.label ?? 'Choisir'}
          </Text>
        </Pressable>

        {/* Pays — valeur bleue, menu déroulant avec noms complets (façon TV Time) */}
        <Pressable style={styles.field} onPress={() => setCountryOpen(true)}>
          <Text style={styles.label}>Pays</Text>
          <Text style={styles.value}>{countryName(country) ?? 'Choisir'}</Text>
        </Pressable>
      </ScrollView>

      {/* Menu déroulant Sexe */}
      <Modal visible={genderOpen} transparent animationType="fade" onRequestClose={() => setGenderOpen(false)}>
        <Pressable style={styles.overlay} onPress={() => setGenderOpen(false)} />
        <View style={styles.sheet}>
          {GENDERS.map((g, i) => (
            <Pressable
              key={g.value}
              style={[styles.sheetItem, i === GENDERS.length - 1 && { borderBottomWidth: 0 }]}
              onPress={() => { setGender(g.value); setGenderOpen(false); }}
            >
              <Text style={styles.sheetLabel}>{g.label}</Text>
              {gender === g.value ? <Feather name="check" size={22} color={COLORS.black} /> : null}
            </Pressable>
          ))}
        </View>
      </Modal>

      {/* Menu déroulant Pays (liste complète, noms en toutes lettres) */}
      <Modal visible={countryOpen} animationType="slide" onRequestClose={() => setCountryOpen(false)}>
        <View style={{ flex: 1, backgroundColor: COLORS.white, paddingTop: insets.top }}>
          <View style={styles.header}>
            <Pressable onPress={() => setCountryOpen(false)} hitSlop={12} accessibilityRole="button" accessibilityLabel="Fermer">
              <Feather name="chevron-left" size={28} color={COLORS.black} />
            </Pressable>
            <Text style={styles.title}>Pays</Text>
            <View style={{ width: 28 }} />
          </View>
          <ScrollView>
            {COUNTRIES.map((c) => (
              <Pressable
                key={c.code}
                style={styles.countryRow}
                onPress={() => { setCountry(c.code); setCountryOpen(false); }}
              >
                <Text style={[styles.countryName, country === c.code && styles.countrySelected]}>{c.name}</Text>
                {country === c.code ? <Feather name="check" size={22} color={COLORS.black} /> : null}
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, height: 54, borderBottomWidth: 1, borderBottomColor: COLORS.borderLight },
  title: { fontSize: 18, fontFamily: FONTS.extraBold },
  save: { color: COLORS.black, fontSize: 15, fontFamily: FONTS.extraBold, letterSpacing: 0.4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: COLORS.borderLight },
  avatar: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#e5e5e5' },
  avatarEmpty: { alignItems: 'center', justifyContent: 'center' },
  cover: { width: 96, height: 64, borderRadius: 6, backgroundColor: '#e5e5e5' },
  link: { color: COLORS.blue, fontFamily: FONTS.regular, fontSize: 16 },
  field: { paddingHorizontal: 20, paddingTop: 18 },
  label: { fontFamily: FONTS.regular, fontSize: 15, color: COLORS.textMuted },
  input: { fontFamily: FONTS.regular, fontSize: 17, color: COLORS.blue, borderBottomWidth: 1, borderBottomColor: COLORS.border, paddingVertical: 8, marginTop: 4 },
  section: { fontSize: 19, fontFamily: FONTS.extraBold, paddingHorizontal: 20, paddingTop: 22 },
  value: { fontFamily: FONTS.regular, fontSize: 17, color: COLORS.blue, paddingVertical: 8, marginTop: 4, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  valueEmpty: { color: COLORS.textSoft },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: COLORS.overlay },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: COLORS.white, borderTopLeftRadius: 8, borderTopRightRadius: 8, paddingBottom: 24 },
  sheetItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 60, paddingHorizontal: 24, borderBottomWidth: 1, borderBottomColor: COLORS.borderLight },
  sheetLabel: { fontFamily: FONTS.regular, fontSize: 16 },
  countryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: COLORS.borderLight },
  countryName: { fontFamily: FONTS.regular, fontSize: 16 },
  countrySelected: { fontFamily: FONTS.bold },
});
