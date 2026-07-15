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

export const dateFr = (iso: string) =>
  new Date(iso).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
