import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Image, Dimensions, Linking, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { api, tmdbImage } from '@/lib/api';
import { COLORS, FONTS } from '@/lib/theme';
import { Loading, LoadError } from '@/components/ui';
import { FadeSwitch } from '@/components/anim';
import { Stars } from '@/components/Stars';

type CastMember = { name: string; character: string | null; profilePath: string | null; tmdbId: string | null };
type Filmo = {
  tmdbId: string; mediaType: 'show' | 'movie'; title: string; character: string | null;
  year: string | null; posterPath: string | null; episodeCount: number | null;
  rating: number | null; genres: string[];
};
type Person = {
  tmdbId: string; name: string; biography: string | null; birthday: string | null;
  deathday: string | null; placeOfBirth: string | null; profilePath: string | null;
  twitter: string | null; instagram: string | null; filmography: Filmo[];
};

type FilmoFilter = 'all' | 'show' | 'movie';
const FILTER_LABEL: Record<FilmoFilter, string> = { all: 'Séries et films', show: 'Séries', movie: 'Films' };

const birthFr = (iso: string) =>
  new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });

// Fiche personne (copie TV Time) : page sombre, ‹ › pour passer d'un membre de
// la distribution à l'autre, photo, bio, lien X, puis filmographie sur fond
// blanc (affiche, rôle, année, note, genres).
export default function PersonScreen() {
  const params = useLocalSearchParams<{ mediaId?: string; type?: string; index?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isMovie = params.type === 'movie';
  const [index, setIndex] = useState(Math.max(0, Number(params.index ?? 0) || 0));
  const [filter, setFilter] = useState<FilmoFilter>('all');
  const [openingId, setOpeningId] = useState<string | null>(null);

  // La distribution vient de la fiche d'origine (déjà en cache).
  const detail = useQuery({
    queryKey: [isMovie ? 'movie' : 'show', String(params.mediaId)],
    queryFn: () => api.get<{ cast: CastMember[] }>(`/api/${isMovie ? 'movies' : 'shows'}/${params.mediaId}`),
    enabled: !!params.mediaId,
  });
  const cast = detail.data?.cast ?? [];
  const member = cast[index];

  // Résolution TMDb : id direct, sinon recherche par nom (cast venant de TheTVDB).
  const person = useQuery({
    queryKey: ['person', member?.tmdbId ?? member?.name],
    queryFn: async () => {
      let pid = member!.tmdbId;
      if (!pid) pid = (await api.get<{ tmdbId: string }>(`/api/people/search?name=${encodeURIComponent(member!.name)}`)).tmdbId;
      return api.get<{ person: Person }>(`/api/people/${pid}`);
    },
    enabled: !!member,
    staleTime: 30 * 60_000,
  });

  const openFilmo = async (f: Filmo) => {
    if (openingId) return;
    setOpeningId(f.tmdbId);
    try {
      const path = f.mediaType === 'movie' ? '/api/movies/add-from-tmdb' : '/api/shows/add-from-tmdb';
      const res = await api.post<{ mediaId: string }>(path, { tmdbId: f.tmdbId, follow: false });
      router.push(`/show/${res.mediaId}${f.mediaType === 'movie' ? '?type=movie' : ''}`);
    } finally {
      setOpeningId(null);
    }
  };

  const p = person.data?.person;
  const photo = tmdbImage(p?.profilePath ?? member?.profilePath, 'w500');
  const { width } = Dimensions.get('window');
  const filmo = (p?.filmography ?? []).filter((f) => filter === 'all' || f.mediaType === filter);

  return (
    <View style={{ flex: 1, backgroundColor: '#16161c' }}>
      {/* Barre TV Time : ‹ › à gauche (membre précédent/suivant), X à droite. */}
      <View style={[styles.topBar, { paddingTop: insets.top + 6 }]}>
        <Pressable onPress={() => index > 0 && setIndex(index - 1)} hitSlop={10} style={styles.arrow} disabled={index <= 0}>
          <Feather name="chevron-left" size={26} color={index > 0 ? '#fff' : 'rgba(255,255,255,0.3)'} />
        </Pressable>
        <Pressable
          onPress={() => index < cast.length - 1 && setIndex(index + 1)}
          hitSlop={10}
          style={styles.arrow}
          disabled={index >= cast.length - 1}
        >
          <Feather name="chevron-right" size={26} color={index < cast.length - 1 ? '#fff' : 'rgba(255,255,255,0.3)'} />
        </Pressable>
        <View style={{ flex: 1 }} />
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.arrow}>
          <Feather name="x" size={26} color="#fff" />
        </Pressable>
      </View>

      {!member && detail.isLoading ? (
        <Loading />
      ) : !member ? (
        <LoadError onRetry={detail.refetch} busy={detail.isRefetching} />
      ) : (
        <FadeSwitch trigger={index}>
          <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 30 }}>
            {/* Carte photo centrée sur fond sombre. */}
            <View style={{ alignItems: 'center', paddingTop: 24 }}>
              <View style={[styles.photoCard, { width: width * 0.72, height: width * 0.72 * 1.45 }]}>
                {photo ? (
                  <Image source={{ uri: photo }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                ) : (
                  <View style={styles.photoEmpty}>
                    <Feather name="user" size={54} color="#666" />
                  </View>
                )}
              </View>
            </View>

            <Text style={styles.name}>{p?.name ?? member.name}</Text>
            {p?.birthday ? (
              <Text style={styles.birth}>
                Né(e) le {birthFr(p.birthday)}
                {p.placeOfBirth ? ` à l'endroit suivant :\n${p.placeOfBirth}` : ''}
              </Text>
            ) : null}
            {person.isLoading ? <ActivityIndicator color="#fff" style={{ marginTop: 24 }} /> : null}
            {p?.biography ? <Text style={styles.bio}>{p.biography}</Text> : null}
            {p?.twitter ? (
              <Pressable style={styles.xBtn} onPress={() => Linking.openURL(`https://x.com/${p.twitter}`).catch(() => undefined)}>
                <Text style={styles.xGlyph}>𝕏</Text>
              </Pressable>
            ) : null}

            {/* Filmographie sur fond blanc (comme TV Time). */}
            {filmo.length > 0 || filter !== 'all' ? (
              <View style={styles.filmoWrap}>
                <Text style={styles.filmoTitle}>Filmographie</Text>
                <Pressable
                  style={styles.filterChip}
                  onPress={() => setFilter(filter === 'all' ? 'show' : filter === 'show' ? 'movie' : 'all')}
                >
                  <Text style={styles.filterText}>{FILTER_LABEL[filter]}</Text>
                  <Feather name="chevron-down" size={18} color={COLORS.black} />
                </Pressable>
                {filmo.map((f) => (
                  <Pressable key={`${f.mediaType}-${f.tmdbId}`} style={styles.filmoRow} onPress={() => openFilmo(f)}>
                    {tmdbImage(f.posterPath, 'w185') ? (
                      <Image source={{ uri: tmdbImage(f.posterPath, 'w185')! }} style={styles.filmoPoster} resizeMode="cover" />
                    ) : (
                      <View style={[styles.filmoPoster, { alignItems: 'center', justifyContent: 'center' }]}>
                        <Feather name={f.mediaType === 'movie' ? 'film' : 'tv'} size={18} color="#b4b4b4" />
                      </View>
                    )}
                    <View style={{ flex: 1 }}>
                      <Text style={styles.filmoName}>
                        {f.title}
                        {f.character ? (
                          <Text style={styles.filmoRole}>
                            {' '}dans le rôle de <Text style={styles.filmoRoleName}>{f.character}</Text>
                          </Text>
                        ) : null}
                      </Text>
                      <Text style={styles.filmoMeta}>
                        {[f.year, f.mediaType === 'show' ? 'Série' : 'Film'].filter(Boolean).join(' • ')}
                      </Text>
                      {typeof f.rating === 'number' && f.rating > 0 ? <Stars rating10={f.rating} /> : null}
                      {f.genres.length > 0 ? (
                        <Text style={styles.filmoGenres}>{f.genres.join(', ').toUpperCase()}</Text>
                      ) : null}
                    </View>
                    {openingId === f.tmdbId ? <ActivityIndicator color={COLORS.black} size="small" /> : null}
                  </Pressable>
                ))}
              </View>
            ) : null}
          </ScrollView>
        </FadeSwitch>
      )}
    </View>
  );
}

// Cotes calquées sur les captures TV Time (fiche Shoutarou Morikubo) : photo
// ~72 % de large, nom 26, naissance 16 gras, bio 16/24, X jaune 44, titre
// Filmographie 24, affiches 64x96, rangées 17/14.
const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingBottom: 6, backgroundColor: '#f7f7f7' },
  arrow: { width: 44, height: 40, alignItems: 'center', justifyContent: 'center' },
  photoCard: { borderRadius: 12, overflow: 'hidden', backgroundColor: '#2a2a32' },
  photoEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  name: { color: '#fff', fontSize: 26, fontFamily: FONTS.extraBold, paddingHorizontal: 24, marginTop: 28 },
  birth: { color: '#fff', fontSize: 16, fontFamily: FONTS.bold, lineHeight: 23, paddingHorizontal: 24, marginTop: 10 },
  bio: { color: 'rgba(255,255,255,0.92)', fontSize: 16, fontFamily: FONTS.regular, lineHeight: 24, paddingHorizontal: 24, marginTop: 18 },
  xBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: COLORS.yellow, alignItems: 'center', justifyContent: 'center', marginLeft: 24, marginTop: 22 },
  xGlyph: { fontSize: 20, color: COLORS.black, fontFamily: FONTS.extraBold },
  filmoWrap: { backgroundColor: COLORS.white, marginTop: 30, paddingTop: 22, paddingBottom: 10 },
  filmoTitle: { fontSize: 24, fontFamily: FONTS.extraBold, paddingHorizontal: 20, marginBottom: 14 },
  filterChip: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#f4f4f4', borderRadius: 10, marginHorizontal: 20, paddingHorizontal: 16, paddingVertical: 12, marginBottom: 6 },
  filterText: { fontSize: 16, fontFamily: FONTS.semiBold },
  filmoRow: { flexDirection: 'row', gap: 14, paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.borderLight, alignItems: 'flex-start' },
  filmoPoster: { width: 64, height: 96, borderRadius: 8, backgroundColor: '#e5e5e5' },
  filmoName: { fontSize: 17, fontFamily: FONTS.bold, lineHeight: 23 },
  filmoRole: { fontFamily: FONTS.regular, color: COLORS.text },
  filmoRoleName: { fontFamily: FONTS.bold },
  filmoMeta: { fontSize: 14, fontFamily: FONTS.regular, color: COLORS.textMuted, marginTop: 3 },
  filmoGenres: { fontSize: 11, fontFamily: FONTS.bold, color: COLORS.textMuted, letterSpacing: 0.4, marginTop: 6 },
});
