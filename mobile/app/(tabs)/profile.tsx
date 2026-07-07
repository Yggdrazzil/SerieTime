import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Image } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { api, tmdbImage } from '@/lib/api';
import type { MediaDto, ProfileStatsDto } from '@/lib/types';
import { watchTime } from '@/lib/format';
import { COLORS } from '@/lib/theme';
import { Loading, Poster } from '@/components/ui';

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
  const { data, isLoading } = useQuery({
    queryKey: ['profile'],
    queryFn: () => api.get<ProfileResponse>('/api/profile'),
  });
  const { data: unreadData } = useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: () => api.get<{ unreadCount: number }>('/api/notifications/unread-count'),
    refetchInterval: 30_000,
  });
  const unread = unreadData?.unreadCount ?? 0;

  if (isLoading || !data) return <Loading />;
  const { user, stats } = data;
  const st = watchTime(stats.showMinutes);

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
        <Pressable style={[styles.friends, { top: insets.top + 8 }]} onPress={() => router.push('/social')}>
          <Feather name="users" size={22} color="#fff" />
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

      <View style={styles.counters}>
        <Counter n={stats.showsCount} label="Séries" />
        <Counter n={stats.moviesCount} label="Films" border />
        <Counter n={stats.ratingsCount} label={stats.ratingsCount > 1 ? 'Notes' : 'Note'} border />
      </View>

      <Section title="Statistiques">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 24, gap: 12 }}>
          <StatCard icon="tv" title="Temps passé devant des séries" values={[[st.months, 'MOIS'], [st.days, 'JOURS'], [st.hours, 'HEURES']]} />
          <StatCard icon="tv" title="Épisodes vus" values={[[stats.episodesWatched, 'ÉPISODES']]} />
          <StatCard icon="film" title="Films regardés" values={[[stats.moviesWatched, 'FILMS']]} />
        </ScrollView>
      </Section>

      {data.lists.length > 0 ? (
        <Section title="Listes">
          <View style={styles.listcard}>
            <Text style={styles.listTitle}>{data.lists[0].title}</Text>
          </View>
        </Section>
      ) : null}

      <PosterRow title="Séries" items={data.shows} emptyLabel="Aucune série suivie" />
      <PosterRow title="Séries préférées" items={data.favoriteShows} heart emptyLabel="Aucune série en favori" />
      <PosterRow title="Films" items={data.movies} isMovie emptyLabel="Aucun film ajouté" />
      <PosterRow title="Films préférés" items={data.favoriteMovies} isMovie heart emptyLabel="Aucun film en favori" />
    </ScrollView>
  );
}

function Counter({ n, label, border }: { n: number; label: string; border?: boolean }) {
  return (
    <View style={[styles.counter, border && styles.counterBorder]}>
      <Text style={styles.counterN}>{n}</Text>
      <Text style={styles.counterL}>{label}</Text>
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
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={styles.sectTitle}>{title}</Text>
          {heart ? <Feather name="heart" size={20} color={COLORS.red} /> : null}
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
  friends: { position: 'absolute', right: 56, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: 2, right: 2, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: COLORS.red, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  dots: { position: 'absolute', right: 12, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 16, padding: 20 },
  avatar: { width: 82, height: 82, borderRadius: 41, borderWidth: 2, borderColor: '#fff', backgroundColor: '#555' },
  avatarEmpty: { alignItems: 'center', justifyContent: 'center' },
  avatarInit: { color: '#fff', fontSize: 34, fontWeight: '800' },
  emptyRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 24 },
  emptyPoster: { width: 70, aspectRatio: 2 / 3, borderRadius: 4, backgroundColor: '#eee', alignItems: 'center', justifyContent: 'center' },
  emptyRowText: { color: COLORS.textMuted, fontSize: 15 },
  name: { color: '#fff', fontSize: 28, fontWeight: '800' },
  modif: { marginTop: 6, borderWidth: 2, borderColor: '#fff', borderRadius: 999, paddingHorizontal: 18, paddingVertical: 5, alignSelf: 'flex-start' },
  modifText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  counters: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: COLORS.borderLight },
  counter: { flex: 1, alignItems: 'center', paddingVertical: 20 },
  counterBorder: { borderLeftWidth: 1, borderLeftColor: COLORS.borderLight },
  counterN: { fontSize: 26, fontWeight: '800' },
  counterL: { fontSize: 16 },
  sectHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 24, marginBottom: 14 },
  sectTitle: { fontSize: 24, fontWeight: '800' },
  statcard: { width: 300, borderWidth: 1, borderColor: COLORS.border, borderRadius: 5 },
  statTop: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderBottomWidth: 1, borderBottomColor: COLORS.borderLight },
  statTitle: { fontSize: 16, fontWeight: '600' },
  statVals: { flexDirection: 'row', justifyContent: 'space-around', padding: 16 },
  statV: { fontSize: 27, fontWeight: '800' },
  statL: { fontSize: 12, fontWeight: '700', letterSpacing: 0.4 },
  listcard: { marginHorizontal: 24, height: 155, borderRadius: 5, backgroundColor: '#2e2e38', justifyContent: 'flex-end', padding: 16 },
  listTitle: { color: '#fff', fontSize: 22, fontWeight: '800' },
});
