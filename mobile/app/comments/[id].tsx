import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Modal, TextInput, ActivityIndicator, Share, Platform } from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { COLORS, FONTS } from '@/lib/theme';
import { EmptyState, Loading } from '@/components/ui';
import { Pop, PopIn, AppearItem } from '@/components/anim';

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

type SortKey = 'pertinents' | 'recents';
const SORT_LABEL: Record<SortKey, string> = { pertinents: 'Les plus pertinents', recents: 'Les plus récents' };

const dateFr = (iso: string) =>
  new Date(iso).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

// Page « Commentaires » (copie TV Time) : ouverte depuis la rangée
// « Commentaires N › » au bas de la fiche. Cartes blanches sur fond gris,
// cœur + réponses + partager, FAB crayon jaune pour publier.
export default function CommentsScreen() {
  const { id, title } = useLocalSearchParams<{ id: string; title?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [sort, setSort] = useState<SortKey>('pertinents');
  const [composer, setComposer] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [openReplies, setOpenReplies] = useState<Record<string, boolean>>({});
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['comments', id],
    queryFn: () => api.get<{ comments: CommentDto[] }>(`/api/media/${id}/comments`),
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['comments', id] });

  const comments = useMemo(() => {
    const list = [...(data?.comments ?? [])];
    if (sort === 'pertinents') list.sort((a, b) => b.reactions.total - a.reactions.total || b.createdAt.localeCompare(a.createdAt));
    else list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return list;
  }, [data, sort]);
  const total = (data?.comments ?? []).reduce((n, c) => n + 1 + (c.replies?.length ?? 0), 0);

  const post = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      await api.post(`/api/media/${id}/comments`, { body: text.trim() });
      setText('');
      setComposer(false);
      invalidate();
    } finally {
      setBusy(false);
    }
  };
  const postReply = async (parentId: string) => {
    if (!replyText.trim()) return;
    await api.post(`/api/media/${id}/comments`, { body: replyText.trim(), parentId });
    setReplyText('');
    setReplyTo(null);
    setOpenReplies((o) => ({ ...o, [parentId]: true }));
    invalidate();
  };
  // Cœur TV Time : bascule la réaction ❤️ (le total agrège toutes les réactions).
  const heart = async (c: CommentDto) => {
    await api.post(`/api/comments/${c.id}/react`, { emoji: '❤️' });
    invalidate();
  };
  const remove = async (c: CommentDto) => {
    await api.del(`/api/comments/${c.id}`);
    invalidate();
  };
  const shareComment = (c: CommentDto) => {
    const message = `« ${c.body} » — ${c.user.displayName} à propos de ${title ?? 'cette série'} (SerieTime)`;
    if (Platform.OS === 'web') {
      const nav = typeof navigator !== 'undefined' ? (navigator as Navigator & { share?: (d: object) => Promise<void> }) : undefined;
      if (nav?.share) nav.share({ text: message }).catch(() => undefined);
      else nav?.clipboard?.writeText(message).catch(() => undefined);
      return;
    }
    Share.share({ message }).catch(() => undefined);
  };

  const card = (c: CommentDto) => (
    <View key={c.id} style={styles.card}>
      <View style={styles.cardHead}>
        <Pressable style={styles.avatar} onPress={() => router.push(`/user/${c.user.id}`)}>
          <Text style={styles.avatarInit}>{c.user.displayName.slice(0, 1).toUpperCase()}</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>{c.user.displayName}</Text>
          <Text style={styles.date}>{dateFr(c.createdAt)}</Text>
        </View>
        {c.isMine ? (
          <Pressable onPress={() => remove(c)} hitSlop={8}>
            <Feather name="trash-2" size={18} color={COLORS.textMuted} />
          </Pressable>
        ) : null}
      </View>
      <Text style={styles.body}>{c.body}</Text>
      <View style={styles.footer}>
        <Pressable style={styles.footBtn} onPress={() => heart(c)} hitSlop={8}>
          {c.reactions.mine.includes('❤️') ? (
            <PopIn><Ionicons name="heart" size={22} color={COLORS.red} /></PopIn>
          ) : (
            <Ionicons name="heart-outline" size={22} color={COLORS.black} />
          )}
          {c.reactions.total > 0 ? <Text style={styles.footCount}>{c.reactions.total}</Text> : null}
        </Pressable>
        <Pressable
          style={styles.footBtn}
          onPress={() => { setOpenReplies((o) => ({ ...o, [c.id]: !o[c.id] })); setReplyTo(c.id); setReplyText(''); }}
          hitSlop={8}
        >
          <Feather name="message-circle" size={21} color={COLORS.black} />
          {(c.replies?.length ?? 0) > 0 ? <Text style={styles.footCount}>{c.replies!.length}</Text> : null}
        </Pressable>
        <View style={{ flex: 1 }} />
        <Pressable onPress={() => shareComment(c)} hitSlop={8}>
          <Feather name="share" size={20} color={COLORS.black} />
        </Pressable>
      </View>
      {openReplies[c.id] ? (
        <View style={styles.replies}>
          {c.replies?.map((r) => (
            <View key={r.id} style={styles.replyRow}>
              <View style={[styles.avatar, { width: 32, height: 32, borderRadius: 16 }]}>
                <Text style={[styles.avatarInit, { fontSize: 13 }]}>{r.user.displayName.slice(0, 1).toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.replyName}>{r.user.displayName} <Text style={styles.date}>· {dateFr(r.createdAt)}</Text></Text>
                <Text style={styles.replyBody}>{r.body}</Text>
              </View>
              {r.isMine ? (
                <Pressable onPress={() => remove(r)} hitSlop={8}>
                  <Feather name="trash-2" size={15} color={COLORS.textMuted} />
                </Pressable>
              ) : null}
            </View>
          ))}
          {replyTo === c.id ? (
            <View style={styles.replyComposer}>
              <TextInput
                style={styles.replyInput}
                placeholder="Votre réponse…"
                placeholderTextColor={COLORS.textMuted}
                value={replyText}
                onChangeText={setReplyText}
              />
              <Pressable style={[styles.replySend, !replyText.trim() && { opacity: 0.4 }]} onPress={() => postReply(c.id)} disabled={!replyText.trim()}>
                <Text style={styles.sendText}>OK</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );

  return (
    <Pop style={{ backgroundColor: COLORS.white }}>
      {/* En-tête TV Time : titre + compteur centrés. */}
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.headSide}>
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
            <AppearItem key={c.id} index={i}>{card(c)}</AppearItem>
          ))}
        </ScrollView>
      )}

      {/* FAB crayon jaune (TV Time) : écrire un commentaire. */}
      <Pressable style={[styles.fab, { bottom: insets.bottom + 22 }]} onPress={() => setComposer(true)}>
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
          <Pressable style={[styles.send, (!text.trim() || busy) && { opacity: 0.4 }]} onPress={post} disabled={!text.trim() || busy}>
            {busy ? <ActivityIndicator color="#000" /> : <Text style={styles.sendText}>PUBLIER</Text>}
          </Pressable>
        </View>
      </Modal>
    </Pop>
  );
}

// Cotes TV Time (capture commentaires Naruto) : cartes blanches radius 12 sur
// fond gris, avatar 44, nom 16, date 14 grise, corps 16/22, icônes 20-22.
const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingBottom: 8, backgroundColor: COLORS.white },
  headSide: { width: 44 },
  headTitle: { fontSize: 18, fontFamily: FONTS.bold },
  headCount: { fontSize: 13, fontFamily: FONTS.regular, color: COLORS.textMuted, marginTop: 1 },
  sortRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: COLORS.white, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.border },
  sortLabel: { fontSize: 11, fontFamily: FONTS.extraBold, color: COLORS.textMuted, letterSpacing: 0.5 },
  sortValue: { fontSize: 16, fontFamily: FONTS.semiBold, color: COLORS.blue },
  card: { backgroundColor: COLORS.white, borderRadius: 12, marginHorizontal: 12, marginVertical: 6, padding: 16 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#20202a', alignItems: 'center', justifyContent: 'center' },
  avatarInit: { color: '#fff', fontSize: 17, fontFamily: FONTS.extraBold },
  name: { fontSize: 16, fontFamily: FONTS.bold },
  date: { fontSize: 13, fontFamily: FONTS.regular, color: COLORS.textMuted, marginTop: 1 },
  body: { fontFamily: FONTS.regular, fontSize: 16, lineHeight: 22, marginTop: 12 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 26, marginTop: 14 },
  footBtn: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  footCount: { fontSize: 14, fontFamily: FONTS.semiBold },
  replies: { marginTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.borderLight, paddingTop: 10, gap: 10 },
  replyRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  replyName: { fontSize: 14, fontFamily: FONTS.bold },
  replyBody: { fontFamily: FONTS.regular, fontSize: 15, lineHeight: 20, marginTop: 2 },
  replyComposer: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  replyInput: { flex: 1, borderWidth: 1, borderColor: COLORS.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontFamily: FONTS.regular, fontSize: 15 },
  replySend: { backgroundColor: COLORS.yellow, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 9 },
  fab: { position: 'absolute', right: 20, width: 62, height: 62, borderRadius: 31, backgroundColor: COLORS.yellow, alignItems: 'center', justifyContent: 'center', elevation: 6, shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.25, shadowRadius: 8 },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: COLORS.overlay },
  sheet: { position: 'absolute', left: 8, right: 8, bottom: 8, backgroundColor: COLORS.white, borderRadius: 14, padding: 16 },
  sheetTitle: { fontSize: 18, fontFamily: FONTS.extraBold, marginBottom: 10 },
  input: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 8, minHeight: 80, padding: 12, fontFamily: FONTS.regular, fontSize: 16, textAlignVertical: 'top' },
  send: { alignSelf: 'flex-end', marginTop: 12, backgroundColor: COLORS.yellow, borderRadius: 999, paddingHorizontal: 22, paddingVertical: 10 },
  sendText: { fontFamily: FONTS.extraBold, fontSize: 13, letterSpacing: 0.4 },
});
