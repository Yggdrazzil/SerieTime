import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Image, TextInput, ActivityIndicator, Alert } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, tmdbImage } from '@/lib/api';
import { useAppStore } from '@/lib/store';
import { COLORS } from '@/lib/theme';
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
      // Chargé à la demande : ne peut pas impacter le démarrage de l'app.
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
        quality: 0.6,
        base64: true,
      });
      if (res.canceled || !res.assets[0]?.base64) return;
      setAvatarUrl(`data:image/jpeg;base64,${res.assets[0].base64}`);
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
    } finally {
      setSaving(false);
    }
  };

  if (profile.isLoading || !profile.data) return <Loading />;

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.white, paddingTop: insets.top }}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
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
            <Pressable onPress={() => setAvatarUrl(null)} hitSlop={8}>
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
            <Pressable onPress={() => setCoverUrl(null)} hitSlop={8}>
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

        <View style={styles.field}>
          <Text style={styles.label}>Sexe</Text>
          <View style={styles.chips}>
            {GENDERS.map((g) => (
              <Pressable
                key={g.value}
                style={[styles.chip, gender === g.value && styles.chipActive]}
                onPress={() => setGender(gender === g.value ? null : g.value)}
              >
                <Text style={[styles.chipText, gender === g.value && styles.chipTextActive]}>{g.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Pays (code ISO à 2 lettres)</Text>
          <TextInput
            style={styles.input}
            value={country}
            onChangeText={(t) => setCountry(t.replace(/[^a-zA-Z]/g, '').slice(0, 2).toUpperCase())}
            autoCapitalize="characters"
            placeholder="FR"
            placeholderTextColor={COLORS.textSoft}
          />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, height: 54, borderBottomWidth: 1, borderBottomColor: COLORS.borderLight },
  title: { fontSize: 18, fontWeight: '800' },
  save: { color: COLORS.black, fontSize: 15, fontWeight: '800', letterSpacing: 0.4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: COLORS.borderLight },
  avatar: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#e5e5e5' },
  avatarEmpty: { alignItems: 'center', justifyContent: 'center' },
  cover: { width: 96, height: 64, borderRadius: 6, backgroundColor: '#e5e5e5' },
  link: { color: COLORS.blue, fontSize: 17 },
  field: { paddingHorizontal: 20, paddingTop: 18 },
  label: { fontSize: 15, color: COLORS.textMuted },
  input: { fontSize: 18, color: COLORS.blue, borderBottomWidth: 1, borderBottomColor: COLORS.border, paddingVertical: 8, marginTop: 4 },
  section: { fontSize: 22, fontWeight: '800', paddingHorizontal: 20, paddingTop: 28 },
  chips: { flexDirection: 'row', gap: 10, marginTop: 10 },
  chip: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 8 },
  chipActive: { backgroundColor: COLORS.yellow, borderColor: COLORS.yellow },
  chipText: { fontSize: 15, fontWeight: '700', color: COLORS.textMuted },
  chipTextActive: { color: COLORS.black },
});
