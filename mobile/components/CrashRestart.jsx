import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { errorStore, normalizeError } from '../lib/errorRecovery';
import { restartWhenSettled, canRestart, RESTART_OUTCOME_TEXT, SAVING_HINT, useReloadPending } from '../lib/appRestart';
import { useSessionState } from '../lib/authState';
import { buildTheme } from '../lib/theme';
import { usePendingSessionAction, runQueuedSessionAction } from './SessionGate';
import { CrashFrame, makeCrashStyles } from './CrashCard';
import { useSlowRestart, SLOW_RESTART_TEXT } from './RestartCover';

// The crash screens' Restart, and the app frame's own crash screen (docs/PROPOSAL_ERROR_RECOVERY.md
// §B4, §B5). Kept out of ./CrashCard.jsx so the door card imports nothing that saves or signs out.

const NEW_PASSWORD_LINE = 'You’ll sign in again with your new password, and your houses download again — you need signal.';
const PASSWORD_PENDING_LINE =
  'Doorline asks for your password again after it reopens. If you’ve just reset your password, it signs you out instead, and your houses download again — you need signal.';

// What this Restart will cost, if anything: a sign-out the app was holding back (a password changed
// elsewhere, a deleted or switched-off account) runs before the reload; a pending password screen's state
// lives only in memory, so after the reload the server decides — a run-out sign-in asks for the password
// again, a password reset meanwhile signs the phone out.
const signOutLine = (pendingAction, reauth) => {
  if (pendingAction?.type === 'signout') {
    return pendingAction.reason === 'password_changed' ? NEW_PASSWORD_LINE : 'Restarting signs Doorline out on this phone.';
  }
  if (!reauth) return null;
  return reauth.reason === 'password_changed' ? NEW_PASSWORD_LINE : PASSWORD_PENDING_LINE;
};

// Restart from a crash screen: skips the password-screen refusal (that screen is already gone with the
// screens it covered) and first runs a sign-out the app was holding back (lib/restartPolicy.js). Still
// refuses over a save or a session change in flight, and says so under the button.
export const RestartBlock = ({ styles }) => {
  const { reauth } = useSessionState();
  const pendingAction = usePendingSessionAction();
  // The reload can wait behind an update check (components/RestartCover.jsx); say so when it does. A
  // reload another button already asked for counts as this one's.
  const reloadPending = useReloadPending();
  const slow = useSlowRestart(reloadPending);
  const [restarting, setRestarting] = useState(false);
  const [outcome, setOutcome] = useState(null);
  const waiting = restarting || reloadPending;
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // Development and Expo Go can't reload from inside the app.
  if (!canRestart()) return <Text style={styles.note}>Close Doorline and open it again.</Text>;

  const restart = async () => {
    if (waiting) return;
    setRestarting(true);
    setOutcome(null);
    let result = 'failed';
    try {
      result = await restartWhenSettled({ fromCrashScreen: true, beforeReload: runQueuedSessionAction });
    } catch {
      result = 'failed';
    }
    if (!alive.current) return;
    setRestarting(false);
    // 'reloading': `waiting` stays true through reloadPending until the reload lands; if it fails — this
    // one's or one it joined — Restart is offered again.
    if (result === 'reloading') return;
    const text = RESTART_OUTCOME_TEXT[result] || RESTART_OUTCOME_TEXT.failed;
    setOutcome(result === 'saving' ? `${text} ${SAVING_HINT}` : text);
  };

  const costLine = signOutLine(pendingAction, reauth);

  return (
    <View>
      <Pressable
        onPress={restart}
        disabled={waiting}
        accessibilityRole="button"
        style={({ pressed }) => [styles.button, pressed && styles.pressed]}
      >
        <Text style={styles.buttonText}>{waiting ? 'Restarting…' : 'Restart Doorline'}</Text>
      </Pressable>
      <Text style={styles.note}>Reopens Doorline in a few seconds.</Text>
      {costLine ? <Text style={styles.note}>{costLine}</Text> : null}
      {waiting && slow >= 1 ? <Text style={styles.outcome}>{SLOW_RESTART_TEXT[1]}</Text> : null}
      {waiting && slow >= 2 ? <Text style={styles.outcome}>{SLOW_RESTART_TEXT[2]}</Text> : null}
      {outcome ? (
        <Text style={styles.outcome} accessibilityLiveRegion="polite">
          {outcome}
        </Text>
      ) : null}
    </View>
  );
};

// Above ThemeProvider (RootLayout is what failed), so always the light theme — the brand's.
let lightStyles = null;
const getLightStyles = () => {
  if (!lightStyles) lightStyles = StyleSheet.create(makeCrashStyles(buildTheme('light')));
  return lightStyles;
};

// app/_layout.jsx's ErrorBoundary export: expo-router wraps the root layout in its own boundary
// (views/Try.js), which catches what a boundary inside RootLayout can't — RootLayout's own hooks and
// every provider it renders. Always renders this screen, never a rethrow: by the time RootLayout can
// fail the first screen has already appeared, so a rethrow could only crash the app or gray it.
export const OuterFrameCrash = ({ error }) => {
  // A host for lib/errorRecovery.js: the crash screen inside RootLayout is gone, and without a host
  // every later error would take the app down. A layout effect, so there is no gap after
  // RootErrorBoundary unmounts in the same commit.
  useLayoutEffect(() => errorStore.addHost(), []);
  const styles = getLightStyles();
  return (
    <CrashFrame styles={styles} title="Doorline hit a problem" error={error} details={normalizeError(error).stack}>
      <RestartBlock styles={styles} />
    </CrashFrame>
  );
};
