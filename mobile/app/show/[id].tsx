import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Modal, TextInput, ActivityIndicator, Image, Share } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, tmdbImage } from '@/lib/api';
import type { EpisodeDto, MediaDto } from '@/lib/types';
import { episodeCode } from '@/lib/format';
import { COLORS, RADIUS, SHADOW } from '@/lib/theme';
import { TopTabs, CheckCircle, Loading, EmptyState } from '@/components/ui';

const INTEREST = ['LES ACTEURS', 'LA PRÉMISSE', 'LES CRÉATEURS', 'LA CHAÎNE/LA PLATEFORME', "LA FRANCHISE OU L'UNIVERS", 'AUTRE'];
const STATUS_LABELS: Record<string, string> = {
  watching: 'En cours', completed: 'Terminée', watchlist: 'Regarder plus tard',
  paused: 'En pause', abandoned: 'Abandonnée', not_started: 'Pas commencée',
};

export default function ShowDetail() {
  const { id, type } = useLocalSearchParams<{ id: string; type?: string }>();
  const isMovie = type === 'movie';
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [tab, setTab] = useState('À PROPOS');
  const [menu, setMenu] = useState(false);
  const [interest, setInterest] = useState<string | null>(null);
  const [justAdded, setJustAdded] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [personalize, setPersonalize] = useState(false);
  const [listsOpen, setListsOpen] = useState(false);

  // Bandeau jaune éphémère en bas d'écran (façon « AJOUTÉE ! » de TV Time).
  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2000);
  };

  const detail = useQuery({
    queryKey: [isMovie ? 'movie' : 'show', id],
    queryFn: () => api.get<any>(`/api/${isMovie ? 'movies' : 'shows'}/${id}`),
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: [isMovie ? 'movie' : 'show', id] });
    qc.invalidateQueries({ queryKey: ['shows'] });
    qc.invalidateQueries({ queryKey: ['movies'] });
  };

  const favorite = useMutation({
    mutationFn: () => api.post(`/api/${isMovie ? 'movies' : 'shows'}/${id}/favorite`),
    onSettled: refresh,
  });
  const markMovie = useMutation({
    mutationFn: (seen: boolean) => api.post(`/api/movies/${id}/${seen ? 'watched' : 'unwatched'}`),
    onSettled: refresh,
  });
  // Suivre (façon TV Time) : série -> statut « Pas commencé », film -> watchlist.
  const follow = useMutation({
    mutationFn: () => api.post(isMovie ? `/api/movies/${id}/watchlist` : `/api/shows/${id}/follow`),
    onSuccess: () => {
      setJustAdded(true);
      setTimeout(() => setJustAdded(false), 2000);
    },
    onSettled: refresh,
  });
  const watchLater = useMutation({
    mutationFn: () => api.post(isMovie ? `/api/movies/${id}/watchlist` : `/api/shows/${id}/watchlater`),
    onSuccess: () => showToast('Regarder plus tard'),
    onSettled: refresh,
  });
  const removeTracking = useMutation({
    mutationFn: () => api.del(`/api/${isMovie ? 'movies' : 'shows'}/${id}/tracking`),
    onSuccess: () => showToast(isMovie ? 'Film supprimé' : 'Série supprimée'),
    onSettled: refresh,
  });
  const share = () => {
    Share.share({ message: `Regarde « ${detail.data?.media?.title} » — suivi avec SerieTime 📺` }).catch(() => undefined);
  };

  if (detail.isLoading || !detail.data) return <Loading />;
  const media: MediaDto = detail.data.media;
  const isFollowed = media.userStatus != null;

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.white }}>
      <View style={styles.hero}>
        {(() => {
          const heroUri = tmdbImage(media.backdropPath, 'w780') ?? tmdbImage(media.posterPath, 'w500');
          return heroUri ? (
            <>
              <Image source={{ uri: heroUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
              <View style={styles.heroShade} />
            </>
          ) : null;
        })()}
        <View style={[styles.heroBtns, { top: insets.top + 4 }]}>
          <Pressable onPress={() => router.back()} hitSlop={8}>
            <Feather name="chevron-down" size={30} color="#fff" />
          </Pressable>
          <Pressable onPress={() => setMenu(true)} hitSlop={8} accessibilityLabel="Options">
            <Feather name="more-horizontal" size={28} color="#fff" />
          </Pressable>
        </View>
        <View style={styles.heroTitleWrap}>
          <Text style={styles.heroTitle}>{media.title}</Text>
          <Text style={styles.heroSub}>
            {isMovie
              ? [media.year, media.genres].filter(Boolean).join(' · ')
              : [
                  detail.data.show?.numberOfSeasons ? `${detail.data.show.numberOfSeasons} saison${detail.data.show.numberOfSeasons > 1 ? 's' : ''}` : null,
                  detail.data.show?.platform ?? detail.data.show?.network,
                ].filter(Boolean).join(' · ')}
          </Text>
        </View>
      </View>

      {isMovie ? (
        <>
          <MovieBody media={media} detail={detail.data} onToggle={() => markMovie.mutate(media.userStatus !== 'completed')} />
          <CommentsTab mediaId={String(id)} />
        </>
      ) : (
        <>
          <TopTabs tabs={['À PROPOS', 'ÉPISODES', 'DISCUSSION']} active={tab} onChange={setTab} />
          {tab === 'À PROPOS' ? (
            <AboutTab media={media} detail={detail.data} interest={interest} setInterest={setInterest} />
          ) : tab === 'ÉPISODES' ? (
            <EpisodesTab showId={String(id)} onChange={refresh} />
          ) : (
            <CommentsTab mediaId={String(id)} />
          )}
        </>
      )}

      {/* Barre du bas façon TV Time : + AJOUTER, puis ✓ AJOUTÉE ! pendant 2 s. */}
      {!isFollowed && !justAdded && !toast ? (
        <Pressable
          style={[styles.addBar, { paddingBottom: insets.bottom + 16 }]}
          onPress={() => follow.mutate()}
          disabled={follow.isPending}
        >
          {follow.isPending ? (
            <ActivityIndicator color={COLORS.black} />
          ) : (
            <View style={styles.addBarRow}>
              <Feather name="plus" size={24} color={COLORS.black} />
              <Text style={styles.addBarText}>{isMovie ? 'AJOUTER LE FILM' : 'AJOUTER LA SÉRIE'}</Text>
            </View>
          )}
        </Pressable>
      ) : null}
      {justAdded || toast ? (
        <View style={[styles.addBar, { paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.addBarRow}>
            <Feather name="check" size={24} color={COLORS.black} />
            <Text style={styles.addBarText}>{toast ?? (isMovie ? 'AJOUTÉ !' : 'AJOUTÉE !')}</Text>
          </View>
        </View>
      ) : null}

      <Modal visible={menu} transparent animationType="fade" onRequestClose={() => setMenu(false)}>
        <Pressable style={styles.overlay} onPress={() => setMenu(false)} />
        <View style={styles.sheet}>
          <View style={styles.statusRow}>
            <Text style={styles.statusText}>{STATUS_LABELS[media.userStatus ?? 'not_started']}</Text>
          </View>
          {!isMovie ? (
            <SheetItem icon="edit-2" label="Personnaliser" onPress={() => { setMenu(false); setPersonalize(true); }} />
          ) : null}
          <SheetItem
            icon="heart"
            color={media.isFavorite ? COLORS.red : COLORS.black}
            label={media.isFavorite ? 'Retirer des favoris' : 'Favoris'}
            onPress={() => { favorite.mutate(); setMenu(false); }}
          />
          <SheetItem icon="plus-square" label="Ajouter à une liste" onPress={() => { setMenu(false); setListsOpen(true); }} />
          <SheetItem icon="clock" label="Regarder plus tard" onPress={() => { setMenu(false); watchLater.mutate(); }} />
          {isFollowed ? (
            <SheetItem
              icon="minus-square"
              label={isMovie ? 'Supprimer le film' : 'Supprimer la série'}
              onPress={() => { setMenu(false); removeTracking.mutate(); }}
            />
          ) : null}
          <SheetItem icon="share-2" label="Partager" onPress={() => { setMenu(false); share(); }} last />
        </View>
      </Modal>

      {!isMovie ? (
        <PersonalizeSheet
          mediaId={String(id)}
          visible={personalize}
          onClose={() => setPersonalize(false)}
          onApplied={(what) => { refresh(); showToast(what === 'poster' ? 'Affiche mise à jour' : 'Bannière mise à jour'); }}
        />
      ) : null}
      <ListsSheet
        mediaId={String(id)}
        visible={listsOpen}
        onClose={() => setListsOpen(false)}
        onChanged={(added, title) => showToast(added ? `Ajouté à « ${title} »` : `Retiré de « ${title} »`)}
      />
    </View>
  );
}

function SheetItem({ icon, label, onPress, color, last }: { icon: keyof typeof Feather.glyphMap; label: string; onPress: () => void; color?: string; last?: boolean }) {
  return (
    <Pressable style={[styles.sheetItem, last && { borderBottomWidth: 0 }]} onPress={onPress}>
      <Feather name={icon} size={22} color={color ?? COLORS.black} />
      <Text style={styles.sheetLabel}>{label}</Text>
    </Pressable>
  );
}

// « Personnaliser » : choisir l'affiche et la bannière parmi les illustrations
// disponibles (TMDb + TheTVDB), comme le bottom sheet de TV Time.
function PersonalizeSheet({
  mediaId,
  visible,
  onClose,
  onApplied,
}: {
  mediaId: string;
  visible: boolean;
  onClose: () => void;
  onApplied: (what: 'poster' | 'banner') => void;
}) {
  const [busyUri, setBusyUri] = useState<string | null>(null);
  const images = useQuery({
    queryKey: ['show-images', mediaId],
    queryFn: () =>
      api.get<{ posters: string[]; backdrops: string[]; selectedPoster: string | null; selectedBackdrop: string | null }>(
        `/api/shows/${mediaId}/images`,
      ),
    enabled: visible,
  });

  const apply = async (what: 'poster' | 'banner', uri: string) => {
    if (busyUri) return;
    setBusyUri(uri);
    try {
      if (what === 'poster') await api.post(`/api/shows/${mediaId}/poster`, { posterPath: uri });
      else await api.post(`/api/shows/${mediaId}/banner`, { backdropPath: uri });
      images.refetch();
      onApplied(what);
    } finally {
      setBusyUri(null);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: COLORS.white }}>
        <View style={pstyles.header}>
          <Pressable onPress={onClose} hitSlop={12}>
            <Feather name="x" size={26} color={COLORS.black} />
          </Pressable>
          <Text style={pstyles.title}>Personnaliser</Text>
          <View style={{ width: 26 }} />
        </View>
        {images.isLoading ? (
          <Loading />
        ) : (
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
            <Text style={pstyles.section}>Affiche</Text>
            <View style={pstyles.grid}>
              {(images.data?.posters ?? []).map((uri) => {
                const selected = uri === images.data?.selectedPoster;
                return (
                  <Pressable key={uri} style={[pstyles.posterWrap, selected && pstyles.selected]} onPress={() => apply('poster', uri)}>
                    <Image source={{ uri: tmdbImage(uri, 'w185') ?? uri }} style={pstyles.poster} resizeMode="cover" />
                    {selected ? (
                      <View style={pstyles.check}>
                        <Feather name="check" size={18} color="#fff" />
                      </View>
                    ) : null}
                    {busyUri === uri ? (
                      <View style={pstyles.busy}>
                        <ActivityIndicator color="#fff" />
                      </View>
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
            <Text style={[pstyles.section, { marginTop: 24 }]}>Bannière</Text>
            {(images.data?.backdrops ?? []).length === 0 ? (
              <Text style={pstyles.emptyNote}>Aucune bannière disponible pour cette série.</Text>
            ) : (
              <View style={{ gap: 12 }}>
                {(images.data?.backdrops ?? []).map((uri) => {
                  const selected = uri === images.data?.selectedBackdrop;
                  return (
                    <Pressable key={uri} style={[pstyles.bannerWrap, selected && pstyles.selected]} onPress={() => apply('banner', uri)}>
                      <Image source={{ uri: tmdbImage(uri, 'w500') ?? uri }} style={pstyles.banner} resizeMode="cover" />
                      {selected ? (
                        <View style={pstyles.check}>
                          <Feather name="check" size={18} color="#fff" />
                        </View>
                      ) : null}
                      {busyUri === uri ? (
                        <View style={pstyles.busy}>
                          <ActivityIndicator color="#fff" />
                        </View>
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
            )}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

// « Ajouter à une liste » : coche/décoche les listes existantes, création rapide.
function ListsSheet({
  mediaId,
  visible,
  onClose,
  onChanged,
}: {
  mediaId: string;
  visible: boolean;
  onClose: () => void;
  onChanged: (added: boolean, title: string) => void;
}) {
  const [newTitle, setNewTitle] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const lists = useQuery({
    queryKey: ['lists', 'picker', mediaId],
    queryFn: () =>
      api.get<{ lists: { id: string; title: string; itemCount: number; containsMediaId?: boolean }[] }>(
        `/api/lists?mediaId=${mediaId}`,
      ),
    enabled: visible,
  });

  const toggle = async (l: { id: string; title: string; containsMediaId?: boolean }) => {
    if (busyId) return;
    setBusyId(l.id);
    try {
      if (l.containsMediaId) {
        await api.del(`/api/lists/${l.id}/items/${mediaId}`);
        onChanged(false, l.title);
      } else {
        await api.post(`/api/lists/${l.id}/items`, { mediaId });
        onChanged(true, l.title);
      }
      lists.refetch();
    } finally {
      setBusyId(null);
    }
  };

  const create = async () => {
    const title = newTitle.trim();
    if (!title || creating) return;
    setCreating(true);
    try {
      const res = await api.post<{ id: string }>('/api/lists', { title });
      await api.post(`/api/lists/${res.id}/items`, { mediaId });
      setNewTitle('');
      onChanged(true, title);
      lists.refetch();
    } finally {
      setCreating(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose} />
      <View style={[styles.sheet, { maxHeight: '70%' }]}>
        <View style={styles.statusRow}>
          <Text style={styles.statusText}>Ajouter à une liste</Text>
        </View>
        <ScrollView keyboardShouldPersistTaps="handled">
          {lists.isLoading ? (
            <Loading />
          ) : (
            (lists.data?.lists ?? []).map((l) => (
              <Pressable key={l.id} style={styles.sheetItem} onPress={() => toggle(l)}>
                <Feather name={l.containsMediaId ? 'check-square' : 'square'} size={22} color={l.containsMediaId ? '#1a9c4b' : COLORS.black} />
                <Text style={styles.sheetLabel} numberOfLines={1}>
                  {l.title}
                </Text>
                {busyId === l.id ? <ActivityIndicator color={COLORS.black} size="small" /> : (
                  <Text style={pstyles.listCount}>{l.itemCount}</Text>
                )}
              </Pressable>
            ))
          )}
          <View style={pstyles.newListRow}>
            <TextInput
              style={pstyles.newListInput}
              placeholder="Nouvelle liste…"
              placeholderTextColor={COLORS.textSoft}
              value={newTitle}
              onChangeText={setNewTitle}
              onSubmitEditing={create}
            />
            <Pressable style={[pstyles.newListBtn, (!newTitle.trim() || creating) && { opacity: 0.4 }]} onPress={create} disabled={!newTitle.trim() || creating}>
              {creating ? <ActivityIndicator color={COLORS.black} size="small" /> : <Text style={pstyles.newListBtnText}>CRÉER</Text>}
            </Pressable>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const pstyles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 54, paddingBottom: 12 },
  title: { fontSize: 20, fontWeight: '800' },
  section: { fontSize: 18, fontWeight: '800', marginBottom: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  posterWrap: { width: '31%', aspectRatio: 2 / 3, borderRadius: 6, overflow: 'hidden', backgroundColor: '#e5e5e5' },
  poster: { width: '100%', height: '100%' },
  bannerWrap: { width: '100%', aspectRatio: 16 / 9, borderRadius: 6, overflow: 'hidden', backgroundColor: '#e5e5e5' },
  banner: { width: '100%', height: '100%' },
  selected: { borderWidth: 3, borderColor: COLORS.yellow },
  check: { position: 'absolute', top: 6, right: 6, width: 26, height: 26, borderRadius: 13, backgroundColor: COLORS.black, alignItems: 'center', justifyContent: 'center' },
  busy: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' },
  emptyNote: { color: COLORS.textMuted, fontSize: 15 },
  listCount: { color: COLORS.textMuted, fontSize: 15 },
  newListRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 24, paddingVertical: 16 },
  newListInput: { flex: 1, borderBottomWidth: 1, borderBottomColor: COLORS.border, fontSize: 17, paddingVertical: 8 },
  newListBtn: { backgroundColor: COLORS.yellow, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 10 },
  newListBtnText: { fontWeight: '800', fontSize: 13, letterSpacing: 0.4 },
});

function AboutTab({ media, detail, interest, setInterest }: any) {
  const providers = detail.providers ?? [];
  return (
    <ScrollView>
      <View style={styles.section}>
        <View style={styles.sectionHeadRow}>
          <Text style={styles.sectionTitle}>Où regarder</Text>
          <Feather name="settings" size={22} color={COLORS.black} />
        </View>
        {providers.length === 0 ? (
          <Text style={styles.muted}>Non disponible</Text>
        ) : (
          <View style={styles.provBtn}>
            <Feather name="play" size={18} color="#fff" />
            <Text style={styles.provText}>{providers[0].name.toUpperCase()}</Text>
          </View>
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.question}>QU'EST-CE QUI VOUS INTÉRESSE LE PLUS DANS CETTE SÉRIE ?</Text>
        {INTEREST.map((o) => (
          <Pressable key={o} style={[styles.qbtn, interest === o && styles.qbtnSel]} onPress={() => setInterest(o)}>
            <Text style={styles.qbtnText}>{o}</Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Informations sur la série</Text>
        <Text style={styles.muted}>{[media.status, media.genres].filter(Boolean).join(' · ')}</Text>
        {media.overview ? <Text style={styles.overview}>{media.overview}</Text> : null}
      </View>
    </ScrollView>
  );
}

function MovieBody({ media, detail, onToggle }: any) {
  const seen = media.userStatus === 'completed';
  const providers = detail.providers ?? [];
  return (
    <ScrollView>
      <View style={[styles.section, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Feather name="eye" size={22} color={COLORS.black} />
          <Text style={{ fontSize: 17 }}>{seen ? 'Vu' : 'Pas vu'}</Text>
        </View>
        <CheckCircle checked={seen} onPress={onToggle} />
      </View>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Où regarder</Text>
        {providers.length === 0 ? (
          <Text style={styles.muted}>Non disponible</Text>
        ) : (
          <View style={styles.provBtn}>
            <Feather name="play" size={18} color="#fff" />
            <Text style={styles.provText}>{providers[0].name.toUpperCase()}</Text>
          </View>
        )}
      </View>
      {media.overview ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Synopsis</Text>
          <Text style={styles.overview}>{media.overview}</Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

type SeasonData = { id: string; seasonNumber: number; title: string; watchedCount: number; totalCount: number; episodes: EpisodeDto[] };

// Vignette d'épisode : image TheTVDB/TMDb si disponible, sinon pictogramme.
function EpThumb({ stillPath }: { stillPath?: string | null }) {
  const uri = tmdbImage(stillPath, 'w300');
  if (uri) return <Image source={{ uri }} style={styles.epThumb} resizeMode="cover" />;
  return (
    <View style={[styles.epThumb, { alignItems: 'center', justifyContent: 'center' }]}>
      <Feather name="image" size={24} color="#9a9a9a" />
    </View>
  );
}

function EpisodesTab({ showId, onChange }: { showId: string; onChange: () => void }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const { data, isLoading } = useQuery({
    queryKey: ['show', showId, 'episodes'],
    queryFn: () => api.get<{ seasons: SeasonData[]; nextEpisode: EpisodeDto | null }>(`/api/shows/${showId}/episodes`),
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['show', showId, 'episodes'] });
    qc.invalidateQueries({ queryKey: ['show', showId] });
    onChange();
  };
  const toggleEp = useMutation({
    mutationFn: (ep: EpisodeDto) => api.post(`/api/episodes/${ep.id}/${ep.watched ? 'unwatched' : 'watched'}`),
    onSettled: refresh,
  });
  const markAll = useMutation({
    mutationFn: (seasonNumber?: number) => api.post(`/api/shows/${showId}/mark-all-watched`, seasonNumber ? { seasonNumber } : {}),
    onSettled: refresh,
  });

  if (isLoading || !data) return <Loading />;
  if (data.seasons.length === 0) return <EmptyState title="Aucun épisode" />;

  return (
    <ScrollView style={{ backgroundColor: COLORS.pageMuted }} contentContainerStyle={{ paddingBottom: 40 }}>
      {data.nextEpisode ? (
        <View style={{ paddingTop: 20, borderBottomWidth: 1, borderBottomColor: COLORS.borderLight, backgroundColor: COLORS.white }}>
          <Text style={[styles.sectionTitle, { paddingHorizontal: 24 }]}>Démarrer le suivi</Text>
          <View style={{ padding: 12 }}>
            <View style={styles.eprow}>
              <EpThumb stillPath={data.nextEpisode.stillPath} />
              <View style={{ flex: 1, padding: 12 }}>
                <Text style={styles.epCode}>{episodeCode(data.nextEpisode.seasonNumber, data.nextEpisode.episodeNumber)}</Text>
                <Text numberOfLines={1}>{data.nextEpisode.title}</Text>
              </View>
              <View style={{ justifyContent: 'center', paddingRight: 14 }}>
                <CheckCircle checked={data.nextEpisode.watched} onPress={() => toggleEp.mutate(data.nextEpisode!)} />
              </View>
            </View>
          </View>
        </View>
      ) : null}

      <View style={{ paddingTop: 20 }}>
        <View style={[styles.sectionHeadRow, { marginBottom: 0 }]}>
          <Text style={styles.sectionTitle}>Tous les épisodes</Text>
          <Pressable style={styles.markAllBtn} onPress={() => markAll.mutate(undefined)}>
            <Feather name="check" size={18} color={COLORS.black} />
          </Pressable>
        </View>
        <View style={{ padding: 12 }}>
          {data.seasons.map((s) => {
            const isOpen = open[s.seasonNumber];
            const done = s.totalCount > 0 && s.watchedCount === s.totalCount;
            return (
              <View key={s.id} style={{ marginBottom: 12 }}>
                <Pressable
                  style={[styles.season, isOpen && styles.seasonOpen]}
                  onPress={() => setOpen((o) => ({ ...o, [s.seasonNumber]: !o[s.seasonNumber] }))}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={styles.seasonTitle}>{s.title}</Text>
                    <Feather name={isOpen ? 'chevron-up' : 'chevron-down'} size={22} color={COLORS.black} />
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Text style={styles.seasonProg}>{s.watchedCount}/{s.totalCount}</Text>
                    <CheckCircle size={44} checked={done} onPress={() => markAll.mutate(s.seasonNumber)} />
                  </View>
                </Pressable>
                {isOpen
                  ? s.episodes.map((e) => (
                      <View key={e.id} style={styles.eprow}>
                        <EpThumb stillPath={e.stillPath} />
                        <View style={{ flex: 1, padding: 10 }}>
                          <Text style={styles.epCode}>{episodeCode(e.seasonNumber, e.episodeNumber)}</Text>
                          <Text numberOfLines={2}>{e.title}</Text>
                        </View>
                        <View style={{ justifyContent: 'center', paddingRight: 14 }}>
                          <CheckCircle size={44} checked={e.watched} onPress={() => toggleEp.mutate(e)} />
                        </View>
                      </View>
                    ))
                  : null}
              </View>
            );
          })}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  hero: { height: 240, backgroundColor: '#1a1a22', justifyContent: 'flex-end', overflow: 'hidden' },
  heroShade: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.35)' },
  addBar: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: COLORS.yellow, paddingTop: 18, alignItems: 'center' },
  addBarRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  addBarText: { fontSize: 17, fontWeight: '800', letterSpacing: 0.6 },
  heroBtns: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 14 },
  heroTitleWrap: { padding: 20 },
  heroTitle: { color: '#fff', fontSize: 27, fontWeight: '800' },
  heroSub: { color: 'rgba(255,255,255,0.9)', fontSize: 15, marginTop: 2 },
  section: { padding: 22, borderBottomWidth: 1, borderBottomColor: COLORS.borderLight },
  sectionHeadRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 24, marginBottom: 14 },
  sectionTitle: { fontSize: 24, fontWeight: '800' },
  muted: { color: COLORS.textMuted, fontSize: 16, marginTop: 8 },
  overview: { fontSize: 18, lineHeight: 26, marginTop: 16 },
  provBtn: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: COLORS.provider, borderRadius: 999, paddingHorizontal: 24, paddingVertical: 12, alignSelf: 'flex-start', marginTop: 12 },
  provText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  question: { textAlign: 'center', fontSize: 14, fontWeight: '700', marginBottom: 16 },
  qbtn: { backgroundColor: COLORS.chipGrey, borderRadius: 6, paddingVertical: 16, marginBottom: 12, alignItems: 'center' },
  qbtnSel: { backgroundColor: COLORS.yellow },
  qbtnText: { fontSize: 14, fontWeight: '700' },
  eprow: { flexDirection: 'row', backgroundColor: COLORS.white, borderRadius: 5, minHeight: 92, overflow: 'hidden', marginBottom: 8, ...SHADOW.card },
  epThumb: { width: 90, backgroundColor: '#e5e5e5' },
  epCode: { fontSize: 19, fontWeight: '800' },
  markAllBtn: { width: 40, height: 40, borderRadius: 20, borderWidth: 2, borderColor: COLORS.black, alignItems: 'center', justifyContent: 'center' },
  season: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 76, paddingHorizontal: 20, backgroundColor: COLORS.white, borderRadius: 5, ...SHADOW.season },
  seasonOpen: { borderBottomWidth: 3, borderBottomColor: COLORS.yellow },
  seasonTitle: { fontSize: 24, fontWeight: '800' },
  seasonProg: { fontSize: 17, marginRight: 14 },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: COLORS.overlay },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: COLORS.white, borderTopLeftRadius: 5, borderTopRightRadius: 5, paddingBottom: 20 },
  statusRow: { backgroundColor: COLORS.chipGrey, borderBottomWidth: 3, borderBottomColor: COLORS.yellow, height: 62, justifyContent: 'center', paddingHorizontal: 24 },
  statusText: { fontSize: 16, color: '#555' },
  sheetItem: { flexDirection: 'row', alignItems: 'center', gap: 16, height: 62, paddingHorizontal: 24, borderBottomWidth: 1, borderBottomColor: COLORS.borderLight },
  sheetLabel: { fontSize: 18, fontWeight: '600' },
});

type CommentDto = {
  id: string;
  body: string;
  createdAt: string;
  episodeId: string | null;
  parentId: string | null;
  user: { id: string; displayName: string; avatarUrl: string | null };
  isMine: boolean;
  reactions: { total: number; byEmoji: Record<string, number>; mine: string[] };
  replies?: CommentDto[];
};

const REACT_EMOJIS = ['❤️', '👍', '😂', '😮', '😢'];

// Discussion sociale : commentaires, fils de réponses et réactions multi-emoji.
function CommentsTab({ mediaId }: { mediaId: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const { data, isLoading } = useQuery({
    queryKey: ['comments', mediaId],
    queryFn: () => api.get<{ comments: CommentDto[] }>(`/api/media/${mediaId}/comments`),
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['comments', mediaId] });

  const post = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      await api.post(`/api/media/${mediaId}/comments`, { body: text.trim() });
      setText('');
      invalidate();
    } finally {
      setBusy(false);
    }
  };
  const postReply = async (parentId: string) => {
    if (!replyText.trim()) return;
    await api.post(`/api/media/${mediaId}/comments`, { body: replyText.trim(), parentId });
    setReplyText('');
    setReplyTo(null);
    invalidate();
  };
  const react = async (c: CommentDto, emoji: string) => {
    await api.post(`/api/comments/${c.id}/react`, { emoji });
    invalidate();
  };
  const remove = async (c: CommentDto) => {
    await api.del(`/api/comments/${c.id}`);
    invalidate();
  };

  const renderComment = (c: CommentDto, isReply = false) => (
    <View key={c.id} style={[cstyles.row, isReply && cstyles.replyRow]}>
      <Pressable style={cstyles.avatar} onPress={() => router.push(`/user/${c.user.id}`)}>
        <Text style={cstyles.avatarInit}>{c.user.displayName.slice(0, 1).toUpperCase()}</Text>
      </Pressable>
      <View style={{ flex: 1 }}>
        <Text style={cstyles.name}>{c.user.displayName}</Text>
        <Text style={cstyles.body}>{c.body}</Text>
        <View style={cstyles.reactBar}>
          {REACT_EMOJIS.map((e) => {
            const count = c.reactions.byEmoji[e] ?? 0;
            const mine = c.reactions.mine.includes(e);
            return (
              <Pressable key={e} style={[cstyles.chip, mine && cstyles.chipActive]} onPress={() => react(c, e)}>
                <Text style={cstyles.chipText}>
                  {e}
                  {count > 0 ? ` ${count}` : ''}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <View style={cstyles.actions}>
          {!isReply ? (
            <Pressable onPress={() => { setReplyTo(replyTo === c.id ? null : c.id); setReplyText(''); }} hitSlop={8}>
              <Text style={cstyles.action}>Répondre</Text>
            </Pressable>
          ) : null}
          {c.isMine ? (
            <Pressable onPress={() => remove(c)} hitSlop={8}>
              <Text style={cstyles.action}>Supprimer</Text>
            </Pressable>
          ) : null}
        </View>
        {replyTo === c.id ? (
          <View style={cstyles.replyComposer}>
            <TextInput
              style={cstyles.replyInput}
              placeholder="Votre réponse…"
              placeholderTextColor={COLORS.textMuted}
              value={replyText}
              onChangeText={setReplyText}
            />
            <Pressable style={[cstyles.replySend, !replyText.trim() && { opacity: 0.4 }]} onPress={() => postReply(c.id)} disabled={!replyText.trim()}>
              <Text style={cstyles.sendText}>OK</Text>
            </Pressable>
          </View>
        ) : null}
        {c.replies?.map((r) => renderComment(r, true))}
      </View>
    </View>
  );

  return (
    <View style={cstyles.wrap}>
      <View style={cstyles.composer}>
        <TextInput
          style={cstyles.input}
          placeholder="Partager un avis…"
          placeholderTextColor={COLORS.textMuted}
          value={text}
          onChangeText={setText}
          multiline
        />
        <Pressable
          style={[cstyles.send, (!text.trim() || busy) && { opacity: 0.4 }]}
          onPress={post}
          disabled={!text.trim() || busy}
        >
          {busy ? <ActivityIndicator color="#000" /> : <Text style={cstyles.sendText}>PUBLIER</Text>}
        </Pressable>
      </View>
      {isLoading ? (
        <Loading />
      ) : (data?.comments.length ?? 0) === 0 ? (
        <EmptyState title="Aucun commentaire" message="Soyez le premier à réagir." />
      ) : (
        data!.comments.map((c) => renderComment(c))
      )}
    </View>
  );
}

const cstyles = StyleSheet.create({
  wrap: { padding: 20 },
  composer: { marginBottom: 20 },
  input: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 8, minHeight: 60, padding: 12, fontSize: 16, textAlignVertical: 'top' },
  send: { alignSelf: 'flex-end', marginTop: 10, backgroundColor: COLORS.yellow, borderRadius: 999, paddingHorizontal: 22, paddingVertical: 10 },
  sendText: { fontWeight: '800', fontSize: 13, letterSpacing: 0.4 },
  row: { flexDirection: 'row', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: COLORS.borderLight },
  replyRow: { borderBottomWidth: 0, paddingVertical: 8, marginLeft: 8, borderLeftWidth: 2, borderLeftColor: COLORS.borderLight, paddingLeft: 12 },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#20202a', alignItems: 'center', justifyContent: 'center' },
  avatarInit: { color: '#fff', fontSize: 16, fontWeight: '800' },
  name: { fontSize: 15, fontWeight: '800' },
  body: { fontSize: 16, lineHeight: 22, marginTop: 3 },
  reactBar: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  chip: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  chipActive: { borderColor: COLORS.yellow, backgroundColor: COLORS.yellowSoft },
  chipText: { fontSize: 14 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 20, marginTop: 8 },
  action: { fontSize: 14, color: COLORS.textMuted, fontWeight: '600' },
  replyComposer: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  replyInput: { flex: 1, borderWidth: 1, borderColor: COLORS.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 15 },
  replySend: { backgroundColor: COLORS.yellow, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 9 },
});
