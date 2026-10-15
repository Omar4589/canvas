import { Component, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { View, Text, Pressable, Modal, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePathname } from 'expo-router';
import * as Updates from 'expo-updates';
import { errorStore } from '../lib/errorRecovery';
import { buildLine } from '../lib/buildInfo';
import { restartWhenSettled, canRestart, RESTART_OUTCOME_TEXT, SAVING_HINT, useReloadPending } from '../lib/appRestart';
import { useSessionState } from '../lib/authState';
import { inCanvassFlow } from '../lib/sessionEnd';
import { loadRoleContext } from '../lib/role';
import { radius, spacing } from '../lib/theme';
import { useThemedStyles } from '../lib/useThemedStyles';

// The one-line "Something went wrong" banner (docs/PROPOSAL_ERROR_RECOVERY.md §B3). lib/errorRecovery.js
// keeps the app running after an error escaped a tap, a timer or a native callback; this tells the
// person, offers a Restart, and holds the details for a screenshot.
//
//   · Mounted LAST inside RootErrorBoundary in app/_layout.jsx: every root overlay shares zIndex 1000 and
//     relies on render order, so it is never hidden under UpdateGate's banner, and it disappears with
//     everything else when the crash screen takes over.
//   · One row under the header row, so both top corners stay usable (the canvasser drawer button at the
//     top right, a door's "‹ Map" and a survey's "‹ Back" at the top left).
//   · Restart goes through lib/appRestart.js and is hidden on a door or in a survey, while the password
//     screen is pending, and in development. A refusal's reason replaces the message (up to three lines,
//     and in the Details sheet) until the next error, the next Restart, ✕ or a move to another screen
//     — no timers.
//   · A bug in the banner can never escalate: NoticeBoundary renders nothing after one, and gives the
//     next error a fresh try. The state lives above it, so an open Details sheet stays open while
//     errors keep arriving.
//
// Known limits: a root view can't paint over a React Native Modal, so an error from a tap inside a sheet
// shows here once the sheet closes; an error inside an async handler is a silent promise rejection.

// Clears the header row: measured on the map, Books, the admin home, a door and a survey.
const HEADER_CLEARANCE = 56;
const PRACTICE = /^\/survey-practice\//;

class NoticeBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { seen: props.count, failed: false };
  }

  static getDerivedStateFromProps(props, state) {
    return props.count !== state.seen ? { seen: props.count, failed: false } : null;
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

const safeBuildLine = () => {
  try {
    return buildLine(Updates);
  } catch {
    return '—';
  }
};

const ErrorNotice = () => {
  const snapshot = useSyncExternalStore(errorStore.subscribe, errorStore.getState);
  const pathname = usePathname();
  // Read by restart() after its wait, and by the Details sheet as it opens — where the person is NOW.
  const pathRef = useRef(pathname);
  pathRef.current = pathname;
  const { reauth, ending } = useSessionState();
  // While a Restart waits to happen, components/RestartCover.jsx is on top; this steps out of the way
  // (and out of reach of a screen reader) until it lands or fails.
  const reloadPending = useReloadPending();
  const insets = useSafeAreaInsets();
  // null = closed; { where: null | 'door' | 'practice', consoleUser }
  const [details, setDetails] = useState(null);
  const [restarting, setRestarting] = useState(false);
  // { kind, count } — a refusal (lib/appRestart.js RESTART_OUTCOME_TEXT), shown only while no newer
  // error has arrived.
  const [outcome, setOutcome] = useState(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // A refusal's reason belongs to the screen it was given on ("Finish this door first."): moving on
  // clears it.
  useEffect(() => {
    setOutcome(null);
  }, [pathname]);

  // Dismissed, or cleared by a sign-out: the next error starts with the sheet closed.
  const hasError = !!snapshot.last;
  useEffect(() => {
    if (!hasError) {
      setDetails(null);
      setOutcome(null);
    }
  }, [hasError]);

  if (!hasError || ending || reloadPending) return null;

  const showRestart = canRestart() && !inCanvassFlow(pathname) && !reauth;

  const restart = async () => {
    if (restarting) return;
    setRestarting(true);
    setOutcome(null);
    let result = 'failed';
    try {
      result = await restartWhenSettled({ getPath: () => pathRef.current });
    } catch {
      result = 'failed';
    }
    if (!alive.current) return;
    setRestarting(false);
    // 'reloading': the cover takes over (lib/appRestart.js reloadPending; this banner steps aside). If that
    // reload fails — this one's or one it joined — the banner comes back ready to try again.
    if (result === 'reloading') return;
    setOutcome({ kind: RESTART_OUTCOME_TEXT[result] ? result : 'failed', count: errorStore.getState().count });
  };

  // Keeps a refusal's reason: the sheet shows it too, so it can be read in full there.
  const openDetails = () => {
    const path = pathRef.current || '';
    const where = PRACTICE.test(path) ? 'practice' : inCanvassFlow(path) ? 'door' : null;
    setDetails({ where, consoleUser: false });
    loadRoleContext()
      .then((ctx) => {
        if (alive.current && ctx?.isConsoleUser) setDetails((d) => (d ? { ...d, consoleUser: true } : d));
      })
      .catch(() => {});
  };

  const dismiss = () => {
    setDetails(null);
    setOutcome(null);
    errorStore.dismiss();
  };

  return (
    <NoticeBoundary count={snapshot.count}>
      <NoticeBody
        snapshot={snapshot}
        top={insets.top + HEADER_CLEARANCE}
        bottomInset={insets.bottom}
        details={details}
        outcomeKind={outcome && outcome.count === snapshot.count ? outcome.kind : null}
        restarting={restarting}
        showRestart={showRestart}
        onOpenDetails={openDetails}
        onCloseDetails={() => setDetails(null)}
        onRestart={restart}
        onDismiss={dismiss}
      />
    </NoticeBoundary>
  );
};

export default ErrorNotice;

const NoticeBody = ({
  snapshot,
  top,
  bottomInset,
  details,
  outcomeKind,
  restarting,
  showRestart,
  onOpenDetails,
  onCloseDetails,
  onRestart,
  onDismiss,
}) => {
  const styles = useThemedStyles(makeStyles);
  const version = useMemo(safeBuildLine, []);
  const { count, last } = snapshot;
  const message = count > 1 ? `Something went wrong (${count})` : 'Something went wrong';
  const outcomeText = outcomeKind ? RESTART_OUTCOME_TEXT[outcomeKind] : null;
  let when = '';
  try {
    when = new Date(last.wallAt).toLocaleString();
  } catch {
    when = '';
  }

  return (
    <View style={[styles.overlay, { top }]} pointerEvents="box-none">
      {/* The shadow sits on an outer view: iOS drops a shadow on a view that clips (overflow hidden). */}
      <View style={styles.bannerShadow}>
        {/* Announced once (Android): a loop on a door changes the count every few tenths of a second. */}
        <View
          style={styles.banner}
          accessibilityRole="alert"
          accessibilityLiveRegion={count === 1 ? 'polite' : 'none'}
        >
          <View style={styles.accent} />
          <Pressable
            onPress={onOpenDetails}
            accessibilityRole="button"
            accessibilityHint="Shows what went wrong"
            style={styles.messageWrap}
          >
            {/* A refusal's reason gets up to three lines: the longest is about 290 points wide, and on a
                320-point screen with Restart showing the column is about 150. */}
            <Text style={outcomeText ? styles.outcome : styles.message} numberOfLines={outcomeText ? 3 : 1}>
              {outcomeText || message}
            </Text>
          </Pressable>
          {showRestart ? (
            <Pressable
              onPress={onRestart}
              disabled={restarting}
              hitSlop={8}
              accessibilityRole="button"
              style={({ pressed }) => [styles.action, pressed && styles.pressed]}
            >
              <Text style={styles.actionText}>{restarting ? 'Restarting…' : 'Restart'}</Text>
            </Pressable>
          ) : null}
          <Pressable
            onPress={onDismiss}
            accessibilityRole="button"
            accessibilityLabel="Dismiss"
            style={({ pressed }) => [styles.dismiss, pressed && styles.pressed]}
          >
            <Text style={styles.dismissText}>✕</Text>
          </Pressable>
        </View>
      </View>

      <Modal visible={!!details} animationType="slide" transparent onRequestClose={onCloseDetails}>
        <View style={styles.backdrop}>
          <View style={[styles.sheet, { paddingBottom: Math.max(bottomInset, spacing.lg) }]}>
            <View style={styles.grabber} />
            <Text style={styles.title} accessibilityRole="header">
              What went wrong
            </Text>
            <ScrollView style={styles.sheetScroll}>
              <Text style={styles.label}>When</Text>
              <Text selectable style={styles.mono}>
                {when || '—'}
              </Text>
              <Text style={styles.label}>Version</Text>
              <Text selectable style={styles.mono}>
                {version}
              </Text>
              <Text style={styles.label}>Error</Text>
              <Text selectable style={styles.mono}>
                {`${last.name}: ${last.message}`}
              </Text>
              {last.stack ? (
                <>
                  <Text style={styles.label}>Details</Text>
                  <Text selectable style={styles.mono}>
                    {last.stack}
                  </Text>
                </>
              ) : null}
              <Text style={styles.para}>Doors and surveys you already saved are safe.</Text>
              {details?.where === 'door' ? (
                <Text style={styles.para}>
                  If this door’s buttons stopped working, go back to the map and restart Doorline — or close and
                  reopen it if Restart isn’t offered — then record the door again.
                </Text>
              ) : null}
              {details?.where === 'practice' ? (
                <Text style={styles.para}>Nothing is saved in practice — go back and start again.</Text>
              ) : null}
              <Text style={styles.para}>
                If this keeps happening, screenshot this and send it to{' '}
                {details?.consoleUser ? 'Doorline support at hello@doorline.app' : 'your team lead or admin'}.
              </Text>
            </ScrollView>
            {outcomeText ? (
              <Text style={styles.sheetOutcome}>
                {outcomeKind === 'saving' ? `${outcomeText} ${SAVING_HINT}` : outcomeText}
              </Text>
            ) : null}
            {showRestart ? (
              <Pressable
                onPress={onRestart}
                disabled={restarting}
                accessibilityRole="button"
                style={({ pressed }) => [styles.button, pressed && styles.pressed]}
              >
                <Text style={styles.buttonText}>{restarting ? 'Restarting…' : 'Restart Doorline'}</Text>
              </Pressable>
            ) : null}
            <Pressable
              onPress={onCloseDetails}
              accessibilityRole="button"
              style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
            >
              <Text style={styles.secondaryText}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const makeStyles = (t) => {
  const { colors, type, shadow } = t;
  return StyleSheet.create({
    overlay: {
      position: 'absolute',
      left: 0,
      right: 0,
      paddingHorizontal: spacing.md,
      zIndex: 1000,
      elevation: 1000,
    },
    bannerShadow: { borderRadius: radius.md, backgroundColor: colors.card, ...shadow.raised },
    banner: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: 44,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      overflow: 'hidden',
    },
    accent: { alignSelf: 'stretch', width: 4, backgroundColor: colors.danger },
    messageWrap: { flex: 1, minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.md },
    message: { ...type.bodyStrong, fontSize: 14 },
    outcome: { ...type.caption, color: colors.textPrimary, fontWeight: '600' },
    action: {
      backgroundColor: colors.brand,
      borderRadius: radius.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs + 2,
    },
    actionText: { color: colors.textInverse, fontWeight: '700', fontSize: 13 },
    dismiss: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    dismissText: { ...type.body, color: colors.textSecondary, fontWeight: '700' },
    pressed: { opacity: 0.7 },

    backdrop: { flex: 1, backgroundColor: colors.backdrop, justifyContent: 'flex-end' },
    sheet: {
      backgroundColor: colors.card,
      borderTopLeftRadius: radius.lg,
      borderTopRightRadius: radius.lg,
      padding: spacing.lg,
      maxHeight: '85%',
    },
    grabber: {
      alignSelf: 'center',
      width: 36,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.border,
      marginBottom: spacing.md,
    },
    title: { ...type.h3, marginBottom: spacing.sm },
    sheetScroll: { flexGrow: 0 },
    label: { ...type.micro, color: colors.textSecondary, marginTop: spacing.md, marginBottom: spacing.xs },
    mono: {
      fontFamily: 'monospace',
      fontSize: 12,
      color: colors.textPrimary,
      backgroundColor: colors.sunken,
      borderRadius: radius.md,
      padding: spacing.md,
    },
    para: { ...type.body, color: colors.textSecondary, marginTop: spacing.md },
    sheetOutcome: { ...type.caption, color: colors.textPrimary, fontWeight: '600', marginTop: spacing.md },
    button: {
      backgroundColor: colors.brand,
      borderRadius: radius.md,
      paddingVertical: spacing.md + 2,
      alignItems: 'center',
      marginTop: spacing.lg,
    },
    buttonText: { color: colors.textInverse, fontWeight: '700', fontSize: 16 },
    secondary: {
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      paddingVertical: spacing.md,
      alignItems: 'center',
      marginTop: spacing.sm,
    },
    secondaryText: { color: colors.textPrimary, fontWeight: '600', fontSize: 15 },
  });
};
