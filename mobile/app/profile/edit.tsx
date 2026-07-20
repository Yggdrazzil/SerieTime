import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Image, ActivityIndicator, Alert } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { goBack } from '@/lib/nav';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, tmdbImage } from '@/lib/api';
import { COLORS, FONTS, RADIUS, SIZES, SPACE } from '@/lib/theme';
import { Loading } from '@/components/ui';
import { ScreenShell, ScreenHeader, PrismeCard, IconAction } from '@/components/prisme';
import { useAppStore } from '@/lib/store';
import type { ProfileUser } from '@/app/(tabs)/profile';

// « Modifier le profil » = PHOTOS uniquement (avatar + bannière) — demande
// produit 2026-07-20. Le nom d'affichage et le pays s'éditent désormais dans
// Paramètres > Compte > Identification.
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

      <PrismeCard elevated>
        {/* Photo de profil */}
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

        {/* Photo de couverture (bannière) */}
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

      {/* Le reste du profil (nom d'affichage, pays) s'édite dans Paramètres. */}
      <Text style={styles.note}>
        Nom d’affichage et pays se modifient dans Paramètres → Compte → Identification.
      </Text>
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
  mediaRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE.md, paddingVertical: SPACE.xs, minHeight: SIZES.touch },
  mediaRowBorder: { borderTopWidth: 1, borderTopColor: COLORS.borderLight, marginTop: SPACE.xs, paddingTop: SPACE.sm },
  avatar: { width: 60, height: 60, borderRadius: 30, backgroundColor: COLORS.imagePlaceholder },
  mediaEmpty: { alignItems: 'center', justifyContent: 'center' },
  cover: { width: 92, height: 60, borderRadius: RADIUS.poster, backgroundColor: COLORS.imagePlaceholder },
  link: { color: COLORS.primary, fontFamily: FONTS.semiBold, fontSize: 15 },
  note: { marginTop: SPACE.sm, color: COLORS.textMuted, fontFamily: FONTS.regular, fontSize: 13, lineHeight: 18 },
});
