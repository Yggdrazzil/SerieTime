import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator, ScrollView, Modal } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, FONTS } from '@/lib/theme';
import { CommentsTab } from '@/components/comments';
import type { FeedItem } from './types';

export function CommentsSheet({
  item,
  onClose,
  resolveMedia,
}: {
  item: FeedItem | null;
  onClose: () => void;
  resolveMedia: (item: FeedItem) => Promise<string>;
}) {
  const insets = useSafeAreaInsets();
  const [mediaId, setMediaId] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!item) return;
    let cancelled = false;
    setMediaId(item.id ?? null);
    setError(false);
    if (!item.id) {
      resolveMedia(item)
        .then((id) => !cancelled && setMediaId(id))
        .catch(() => !cancelled && setError(true));
    }
    return () => {
      cancelled = true;
    };
  }, [item, resolveMedia]);

  return (
    <Modal visible={!!item} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom }]}>
        <View style={styles.head}>
          <Text style={styles.title}>Commentaires</Text>
          <Pressable onPress={onClose} hitSlop={10}>
            <Feather name="x" size={24} color={COLORS.black} />
          </Pressable>
        </View>
        {error ? (
          <View style={styles.center}>
            <Text style={styles.err}>Impossible de charger les commentaires.</Text>
          </View>
        ) : mediaId ? (
          <ScrollView keyboardShouldPersistTaps="handled">
            <CommentsTab mediaId={mediaId} />
          </ScrollView>
        ) : (
          <View style={styles.center}>
            <ActivityIndicator color={COLORS.black} />
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '78%',
    backgroundColor: COLORS.white,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.borderLight,
  },
  title: { fontFamily: FONTS.extraBold, fontSize: 18, color: COLORS.black },
  center: { padding: 40, alignItems: 'center' },
  err: { fontFamily: FONTS.regular, fontSize: 15, color: COLORS.textMuted },
});
