import React, { useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, ActivityIndicator, Platform } from 'react-native';
import { COLORS, FONTS } from '@/lib/theme';
import { PageHeader } from '@/components/PageHeader';
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
  progress?: { phase: 'apply' | 'artwork' | 'done'; done: number; total: number };
};

type Step = 'idle' | 'uploading' | 'analyzing' | 'analyzed' | 'importing' | 'done';

const PHASE_LABEL: Record<string, string> = {
  apply: 'Étape 1/2 · Séries, films, progression et favoris…',
  artwork: 'Étape 2/2 · Récupération des affiches…',
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
    <View style={{ flex: 1, backgroundColor: COLORS.white }}>
      <PageHeader title="Importer TV Time" />
      <ScrollView contentContainerStyle={{ padding: 24 }}>
        <Text style={styles.lead}>
          Récupère ton archive TV Time (dans l’app TV Time : Réglages → demande d’export de tes données ; tu reçois un
          fichier .zip par mail), puis importe-le ici.
        </Text>

        {step === 'idle' || step === 'analyzed' || step === 'done' ? (
          <Pressable style={styles.btnYellow} onPress={pickFile}>
            <Text style={styles.btnYellowText}>{summary ? 'CHOISIR UN AUTRE .ZIP' : 'CHOISIR UN FICHIER .ZIP'}</Text>
          </Pressable>
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {step === 'uploading' || step === 'analyzing' ? (
          <View style={styles.centerRow}>
            <ActivityIndicator color={COLORS.black} />
            <Text style={styles.muted}>{step === 'uploading' ? 'Envoi du fichier…' : 'Analyse de l’archive…'}</Text>
          </View>
        ) : null}

        {summary && (step === 'analyzed' || step === 'importing') ? (
          <View style={{ marginTop: 28 }}>
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
              <Pressable style={styles.btnYellow} onPress={startImport}>
                <Text style={styles.btnYellowText}>IMPORTER</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {step === 'importing' ? (
          <View style={{ marginTop: 24 }}>
            <Text style={styles.muted}>{PHASE_LABEL[prog?.phase ?? 'apply']}</Text>
            <View style={styles.barTrack}>
              <View style={[styles.barFill, { width: `${pct}%` }]} />
            </View>
            <Text style={styles.progText}>
              {prog ? `${prog.done} / ${prog.total}` : '…'} {pct ? `(${pct}%)` : ''}
            </Text>
            <Text style={styles.hint}>Tu peux fermer cette page, l’import continue en arrière-plan.</Text>
          </View>
        ) : null}

        {step === 'done' ? (
          <View style={styles.doneBox}>
            <Text style={styles.doneTitle}>Import terminé 🎉</Text>
            <Text style={styles.muted}>Tes séries, ta progression et tes favoris sont dans l’app.</Text>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

function Row({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, strong && { fontFamily: FONTS.bold }]}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  lead: { fontFamily: FONTS.regular, fontSize: 16, color: COLORS.textMuted, lineHeight: 23 },
  btnYellow: { backgroundColor: COLORS.yellow, borderRadius: 999, paddingVertical: 15, marginTop: 24, alignItems: 'center' },
  btnYellowText: { fontSize: 15, fontFamily: FONTS.extraBold, letterSpacing: 0.6 },
  error: { marginTop: 18, color: COLORS.red, fontFamily: FONTS.bold, fontSize: 15 },
  centerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 24 },
  muted: { fontFamily: FONTS.regular, fontSize: 16, color: COLORS.textMuted },
  reportTitle: { fontSize: 20, fontFamily: FONTS.extraBold },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3, marginTop: 4 },
  rowLabel: { fontFamily: FONTS.regular, fontSize: 16 },
  rowValue: { fontSize: 16, fontFamily: FONTS.extraBold },
  divider: { height: 1, backgroundColor: COLORS.borderLight, marginVertical: 10 },
  barTrack: { height: 12, borderRadius: 999, backgroundColor: COLORS.chipGrey, marginTop: 12, overflow: 'hidden' },
  barFill: { height: 12, borderRadius: 999, backgroundColor: COLORS.yellow },
  progText: { marginTop: 8, fontFamily: FONTS.bold, fontSize: 15 },
  hint: { marginTop: 10, fontFamily: FONTS.regular, fontSize: 14, color: COLORS.textSoft },
  doneBox: { marginTop: 28, gap: 8 },
  doneTitle: { fontSize: 19, fontFamily: FONTS.extraBold },
});
