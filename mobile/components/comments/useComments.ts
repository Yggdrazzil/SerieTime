import { useMemo, useState } from 'react';
import { Platform, Share } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import type { CommentDto } from './types';

const BLOCKED_FALLBACK = 'Ce commentaire enfreint les règles de la communauté et ne peut pas être publié.';

// Traduit une erreur de publication en message affichable, ou la relaie.
// Renvoie le message de modération (serveur) quand le commentaire est bloqué.
function moderationMessage(e: unknown): string | null {
  if (e instanceof ApiError && e.code === 'comment_blocked') return e.serverMessage || BLOCKED_FALLBACK;
  return null;
}

export type SortKey = 'pertinents' | 'recents';
export const SORT_LABEL: Record<SortKey, string> = { pertinents: 'Les plus pertinents', recents: 'Les plus récents' };

// Logique partagée « Commentaires » (TV Time) : requête, tri, réponses,
// cœur ❤️ optimiste, suppression optimiste, partage. Consommée par la page
// plein écran (mobile/app/comments/[id].tsx) et par le bottom sheet TikTok
// (mobile/components/explore/CommentsSheet.tsx) — même clé de requête
// `['comments', mediaId]` pour partager le cache (et les compteurs de
// CommentsRowLink).
export function useComments(mediaId: string, title?: string) {
  const qc = useQueryClient();
  const [sort, setSort] = useState<SortKey>('pertinents');
  const [openReplies, setOpenReplies] = useState<Record<string, boolean>>({});
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  // Message d'erreur de publication (modération) partagé par le commentaire et
  // les réponses (même route serveur). null = pas d'erreur.
  const [postError, setPostError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['comments', mediaId],
    queryFn: () => api.get<{ comments: CommentDto[] }>(`/api/media/${mediaId}/comments`),
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['comments', mediaId] });

  const comments = useMemo(() => {
    const list = [...(data?.comments ?? [])];
    if (sort === 'pertinents') list.sort((a, b) => b.reactions.total - a.reactions.total || b.createdAt.localeCompare(a.createdAt));
    else list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return list;
  }, [data, sort]);
  const total = (data?.comments ?? []).reduce((n, c) => n + 1 + (c.replies?.length ?? 0), 0);

  const toggleReplies = (id: string) => setOpenReplies((o) => ({ ...o, [id]: !o[id] }));

  // Publie un commentaire. Renvoie true si publié, false si rejeté par la
  // modération (message dans `postError`). Les autres erreurs sont relancées.
  const post = async (body: string): Promise<boolean> => {
    if (!body.trim()) return false;
    setPostError(null);
    try {
      await api.post(`/api/media/${mediaId}/comments`, { body: body.trim() });
      invalidate();
      return true;
    } catch (e) {
      const msg = moderationMessage(e);
      if (msg) {
        setPostError(msg);
        return false;
      }
      throw e;
    }
  };
  const postReply = async (parentId: string): Promise<boolean> => {
    if (!replyText.trim()) return false;
    setPostError(null);
    try {
      await api.post(`/api/media/${mediaId}/comments`, { body: replyText.trim(), parentId });
      setReplyText('');
      setReplyTo(null);
      setOpenReplies((o) => ({ ...o, [parentId]: true }));
      invalidate();
      return true;
    } catch (e) {
      const msg = moderationMessage(e);
      if (msg) {
        setPostError(msg);
        return false;
      }
      throw e;
    }
  };
  // Cœur TV Time : bascule OPTIMISTE de la réaction ❤️ — le cœur se remplit au
  // doigt, le serveur confirme derrière (rollback si échec).
  const heart = async (c: CommentDto) => {
    const mine = c.reactions.mine.includes('❤️');
    await qc.cancelQueries({ queryKey: ['comments', mediaId] });
    const prev = qc.getQueryData<{ comments: CommentDto[] }>(['comments', mediaId]);
    const patch = (x: CommentDto): CommentDto =>
      x.id === c.id
        ? {
            ...x,
            reactions: {
              ...x.reactions,
              total: Math.max(0, x.reactions.total + (mine ? -1 : 1)),
              mine: mine ? x.reactions.mine.filter((e) => e !== '❤️') : [...x.reactions.mine, '❤️'],
              byEmoji: { ...x.reactions.byEmoji, '❤️': Math.max(0, (x.reactions.byEmoji['❤️'] ?? 0) + (mine ? -1 : 1)) },
            },
          }
        : { ...x, replies: x.replies?.map(patch) };
    qc.setQueryData<{ comments: CommentDto[] }>(['comments', mediaId], (d) => (d ? { comments: d.comments.map(patch) } : d));
    try {
      await api.post(`/api/comments/${c.id}/react`, { emoji: '❤️' });
      invalidate();
    } catch {
      if (prev) qc.setQueryData(['comments', mediaId], prev);
    }
  };
  // Suppression OPTIMISTE : la carte disparaît immédiatement.
  const remove = async (c: CommentDto) => {
    await qc.cancelQueries({ queryKey: ['comments', mediaId] });
    const prev = qc.getQueryData<{ comments: CommentDto[] }>(['comments', mediaId]);
    qc.setQueryData<{ comments: CommentDto[] }>(['comments', mediaId], (d) =>
      d
        ? {
            comments: d.comments
              .filter((x) => x.id !== c.id)
              .map((x) => ({ ...x, replies: x.replies?.filter((r) => r.id !== c.id) })),
          }
        : d,
    );
    try {
      await api.del(`/api/comments/${c.id}`);
      invalidate();
    } catch {
      if (prev) qc.setQueryData(['comments', mediaId], prev);
    }
  };
  const shareComment = (c: CommentDto) => {
    const message = `« ${c.body} » — ${c.user.displayName} à propos de ${title ?? 'cette série'} (PlotTime)`;
    if (Platform.OS === 'web') {
      const nav = typeof navigator !== 'undefined' ? (navigator as Navigator & { share?: (d: object) => Promise<void> }) : undefined;
      if (nav?.share) nav.share({ text: message }).catch(() => undefined);
      else nav?.clipboard?.writeText(message).catch(() => undefined);
      return;
    }
    Share.share({ message }).catch(() => undefined);
  };

  return {
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
    postError,
    clearPostError: () => setPostError(null),
    heart,
    remove,
    shareComment,
  };
}
