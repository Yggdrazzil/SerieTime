import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, TextInput, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { COLORS, FONTS } from '@/lib/theme';
import { EmptyState, Loading } from '@/components/ui';

export type CommentDto = {
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

const REACT_EMOJIS = ['❤️', '👍', '😂', '😮', '😢'];

// Discussion sociale : commentaires, fils de réponses et réactions multi-emoji.
export function CommentsTab({ mediaId }: { mediaId: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const { data, isLoading } = useQuery({
    queryKey: ['comments', mediaId],
    queryFn: () => api.get<{ comments: CommentDto[] }>(`/api/media/${mediaId}/comments`),
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['comments', mediaId] });

  const post = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      await api.post(`/api/media/${mediaId}/comments`, { body: text.trim() });
      setText('');
      invalidate();
    } finally {
      setBusy(false);
    }
  };
  const postReply = async (parentId: string) => {
    if (!replyText.trim()) return;
    await api.post(`/api/media/${mediaId}/comments`, { body: replyText.trim(), parentId });
    setReplyText('');
    setReplyTo(null);
    invalidate();
  };
  const react = async (c: CommentDto, emoji: string) => {
    await api.post(`/api/comments/${c.id}/react`, { emoji });
    invalidate();
  };
  const remove = async (c: CommentDto) => {
    await api.del(`/api/comments/${c.id}`);
    invalidate();
  };

  const renderComment = (c: CommentDto, isReply = false) => (
    <View key={c.id} style={[cstyles.row, isReply && cstyles.replyRow]}>
      <Pressable style={cstyles.avatar} onPress={() => router.push(`/user/${c.user.id}`)}>
        <Text style={cstyles.avatarInit}>{c.user.displayName.slice(0, 1).toUpperCase()}</Text>
      </Pressable>
      <View style={{ flex: 1 }}>
        <Text style={cstyles.name}>{c.user.displayName}</Text>
        <Text style={cstyles.body}>{c.body}</Text>
        <View style={cstyles.reactBar}>
          {REACT_EMOJIS.map((e) => {
            const count = c.reactions.byEmoji[e] ?? 0;
            const mine = c.reactions.mine.includes(e);
            return (
              <Pressable key={e} style={[cstyles.chip, mine && cstyles.chipActive]} onPress={() => react(c, e)}>
                <Text style={cstyles.chipText}>
                  {e}
                  {count > 0 ? ` ${count}` : ''}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <View style={cstyles.actions}>
          {!isReply ? (
            <Pressable onPress={() => { setReplyTo(replyTo === c.id ? null : c.id); setReplyText(''); }} hitSlop={8}>
              <Text style={cstyles.action}>Répondre</Text>
            </Pressable>
          ) : null}
          {c.isMine ? (
            <Pressable onPress={() => remove(c)} hitSlop={8}>
              <Text style={cstyles.action}>Supprimer</Text>
            </Pressable>
          ) : null}
        </View>
        {replyTo === c.id ? (
          <View style={cstyles.replyComposer}>
            <TextInput
              style={cstyles.replyInput}
              placeholder="Votre réponse…"
              placeholderTextColor={COLORS.textMuted}
              value={replyText}
              onChangeText={setReplyText}
            />
            <Pressable style={[cstyles.replySend, !replyText.trim() && { opacity: 0.4 }]} onPress={() => postReply(c.id)} disabled={!replyText.trim()}>
              <Text style={cstyles.sendText}>OK</Text>
            </Pressable>
          </View>
        ) : null}
        {c.replies?.map((r) => renderComment(r, true))}
      </View>
    </View>
  );

  return (
    <View style={cstyles.wrap}>
      <View style={cstyles.composer}>
        <TextInput
          style={cstyles.input}
          placeholder="Partager un avis…"
          placeholderTextColor={COLORS.textMuted}
          value={text}
          onChangeText={setText}
          multiline
        />
        <Pressable
          style={[cstyles.send, (!text.trim() || busy) && { opacity: 0.4 }]}
          onPress={post}
          disabled={!text.trim() || busy}
        >
          {busy ? <ActivityIndicator color="#000" /> : <Text style={cstyles.sendText}>PUBLIER</Text>}
        </Pressable>
      </View>
      {isLoading ? (
        <Loading />
      ) : (data?.comments.length ?? 0) === 0 ? (
        <EmptyState title="Aucun commentaire" message="Soyez le premier à réagir." />
      ) : (
        data!.comments.map((c) => renderComment(c))
      )}
    </View>
  );
}

const cstyles = StyleSheet.create({
  wrap: { padding: 20 },
  composer: { marginBottom: 20 },
  input: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 8, minHeight: 60, padding: 12, fontFamily: FONTS.regular, fontSize: 16, textAlignVertical: 'top' },
  send: { alignSelf: 'flex-end', marginTop: 10, backgroundColor: COLORS.yellow, borderRadius: 999, paddingHorizontal: 22, paddingVertical: 10 },
  sendText: { fontFamily: FONTS.extraBold, fontSize: 13, letterSpacing: 0.4 },
  row: { flexDirection: 'row', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: COLORS.borderLight },
  replyRow: { borderBottomWidth: 0, paddingVertical: 8, marginLeft: 8, borderLeftWidth: 2, borderLeftColor: COLORS.borderLight, paddingLeft: 12 },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#20202a', alignItems: 'center', justifyContent: 'center' },
  avatarInit: { color: '#fff', fontSize: 16, fontFamily: FONTS.extraBold },
  name: { fontSize: 15, fontFamily: FONTS.extraBold },
  body: { fontFamily: FONTS.regular, fontSize: 16, lineHeight: 22, marginTop: 3 },
  reactBar: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  chip: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  chipActive: { borderColor: COLORS.yellow, backgroundColor: COLORS.yellowSoft },
  chipText: { fontFamily: FONTS.regular, fontSize: 14 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 20, marginTop: 8 },
  action: { fontSize: 14, color: COLORS.textMuted, fontFamily: FONTS.semiBold },
  replyComposer: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  replyInput: { flex: 1, borderWidth: 1, borderColor: COLORS.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontFamily: FONTS.regular, fontSize: 15 },
  replySend: { backgroundColor: COLORS.yellow, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 9 },
});
