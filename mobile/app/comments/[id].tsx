import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  FlatList,
  StyleSheet,
  Pressable,
  Modal,
  TextInput,
  ActivityIndicator,
  RefreshControl,
  KeyboardAvoidingView,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { goBack } from '@/lib/nav';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, FONTS, RADIUS, SHADOW, SIZES, SPACE } from '@/lib/theme';
import { EmptyState, LoadError } from '@/components/ui';
import { Pop, AppearItem, Skeleton } from '@/components/anim';
import { useReduceMotion } from '@/lib/useReduceMotion';
import { useOpenUserPreview } from '@/lib/userPreview';
import { useComments, SORT_LABEL } from '@/components/comments/useComments';
import { CommentCard } from '@/components/comments/CommentCard';
import { BlockedCommentPopup } from '@/components/comments/BlockedCommentPopup';

function CommentsSkeleton() {
  return (
    <ScrollView
      contentContainerStyle={styles.listContent}
      showsVerticalScrollIndicator={false}
      accessibilityLabel="Chargement des commentaires"
    >
      {[0, 1, 2].map((item) => (
        <View key={item} style={styles.skeletonCard}>
          <View style={styles.skeletonHead}>
            <Skeleton style={styles.skeletonAvatar} />
            <View style={styles.skeletonCopy}>
              <Skeleton style={styles.skeletonName} />
              <Skeleton style={styles.skeletonDate} />
            </View>
          </View>
          <Skeleton style={styles.skeletonLine} />
          <Skeleton style={[styles.skeletonLine, styles.skeletonLineShort]} />
          <View style={styles.skeletonActions}>
            <Skeleton style={styles.skeletonAction} />
            <Skeleton style={styles.skeletonAction} />
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

// Types de média connus : conditionnent le lien « Voir la fiche » de l'en-tête.
type MediaKind = 'show' | 'movie' | 'game';
function parseMediaKind(value?: string): MediaKind | null {
  return value === 'show' || value === 'movie' || value === 'game' ? value : null;
}

export default function CommentsScreen() {
  const { id, title, type } = useLocalSearchParams<{ id: string; title?: string; type?: string }>();
  const router = useRouter();
  const openUserPreview = useOpenUserPreview();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const reduce = useReduceMotion();
  const [composer, setComposer] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const {
    comments,
    total,
    isLoading,
    isError,
    hasData,
    refetch,
    isRefetching,
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
    clearPostError,
    heart,
    remove,
    shareComment,
  } = useComments(id, title);

  const submit = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      const ok = await post(text);
      if (ok) {
        setText('');
        setComposer(false);
      }
    } finally {
      setBusy(false);
    }
  };

  const refreshControl = (
    <RefreshControl
      refreshing={isRefetching}
      onRefresh={() => void refetch()}
      tintColor={COLORS.primary}
      colors={[COLORS.primary]}
    />
  );
  const fabRight = Math.max(SPACE.md, (width - SIZES.contentMax) / 2 + SPACE.md);
  const closeComposer = () => {
    if (!busy) setComposer(false);
  };

  // Retour vers la fiche du média (retour Étienne) : seulement quand l'appelant
  // a transmis le type — sans lui, on ne sait pas quelle fiche ouvrir.
  const mediaKind = parseMediaKind(type);
  const ficheHref: Href | null = mediaKind
    ? ((mediaKind === 'game'
        ? '/game/' + id
        : '/show/' + id + (mediaKind === 'movie' ? '?type=movie' : '')) as Href)
    : null;

  const headerCopy = (
    <>
      <Text style={styles.headEyebrow}>DISCUSSION</Text>
      <View style={styles.headTitleRow}>
        <Text accessibilityRole="header" style={styles.headTitle} numberOfLines={1}>{title ?? 'Commentaires'}</Text>
        {ficheHref ? (
          <Feather name="chevron-right" size={17} color={COLORS.textMuted} accessible={false} />
        ) : null}
      </View>
      <Text style={styles.headCount}>
        {total} commentaire{total !== 1 ? 's' : ''}
        {ficheHref ? ' · Voir la fiche' : ''}
      </Text>
    </>
  );

  return (
    <Pop style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + SPACE.xs }]}>
        <View style={styles.headerInner}>
          <Pressable
            onPress={() => goBack('/')}
            style={({ pressed }) => [styles.headSide, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Retour"
          >
            <Feather name="chevron-left" size={26} color={COLORS.text} />
          </Pressable>
          {ficheHref ? (
            <Pressable
              style={({ pressed }) => [styles.headerCopy, pressed && styles.pressed]}
              onPress={() => router.push(ficheHref)}
              accessibilityRole="button"
              accessibilityLabel={'Ouvrir la fiche de ' + (title ?? 'ce média')}
              accessibilityHint="Quitte la discussion pour la fiche du média"
            >
              {headerCopy}
            </Pressable>
          ) : (
            <View style={styles.headerCopy}>{headerCopy}</View>
          )}
          <View style={styles.headSide} />
        </View>
      </View>

      <View style={styles.toolbar}>
        <Pressable
          style={({ pressed }) => [styles.sortRow, pressed && styles.pressed]}
          onPress={() => setSort(sort === 'pertinents' ? 'recents' : 'pertinents')}
          accessibilityRole="button"
          accessibilityLabel={`Trier les commentaires. Tri actuel : ${SORT_LABEL[sort]}`}
          accessibilityHint="Bascule entre les commentaires les plus pertinents et les plus récents"
        >
          <View style={styles.sortIcon} accessible={false}>
            <Feather name="sliders" size={17} color={COLORS.primary} />
          </View>
          <View style={styles.sortCopy}>
            <Text style={styles.sortLabel}>TRIER PAR</Text>
            <Text style={styles.sortValue}>{SORT_LABEL[sort]}</Text>
          </View>
          <Feather name="repeat" size={17} color={COLORS.textMuted} />
        </Pressable>
      </View>

      <View style={styles.content}>
        {isLoading && !hasData ? (
          <CommentsSkeleton />
        ) : isError && !hasData ? (
          <ScrollView
            contentContainerStyle={styles.stateContent}
            refreshControl={refreshControl}
            showsVerticalScrollIndicator={false}
          >
            <LoadError onRetry={() => void refetch()} busy={isRefetching} />
          </ScrollView>
        ) : comments.length === 0 ? (
          <ScrollView
            contentContainerStyle={styles.stateContent}
            refreshControl={refreshControl}
            showsVerticalScrollIndicator={false}
          >
            <EmptyState title="Aucun commentaire" message="Soyez le premier à lancer la discussion." />
          </ScrollView>
        ) : (
          <FlatList
            style={styles.list}
            data={comments}
            keyExtractor={(comment) => comment.id}
            renderItem={({ item: comment, index }) => (
              <AppearItem index={index}>
                <CommentCard
                  comment={comment}
                  onHeart={heart}
                  onRemove={remove}
                  onShare={shareComment}
                  replyOpen={!!openReplies[comment.id]}
                  onToggleReplies={() => {
                    const willOpen = !openReplies[comment.id];
                    toggleReplies(comment.id);
                    setReplyTo(willOpen ? comment.id : null);
                    setReplyText('');
                    if (postError) clearPostError();
                  }}
                  isReplying={replyTo === comment.id}
                  replyText={replyText}
                  setReplyText={(value) => {
                    setReplyText(value);
                    if (postError) clearPostError();
                  }}
                  onPostReply={() => postReply(comment.id)}
                  onOpenUser={(userId) => openUserPreview(userId)}
                />
              </AppearItem>
            )}
            contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 112 }]}
            refreshControl={refreshControl}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            initialNumToRender={6}
            maxToRenderPerBatch={6}
            windowSize={7}
          />
        )}
      </View>

      <Pressable
        style={({ pressed }) => [
          styles.fab,
          { right: fabRight, bottom: insets.bottom + SPACE.lg },
          pressed && styles.fabPressed,
        ]}
        onPress={() => {
          clearPostError();
          setComposer(true);
        }}
        accessibilityRole="button"
        accessibilityLabel="Écrire un commentaire"
      >
        <Feather name="edit-3" size={22} color={COLORS.onPrimary} />
      </Pressable>

      <Modal
        visible={composer}
        transparent
        animationType={reduce ? 'none' : 'fade'}
        onRequestClose={closeComposer}
      >
        <Pressable
          style={styles.overlay}
          onPress={closeComposer}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="Fermer la rédaction"
        />
        <KeyboardAvoidingView
          style={styles.sheetWrap}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          pointerEvents="box-none"
        >
          <View
            style={[styles.sheet, { paddingBottom: insets.bottom + SPACE.md }]}
            accessibilityViewIsModal
            onAccessibilityEscape={closeComposer}
          >
            <View style={styles.sheetHandle} accessible={false} />
            <View style={styles.sheetHead}>
              <View style={styles.sheetHeading}>
                <Text accessibilityRole="header" style={styles.sheetTitle}>Votre commentaire</Text>
                <Text style={styles.sheetSubtitle}>Partagez votre avis avec la communauté.</Text>
              </View>
              <Pressable
                style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
                onPress={closeComposer}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel="Fermer"
                accessibilityState={{ disabled: busy }}
              >
                <Feather name="x" size={21} color={COLORS.text} />
              </Pressable>
            </View>
            <TextInput
              style={styles.input}
              placeholder="Partager un avis…"
              placeholderTextColor={COLORS.textMuted}
              value={text}
              onChangeText={(value) => {
                setText(value);
                if (postError) clearPostError();
              }}
              multiline
              maxLength={2000}
              autoFocus
              accessibilityLabel="Votre commentaire"
            />
            <View style={styles.sheetFooter}>
              <Text style={styles.characterCount}>{text.length}/2000</Text>
              <Pressable
                style={({ pressed }) => [
                  styles.send,
                  (!text.trim() || busy) && styles.disabled,
                  pressed && styles.pressed,
                ]}
                onPress={() => void submit()}
                disabled={!text.trim() || busy}
                accessibilityRole="button"
                accessibilityLabel="Publier le commentaire"
                accessibilityState={{ disabled: !text.trim() || busy, busy }}
              >
                {busy ? (
                  <ActivityIndicator size="small" color={COLORS.onPrimary} />
                ) : (
                  <>
                    <Text style={styles.sendText}>PUBLIER</Text>
                    <Feather name="send" size={16} color={COLORS.onPrimary} />
                  </>
                )}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <BlockedCommentPopup message={postError} onClose={clearPostError} />
    </Pop>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: COLORS.pageMuted },
  header: {
    backgroundColor: COLORS.surface,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderLight,
  },
  headerInner: {
    width: '100%',
    maxWidth: SIZES.contentMax,
    minHeight: 76,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACE.sm,
    paddingBottom: SPACE.sm,
  },
  headSide: {
    width: SIZES.touch,
    height: SIZES.touch,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: RADIUS.control,
  },
  headerCopy: { flex: 1, minWidth: 0, alignItems: 'center', paddingHorizontal: SPACE.xs },
  headTitleRow: { maxWidth: '100%', flexDirection: 'row', alignItems: 'center', gap: 2 },
  headEyebrow: {
    color: COLORS.primary,
    fontSize: 10.5,
    lineHeight: 14,
    fontFamily: FONTS.extraBold,
    letterSpacing: 1.1,
  },
  headTitle: { flexShrink: 1, color: COLORS.text, fontSize: 19, lineHeight: 24, fontFamily: FONTS.extraBold },
  headCount: { marginTop: 1, color: COLORS.textMuted, fontSize: 12.5, lineHeight: 17, fontFamily: FONTS.regular },
  toolbar: {
    backgroundColor: COLORS.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.borderLight,
  },
  sortRow: {
    width: '100%',
    maxWidth: SIZES.contentMax,
    minHeight: 60,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.sm,
    paddingHorizontal: SPACE.md,
    paddingVertical: SPACE.xs,
  },
  sortIcon: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primarySoft,
    borderRadius: RADIUS.control,
  },
  sortCopy: { flex: 1, minWidth: 0 },
  sortLabel: { color: COLORS.textMuted, fontSize: 10.5, lineHeight: 14, fontFamily: FONTS.extraBold, letterSpacing: 0.7 },
  sortValue: { color: COLORS.primary, fontSize: 15, lineHeight: 20, fontFamily: FONTS.bold },
  content: { flex: 1, backgroundColor: COLORS.pageMuted },
  list: { flex: 1 },
  listContent: { paddingTop: SPACE.sm },
  stateContent: {
    minHeight: 360,
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACE.lg,
    paddingBottom: 96,
  },
  skeletonCard: {
    width: '94%',
    maxWidth: SIZES.contentMax,
    alignSelf: 'center',
    marginVertical: SPACE.xs,
    padding: SPACE.md,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: RADIUS.card,
  },
  skeletonHead: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm },
  skeletonAvatar: { width: 44, height: 44, borderRadius: 22 },
  skeletonCopy: { flex: 1, gap: SPACE.xs },
  skeletonName: { width: '38%', height: 15 },
  skeletonDate: { width: '25%', height: 11 },
  skeletonLine: { height: 14, marginTop: SPACE.md },
  skeletonLineShort: { width: '68%', marginTop: SPACE.xs },
  skeletonActions: { flexDirection: 'row', gap: SPACE.xs, marginTop: SPACE.md },
  skeletonAction: { width: 58, height: 44, borderRadius: RADIUS.control },
  fab: {
    position: 'absolute',
    width: 58,
    height: 58,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary,
    borderWidth: 1,
    borderColor: COLORS.primarySoft,
    borderRadius: 29,
    ...SHADOW.season,
  },
  fabPressed: { opacity: 0.82, transform: [{ scale: 0.95 }] },
  pressed: { opacity: 0.72 },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: COLORS.overlay },
  sheetWrap: { flex: 1, justifyContent: 'flex-end', paddingHorizontal: SPACE.xs, paddingBottom: SPACE.xs },
  sheet: {
    width: '100%',
    maxWidth: SIZES.contentMax,
    alignSelf: 'center',
    paddingHorizontal: SPACE.md,
    paddingTop: SPACE.xs,
    backgroundColor: COLORS.sheet,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: RADIUS.sheet,
    ...SHADOW.season,
  },
  sheetHandle: {
    width: 42,
    height: 4,
    alignSelf: 'center',
    marginBottom: SPACE.sm,
    backgroundColor: COLORS.border,
    borderRadius: RADIUS.pill,
  },
  sheetHead: { flexDirection: 'row', alignItems: 'flex-start', gap: SPACE.sm, marginBottom: SPACE.md },
  sheetHeading: { flex: 1, minWidth: 0 },
  sheetTitle: { color: COLORS.text, fontSize: 20, lineHeight: 26, fontFamily: FONTS.extraBold },
  sheetSubtitle: { marginTop: 2, color: COLORS.textMuted, fontSize: 13.5, lineHeight: 19, fontFamily: FONTS.regular },
  closeButton: {
    width: SIZES.touch,
    height: SIZES.touch,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.surfaceMuted,
    borderRadius: RADIUS.control,
  },
  input: {
    minHeight: 112,
    maxHeight: 220,
    paddingHorizontal: SPACE.sm,
    paddingVertical: SPACE.sm,
    color: COLORS.text,
    backgroundColor: COLORS.surfaceMuted,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.control,
    fontFamily: FONTS.regular,
    fontSize: 16,
    lineHeight: 23,
    textAlignVertical: 'top',
  },
  sheetFooter: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACE.sm,
    marginTop: SPACE.sm,
  },
  characterCount: { color: COLORS.textSoft, fontFamily: FONTS.regular, fontSize: 12 },
  send: {
    minWidth: 132,
    minHeight: SIZES.touchComfortable,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACE.xs,
    paddingHorizontal: SPACE.lg,
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.pill,
  },
  sendText: { color: COLORS.onPrimary, fontFamily: FONTS.extraBold, fontSize: 13, letterSpacing: 0.5 },
  disabled: { opacity: 0.4 },
});
