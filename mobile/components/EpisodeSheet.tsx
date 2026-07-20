import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  FlatList,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';
import { useRouter, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, tmdbImage } from '@/lib/api';
import type { EpisodeDto } from '@/lib/types';
import { episodeCode } from '@/lib/format';
import { COLORS, FONTS, RADIUS, SHADOW, SIZES, SPACE, THEME } from '@/lib/theme';
import { CheckCircle } from '@/components/ui';
import { Stars } from '@/components/Stars';
import { MarkPreviousPopup, hasUnwatchedPrevious } from '@/components/MarkPreviousPopup';
import { useReduceMotion } from '@/lib/useReduceMotion';

export type EpisodeSheetTarget = {
  mediaId: string;
  mediaTitle: string;
  posterPath?: string | null;
  episode: EpisodeDto;
};

type SeasonData = { seasonNumber: number; episodes: EpisodeDto[] };
type EpisodesData = { seasons: SeasonData[]; nextEpisode: EpisodeDto | null };

const isAired = (episode: EpisodeDto) =>
  !episode.airDate || new Date(episode.airDate).getTime() <= Date.now();

const dateFr = (iso?: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString('fr-FR', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : null;

export function EpisodeSheet({
  target,
  onClose,
}: {
  target: EpisodeSheetTarget | null;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const reduce = useReduceMotion();
  const { width, height } = useWindowDimensions();
  const sheetWidth = Math.min(width, SIZES.contentMax);
  const [index, setIndex] = useState(0);
  const pagerRef = useRef<FlatList<EpisodeDto>>(null);
  const alignedFor = useRef<string | null>(null);
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!target) return;
    if (reduce) {
      anim.setValue(1);
      return;
    }

    anim.setValue(0);
    Animated.spring(anim, {
      toValue: 1,
      useNativeDriver: Platform.OS !== 'web',
      friction: 10,
      tension: 70,
    }).start();
  }, [anim, reduce, target]);

  const close = () => {
    if (reduce) {
      onClose();
      return;
    }

    Animated.timing(anim, {
      toValue: 0,
      duration: 180,
      useNativeDriver: Platform.OS !== 'web',
    }).start(onClose);
  };

  const episodesQ = useQuery({
    queryKey: ['show', target?.mediaId, 'episodes'],
    queryFn: () =>
      api.get<EpisodesData>('/api/shows/' + target!.mediaId + '/episodes'),
    enabled: !!target,
  });

  const pages = useMemo<EpisodeDto[]>(() => {
    if (!target) return [];

    const seasons = episodesQ.data?.seasons;
    if (!seasons) return [target.episode];

    const sorted = [...seasons].sort((first, second) => {
      const firstSpecial = first.seasonNumber === 0 ? 1 : 0;
      const secondSpecial = second.seasonNumber === 0 ? 1 : 0;
      return firstSpecial - secondSpecial || first.seasonNumber - second.seasonNumber;
    });
    const airedEpisodes = sorted.flatMap((season) =>
      season.episodes.filter(isAired),
    );
    return airedEpisodes.length > 0 ? airedEpisodes : [target.episode];
  }, [episodesQ.data, target]);

  useEffect(() => {
    if (!target) {
      alignedFor.current = null;
      return;
    }

    const alignmentKey = target.episode.id + '-' + pages.length;
    if (alignedFor.current === alignmentKey) return;
    alignedFor.current = alignmentKey;

    const targetIndex = Math.max(
      0,
      pages.findIndex((episode) => episode.id === target.episode.id),
    );
    setIndex(targetIndex);
    requestAnimationFrame(() =>
      pagerRef.current?.scrollToIndex({
        index: targetIndex,
        animated: false,
      }),
    );
  }, [pages, target]);

  useEffect(() => {
    if (!target || pages.length === 0) return;
    const currentIndex = Math.min(index, pages.length - 1);
    requestAnimationFrame(() =>
      pagerRef.current?.scrollToOffset({
        offset: currentIndex * sheetWidth,
        animated: false,
      }),
    );
  }, [sheetWidth]);

  if (!target) return null;

  const safeIndex = Math.min(index, Math.max(0, pages.length - 1));
  const goToPage = (nextIndex: number) => {
    const boundedIndex = Math.min(
      Math.max(0, nextIndex),
      Math.max(0, pages.length - 1),
    );
    setIndex(boundedIndex);
    pagerRef.current?.scrollToIndex({
      index: boundedIndex,
      animated: !reduce,
    });
  };

  return (
    <Modal
      visible
      transparent
      animationType="none"
      onRequestClose={close}
      statusBarTranslucent
    >
      <Animated.View style={[styles.backdrop, { opacity: anim }]}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={close}
          accessibilityRole="button"
          accessibilityLabel="Fermer la fiche épisode"
        />
      </Animated.View>

      <Animated.View
        style={[
          styles.panel,
          {
            width: sheetWidth,
            marginTop: insets.top + SPACE.xs,
            transform: [
              {
                translateY: anim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [height + SPACE.xxl, 0],
                }),
              },
            ],
          },
        ]}
        accessibilityViewIsModal
        onAccessibilityEscape={close}
      >
        <View style={styles.topBar}>
          <Pressable
            onPress={close}
            style={({ pressed }) => [
              styles.closeButton,
              pressed && styles.controlPressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Fermer la fiche épisode"
          >
            <Feather name="chevron-down" size={26} color={COLORS.text} />
          </Pressable>

          <View
            style={styles.dotsWrap}
            pointerEvents="none"
            accessible
            accessibilityLiveRegion="polite"
            accessibilityLabel={
              'Épisode ' + (safeIndex + 1) + ' sur ' + Math.max(1, pages.length)
            }
          >
            <Dots total={pages.length} index={safeIndex} />
            <Text style={styles.pageCount}>
              {safeIndex + 1}/{Math.max(1, pages.length)}
            </Text>
          </View>

          <View style={styles.pagerButtons}>
            <Pressable
              onPress={() => goToPage(safeIndex - 1)}
              disabled={safeIndex <= 0}
              style={({ pressed }) => [
                styles.pagerButton,
                pressed && styles.controlPressed,
                safeIndex <= 0 && styles.pagerButtonDisabled,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Épisode précédent"
              accessibilityState={{ disabled: safeIndex <= 0 }}
            >
              <Feather name="chevron-left" size={21} color={COLORS.text} />
            </Pressable>
            <Pressable
              onPress={() => goToPage(safeIndex + 1)}
              disabled={safeIndex >= pages.length - 1}
              style={({ pressed }) => [
                styles.pagerButton,
                pressed && styles.controlPressed,
                safeIndex >= pages.length - 1 && styles.pagerButtonDisabled,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Épisode suivant"
              accessibilityState={{ disabled: safeIndex >= pages.length - 1 }}
            >
              <Feather name="chevron-right" size={21} color={COLORS.text} />
            </Pressable>
          </View>
        </View>

        {episodesQ.isError ? (
          <Text
            style={styles.pagerWarning}
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
          >
            La navigation complète est indisponible. Cet épisode reste consultable.
          </Text>
        ) : null}

        <FlatList
          ref={pagerRef}
          data={pages}
          horizontal
          pagingEnabled
          snapToInterval={sheetWidth}
          decelerationRate="fast"
          showsHorizontalScrollIndicator={false}
          style={styles.pager}
          keyExtractor={(episode) => episode.id}
          renderItem={({ item: episode }) => (
            <View style={{ width: sheetWidth }}>
              <EpisodePage
                episode={episode}
                mediaId={target.mediaId}
                mediaTitle={target.mediaTitle}
                posterPath={target.posterPath}
                seasons={episodesQ.data?.seasons ?? []}
                seasonsLoading={episodesQ.isLoading && !episodesQ.isError}
                onClose={onClose}
                bottomPad={insets.bottom + SPACE.lg}
              />
            </View>
          )}
          getItemLayout={(_data, itemIndex) => ({
            length: sheetWidth,
            offset: sheetWidth * itemIndex,
            index: itemIndex,
          })}
          initialNumToRender={1}
          maxToRenderPerBatch={2}
          windowSize={3}
          removeClippedSubviews={Platform.OS !== 'web'}
          onMomentumScrollEnd={(event) => {
            const nextIndex = Math.round(
              event.nativeEvent.contentOffset.x / sheetWidth,
            );
            if (
              nextIndex !== index &&
              nextIndex >= 0 &&
              nextIndex < pages.length
            ) {
              setIndex(nextIndex);
            }
          }}
          onScrollToIndexFailed={({ index: failedIndex }) => {
            pagerRef.current?.scrollToOffset({
              offset: failedIndex * sheetWidth,
              animated: false,
            });
          }}
        />
      </Animated.View>
    </Modal>
  );
}

function Dots({ total, index }: { total: number; index: number }) {
  if (total <= 1) return null;

  const visibleDots = Math.min(5, total);
  const start = Math.min(
    Math.max(0, index - 2),
    total - visibleDots,
  );

  return (
    <View style={styles.dotsRow}>
      {Array.from({ length: visibleDots }, (_, dotIndex) => {
        const active = start + dotIndex === index;
        return (
          <View
            key={dotIndex}
            style={[styles.dot, active && styles.dotActive]}
          />
        );
      })}
    </View>
  );
}

function EpisodePage({
  episode,
  mediaId,
  mediaTitle,
  posterPath,
  seasons,
  seasonsLoading,
  onClose,
  bottomPad,
}: {
  episode: EpisodeDto;
  mediaId: string;
  mediaTitle: string;
  posterPath?: string | null;
  seasons: SeasonData[];
  seasonsLoading: boolean;
  onClose: () => void;
  bottomPad: number;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [askPrevious, setAskPrevious] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);

  const detail = useQuery({
    queryKey: ['show', mediaId],
    queryFn: () =>
      api.get<{ providers: { name: string }[] }>('/api/shows/' + mediaId),
    staleTime: 5 * 60_000,
  });

  const ratings = useQuery({
    queryKey: ['community-ratings', mediaId],
    queryFn: () =>
      api.get<{
        seasons: {
          seasonNumber: number;
          points: { episodeNumber: number; avg: number }[];
        }[];
      }>('/api/shows/' + mediaId + '/community-ratings'),
    retry: false,
    staleTime: 5 * 60_000,
  });

  const comments = useQuery({
    queryKey: ['comments', mediaId],
    queryFn: () =>
      api.get<{ comments: { replies?: unknown[] }[] }>(
        '/api/media/' + mediaId + '/comments',
      ),
    staleTime: 60_000,
  });

  const toggle = useMutation({
    mutationFn: (item: EpisodeDto) =>
      api.post(
        '/api/episodes/' +
          item.id +
          '/' +
          (item.watched ? 'unwatched' : 'watched'),
      ),
    onMutate: async (item: EpisodeDto) => {
      setMutationError(null);
      await queryClient.cancelQueries({
        queryKey: ['show', mediaId, 'episodes'],
      });
      const previous = queryClient.getQueryData<EpisodesData>([
        'show',
        mediaId,
        'episodes',
      ]);

      if (previous) {
        queryClient.setQueryData<EpisodesData>(
          ['show', mediaId, 'episodes'],
          {
            ...previous,
            nextEpisode:
              previous.nextEpisode?.id === item.id
                ? { ...previous.nextEpisode, watched: !item.watched }
                : previous.nextEpisode,
            seasons: previous.seasons.map((season) =>
              season.seasonNumber !== item.seasonNumber
                ? season
                : {
                    ...season,
                    episodes: season.episodes.map((candidate) =>
                      candidate.id === item.id
                        ? { ...candidate, watched: !item.watched }
                        : candidate,
                    ),
                  },
            ),
          },
        );
      }

      return { previous };
    },
    onError: (
      _error: unknown,
      _item: EpisodeDto,
      context?: { previous?: EpisodesData },
    ) => {
      if (context?.previous) {
        queryClient.setQueryData(
          ['show', mediaId, 'episodes'],
          context.previous,
        );
      }
      setMutationError(
        "Le statut de l'épisode n'a pas pu être enregistré. Réessaie.",
      );
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['shows'] });
      // ['show', mediaId] couvre la fiche détaillée (statut/progression) ET
      // ['show', mediaId, 'episodes'] (préfixe) — la fiche en cache doit
      // refléter l'épisode coché/décoché depuis la sheet.
      queryClient.invalidateQueries({ queryKey: ['show', mediaId] });
      queryClient.invalidateQueries({ queryKey: ['profile'] });
      queryClient.invalidateQueries({ queryKey: ['gamification'] });
    },
  });

  const markPrevious = useMutation({
    mutationFn: () =>
      api.post('/api/episodes/' + episode.id + '/watched-previous'),
    onMutate: async () => {
      setMutationError(null);
      await queryClient.cancelQueries({
        queryKey: ['show', mediaId, 'episodes'],
      });
      const previous = queryClient.getQueryData<EpisodesData>([
        'show',
        mediaId,
        'episodes',
      ]);

      if (previous) {
        const isBefore = (candidate: EpisodeDto) =>
          candidate.seasonNumber < episode.seasonNumber ||
          (candidate.seasonNumber === episode.seasonNumber &&
            candidate.episodeNumber < episode.episodeNumber);

        queryClient.setQueryData<EpisodesData>(
          ['show', mediaId, 'episodes'],
          {
            ...previous,
            seasons: previous.seasons.map((season) =>
              season.seasonNumber <= 0
                ? season
                : {
                    ...season,
                    episodes: season.episodes.map((candidate) =>
                      !candidate.watched &&
                      isBefore(candidate) &&
                      isAired(candidate)
                        ? { ...candidate, watched: true }
                        : candidate,
                    ),
                  },
            ),
          },
        );
      }

      return { previous };
    },
    onError: (
      _error: unknown,
      _value: void,
      context?: { previous?: EpisodesData },
    ) => {
      if (context?.previous) {
        queryClient.setQueryData(
          ['show', mediaId, 'episodes'],
          context.previous,
        );
      }
      setMutationError(
        "Les épisodes précédents n'ont pas pu être enregistrés. Réessaie.",
      );
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['shows'] });
      // Fiche détaillée + liste d'épisodes (préfixe ['show', mediaId]).
      queryClient.invalidateQueries({ queryKey: ['show', mediaId] });
      queryClient.invalidateQueries({ queryKey: ['profile'] });
      queryClient.invalidateQueries({ queryKey: ['gamification'] });
    },
  });

  const pressCheck = () => {
    if (toggle.isPending || seasonsLoading) return;
    if (
      !episode.watched &&
      hasUnwatchedPrevious(seasons, episode)
    ) {
      setAskPrevious(true);
    }
    toggle.mutate(episode);
  };

  const share = () => {
    const message =
      '« ' +
      mediaTitle +
      ' » ' +
      episodeCode(episode.seasonNumber, episode.episodeNumber) +
      ' — suivi avec PlotTime 📺';

    if (Platform.OS === 'web') {
      const navigatorApi =
        typeof navigator !== 'undefined'
          ? (navigator as Navigator & {
              share?: (data: object) => Promise<void>;
            })
          : undefined;

      if (navigatorApi?.share) {
        navigatorApi.share({ text: message }).catch(() => undefined);
      } else {
        navigatorApi?.clipboard?.writeText(message).catch(() => undefined);
      }
      return;
    }

    Share.share({ message }).catch(() => undefined);
  };

  const openShow = () => {
    onClose();
    router.push(('/show/' + mediaId) as Href);
  };

  const hero =
    tmdbImage(episode.stillPath, 'w780') ??
    tmdbImage(posterPath, 'w500');
  const providers = detail.data?.providers ?? [];
  const average = ratings.data?.seasons
    .find((season) => season.seasonNumber === episode.seasonNumber)
    ?.points.find(
      (point) => point.episodeNumber === episode.episodeNumber,
    )?.avg;
  const commentsTotal = comments.data
    ? comments.data.comments.reduce(
        (total, comment) =>
          total + 1 + (comment.replies?.length ?? 0),
        0,
      )
    : null;

  return (
    <ScrollView
      style={styles.episodeScroll}
      contentContainerStyle={[
        styles.episodeContent,
        { paddingBottom: bottomPad },
      ]}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.heroCard}>
        <View style={styles.hero}>
          {hero ? (
            <Image
              source={{ uri: hero }}
              style={StyleSheet.absoluteFill}
              resizeMode="cover"
              accessible
              accessibilityLabel={
                "Image de l'épisode " +
                episodeCode(
                  episode.seasonNumber,
                  episode.episodeNumber,
                )
              }
            />
          ) : (
            <View style={[StyleSheet.absoluteFill, styles.heroEmpty]}>
              <Feather
                name="image"
                size={34}
                color={COLORS.textSoft}
              />
            </View>
          )}

          <View style={styles.heroShade} />

          <View style={styles.heroTop}>
            <Pressable
              style={({ pressed }) => [
                styles.seriesPill,
                pressed && styles.heroControlPressed,
              ]}
              onPress={openShow}
              accessibilityRole="button"
              accessibilityLabel={'Ouvrir la fiche de ' + mediaTitle}
            >
              <Text style={styles.seriesPillText} numberOfLines={1}>
                {mediaTitle}
              </Text>
              <Feather
                name="chevron-right"
                size={15}
                color="#FFFFFF"
              />
            </Pressable>

            <Pressable
              onPress={share}
              style={({ pressed }) => [
                styles.shareButton,
                pressed && styles.heroControlPressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Partager cet épisode"
            >
              <Feather name="share-2" size={20} color="#FFFFFF" />
            </Pressable>
          </View>

          <View style={styles.heroCaption}>
            <Text style={styles.heroCode}>
              {episodeCode(
                episode.seasonNumber,
                episode.episodeNumber,
              )}
            </Text>
            {episode.title ? (
              <Text style={styles.heroEpisodeTitle} numberOfLines={2}>
                {episode.title}
              </Text>
            ) : null}
          </View>
        </View>

        <View style={styles.metaRow}>
          <View style={styles.metaCopy}>
            {episode.airDate ? (
              <View style={styles.metaItem}>
                <Feather
                  name="calendar"
                  size={16}
                  color={COLORS.primary}
                />
                <Text style={styles.metaText}>
                  {dateFr(episode.airDate)}
                </Text>
              </View>
            ) : null}

            <View style={styles.metaItem}>
              <Ionicons
                name={episode.watched ? 'eye' : 'eye-outline'}
                size={18}
                color={
                  episode.watched
                    ? COLORS.success
                    : COLORS.textMuted
                }
              />
              <Text style={styles.metaText}>
                {episode.watched ? 'Vu' : 'Pas vu'}
              </Text>
            </View>
          </View>

          <CheckCircle
            size={44}
            checked={episode.watched}
            onPress={toggle.isPending || seasonsLoading ? undefined : pressCheck}
          />
        </View>

        {mutationError ? (
          <Text
            style={styles.mutationError}
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
          >
            {mutationError}
          </Text>
        ) : null}
      </View>

      <View style={styles.sectionCard}>
        <SectionHeader
          icon="play-circle"
          eyebrow="DISPONIBILITÉ"
          title="Où regarder"
        />

        {providers.length === 0 ? (
          <View style={styles.emptyLine}>
            <Feather
              name={detail.isError ? 'wifi-off' : 'info'}
              size={18}
              color={COLORS.textMuted}
            />
            <Text style={styles.muted}>
              {detail.isLoading
                ? 'Chargement des plateformes…'
                : detail.isError
                  ? 'Plateformes indisponibles pour le moment.'
                  : 'Aucune plateforme renseignée.'}
            </Text>
          </View>
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.providers}
          >
            {providers.map((provider) => (
              <View
                key={provider.name}
                style={styles.providerChip}
                accessible
                accessibilityLabel={'Disponible sur ' + provider.name}
              >
                <Ionicons
                  name="play-circle-outline"
                  size={18}
                  color={COLORS.onPrimary}
                />
                <Text style={styles.providerText}>
                  {provider.name}
                </Text>
              </View>
            ))}
          </ScrollView>
        )}
      </View>

      {typeof average === 'number' || episode.overview ? (
        <View style={styles.sectionCard}>
          <SectionHeader
            icon="info"
            eyebrow="ÉPISODE"
            title="À propos"
          />
          {typeof average === 'number' ? (
            <View style={styles.ratingRow}>
              <Stars rating10={average * 2} size={17} />
              <Text style={styles.ratingLabel}>Note de la communauté</Text>
            </View>
          ) : null}
          {episode.overview ? (
            <Text style={styles.overview} selectable>
              {episode.overview}
            </Text>
          ) : null}
        </View>
      ) : null}

      <Pressable
        style={({ pressed }) => [
          styles.commentsCard,
          pressed && styles.cardPressed,
        ]}
        onPress={() => {
          onClose();
          router.push((
            '/comments/' +
              mediaId +
              '?title=' +
              encodeURIComponent(mediaTitle) +
              '&type=show'
          ) as Href);
        }}
        accessibilityRole="button"
        accessibilityLabel={
          commentsTotal === null
            ? 'Ouvrir les commentaires'
            : 'Ouvrir les commentaires, ' +
              commentsTotal +
              ' contribution' +
              (commentsTotal > 1 ? 's' : '')
        }
      >
        <View style={styles.commentsIcon} accessible={false}>
          <Feather
            name="message-circle"
            size={20}
            color={COLORS.secondary}
          />
        </View>
        <View style={styles.commentsCopy}>
          <Text style={styles.commentsEyebrow}>COMMUNAUTÉ</Text>
          <Text style={styles.commentsTitle}>Commentaires</Text>
        </View>
        <View style={styles.commentsAction}>
          <Text style={styles.commentsCount}>
            {comments.isLoading
              ? '…'
              : comments.isError
                ? '—'
                : commentsTotal}
          </Text>
          <Feather
            name="chevron-right"
            size={20}
            color={COLORS.textMuted}
          />
        </View>
      </Pressable>

      <MarkPreviousPopup
        visible={askPrevious}
        onYes={() => {
          setAskPrevious(false);
          markPrevious.mutate();
        }}
        onNo={() => setAskPrevious(false)}
      />
    </ScrollView>
  );
}

function SectionHeader({
  icon,
  eyebrow,
  title,
}: {
  icon: React.ComponentProps<typeof Feather>['name'];
  eyebrow: string;
  title: string;
}) {
  return (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionIcon} accessible={false}>
        <Feather name={icon} size={19} color={COLORS.primary} />
      </View>
      <View style={styles.sectionHeaderCopy}>
        <Text style={styles.sectionEyebrow}>{eyebrow}</Text>
        <Text style={styles.sectionTitle} accessibilityRole="header">
          {title}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: COLORS.overlay,
  },
  panel: {
    flex: 1,
    alignSelf: 'center',
    overflow: 'hidden',
    borderTopLeftRadius: RADIUS.sheet,
    borderTopRightRadius: RADIUS.sheet,
    // Glass : fond quasi opaque (COLORS.sheet) — la feuille flotte au-dessus de
    // la file, un fond-voile la rendait illisible. Autres thèmes : inchangés.
    backgroundColor: THEME === 'glass' ? COLORS.sheet : COLORS.bg,
    ...SHADOW.card,
  },
  topBar: {
    minHeight: SIZES.header,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACE.sm,
    backgroundColor: COLORS.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.borderLight,
  },
  closeButton: {
    width: SIZES.touch,
    height: SIZES.touch,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: RADIUS.control,
  },
  pagerButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.xxs,
  },
  pagerButton: {
    width: SIZES.touch,
    height: SIZES.touch,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: RADIUS.control,
    backgroundColor: COLORS.surfaceMuted,
  },
  pagerButtonDisabled: {
    opacity: 0.36,
  },
  dotsWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACE.xxs,
  },
  dotsRow: {
    flexDirection: 'row',
    gap: SPACE.xs,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: COLORS.chipSelected,
  },
  dotActive: {
    width: 19,
    backgroundColor: COLORS.primary,
  },
  pageCount: {
    color: COLORS.textMuted,
    fontSize: 10,
    lineHeight: 13,
    fontFamily: FONTS.bold,
  },
  pagerWarning: {
    paddingHorizontal: SPACE.md,
    paddingVertical: SPACE.xs,
    color: COLORS.warning,
    fontSize: 12,
    lineHeight: 17,
    fontFamily: FONTS.semiBold,
    textAlign: 'center',
    backgroundColor: COLORS.surfaceMuted,
  },
  pager: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  pagePlaceholder: {
    flex: 1,
    padding: SPACE.md,
    gap: SPACE.sm,
    backgroundColor: COLORS.bg,
  },
  pagePlaceholderPoster: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: RADIUS.card,
    backgroundColor: COLORS.imagePlaceholder,
  },
  pagePlaceholderLine: {
    width: '72%',
    height: 18,
    borderRadius: RADIUS.small,
    backgroundColor: COLORS.imagePlaceholder,
  },
  pagePlaceholderLineShort: {
    width: '44%',
    height: 14,
    borderRadius: RADIUS.small,
    backgroundColor: COLORS.imagePlaceholder,
  },
  episodeScroll: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  episodeContent: {
    padding: SPACE.md,
    gap: SPACE.sm,
  },
  heroCard: {
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: RADIUS.card,
    backgroundColor: COLORS.surface,
    ...SHADOW.card,
  },
  hero: {
    aspectRatio: 16 / 9,
    justifyContent: 'flex-end',
    overflow: 'hidden',
    backgroundColor: COLORS.imagePlaceholder,
  },
  heroEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.imagePlaceholder,
  },
  heroShade: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(12, 8, 28, 0.34)',
  },
  heroTop: {
    position: 'absolute',
    top: SPACE.sm,
    left: SPACE.sm,
    right: SPACE.sm,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: SPACE.sm,
  },
  seriesPill: {
    minHeight: SIZES.touch,
    maxWidth: '78%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.xxs,
    paddingHorizontal: SPACE.sm,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.75)',
    borderRadius: RADIUS.pill,
    backgroundColor: 'rgba(20,13,39,0.72)',
  },
  seriesPillText: {
    flexShrink: 1,
    color: '#FFFFFF',
    fontSize: 12,
    lineHeight: 16,
    fontFamily: FONTS.extraBold,
  },
  shareButton: {
    width: SIZES.touch,
    height: SIZES.touch,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: RADIUS.pill,
    backgroundColor: 'rgba(20,13,39,0.72)',
  },
  heroControlPressed: {
    opacity: 0.78,
    transform: [{ scale: 0.98 }],
  },
  heroCaption: {
    padding: SPACE.md,
  },
  heroCode: {
    color: '#FFFFFF',
    fontSize: 24,
    lineHeight: 29,
    fontFamily: FONTS.extraBold,
  },
  heroEpisodeTitle: {
    marginTop: 2,
    color: 'rgba(255,255,255,0.94)',
    fontSize: 14,
    lineHeight: 19,
    fontFamily: FONTS.medium,
  },
  metaRow: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.md,
    paddingHorizontal: SPACE.md,
    paddingVertical: SPACE.sm,
  },
  metaCopy: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: SPACE.md,
  },
  metaItem: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.xs,
  },
  metaText: {
    color: COLORS.text,
    fontSize: 14,
    lineHeight: 19,
    fontFamily: FONTS.semiBold,
  },
  mutationError: {
    marginHorizontal: SPACE.md,
    marginBottom: SPACE.md,
    padding: SPACE.sm,
    color: COLORS.danger,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: FONTS.semiBold,
    borderRadius: RADIUS.control,
    backgroundColor: COLORS.surfaceMuted,
  },
  sectionCard: {
    padding: SPACE.md,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: RADIUS.card,
    backgroundColor: COLORS.surface,
    ...SHADOW.card,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.sm,
  },
  sectionIcon: {
    width: 40,
    height: 40,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: RADIUS.control,
    backgroundColor: COLORS.primarySoft,
  },
  sectionHeaderCopy: {
    flex: 1,
  },
  sectionEyebrow: {
    color: COLORS.primary,
    fontSize: 10,
    lineHeight: 14,
    fontFamily: FONTS.extraBold,
    letterSpacing: 1,
  },
  sectionTitle: {
    color: COLORS.text,
    fontSize: 18,
    lineHeight: 23,
    fontFamily: FONTS.extraBold,
  },
  emptyLine: {
    minHeight: SIZES.touch,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.xs,
    marginTop: SPACE.sm,
  },
  muted: {
    flex: 1,
    color: COLORS.textMuted,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: FONTS.regular,
  },
  providers: {
    gap: SPACE.xs,
    paddingTop: SPACE.md,
    paddingRight: SPACE.sm,
  },
  providerChip: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.xs,
    paddingHorizontal: SPACE.md,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.primary,
  },
  providerText: {
    color: COLORS.onPrimary,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: FONTS.extraBold,
  },
  ratingRow: {
    alignItems: 'flex-start',
    gap: SPACE.xxs,
    marginTop: SPACE.md,
  },
  ratingLabel: {
    color: COLORS.textMuted,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: FONTS.medium,
  },
  overview: {
    marginTop: SPACE.md,
    color: COLORS.text,
    fontSize: 14,
    lineHeight: 22,
    fontFamily: FONTS.regular,
  },
  commentsCard: {
    minHeight: 80,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.sm,
    padding: SPACE.md,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: RADIUS.card,
    backgroundColor: COLORS.surface,
    ...SHADOW.card,
  },
  commentsIcon: {
    width: SIZES.touch,
    height: SIZES.touch,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: RADIUS.control,
    backgroundColor: COLORS.primarySoft,
  },
  commentsCopy: {
    flex: 1,
  },
  commentsEyebrow: {
    color: COLORS.secondary,
    fontSize: 10,
    lineHeight: 14,
    fontFamily: FONTS.extraBold,
    letterSpacing: 1,
  },
  commentsTitle: {
    color: COLORS.text,
    fontSize: 17,
    lineHeight: 22,
    fontFamily: FONTS.extraBold,
  },
  commentsAction: {
    minWidth: SIZES.touch,
    minHeight: SIZES.touch,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: SPACE.xxs,
  },
  commentsCount: {
    color: COLORS.textMuted,
    fontSize: 14,
    lineHeight: 19,
    fontFamily: FONTS.bold,
  },
  controlPressed: {
    opacity: 0.72,
  },
  cardPressed: {
    opacity: 0.82,
    transform: [{ scale: 0.995 }],
  },
});
