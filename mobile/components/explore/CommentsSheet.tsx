import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator, ScrollView, TextInput, Modal } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, FONTS } from '@/lib/theme';
import { EmptyState, Loading } from '@/components/ui';
import { useComments } from '@/components/comments/useComments';
import { CommentCard } from '@/components/comments/CommentCard';
import { BlockedCommentPopup } from '@/components/comments/BlockedCommentPopup';
import { useBackClose } from '@/lib/useBackClose';
import type { FeedItem } from './types';

export function CommentsSheet({
  item,
  onClose,
  resolveMedia,
  onCommentPosted,
}: {
  item: FeedItem | null;
  onClose: () => void;
  resolveMedia: (item: FeedItem) => Promise<string>;
  // Appelé après publication réussie d'un commentaire (fait +1 le compteur du rail).
  onCommentPosted?: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [mediaId, setMediaId] = useState<string | null>(null);
  const [error, setError] = useState(false);
  // Le « retour » ferme la feuille de commentaires au lieu de quitter l'Explorer.
  useBackClose(!!item, onClose);

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
          <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Fermer">
            <Feather name="x" size={24} color={COLORS.black} />
          </Pressable>
        </View>
        {error ? (
          <View style={styles.center}>
            <Text style={styles.err}>Impossible de charger les commentaires.</Text>
          </View>
        ) : mediaId ? (
          <CommentsPanel mediaId={mediaId} title={item?.title} onClose={onClose} onCommentPosted={onCommentPosted} />
        ) : (
          <View style={styles.center}>
            <ActivityIndicator color={COLORS.black} />
          </View>
        )}
      </View>
    </Modal>
  );
}

// Panneau interne : monté uniquement une fois le mediaId connu, pour que
// useComments (React Query) soit toujours appelé avec un id réel.
function CommentsPanel({
  mediaId,
  title,
  onClose,
  onCommentPosted,
}: {
  mediaId: string;
  title?: string;
  onClose: () => void;
  onCommentPosted?: () => void;
}) {
  const router = useRouter();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const {
    comments,
    isLoading,
    openReplies,
    toggleReplies,
    replyTo,
    setReplyTo,
    replyText,
    setReplyText,
    post,
    postReply,
    postError,
    clearPostError,
    heart,
    remove,
    shareComment,
  } = useComments(mediaId, title);

  const submit = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      const ok = await post(text);
      if (ok) {
        setText('');
        onCommentPosted?.();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      {isLoading ? (
        <Loading />
      ) : comments.length === 0 ? (
        <EmptyState title="Aucun commentaire" message="Soyez le premier à réagir." />
      ) : (
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingVertical: 10 }}>
          {comments.map((c) => (
            <CommentCard
              key={c.id}
              comment={c}
              onHeart={heart}
              onRemove={remove}
              onShare={shareComment}
              replyOpen={!!openReplies[c.id]}
              onToggleReplies={() => { toggleReplies(c.id); setReplyTo(c.id); setReplyText(''); }}
              isReplying={replyTo === c.id}
              replyText={replyText}
              setReplyText={setReplyText}
              onPostReply={() => postReply(c.id)}
              onOpenUser={(userId) => { onClose(); router.push(`/user/${userId}`); }}
            />
          ))}
        </ScrollView>
      )}
      {/* Popup de modération : commentaire/réponse rejeté (règles communauté). */}
      <BlockedCommentPopup message={postError} onClose={clearPostError} />
      {/* Barre de composition TikTok : en bas, inline (pas de FAB flottant ici). */}
      <View style={styles.composer}>
        <TextInput
          style={styles.composerInput}
          placeholder="Ajouter un commentaire…"
          placeholderTextColor={COLORS.textMuted}
          value={text}
          onChangeText={(t) => { setText(t); if (postError) clearPostError(); }}
        />
        <Pressable
          style={[styles.composerSend, (!text.trim() || busy) && { opacity: 0.4 }]}
          onPress={submit}
          disabled={!text.trim() || busy}
          accessibilityRole="button"
          accessibilityLabel="Envoyer"
        >
          {busy ? <ActivityIndicator color={COLORS.onAccent} /> : <Feather name="send" size={18} color={COLORS.onAccent} />}
        </Pressable>
      </View>
    </View>
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
    minHeight: '55%',
    backgroundColor: COLORS.sheet,
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
  composer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.borderLight,
  },
  composerInput: { color: COLORS.text,
    flex: 1,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 9,
    fontFamily: FONTS.regular,
    fontSize: 15,
  },
  composerSend: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: COLORS.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
