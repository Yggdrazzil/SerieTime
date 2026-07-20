import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Platform } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { COLORS, FONTS, RADIUS, SIZES, SPACE } from '@/lib/theme';
import { goBack } from '@/lib/nav';
import { ScreenShell, ScreenHeader, PrismeCard, ProgressBar, IconAction } from '@/components/prisme';
import { api, ApiError } from '@/lib/api';

// Résumé renvoyé par /analyze (sous-ensemble utile côté écran).
type Summary = {
  showsDetected: number;
  moviesDetected: number;
  episodesWatchedDetected: number;
  favoritesDetected: number;
  autoImport: number;
  toVerify: number;
  unresolved: number;
  duplicatesIgnored: number;
  progress?: { phase: 'apply' | 'artwork' | 'sync' | 'done'; done: number; total: number };
};

type Step = 'idle' | 'uploading' | 'analyzing' | 'analyzed' | 'importing' | 'done';

const PHASE_LABEL: Record<string, string> = {
  apply: 'Étape 1/3 · Séries, films, progression et favoris…',
  artwork: 'Étape 2/3 · Récupération des affiches…',
  sync: 'Étape 3/3 · Épisodes et dates de diffusion (remplit « À voir »)…',
  done: 'Terminé',
};

export default function ImportScreen() {
  const [step, setStep] = useState<Step>('idle');
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [importId, setImportId] = useState<string | null>(null);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (poll.current) clearInterval(poll.current); }, []);

  const fail = (e: unknown) => {
    const code = e instanceof ApiError ? e.code : String(e);
    const msg =
      code === 'not_a_zip' ? "Ce fichier n'est pas un .zip valide."
      : code === 'file_too_large' ? 'Fichier trop volumineux.'
      : code === 'no_server' ? 'Serveur non configuré.'
      : "Une erreur est survenue. Réessaie.";
    setError(msg);
    setStep((s) => (s === 'importing' ? 'importing' : 'idle'));
  };

  // Sélection du fichier : sur web, on ouvre le sélecteur natif du navigateur.
  const pickFile = () => {
    setError(null);
    if (Platform.OS !== 'web' || typeof document === 'undefined') {
      setError('Pour l’instant, l’import se fait depuis la web app (navigateur).');
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.zip,application/zip,application/x-zip-compressed';
    input.onchange = () => {
      const f = input.files?.[0];
      if (f) void handleFile(f);
    };
    input.click();
  };

  const handleFile = async (file: Blob & { name?: string }) => {
    setSummary(null);
    setStep('uploading');
    try {
      let up: { importId: string };
      try {
        up = await api.upload<{ importId: string }>('/api/import/tvtime/upload', file, file.name ?? 'tvtime-export.zip');
      } catch (e) {
        // Déjà importé : on relance en forçant (réimport propre).
        if (e instanceof ApiError && e.code === 'already_imported') {
          up = await api.upload<{ importId: string }>('/api/import/tvtime/upload?force=true', file, file.name ?? 'tvtime-export.zip');
        } else throw e;
      }
      setImportId(up.importId);
      setStep('analyzing');
      const res = await api.post<{ summary: Summary }>(`/api/import/tvtime/${up.importId}/analyze`);
      setSummary(res.summary);
      setStep('analyzed');
    } catch (e) {
      fail(e);
    }
  };

  // Suit la progression d'un import en tâche de fond (réutilisé par le lancement
  // ET par la reprise quand on rouvre l'écran).
  const startPolling = (id: string) => {
    if (poll.current) clearInterval(poll.current);
    poll.current = setInterval(async () => {
      try {
        const s = await api.get<{ status: string; summary: Summary | null }>(`/api/import/tvtime/${id}`);
        if (s.summary) setSummary(s.summary);
        if (s.status === 'imported' || s.status === 'failed') {
          if (poll.current) clearInterval(poll.current);
          setStep(s.status === 'imported' ? 'done' : 'idle');
          if (s.status === 'failed') setError("L'import a échoué. Réessaie.");
        }
      } catch {
        /* on retentera au prochain tick */
      }
    }, 1500);
  };

  const startImport = async () => {
    if (!importId) return;
    setError(null);
    setStep('importing');
    try {
      await api.post(`/api/import/tvtime/${importId}/confirm`);
      startPolling(importId);
    } catch (e) {
      fail(e);
    }
  };

  // Reprise : si un import est déjà en cours (ou analysé en attente), on le
  // retrouve au lieu de repartir de l'écran de départ quand on rouvre la page.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { imports } = await api.get<{ imports: { importId: string; status: string }[] }>('/api/import/tvtime');
        const latest = imports?.[0];
        if (!latest || cancelled) return;
        if (latest.status === 'importing' || latest.status === 'analyzed') {
          const d = await api.get<{ summary: Summary | null }>(`/api/import/tvtime/${latest.importId}`);
          if (cancelled) return;
          setImportId(latest.importId);
          if (d.summary) setSummary(d.summary);
          if (latest.status === 'importing') {
            setStep('importing');
            startPolling(latest.importId);
          } else {
            setStep('analyzed');
          }
        }
      } catch {
        /* aucun import à reprendre */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const prog = summary?.progress;
  const pct = prog && prog.total > 0 ? Math.round((prog.done / prog.total) * 100) : 0;

  return (
    <ScreenShell scroll>
      <ScreenHeader
        title="Importer TV Time"
        leading={<IconAction icon="chevron-left" label="Retour" onPress={() => goBack('/profile')} />}
      />
      <View style={styles.list}>
        <PrismeCard elevated>
          <View style={styles.cardHead}>
            <View style={styles.cardIcon}>
              <Feather name="download-cloud" size={16} color={COLORS.primary} />
            </View>
            <Text style={styles.cardTitle}>Importer ton archive</Text>
          </View>
          <Text style={styles.lead}>
            Récupère ton archive TV Time (dans l’app TV Time : Réglages → demande d’export de tes données ; tu reçois un
            fichier .zip par mail), puis importe-le ici.
          </Text>
          {/* Mention légale (cf. docs/STORES.md / avis PI) : l'import du nom
              « TV Time » est purement descriptif, pas une affiliation. */}
          <Text style={styles.disclaimer}>
            PlotTime est un service indépendant, non affilié à TV Time ni à Whip Media. L’import ne concerne que vos
            propres données, exportées par vous.
          </Text>

          {step === 'idle' || step === 'analyzed' || step === 'done' ? (
            <Pressable style={({ pressed }) => [styles.btnYellow, pressed && styles.btnPressed]} onPress={pickFile} accessibilityRole="button">
              <Feather name="upload" size={16} color={COLORS.onAccent} />
              <Text style={styles.btnYellowText}>{summary ? 'CHOISIR UN AUTRE .ZIP' : 'CHOISIR UN FICHIER .ZIP'}</Text>
            </Pressable>
          ) : null}

          {error ? (
            <View style={styles.errorRow}>
              <Feather name="alert-triangle" size={16} color={COLORS.danger} />
              <Text style={styles.error}>{error}</Text>
            </View>
          ) : null}

          {step === 'uploading' || step === 'analyzing' ? (
            <View style={styles.centerRow}>
              <ActivityIndicator color={COLORS.primary} />
              <Text style={styles.muted}>{step === 'uploading' ? 'Envoi du fichier…' : 'Analyse de l’archive…'}</Text>
            </View>
          ) : null}
        </PrismeCard>

        {summary && (step === 'analyzed' || step === 'importing') ? (
          <PrismeCard elevated>
            <Text style={styles.reportTitle}>Archive analysée</Text>
            <Row label="Séries détectées" value={summary.showsDetected} />
            <Row label="Films détectés" value={summary.moviesDetected} />
            <Row label="Épisodes vus détectés" value={summary.episodesWatchedDetected} />
            <Row label="Favoris détectés" value={summary.favoritesDetected} />
            <View style={styles.divider} />
            <Row label="Import automatique" value={summary.autoImport} strong />
            <Row label="À vérifier" value={summary.toVerify} />
            <Row label="Non reconnus" value={summary.unresolved} />
            <Row label="Doublons ignorés" value={summary.duplicatesIgnored} />

            {step === 'analyzed' ? (
              <Pressable style={({ pressed }) => [styles.btnYellow, pressed && styles.btnPressed]} onPress={startImport} accessibilityRole="button">
                <Text style={styles.btnYellowText}>IMPORTER</Text>
              </Pressable>
            ) : null}
          </PrismeCard>
        ) : null}

        {step === 'importing' ? (
          <PrismeCard elevated>
            <Text style={styles.muted}>{PHASE_LABEL[prog?.phase ?? 'apply']}</Text>
            <ProgressBar
              value={prog?.done ?? 0}
              max={prog?.total ?? 0}
              label={PHASE_LABEL[prog?.phase ?? 'apply']}
              color={COLORS.yellow}
              trackColor={COLORS.surfaceMuted}
              height={12}
              style={styles.progressBar}
            />
            <Text style={styles.progText}>
              {prog ? `${prog.done} / ${prog.total}` : '…'} {pct ? `(${pct}%)` : ''}
            </Text>
            <Text style={styles.hint}>Tu peux fermer cette page, l’import continue en arrière-plan.</Text>
          </PrismeCard>
        ) : null}

        {step === 'done' ? (
          <PrismeCard elevated style={styles.doneBox}>
            <View style={styles.doneIcon}>
              <Feather name="check" size={24} color={COLORS.onAccent} />
            </View>
            <Text style={styles.doneTitle}>Import terminé 🎉</Text>
            <Text style={styles.muted}>Tes séries, ta progression et tes favoris sont dans l’app.</Text>
          </PrismeCard>
        ) : null}
      </View>
    </ScreenShell>
  );
}

function Row({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, strong && { color: COLORS.text, fontFamily: FONTS.bold }]}>{label}</Text>
      <Text style={[styles.rowValue, strong && { color: COLORS.primary }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: SPACE.sm, paddingBottom: SPACE.xl },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: SPACE.xs, marginBottom: SPACE.sm },
  cardIcon: {
    width: 32, height: 32, flexShrink: 0, borderRadius: RADIUS.control,
    backgroundColor: COLORS.primarySoft, alignItems: 'center', justifyContent: 'center',
  },
  cardTitle: { flex: 1, color: COLORS.text, fontSize: 17, fontFamily: FONTS.extraBold },
  lead: { fontFamily: FONTS.regular, fontSize: 15, color: COLORS.textMuted, lineHeight: 22 },
  disclaimer: { fontFamily: FONTS.regular, fontSize: 11.5, color: COLORS.textSoft, marginTop: SPACE.sm, lineHeight: 16 },
  btnYellow: { minHeight: SIZES.touchComfortable, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACE.xs, backgroundColor: COLORS.yellow, borderRadius: RADIUS.pill, paddingVertical: SPACE.sm, marginTop: SPACE.md },
  btnYellowText: { color: COLORS.onAccent, fontSize: 15, fontFamily: FONTS.extraBold, letterSpacing: 0.6 },
  btnPressed: { opacity: 0.86, transform: [{ scale: 0.99 }] },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE.xs, marginTop: SPACE.md },
  error: { flex: 1, color: COLORS.danger, fontFamily: FONTS.bold, fontSize: 14 },
  centerRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, marginTop: SPACE.md },
  muted: { flex: 1, fontFamily: FONTS.regular, fontSize: 15, color: COLORS.textMuted, lineHeight: 21 },
  reportTitle: { color: COLORS.text, fontSize: 18, fontFamily: FONTS.extraBold, marginBottom: SPACE.xs },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 5 },
  rowLabel: { color: COLORS.text, fontFamily: FONTS.regular, fontSize: 15 },
  rowValue: { color: COLORS.text, fontSize: 16, fontFamily: FONTS.extraBold },
  divider: { height: 1, backgroundColor: COLORS.borderLight, marginVertical: SPACE.sm },
  progressBar: { marginTop: SPACE.sm },
  progText: { color: COLORS.text, marginTop: SPACE.xs, fontFamily: FONTS.bold, fontSize: 15 },
  hint: { marginTop: SPACE.sm, fontFamily: FONTS.regular, fontSize: 14, color: COLORS.textSoft, lineHeight: 20 },
  doneBox: { alignItems: 'center', gap: SPACE.xs },
  doneIcon: { width: SIZES.touch, height: SIZES.touch, borderRadius: RADIUS.control, backgroundColor: COLORS.success, alignItems: 'center', justifyContent: 'center', marginBottom: SPACE.xxs },
  doneTitle: { color: COLORS.text, fontSize: 19, fontFamily: FONTS.extraBold, textAlign: 'center' },
});
