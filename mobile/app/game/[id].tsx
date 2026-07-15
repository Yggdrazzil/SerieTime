import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Image } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, tmdbImage } from '@/lib/api';
import { COLORS, FONTS } from '@/lib/theme';
import { Loading, LoadError } from '@/components/ui';
import { Pop, SlideUpBar } from '@/components/anim';
import { Stars } from '@/components/Stars';

// Miroir de la réponse GET /api/games/:id (serveur : apps/server/src/modules/games/routes.ts).
type GameDetailDto = {
  id: string;
  title: string;
  posterPath: string | null;
  year: number | null;
  voteAverage: number | null;
  platforms: string | null;
  userStatus: string | null;
  playtimeMinutes: number | null;
  overview: string | null;
  backdropPath: string | null;
  developer: string | null;
  publisher: string | null;
  gameModes: string | null;
  releaseDate: string | null;
};

const GAME_STATUSES = ['wishlist', 'playing', 'completed', 'abandoned'] as const;
type GameStatus = (typeof GAME_STATUSES)[number];
const STATUS_LABELS: Record<GameStatus, string> = {
  wishlist: 'Voulus',
  playing: 'En cours',
  completed: 'Terminé',
  abandoned: 'Abandonné',
};

// « 3h45 » / « 45 min » à partir du temps de jeu en minutes (import Steam).
function formatPlaytime(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}

// Fiche jeu — miroir simplifié de mobile/app/show/[id].tsx (header jaquette,
// infos, sélecteur de statut, commentaires). Suivi optimiste avec rollback,
// comme les autres fiches de l'app.
export default function GameDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2000);
  };

  const detailKey = ['game', String(id)];
  const detail = useQuery({
    queryKey: detailKey,
    queryFn: () => api.get<GameDetailDto>(`/api/games/${id}`),
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: detailKey });
    qc.invalidateQueries({ queryKey: ['games', 'library'] });
  };

  // Mise à jour optimiste du cache de la fiche (même recette que show/[id].tsx) :
  // on écrit tout de suite le résultat attendu, rollback si le serveur refuse.
  const patch = async (p: Partial<GameDetailDto>) => {
    await qc.cancelQueries({ queryKey: detailKey });
    const prev = qc.getQueryData<GameDetailDto>(detailKey);
    if (prev) qc.setQueryData<GameDetailDto>(detailKey, { ...prev, ...p });
    return { prev };
  };
  const rollback = (ctx?: { prev?: GameDetailDto }) => {
    if (ctx?.prev) qc.setQueryData(detailKey, ctx.prev);
  };

  const setStatus = useMutation({
    mutationFn: (status: GameStatus) => api.post(`/api/games/${id}/status`, { status }),
    onMutate: (status: GameStatus) => patch({ userStatus: status }),
    onError: (_e, _v, ctx) => rollback(ctx),
    onSettled: refresh,
  });

  const removeTracking = useMutation({
    mutationFn: () => api.del(`/api/games/${id}/tracking`),
    onMutate: () => {
      showToast('Jeu retiré');
      return patch({ userStatus: null });
    },
    onError: (_e, _v, ctx) => rollback(ctx),
    onSettled: refresh,
  });

  if (detail.isLoading) return <Loading />;
  if (!detail.data) return <LoadError onRetry={detail.refetch} busy={detail.isRefetching} />;
  const game = detail.data;
  const heroUri = tmdbImage(game.backdropPath) ?? tmdbImage(game.posterPath);

  return (
    <Pop style={{ flex: 1, backgroundColor: COLORS.white }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 60 }}>
        <View style={styles.hero}>
          {heroUri ? <Image source={{ uri: heroUri }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
          <View style={styles.heroShade} />
          <Pressable style={[styles.backBtn, { top: insets.top + 8 }]} onPress={() => router.back()} hitSlop={8}>
            <Feather name="chevron-down" size={30} color="#fff" />
          </Pressable>
        </View>

        <View style={styles.headRow}>
          {tmdbImage(game.posterPath, 'w342') ? (
            <Image source={{ uri: tmdbImage(game.posterPath, 'w342')! }} style={styles.poster} resizeMode="cover" />
          ) : (
            <View style={[styles.poster, styles.posterEmpty]}>
              <Feather name="image" size={26} color="#b4b4b4" />
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{game.title}</Text>
            <Text style={styles.meta}>{[game.year, game.platforms].filter(Boolean).join(' • ')}</Text>
            {game.voteAverage ? <Stars rating10={game.voteAverage} size={19} /> : null}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Suivi</Text>
          <View style={styles.statusRow}>
            {GAME_STATUSES.map((s) => (
              <Pressable
                key={s}
                style={[styles.statusChip, game.userStatus === s && styles.statusChipSel]}
                onPress={() => setStatus.mutate(s)}
                disabled={setStatus.isPending}
              >
                <Text style={[styles.statusChipText, game.userStatus === s && styles.statusChipTextSel]}>
                  {STATUS_LABELS[s]}
                </Text>
              </Pressable>
            ))}
          </View>
          {game.userStatus ? (
            <Pressable style={styles.removeBtn} onPress={() => removeTracking.mutate()} disabled={removeTracking.isPending}>
              <Feather name="minus-square" size={18} color={COLORS.red} />
              <Text style={styles.removeBtnText}>Retirer</Text>
            </Pressable>
          ) : null}
        </View>

        {game.overview ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Résumé</Text>
            <Text style={styles.overview}>{game.overview}</Text>
          </View>
        ) : null}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Informations</Text>
          {game.developer ? <InfoRow icon="tool" label={`Développeur : ${game.developer}`} /> : null}
          {game.publisher ? <InfoRow icon="briefcase" label={`Éditeur : ${game.publisher}`} /> : null}
          {game.gameModes ? <InfoRow icon="users" label={game.gameModes} /> : null}
          {game.playtimeMinutes ? (
            <InfoRow icon="clock" label={`Temps de jeu : ${formatPlaytime(game.playtimeMinutes)}`} />
          ) : null}
          {!game.developer && !game.publisher && !game.gameModes && !game.playtimeMinutes ? (
            <Text style={styles.muted}>Non disponible</Text>
          ) : null}
        </View>

        <CommentsRow mediaId={game.id} title={game.title} />
      </ScrollView>

      <SlideUpBar visible={!!toast} style={[styles.toastBar, { paddingBottom: insets.bottom + 16 }]}>
        <View style={styles.toastRow}>
          <Feather name="check" size={22} color={COLORS.black} />
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      </SlideUpBar>
    </Pop>
  );
}

function InfoRow({ icon, label }: { icon: keyof typeof Feather.glyphMap; label: string }) {
  return (
    <View style={styles.infoRow}>
      <Feather name={icon} size={20} color={COLORS.black} />
      <Text style={styles.infoText}>{label}</Text>
    </View>
  );
}

// Rangée « Commentaires » (titre + chevron) ouvrant la page dédiée /comments/:id
// (générique par mediaId, cf. mobile/app/comments/[id].tsx). `CommentsRowLink`
// (show/[id].tsx) n'est pas exporté depuis ce fichier ; on reproduit ici la
// version simple — pas de compteur — plutôt que dupliquer sa requête de comptage.
function CommentsRow({ mediaId, title }: { mediaId: string; title: string }) {
  const router = useRouter();
  return (
    <Pressable
      style={[styles.section, styles.commentsRow]}
      onPress={() => router.push(`/comments/${mediaId}?title=${encodeURIComponent(title)}`)}
    >
      <Text style={styles.sectionTitle}>Commentaires</Text>
      <Feather name="chevron-right" size={24} color={COLORS.black} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hero: { height: 200, backgroundColor: '#1a1a22', overflow: 'hidden' },
  heroShade: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.35)' },
  backBtn: { position: 'absolute', left: 14 },
  headRow: { flexDirection: 'row', gap: 14, padding: 20, marginTop: -50 },
  poster: { width: 100, aspectRatio: 2 / 3, borderRadius: 8, backgroundColor: '#e5e5e5' },
  posterEmpty: { alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 21, fontFamily: FONTS.extraBold, color: '#fff' },
  meta: { fontFamily: FONTS.regular, fontSize: 15, color: 'rgba(255,255,255,0.85)', marginTop: 4 },
  section: { paddingHorizontal: 20, paddingVertical: 18, borderBottomWidth: 1, borderBottomColor: COLORS.borderLight },
  sectionTitle: { fontSize: 18, fontFamily: FONTS.extraBold, marginBottom: 12 },
  statusRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  statusChip: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999, backgroundColor: COLORS.chipGrey },
  statusChipSel: { backgroundColor: COLORS.yellow },
  statusChipText: { fontFamily: FONTS.bold, fontSize: 14 },
  statusChipTextSel: { color: COLORS.black },
  removeBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16, alignSelf: 'flex-start' },
  removeBtnText: { fontFamily: FONTS.semiBold, fontSize: 15, color: COLORS.red },
  overview: { fontFamily: FONTS.regular, fontSize: 16, lineHeight: 23 },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  infoText: { fontFamily: FONTS.regular, fontSize: 16, flexShrink: 1 },
  muted: { color: COLORS.textMuted, fontFamily: FONTS.regular, fontSize: 15 },
  commentsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  toastBar: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: COLORS.yellow, paddingTop: 18, alignItems: 'center' },
  toastRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  toastText: { fontSize: 15, fontFamily: FONTS.extraBold, letterSpacing: 0.6 },
});
