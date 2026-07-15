import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Modal, TextInput, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, FONTS } from '@/lib/theme';
import { EmptyState, Loading } from '@/components/ui';
import { Pop, AppearItem } from '@/components/anim';
import { useComments, SORT_LABEL } from '@/components/comments/useComments';
import { CommentCard } from '@/components/comments/CommentCard';

// Page « Commentaires » (copie TV Time) : ouverte depuis la rangée
// « Commentaires N › » au bas de la fiche. Cartes blanches sur fond gris,
// cœur + réponses + partager, FAB crayon jaune pour publier.
export default function CommentsScreen() {
  const { id, title } = useLocalSearchParams<{ id: string; title?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [composer, setComposer] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const {
    comments,
    total,
    isLoading,
    sort,
    setSort,
    openReplies,
    toggleReplies,
    replyTo,
    setReplyTo,
    replyText,
    setReplyText,
    post,
    postReply,
    heart,
    remove,
    shareComment,
  } = useComments(id, title);

  const submit = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      await post(text);
      setText('');
      setComposer(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Pop style={{ backgroundColor: COLORS.white }}>
      {/* En-tête TV Time : titre + compteur centrés. */}
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.headSide} accessibilityRole="button" accessibilityLabel="Retour">
          <Feather name="chevron-left" size={28} color={COLORS.black} />
        </Pressable>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text style={styles.headTitle} numberOfLines={1}>{title ?? 'Commentaires'}</Text>
          <Text style={styles.headCount}>{total} commentaire{total > 1 ? 's' : ''}</Text>
        </View>
        <View style={styles.headSide} />
      </View>
      <Pressable style={styles.sortRow} onPress={() => setSort(sort === 'pertinents' ? 'recents' : 'pertinents')}>
        <Text style={styles.sortLabel}>TRIER PAR</Text>
        <Text style={styles.sortValue}>{SORT_LABEL[sort]}</Text>
      </Pressable>

      {isLoading ? (
        <Loading />
      ) : comments.length === 0 ? (
        <EmptyState title="Aucun commentaire" message="Soyez le premier à réagir avec le crayon jaune." />
      ) : (
        <ScrollView style={{ backgroundColor: '#f2f2f2' }} contentContainerStyle={{ paddingVertical: 10, paddingBottom: insets.bottom + 110 }}>
          {comments.map((c, i) => (
            <AppearItem key={c.id} index={i}>
              <CommentCard
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
                onOpenUser={(userId) => router.push(`/user/${userId}`)}
              />
            </AppearItem>
          ))}
        </ScrollView>
      )}

      {/* FAB crayon jaune (TV Time) : écrire un commentaire. */}
      <Pressable
        style={[styles.fab, { bottom: insets.bottom + 22 }]}
        onPress={() => setComposer(true)}
        accessibilityRole="button"
        accessibilityLabel="Écrire un commentaire"
      >
        <Feather name="edit-2" size={24} color={COLORS.black} />
      </Pressable>

      <Modal visible={composer} transparent animationType="fade" onRequestClose={() => setComposer(false)}>
        <Pressable style={styles.overlay} onPress={() => setComposer(false)} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 14 }]}>
          <Text style={styles.sheetTitle}>Votre commentaire</Text>
          <TextInput
            style={styles.input}
            placeholder="Partager un avis…"
            placeholderTextColor={COLORS.textMuted}
            value={text}
            onChangeText={setText}
            multiline
            autoFocus
          />
          <Pressable style={[styles.send, (!text.trim() || busy) && { opacity: 0.4 }]} onPress={submit} disabled={!text.trim() || busy}>
            {busy ? <ActivityIndicator color="#000" /> : <Text style={styles.sendText}>PUBLIER</Text>}
          </Pressable>
        </View>
      </Modal>
    </Pop>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingBottom: 8, backgroundColor: COLORS.white },
  headSide: { width: 44 },
  headTitle: { fontSize: 18, fontFamily: FONTS.bold },
  headCount: { fontSize: 13, fontFamily: FONTS.regular, color: COLORS.textMuted, marginTop: 1 },
  sortRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: COLORS.white, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.border },
  sortLabel: { fontSize: 11, fontFamily: FONTS.extraBold, color: COLORS.textMuted, letterSpacing: 0.5 },
  sortValue: { fontSize: 16, fontFamily: FONTS.semiBold, color: COLORS.blue },
  fab: { position: 'absolute', right: 20, width: 62, height: 62, borderRadius: 31, backgroundColor: COLORS.yellow, alignItems: 'center', justifyContent: 'center', elevation: 6, shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.25, shadowRadius: 8 },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: COLORS.overlay },
  sheet: { position: 'absolute', left: 8, right: 8, bottom: 8, backgroundColor: COLORS.white, borderRadius: 14, padding: 16 },
  sheetTitle: { fontSize: 18, fontFamily: FONTS.extraBold, marginBottom: 10 },
  input: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 8, minHeight: 80, padding: 12, fontFamily: FONTS.regular, fontSize: 16, textAlignVertical: 'top' },
  send: { alignSelf: 'flex-end', marginTop: 12, backgroundColor: COLORS.yellow, borderRadius: 999, paddingHorizontal: 22, paddingVertical: 10 },
  sendText: { fontFamily: FONTS.extraBold, fontSize: 13, letterSpacing: 0.4 },
});
