import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Image, Dimensions } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { api, tmdbImage } from '@/lib/api';
import type { MediaDto, ProfileStatsDto } from '@/lib/types';
import { watchTime } from '@/lib/format';
import { COLORS, FONTS } from '@/lib/theme';
import { Loading, LoadError, Poster } from '@/components/ui';

export type ProfileUser = {
  displayName: string;
  email?: string | null;
  avatarUrl?: string | null;
  coverUrl?: string | null;
  birthYear?: number | null;
  gender?: string | null;
  countryCode?: string;
};

type ProfileResponse = {
  user: ProfileUser;
  social?: { followingCount: number; followersCount: number; commentsCount: number };
  stats: ProfileStatsDto;
  lists: { id: string; title: string; posterPaths: string[] }[];
  shows: MediaDto[];
  favoriteShows: MediaDto[];
  movies: MediaDto[];
  favoriteMovies: MediaDto[];
};

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['profile'],
    queryFn: () => api.get<ProfileResponse>('/api/profile'),
  });
  const { data: unreadData } = useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: () => api.get<{ unreadCount: number }>('/api/notifications/unread-count'),
    refetchInterval: 30_000,
  });
  const unread = unreadData?.unreadCount ?? 0;

  if (isLoading) return <Loading />;
  if (!data) return <LoadError onRetry={refetch} busy={isRefetching} />;
  const { user, stats } = data;
  const st = watchTime(stats.showMinutes);
  const mt = watchTime(stats.movieMinutes);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.white }} contentContainerStyle={{ paddingBottom: 24 }}>
      <View style={styles.head}>
        {user.coverUrl ? (
          <>
            <Image source={{ uri: tmdbImage(user.coverUrl, 'w780') ?? user.coverUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" />
            <View style={styles.coverShade} />
          </>
        ) : null}
        <Pressable style={[styles.bell, { top: insets.top + 8 }]} onPress={() => router.push('/notifications')}>
          <Feather name="bell" size={22} color={COLORS.black} />
          {unread > 0 ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{unread > 9 ? '9+' : unread}</Text>
            </View>
          ) : null}
        </Pressable>
        <Pressable style={[styles.dots, { top: insets.top + 8 }]} onPress={() => router.push('/settings')}>
          <Feather name="more-horizontal" size={26} color="#fff" />
        </Pressable>
        <View style={styles.headRow}>
          {user.avatarUrl ? (
            <Image source={{ uri: tmdbImage(user.avatarUrl, 'w185') ?? user.avatarUrl }} style={styles.avatar} resizeMode="cover" />
          ) : (
            <View style={[styles.avatar, styles.avatarEmpty]}>
              <Text style={styles.avatarInit}>{user.displayName.slice(0, 1).toUpperCase()}</Text>
            </View>
          )}
          <View>
            <Text style={styles.name}>{user.displayName}</Text>
            <Pressable style={styles.modif} onPress={() => router.push('/profile/edit')}>
              <Text style={styles.modifText}>MODIFIER</Text>
            </Pressable>
          </View>
        </View>
      </View>

      {/* Compteurs sociaux (façon TV Time) — un tap ouvre l'écran social. */}
      <View style={styles.counters}>
        <Counter
          n={data.social?.followingCount ?? 0}
          label={(data.social?.followingCount ?? 0) > 1 ? 'abonnements' : 'abonnement'}
          onPress={() => router.push('/social')}
        />
        <Counter
          n={data.social?.followersCount ?? 0}
          label={(data.social?.followersCount ?? 0) > 1 ? 'abonnés' : 'abonné'}
          border
          onPress={() => router.push('/social')}
        />
        <Counter
          n={data.social?.commentsCount ?? 0}
          label={(data.social?.commentsCount ?? 0) > 1 ? 'commentaires' : 'commentaire'}
          border
        />
      </View>

      <Section title="Statistiques">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 24, gap: 12 }}>
          <StatCard icon="tv" title="Temps passé devant des séries" values={[[st.months, 'MOIS'], [st.days, 'JOURS'], [st.hours, 'HEURES']]} />
          <StatCard icon="tv" title="Épisodes vus" values={[[stats.episodesWatched, 'ÉPISODES']]} />
          <StatCard icon="film" title="Temps passé devant des films" values={[[mt.months, 'MOIS'], [mt.days, 'JOURS'], [mt.hours, 'HEURES']]} />
          <StatCard icon="film" title="Films regardés" values={[[stats.moviesWatched, 'FILMS']]} />
        </ScrollView>
      </Section>

      {data.lists.length > 0 ? (
        <Section title="Listes">
          <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false}>
            {data.lists.map((l) => (
              <ListCollageCard key={l.id} title={l.title} posterPaths={l.posterPaths} />
            ))}
          </ScrollView>
          {data.lists.length > 1 ? (
            <View style={styles.dotsRow}>
              {data.lists.map((l, i) => (
                <View key={l.id} style={[styles.dot, i === 0 && styles.dotActive]} />
              ))}
            </View>
          ) : null}
        </Section>
      ) : null}

      <PosterRow title="Séries" items={data.shows} emptyLabel="Aucune série suivie" />
      <PosterRow title="Séries préférées" items={data.favoriteShows} heart emptyLabel="Aucune série en favori" />
      <PosterRow title="Films" items={data.movies} isMovie emptyLabel="Aucun film ajouté" />
      <PosterRow title="Films préférés" items={data.favoriteMovies} isMovie heart emptyLabel="Aucun film en favori" />
    </ScrollView>
  );
}

function Counter({ n, label, border, onPress }: { n: number; label: string; border?: boolean; onPress?: () => void }) {
  return (
    <Pressable style={[styles.counter, border && styles.counterBorder]} onPress={onPress}>
      <Text style={styles.counterN}>{n}</Text>
      <Text style={styles.counterL}>{label}</Text>
    </Pressable>
  );
}

// Carte « Listes » façon TV Time : collage des affiches + titre en surimpression.
function ListCollageCard({ title, posterPaths }: { title: string; posterPaths: string[] }) {
  const { width } = Dimensions.get('window');
  const cardWidth = width - 48;
  return (
    <View style={[styles.listcard, { width: cardWidth, marginHorizontal: 24 }]}>
      <View style={StyleSheet.absoluteFill}>
        <View style={{ flex: 1, flexDirection: 'row' }}>
          {(posterPaths.length ? posterPaths.slice(0, 4) : [null]).map((p, i) => (
            <View key={i} style={{ flex: 1, backgroundColor: '#2e2e38' }}>
              {p ? <Image source={{ uri: tmdbImage(p, 'w342') ?? p }} style={{ width: '100%', height: '100%' }} resizeMode="cover" /> : null}
            </View>
          ))}
        </View>
      </View>
      <View style={styles.listShade} />
      <Text style={styles.listTitle}>{title}</Text>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ paddingVertical: 20 }}>
      <View style={styles.sectHead}>
        <Text style={styles.sectTitle}>{title}</Text>
        <Feather name="chevron-right" size={24} color={COLORS.black} />
      </View>
      {children}
    </View>
  );
}

function StatCard({ icon, title, values }: { icon: keyof typeof Feather.glyphMap; title: string; values: [number, string][] }) {
  return (
    <View style={styles.statcard}>
      <View style={styles.statTop}>
        <Feather name={icon} size={20} color={COLORS.black} />
        <Text style={styles.statTitle}>{title}</Text>
      </View>
      <View style={styles.statVals}>
        {values.map(([v, l]) => (
          <View key={l} style={{ alignItems: 'center' }}>
            <Text style={styles.statV}>{v}</Text>
            <Text style={styles.statL}>{l}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function PosterRow({
  title,
  items,
  heart,
  isMovie,
  emptyLabel,
}: {
  title: string;
  items: MediaDto[];
  heart?: boolean;
  isMovie?: boolean;
  emptyLabel: string;
}) {
  const router = useRouter();
  return (
    <View style={{ paddingVertical: 16 }}>
      <View style={styles.sectHead}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          {heart ? (
            // Pastille rouge + cœur blanc AVANT le titre, comme TV Time.
            <View style={styles.heartBadge}>
              <Feather name="heart" size={15} color="#fff" />
            </View>
          ) : null}
          <Text style={styles.sectTitle}>{title}</Text>
        </View>
        <Feather name="chevron-right" size={24} color={COLORS.black} />
      </View>
      {items.length === 0 ? (
        // Section toujours visible façon TV Time, avec un état vide.
        <View style={styles.emptyRow}>
          <View style={styles.emptyPoster}>
            <Feather name={isMovie ? 'film' : 'tv'} size={26} color="#b4b4b4" />
          </View>
          <Text style={styles.emptyRowText}>{emptyLabel}</Text>
        </View>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 24, gap: 6 }}>
          {items.map((m) => (
            <Poster
              key={m.id}
              title={m.title}
              uri={tmdbImage(m.posterPath)}
              width={118}
              onPress={() => router.push(`/show/${m.id}${isMovie ? '?type=movie' : ''}`)}
            />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  head: { height: 210, backgroundColor: '#20202a', justifyContent: 'flex-end', overflow: 'hidden' },
  coverShade: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.35)' },
  bell: { position: 'absolute', left: 16, width: 46, height: 46, borderRadius: 23, backgroundColor: COLORS.yellow, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: 2, right: 2, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: COLORS.red, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  badgeText: { color: '#fff', fontSize: 11, fontFamily: FONTS.extraBold },
  dots: { position: 'absolute', right: 12, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 16, padding: 20 },
  avatar: { width: 82, height: 82, borderRadius: 41, borderWidth: 2, borderColor: '#fff', backgroundColor: '#555' },
  avatarEmpty: { alignItems: 'center', justifyContent: 'center' },
  avatarInit: { color: '#fff', fontSize: 34, fontFamily: FONTS.extraBold },
  emptyRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 24 },
  emptyPoster: { width: 70, aspectRatio: 2 / 3, borderRadius: 4, backgroundColor: '#eee', alignItems: 'center', justifyContent: 'center' },
  emptyRowText: { color: COLORS.textMuted, fontFamily: FONTS.regular, fontSize: 15 },
  name: { color: '#fff', fontSize: 28, fontFamily: FONTS.extraBold },
  modif: { marginTop: 6, borderWidth: 2, borderColor: '#fff', borderRadius: 999, paddingHorizontal: 18, paddingVertical: 5, alignSelf: 'flex-start' },
  modifText: { color: '#fff', fontSize: 13, fontFamily: FONTS.extraBold },
  counters: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: COLORS.borderLight },
  counter: { flex: 1, alignItems: 'center', paddingVertical: 20 },
  counterBorder: { borderLeftWidth: 1, borderLeftColor: COLORS.borderLight },
  counterN: { fontSize: 26, fontFamily: FONTS.extraBold },
  counterL: { fontFamily: FONTS.regular, fontSize: 16 },
  sectHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 24, marginBottom: 14 },
  sectTitle: { fontSize: 24, fontFamily: FONTS.extraBold },
  statcard: { width: 300, borderWidth: 1, borderColor: COLORS.border, borderRadius: 5 },
  statTop: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderBottomWidth: 1, borderBottomColor: COLORS.borderLight },
  statTitle: { fontSize: 16, fontFamily: FONTS.semiBold },
  statVals: { flexDirection: 'row', justifyContent: 'space-around', padding: 16 },
  statV: { fontSize: 27, fontFamily: FONTS.extraBold },
  statL: { fontSize: 12, fontFamily: FONTS.bold, letterSpacing: 0.4 },
  listcard: { height: 155, borderRadius: 8, backgroundColor: '#2e2e38', justifyContent: 'flex-end', padding: 16, overflow: 'hidden' },
  listShade: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.25)' },
  listTitle: { color: '#fff', fontSize: 22, fontFamily: FONTS.extraBold },
  dotsRow: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 12 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#cfcfcf' },
  dotActive: { backgroundColor: COLORS.yellow },
  heartBadge: { width: 28, height: 28, borderRadius: 14, backgroundColor: COLORS.red, alignItems: 'center', justifyContent: 'center' },
});
