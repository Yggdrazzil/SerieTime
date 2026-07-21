import React from 'react';
import { View, Text, StyleSheet, Pressable, Image } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { tmdbImage } from '@/lib/api';
import { COLORS, FONTS, RADIUS, SIZES, SPACE } from '@/lib/theme';
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
      style={({ pressed }) => [styles.btn, pressed && styles.btnPressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={caption}
      accessibilityState={selected != null ? { selected } : undefined}
    >
      <PopIn
        key={String(active)}
        style={[
          styles.iconWrap,
          active && styles.iconWrapActive,
          active && { borderColor: color },
        ]}
      >
        <Feather name={icon} size={24} color={color} />
      </PopIn>
      {count != null && count > 0 ? <Text style={styles.count}>{formatCount(count)}</Text> : null}
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
        style={({ pressed }) => [styles.posterBtn, pressed && styles.btnPressed]}
        onPress={onFiche}
        accessibilityRole="button"
        accessibilityLabel={`Voir la fiche de ${item.title}`}
      >
        {poster ? (
          <Image source={{ uri: poster }} style={styles.poster} resizeMode="cover" accessible={false} />
        ) : (
          <View style={[styles.poster, styles.posterEmpty]} accessible={false}>
            <Feather name="film" size={18} color="#fff" />
          </View>
        )}
        {/* Libellé (comme les autres actions du rail) : signale que la vignette
            ouvre la fiche de l'œuvre (retour Étienne 2026-07-21). */}
        <Text style={styles.caption}>Fiche</Text>
      </Pressable>
      {/* Jeux : le ❤️ pose le statut « Voulu » et la coche « Terminé » (mêmes
          mots que la fiche jeu) — « À voir »/« Déjà vu » n'avaient pas de sens. */}
      <RailButton
        icon="heart"
        active={state.liked}
        activeColor={COLORS.secondary}
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
  rail: {
    position: 'absolute',
    right: SPACE.sm,
    // Au-dessus de la tab bar flottante mini (46 px + encoche) avec une marge.
    bottom: 96,
    alignItems: 'center',
    gap: 2,
  },
  posterBtn: {
    width: 52,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
    marginBottom: 2,
    borderRadius: RADIUS.control,
  },
  poster: {
    width: 50,
    height: 50,
    backgroundColor: '#211B29',
    borderWidth: 2,
    borderColor: COLORS.primary,
    borderRadius: RADIUS.control,
  },
  posterEmpty: { alignItems: 'center', justifyContent: 'center' },
  btn: {
    minWidth: 58,
    minHeight: 58,
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
    borderRadius: RADIUS.control,
  },
  btnPressed: { opacity: 0.64, transform: [{ scale: 0.96 }] },
  iconWrap: {
    width: SIZES.touch,
    height: SIZES.touch,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(7,4,12,0.64)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.28)',
    borderRadius: RADIUS.control,
  },
  iconWrapActive: { backgroundColor: 'rgba(255,255,255,0.15)' },
  count: {
    position: 'absolute',
    top: -1,
    right: 0,
    minWidth: 19,
    minHeight: 19,
    paddingHorizontal: 4,
    overflow: 'hidden',
    color: '#FFFFFF',
    backgroundColor: 'rgba(7,4,12,0.86)',
    borderRadius: RADIUS.pill,
    fontFamily: FONTS.extraBold,
    fontSize: 10,
    lineHeight: 19,
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.7)',
    textShadowRadius: 4,
  },
  caption: {
    maxWidth: 62,
    color: '#FFFFFF',
    fontFamily: FONTS.bold,
    fontSize: 9.5,
    lineHeight: 12,
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.72)',
    textShadowRadius: 4,
  },
});
