import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Image, ActivityIndicator, Alert } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { goBack } from '@/lib/nav';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, tmdbImage } from '@/lib/api';
import { COLORS, FONTS, RADIUS, SIZES, SPACE } from '@/lib/theme';
import { Loading } from '@/components/ui';
import { ScreenShell, ScreenHeader, SectionHeader, PrismeCard, IconAction } from '@/components/prisme';
import { useAppStore } from '@/lib/store';
import type { ProfileUser } from '@/app/(tabs)/profile';

// « Modifier le profil » = PHOTOS uniquement (avatar + bannière). Le nom
// d'affichage et le pays s'éditent dans Paramètres > Compte > Identification.
export default function EditProfile() {
  const router = useRouter();
  const qc = useQueryClient();
  const { coverPick, setCoverPick } = useAppStore();

  const profile = useQuery({
    queryKey: ['profile'],
    queryFn: () => api.get<{ user: ProfileUser }>('/api/profile'),
  });

  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [saving, setSaving] = useState(false);

  // Pré-remplit depuis le profil chargé.
  useEffect(() => {
    if (!profile.data || initialized) return;
    const u = profile.data.user;
    setAvatarUrl(u.avatarUrl ?? null);
    setCoverUrl(u.coverUrl ?? null);
    setInitialized(true);
  }, [profile.data, initialized]);

  // Récupère la bannière choisie dans /profile/cover.
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
      await api.post('/api/profile', { avatarUrl, coverUrl });
      await qc.invalidateQueries({ queryKey: ['profile'] });
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
    <ScreenShell scroll contentContainerStyle={styles.content}>
      <ScreenHeader
        title="Modifier le profil"
        leading={<IconAction icon="x" label="Fermer" onPress={() => goBack('/profile')} />}
        trailing={
          <Pressable
            style={({ pressed }) => [styles.saveBtn, pressed && styles.btnPressed, saving && styles.saveBtnBusy]}
            onPress={save}
            disabled={saving}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Sauvegarder"
            accessibilityState={{ disabled: saving, busy: saving }}
          >
            {saving ? <ActivityIndicator color={COLORS.onPrimary} /> : <Text style={styles.saveText}>SAUVEGARDER</Text>}
          </Pressable>
        }
      />

      {/* Photo de profil — grand aperçu circulaire, actions dessous. */}
      <SectionHeader title="Photo de profil" />
      <PrismeCard elevated style={styles.card}>
        {avatarUrl ? (
          <Image source={{ uri: tmdbImage(avatarUrl, 'w342') ?? avatarUrl }} style={styles.avatarPreview} resizeMode="cover" />
        ) : (
          <View style={[styles.avatarPreview, styles.previewEmpty]}>
            <Feather name="user" size={44} color={COLORS.textSoft} />
          </View>
        )}
        <View style={styles.actionsRow}>
          <Pressable
            style={({ pressed }) => [styles.chooseBtn, pressed && styles.btnPressed]}
            onPress={pickAvatar}
            accessibilityRole="button"
            accessibilityLabel="Choisir une photo de profil"
          >
            <Feather name="image" size={15} color={COLORS.onPrimary} />
            <Text style={styles.chooseText}>{avatarUrl ? 'Changer' : 'Choisir une photo'}</Text>
          </Pressable>
          {avatarUrl ? (
            <Pressable
              style={({ pressed }) => [styles.removeBtn, pressed && styles.btnPressed]}
              onPress={() => setAvatarUrl(null)}
              accessibilityRole="button"
              accessibilityLabel="Supprimer la photo de profil"
            >
              <Feather name="trash-2" size={15} color={COLORS.danger} />
              <Text style={styles.removeText}>Supprimer</Text>
            </Pressable>
          ) : null}
        </View>
      </PrismeCard>

      {/* Bannière — grand aperçu 16:9, actions dessous. */}
      <SectionHeader title="Bannière" eyebrow="L'image en tête de ton profil" />
      <PrismeCard elevated style={styles.card}>
        {coverUrl ? (
          <Image source={{ uri: tmdbImage(coverUrl, 'w500') ?? coverUrl }} style={styles.coverPreview} resizeMode="cover" />
        ) : (
          <View style={[styles.coverPreview, styles.previewEmpty]}>
            <Feather name="image" size={36} color={COLORS.textSoft} />
            <Text style={styles.previewHint}>Choisis la bannière d'une série ou d'un film</Text>
          </View>
        )}
        <View style={styles.actionsRow}>
          <Pressable
            style={({ pressed }) => [styles.chooseBtn, pressed && styles.btnPressed]}
            onPress={() => router.push('/profile/cover')}
            accessibilityRole="button"
            accessibilityLabel="Choisir une bannière"
          >
            <Feather name="search" size={15} color={COLORS.onPrimary} />
            <Text style={styles.chooseText}>{coverUrl ? 'Changer' : 'Choisir une bannière'}</Text>
          </Pressable>
          {coverUrl ? (
            <Pressable
              style={({ pressed }) => [styles.removeBtn, pressed && styles.btnPressed]}
              onPress={() => setCoverUrl(null)}
              accessibilityRole="button"
              accessibilityLabel="Supprimer la bannière"
            >
              <Feather name="trash-2" size={15} color={COLORS.danger} />
              <Text style={styles.removeText}>Supprimer</Text>
            </Pressable>
          ) : null}
        </View>
      </PrismeCard>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: SPACE.xl },
  saveBtn: {
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: SPACE.sm,
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.pill,
  },
  saveBtnBusy: { opacity: 0.6 },
  saveText: { color: COLORS.onPrimary, fontSize: 12.5, fontFamily: FONTS.extraBold, letterSpacing: 0.4 },
  btnPressed: { opacity: 0.86, transform: [{ scale: 0.98 }] },
  card: { alignItems: 'center', gap: SPACE.md, marginBottom: SPACE.sm },
  avatarPreview: {
    width: 128,
    height: 128,
    borderRadius: 64,
    backgroundColor: COLORS.imagePlaceholder,
    borderWidth: 4,
    borderColor: COLORS.surface,
    ...{ shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.18, shadowRadius: 10, elevation: 4 },
  },
  coverPreview: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: RADIUS.card,
    backgroundColor: COLORS.imagePlaceholder,
    overflow: 'hidden',
  },
  previewEmpty: { alignItems: 'center', justifyContent: 'center', gap: SPACE.xs },
  previewHint: { color: COLORS.textSoft, fontFamily: FONTS.regular, fontSize: 12.5, textAlign: 'center', paddingHorizontal: SPACE.lg },
  actionsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACE.sm, flexWrap: 'wrap' },
  chooseBtn: {
    minHeight: SIZES.touch,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACE.xs,
    paddingHorizontal: SPACE.md,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.primary,
  },
  chooseText: { color: COLORS.onPrimary, fontSize: 13.5, fontFamily: FONTS.extraBold },
  removeBtn: {
    minHeight: SIZES.touch,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACE.xs,
    paddingHorizontal: SPACE.md,
    borderRadius: RADIUS.pill,
    borderWidth: 1.5,
    borderColor: COLORS.danger,
  },
  removeText: { color: COLORS.danger, fontSize: 13.5, fontFamily: FONTS.bold },
});
