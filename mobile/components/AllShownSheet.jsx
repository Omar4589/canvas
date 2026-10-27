import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, ActivityIndicator, Modal, StyleSheet, Alert } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../lib/api';
import { BULK_MAX } from '../lib/usersHub';
import {
  CHUNK_SIZE,
  runInChunks,
  moveOutcomes,
  assignOutcomes,
  resendOutcome,
  previewSkips,
  previewParts,
  mergeRuns,
  tally,
  movePreviewLines,
  assignPreviewLines,
  confirmFor,
  progressLine,
  summaryLines,
} from '../lib/allShown';
import { RowBar } from './InsetGroup';
import { radius, spacing } from '../lib/theme';
import { useTheme } from '../lib/ThemeContext';
import { useThemedStyles } from '../lib/useThemedStyles';

// The Users hub's "all shown" actions, in one sheet (docs/PROPOSAL_PEOPLE_PAGES.md §G):
//   move    Move all shown to a crew…: pick the crew, see the preview (POST …/crew/coordinator-bulk/
//           preview: the exact doors, the teams they come from, who runs a crew), then the bulk write
//           (PATCH …/crew/coordinator-bulk) with each person's `from` from that preview;
//   assign  Assign all shown (org admins): the crew they join and the same preview, then POST
//           …/assignments with that crew;
//   resend  Resend invites to all shown: the people, then one invite request each.
// Each run asks first with an Alert (Cancel first), then goes 10 people a request, one request at a
// time, with progress; Android back does nothing until it ends, and Stop ends it between requests. A
// 402 (the account is read-only for billing) stops it with the server's message. Retry failed checks
// the failed people again first, so each is written with a fresh `from`. The client-report teams a
// move changes aren't named here: the phone doesn't load client reports (plan N.2.6). The rules and
// the sentences are lib/allShown.js.
export default function AllShownSheet({
  mode, // 'move' | 'assign' | 'resend'
  campaign, // { id, name }
  people, // [{ userId, name }] — the rows the action covers, as they were shown
  coordinators = [], // [{ id, name }] who can run a crew: GET …/crew's `coordinators`
  coordinatorsStatus = 'success', // that query's status: 'pending' | 'error' | 'success'
  onClose,
  onFinished, // after each run: refresh the caller's lists (once a run)
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const cId = campaign?.id;
  const [phase, setPhase] = useState(mode === 'resend' ? 'ready' : 'pick');
  const [pick, setPick] = useState(null); // { id: string|null, name: string|null }
  const [progress, setProgress] = useState({ sent: 0, total: 0 });
  const [checking, setChecking] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [run, setRun] = useState(null);
  const [runError, setRunError] = useState(null);

  // `fetchRef` aborts every request when the sheet goes away; `stopRef` is Stop, which lets the request
  // already on its way finish and is checked between requests.
  const fetchRef = useRef(null);
  const stopRef = useRef(null);
  // One confirm at a time and one run at a time: a double tap could otherwise stack two confirms on
  // Android and start two runs, whose summaries and Stop would each cover only one of them.
  const askingRef = useRef(false);
  const busyRef = useRef(false);
  useEffect(() => {
    const ctrl = new AbortController();
    fetchRef.current = ctrl;
    return () => {
      ctrl.abort();
      stopRef.current?.abort();
    };
  }, []);

  const ids = useMemo(() => people.map((p) => String(p.userId)), [people]);
  const nameOf = useMemo(() => {
    const m = new Map(people.map((p) => [String(p.userId), p.name]));
    return (id) => m.get(String(id)) || null;
  }, [people]);
  const tooMany = mode !== 'resend' && ids.length > BULK_MAX;
  const running = phase === 'run';

  // The preview for the whole selection, in one call: its door total is exact and deduplicated. Its
  // intent makes the totals exactly what the write does: a move leaves out anyone taken off the campaign
  // since this list loaded (not-on-campaign), an add anyone put on it meanwhile (already-on-campaign).
  const intent = mode === 'assign' ? 'join' : 'move';
  const previewQ = useQuery({
    queryKey: ['admin', 'crew-bulk-preview', cId, mode, pick?.id ?? 'none', ids.join(',')],
    queryFn: ({ signal }) =>
      api(`/admin/campaigns/${cId}/crew/coordinator-bulk/preview`, {
        method: 'POST',
        body: { userIds: ids, coordinatorId: pick?.id ?? null, intent },
        signal,
      }),
    enabled: phase === 'preview' && !!pick && !!cId && !tooMany && ids.length > 0,
    retry: false,
    gcTime: 0,
  });

  // One request for a batch, answered per person. The literal paths stay at the api() calls, so
  // `npm run audit:mobile-api` sees them.
  const signal = () => fetchRef.current?.signal;
  const postAssign = (batch) =>
    api(`/admin/campaigns/${cId}/assignments`, {
      method: 'POST',
      body: { userIds: batch.map((p) => String(p.userId)), coordinatorId: pick?.id ?? null },
      signal: signal(),
    });
  const send = {
    move: async (batch) => {
      const res = await api(`/admin/campaigns/${cId}/crew/coordinator-bulk`, {
        method: 'PATCH',
        body: { people: batch.map((p) => ({ userId: String(p.userId), from: p.from ?? null })), coordinatorId: pick?.id ?? null },
        signal: signal(),
      });
      return moveOutcomes(batch, res?.results);
    },
    assign: async (batch) => {
      try {
        return assignOutcomes(batch, await postAssign(batch));
      } catch (err) {
        // Someone in this batch stopped being an active member meanwhile, and the server refused the
        // whole request for it: list them, and send the rest again.
        const invalid = new Set((err?.data?.invalidUserIds || []).map(String));
        if (err?.status !== 400 || !invalid.size) throw err;
        const gone = batch
          .filter((p) => invalid.has(String(p.userId)))
          .map((p) => ({ userId: p.userId, outcome: 'failed', reason: 'request', detail: 'No longer an active member of this organization' }));
        const rest = batch.filter((p) => !invalid.has(String(p.userId)));
        return rest.length ? [...gone, ...assignOutcomes(rest, await postAssign(rest))] : gone;
      }
    },
    resend: async ([p]) => [
      resendOutcome(p, await api(`/admin/memberships/${p.userId}/resend-invite`, { method: 'POST', signal: signal() })),
    ],
  };

  // Run `list`, folding it into `prev` (the run it retries or continues). The caller's caches are
  // refreshed once, whatever happened.
  const start = async (list, prev = null) => {
    if (busyRef.current) return;
    busyRef.current = true;
    const stop = new AbortController();
    stopRef.current = stop;
    setStopping(false);
    setRunError(null);
    setPhase('run');
    setProgress({ sent: 0, total: list.length });
    try {
      const next = await runInChunks(
        list,
        { size: mode === 'resend' ? 1 : CHUNK_SIZE, perPerson: mode === 'resend', signal: stop.signal, onProgress: setProgress },
        send[mode]
      );
      if (fetchRef.current?.signal.aborted) return;
      setRun(mergeRuns(prev, next, list.map((p) => p.userId)));
      setPhase('summary');
    } catch (err) {
      // runInChunks answers every request's failure itself; this is only for the unexpected.
      if (fetchRef.current?.signal.aborted) return;
      setRun(mergeRuns(prev, { outcomes: [], stopped: null, notStarted: list }, list.map((p) => p.userId)));
      setRunError(err?.message || 'Something went wrong.');
      setPhase('summary');
    } finally {
      busyRef.current = false;
      onFinished?.();
    }
  };

  // Retry failed and Continue on a move check those people again first, so each is written with a
  // fresh `from` — a change cut off reads as unfinished and finishes, instead of colliding again.
  const again = async (who) => {
    if (busyRef.current) return;
    if (mode !== 'move') {
      await start(who, run);
      return;
    }
    busyRef.current = true;
    const againIds = who.map((p) => String(p.userId));
    setPhase('run');
    setChecking(true);
    setRunError(null);
    let data;
    try {
      data = await api(`/admin/campaigns/${cId}/crew/coordinator-bulk/preview`, {
        method: 'POST',
        body: { userIds: againIds, coordinatorId: pick?.id ?? null, intent: 'move' },
        signal: signal(),
      });
    } catch (err) {
      if (fetchRef.current?.signal.aborted) return;
      setRunError(err?.message || "Couldn't check them again.");
      setPhase('summary');
      return;
    } finally {
      // Released before start() claims it again, in the same tick, so nothing can slip in between.
      busyRef.current = false;
      setChecking(false);
    }
    const { movers, skipped } = previewParts(data);
    const base = mergeRuns(run, { outcomes: previewSkips(data?.people), stopped: null, notStarted: [] }, skipped.map((p) => p.userId));
    if (!movers.length) {
      setRun(base);
      setPhase('summary');
      return;
    }
    await start(movers.map((p) => ({ userId: p.userId, from: p.from ?? null })), base);
  };

  // Every run asks first. Cancel FIRST: Android lays the buttons out in array order.
  const confirmRun = () => {
    if (askingRef.current || busyRef.current) return;
    let list;
    let base = null;
    let doors = 0;
    if (mode === 'resend') {
      list = people.map((p) => ({ userId: String(p.userId) }));
    } else {
      const { movers, totals } = previewParts(previewQ.data);
      list = movers.map((p) => ({ userId: String(p.userId), from: p.from ?? null }));
      base = { outcomes: previewSkips(previewQ.data?.people), stopped: null, notStarted: [] };
      doors = totals.doors;
    }
    if (!list.length) return;
    const c = confirmFor(mode, { n: list.length, crewName: pick?.name ?? null, doors, campaignName: campaign?.name || 'this campaign' });
    askingRef.current = true;
    const answered = () => {
      askingRef.current = false;
    };
    Alert.alert(
      c.title,
      c.message,
      [
        { text: 'Cancel', style: 'cancel', onPress: answered },
        {
          text: c.action,
          onPress: () => {
            answered();
            start(list, base);
          },
        },
      ],
      { cancelable: true, onDismiss: answered }
    );
  };

  const close = () => {
    if (!running) onClose();
  };

  const n = ids.length;
  const crewTitle = (name) => (name ? `${name}'s crew` : 'No crew');
  let title;
  let body;
  let actions;

  if (phase === 'pick') {
    title = mode === 'move' ? `Move ${n.toLocaleString()} to a crew` : `Assign ${n.toLocaleString()} to ${campaign?.name || 'this campaign'}`;
    body = tooMany ? (
      <Text style={styles.body}>
        {`That's more than ${BULK_MAX.toLocaleString()} people. Search or filter the list down to ${BULK_MAX.toLocaleString()} or fewer to do this at once.`}
      </Text>
    ) : (
      <>
        <Text style={styles.sub}>
          {mode === 'move'
            ? 'Pick the crew they move to. You’ll see what moves before anything changes.'
            : 'Pick the crew they join. You’ll see what moves before anything changes.'}
        </Text>
        <View style={styles.list}>
          {[{ id: null, name: null }, ...coordinators].map((c) => (
            <Pressable
              key={c.id || 'none'}
              onPress={() => {
                setPick({ id: c.id, name: c.name });
                setPhase('preview');
              }}
              style={({ pressed }) => [styles.listItem, pressed && { backgroundColor: colors.sunken }]}
            >
              <Text style={styles.listItemText}>{c.id ? c.name : 'No crew'}</Text>
            </Pressable>
          ))}
        </View>
        {coordinatorsStatus === 'pending' ? (
          <Text style={styles.note}>Loading who can run a crew…</Text>
        ) : coordinatorsStatus === 'error' ? (
          <Text style={styles.error}>Couldn't load who can run a crew. Close this and try again.</Text>
        ) : null}
      </>
    );
    actions = (
      <Pressable onPress={onClose} style={styles.btnGhost}>
        <Text style={styles.btnGhostText}>Cancel</Text>
      </Pressable>
    );
  } else if (phase === 'preview') {
    title = mode === 'move' ? `Move to ${crewTitle(pick?.name)}` : `Assign to ${campaign?.name || 'this campaign'}`;
    const lines = previewQ.data
      ? mode === 'move'
        ? movePreviewLines(previewQ.data, { crewName: pick?.name ?? null })
        : assignPreviewLines(previewQ.data, { crewName: pick?.name ?? null, campaignName: campaign?.name || 'this campaign' })
      : [];
    const movers = previewParts(previewQ.data).movers.length;
    body = previewQ.isLoading ? (
      <View style={styles.rowCenter}>
        <ActivityIndicator color={colors.brand} />
        <Text style={styles.muted}>Checking what would move…</Text>
      </View>
    ) : previewQ.error ? (
      <>
        <Text style={styles.error}>{previewQ.error.message || "Couldn't check what would move."}</Text>
        <Pressable onPress={() => previewQ.refetch()} style={styles.link}>
          <Text style={styles.linkText}>Try again</Text>
        </Pressable>
      </>
    ) : (
      lines.map((line, i) => (
        <Text key={i} style={i === 0 ? styles.body : styles.note}>
          {line}
        </Text>
      ))
    );
    actions = (
      <>
        <Pressable onPress={() => setPhase('pick')} style={styles.btnGhost}>
          <Text style={styles.btnGhostText}>Back</Text>
        </Pressable>
        <Pressable
          onPress={confirmRun}
          style={[styles.btnPrimary, (!previewQ.data || !movers) && { opacity: 0.5 }]}
          disabled={!previewQ.data || !movers}
        >
          <Text style={styles.btnPrimaryText}>{mode === 'move' ? 'Move them' : 'Add them'}</Text>
        </Pressable>
      </>
    );
  } else if (phase === 'ready') {
    title = `Resend ${n.toLocaleString()} ${n === 1 ? 'invite' : 'invites'}`;
    const names = people.slice(0, 10).map((p) => p.name || 'Someone');
    body = (
      <>
        <Text style={styles.body}>
          {`${n === 1 ? 'They never signed in. They get' : 'They never signed in. Each of them gets'} a new set-password link by email, which replaces any earlier invite or reset link they have.`}
        </Text>
        <Text style={styles.note}>
          {names.join(', ')}
          {n > 10 ? ` and ${(n - 10).toLocaleString()} more` : ''}
        </Text>
      </>
    );
    actions = (
      <>
        <Pressable onPress={onClose} style={styles.btnGhost}>
          <Text style={styles.btnGhostText}>Cancel</Text>
        </Pressable>
        <Pressable onPress={confirmRun} style={styles.btnPrimary} disabled={!n}>
          <Text style={styles.btnPrimaryText}>Send invites</Text>
        </Pressable>
      </>
    );
  } else if (phase === 'run') {
    title = mode === 'move' ? `Move to ${crewTitle(pick?.name)}` : mode === 'assign' ? `Assign to ${campaign?.name || 'this campaign'}` : 'Resend invites';
    const pct = progress.total ? Math.round((progress.sent / progress.total) * 100) : 0;
    body = (
      <>
        <Text style={styles.body}>{checking ? 'Checking them again…' : progressLine(mode, progress)}</Text>
        <View style={{ marginTop: spacing.sm }}>
          <RowBar pct={checking ? 0 : pct} />
        </View>
        <Text style={styles.note}>Keep this open until it finishes. Stop ends it after the people already on their way.</Text>
      </>
    );
    actions = (
      <Pressable
        onPress={() => {
          stopRef.current?.abort();
          setStopping(true);
        }}
        style={[styles.btnSecondary, (stopping || checking) && { opacity: 0.5 }]}
        disabled={stopping || checking}
      >
        <Text style={styles.btnSecondaryText}>{stopping ? 'Stopping…' : 'Stop'}</Text>
      </Pressable>
    );
  } else {
    title = 'Done';
    const t = run ? tally(run.outcomes) : { failed: [] };
    const failed = t.failed;
    const notStarted = run?.notStarted || [];
    const lines = run ? summaryLines(mode, run, nameOf) : [];
    body = (
      <>
        {lines.map((line, i) => (
          <Text key={i} style={i === 0 ? styles.body : styles.note}>
            {line}
          </Text>
        ))}
        {runError ? <Text style={styles.error}>{runError}</Text> : null}
      </>
    );
    actions = (
      <>
        {failed.length ? (
          <Pressable onPress={() => again(failed.map((o) => ({ userId: String(o.userId) })))} style={styles.btnSecondary}>
            <Text style={styles.btnSecondaryText}>{`Retry failed (${failed.length.toLocaleString()})`}</Text>
          </Pressable>
        ) : null}
        {notStarted.length ? (
          <Pressable onPress={() => again(notStarted)} style={styles.btnSecondary}>
            <Text style={styles.btnSecondaryText}>{`Continue (${notStarted.length.toLocaleString()})`}</Text>
          </Pressable>
        ) : null}
        <Pressable onPress={onClose} style={styles.btnPrimary}>
          <Text style={styles.btnPrimaryText}>Done</Text>
        </Pressable>
      </>
    );
  }

  return (
    // Android back does nothing during a run: the run would carry on out of sight, with no summary.
    <Modal visible transparent animationType="slide" onRequestClose={close}>
      <View style={styles.modalRoot}>
        <Pressable style={styles.modalBackdrop} onPress={close} />
        <View style={[styles.card, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
          <Text style={styles.title}>{title}</Text>
          <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ paddingBottom: spacing.sm }}>
            {body}
          </ScrollView>
          <View style={styles.actions}>{actions}</View>
        </View>
      </View>
    </Modal>
  );
}

function makeStyles(t) {
  const { colors, type, shadow } = t;
  return StyleSheet.create({
    modalRoot: { flex: 1, justifyContent: 'flex-end' },
    modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.backdrop },
    card: {
      backgroundColor: colors.card,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.lg,
      maxHeight: '86%',
      ...shadow.card,
    },
    title: { ...type.h3, color: colors.textPrimary, marginBottom: spacing.sm },
    sub: { ...type.caption, color: colors.textSecondary, marginBottom: spacing.sm },
    body: { ...type.body, color: colors.textPrimary },
    note: { ...type.caption, color: colors.textSecondary, marginTop: spacing.sm },
    muted: { ...type.caption, color: colors.textMuted },
    error: { ...type.caption, color: colors.danger, marginTop: spacing.xs },
    rowCenter: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    list: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      overflow: 'hidden',
    },
    listItem: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    listItemText: { ...type.body, color: colors.textPrimary },
    link: { paddingVertical: spacing.sm, marginTop: spacing.xs },
    linkText: { color: colors.brand, fontWeight: '700' },
    actions: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
    btnPrimary: {
      backgroundColor: colors.brand,
      borderRadius: radius.md,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.lg,
      alignItems: 'center',
    },
    btnPrimaryText: { color: colors.textInverse, fontWeight: '700' },
    btnSecondary: {
      borderWidth: 1,
      borderColor: colors.brand,
      borderRadius: radius.md,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      alignItems: 'center',
    },
    btnSecondaryText: { color: colors.brand, fontWeight: '700' },
    btnGhost: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md },
    btnGhostText: { color: colors.textMuted, fontWeight: '600' },
  });
}
