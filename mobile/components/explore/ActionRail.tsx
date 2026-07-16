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
  caption,
  selected,
}: {
  icon: keyof typeof Feather.glyphMap;
  active?: boolean;
  activeColor?: string;
  count?: number;
  onPress: () => void;
  label: string;
  caption: string;
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
        <Feather name={icon} size={28} color={color} />
      </PopIn>
      {count != null && count > 0 ? <Text style={styles.count}>{formatCount(count)}</Text> : null}
      {/* Mini-libellé permanent : cœur/œil/pouce n'étaient pas compréhensibles
          sans lui (retour utilisateur). Coloré quand l'action est active. */}
      <Text style={[styles.caption, active ? { color } : null]}>{caption}</Text>
    </Pressable>
  );
}

export function ActionRail({
  item,
  state,
  isGame,
  onLike,
  onDislike,
  onWatched,
  onComment,
  onShare,
  onFiche,
}: {
  item: FeedItem;
  state: RailState;
  isGame?: boolean;
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
      {/* Jeux : le ❤️ pose le statut « Voulu » et la coche « Terminé » (mêmes
          mots que la fiche jeu) — « À voir »/« Déjà vu » n'avaient pas de sens. */}
      <RailButton
        icon="heart"
        active={state.liked}
        activeColor={COLORS.yellow}
        count={state.likes}
        onPress={onLike}
        label={
          isGame
            ? state.liked ? 'Retirer des jeux voulus' : 'Ajouter aux jeux voulus'
            : state.liked ? 'Retirer de la liste à voir' : 'Ajouter à la liste à voir'
        }
        caption={isGame ? 'Voulu' : 'À voir'}
        selected={state.liked}
      />
      <RailButton
        icon={isGame ? 'check-circle' : 'eye'}
        active={state.watched}
        activeColor={COLORS.green}
        count={state.watchedCount}
        onPress={onWatched}
        label={
          isGame
            ? state.watched ? 'Retirer des jeux terminés' : 'Marquer comme terminé'
            : state.watched ? 'Marquer comme non vu' : 'Marquer comme vu'
        }
        caption={isGame ? 'Terminé' : 'Déjà vu'}
        selected={state.watched}
      />
      <RailButton icon="thumbs-down" activeColor={COLORS.red} onPress={onDislike} label="Pas intéressé, passer" caption="Passer" />
      <RailButton icon="message-circle" count={state.comments} onPress={onComment} label="Commentaires" caption="Avis" />
      <RailButton icon="share-2" onPress={onShare} label="Partager" caption="Partager" />
    </View>
  );
}

const styles = StyleSheet.create({
  rail: { position: 'absolute', right: 10, bottom: 96, alignItems: 'center', gap: 16 },
  posterBtn: { marginBottom: 4 },
  poster: { width: 46, height: 46, borderRadius: 23, borderWidth: 2, borderColor: '#fff', backgroundColor: '#26262e' },
  posterEmpty: { alignItems: 'center', justifyContent: 'center' },
  btn: { alignItems: 'center', gap: 4 },
  iconWrap: { alignItems: 'center', justifyContent: 'center' },
  count: { color: '#fff', fontFamily: FONTS.bold, fontSize: 12, textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 3 },
  caption: { color: '#fff', fontFamily: FONTS.semiBold, fontSize: 10, textShadowColor: 'rgba(0,0,0,0.7)', textShadowRadius: 3, marginTop: -2 },
});
