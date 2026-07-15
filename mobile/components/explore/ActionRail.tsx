import React from 'react';
import { View, Text, StyleSheet, Pressable, Image } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { tmdbImage } from '@/lib/api';
import { COLORS, FONTS } from '@/lib/theme';
import { PopIn } from '@/components/anim';
import { formatCount } from '@/lib/format';
import type { FeedItem } from './types';

export type RailState = {
  liked: boolean;
  watched: boolean;
  likes: number;
  watchedCount: number;
  comments: number;
};

function RailButton({
  icon,
  active,
  activeColor,
  count,
  onPress,
  label,
  selected,
}: {
  icon: keyof typeof Feather.glyphMap;
  active?: boolean;
  activeColor?: string;
  count?: number;
  onPress: () => void;
  label: string;
  selected?: boolean;
}) {
  const color = active ? activeColor ?? COLORS.yellow : '#fff';
  return (
    <Pressable
      style={styles.btn}
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={selected != null ? { selected } : undefined}
    >
      <PopIn key={String(active)} style={styles.iconWrap}>
        <Feather name={icon} size={30} color={color} />
      </PopIn>
      {count != null ? <Text style={styles.count}>{formatCount(count)}</Text> : null}
    </Pressable>
  );
}

export function ActionRail({
  item,
  state,
  onLike,
  onDislike,
  onWatched,
  onComment,
  onShare,
  onFiche,
}: {
  item: FeedItem;
  state: RailState;
  onLike: () => void;
  onDislike: () => void;
  onWatched: () => void;
  onComment: () => void;
  onShare: () => void;
  onFiche: () => void;
}) {
  const poster = tmdbImage(item.posterPath, 'w185');
  return (
    <View style={styles.rail}>
      <Pressable
        style={styles.posterBtn}
        onPress={onFiche}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel="Voir la fiche"
      >
        {poster ? (
          <Image source={{ uri: poster }} style={styles.poster} resizeMode="cover" />
        ) : (
          <View style={[styles.poster, styles.posterEmpty]}>
            <Feather name="film" size={18} color="#fff" />
          </View>
        )}
      </Pressable>
      <RailButton
        icon="heart"
        active={state.liked}
        activeColor={COLORS.yellow}
        count={state.likes}
        onPress={onLike}
        label={state.liked ? 'Retirer de la liste à voir' : 'Ajouter à la liste à voir'}
        selected={state.liked}
      />
      <RailButton icon="thumbs-down" activeColor={COLORS.red} onPress={onDislike} label="Je n'aime pas" />
      <RailButton
        icon="eye"
        active={state.watched}
        activeColor={COLORS.green}
        count={state.watchedCount}
        onPress={onWatched}
        label={state.watched ? 'Marquer comme non vu' : 'Marquer comme vu'}
        selected={state.watched}
      />
      <RailButton icon="message-circle" count={state.comments} onPress={onComment} label="Commentaires" />
      <RailButton icon="share-2" onPress={onShare} label="Partager" />
    </View>
  );
}

const styles = StyleSheet.create({
  rail: { position: 'absolute', right: 10, bottom: 120, alignItems: 'center', gap: 20 },
  posterBtn: { marginBottom: 4 },
  poster: { width: 46, height: 46, borderRadius: 23, borderWidth: 2, borderColor: '#fff', backgroundColor: '#26262e' },
  posterEmpty: { alignItems: 'center', justifyContent: 'center' },
  btn: { alignItems: 'center', gap: 4 },
  iconWrap: { alignItems: 'center', justifyContent: 'center' },
  count: { color: '#fff', fontFamily: FONTS.bold, fontSize: 12, textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 3 },
});
