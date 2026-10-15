import { Component, useLayoutEffect, useState } from 'react';
import { Text, Pressable } from 'react-native';
import { router, usePathname } from 'expo-router';
import { clearActiveOrgId, clearActiveCampaign } from '../lib/cache';
import { errorStore, normalizeError } from '../lib/errorRecovery';
import { inCanvassFlow } from '../lib/sessionEnd';
import { useThemedStyles } from '../lib/useThemedStyles';
import { CrashFrame, makeCrashStyles } from './CrashCard';
import { RestartBlock } from './CrashRestart';
import { useReloadPending } from '../lib/appRestart';

// The full "Something crashed" screen, in place of every screen below it
// (docs/PROPOSAL_ERROR_RECOVERY.md §B4). Two ways in:
//   · a render or lifecycle error anywhere below that no closer boundary caught (a door, survey or
//     practice-survey route catches its own — components/CrashCard.jsx's DoorCrashCard);
//   · a TAKEOVER: lib/errorRecovery.js counted five errors inside three seconds while the person was off
//     the doors — something stuck in a loop. Showing this screen unmounts the screens that own such a
//     loop; a loop owned by module scope or RootLayout keeps running behind it, and Restart fixes those.
// It never takes over on top of a render crash it is already showing, and keeps the error in its own
// state, so a clear() during its own restart can't bring the screens back for a moment.
//
// It is also the error store's "host": while it is mounted, a fatal JavaScript error keeps the app
// running instead of taking it down, because there is something to draw on.
//
// Restart Doorline leads (lib/appRestart.js, from a crash screen). Reset & go home is for when Restart
// lands straight back here: it drops the active org and campaign so routing lands somewhere safe
// (app/index.jsx → the organization picker) rather than straight back into the screen that crashed.
//
// NOTE: this only catches JavaScript. A native crash closes the app with no screen — capture
// `adb logcat` for that.
// An error the global handler caught a moment before a render crash. The usual case is a screen whose
// code failed to load: Metro reports that as an error (lib/errorRecovery.js catches it) and the route
// then crashes on the empty module it got back — so the screenshot needs the first error, not just the
// second.
const RELATED_MS = 2_000;
const errorJustBefore = () => {
  const { last } = errorStore.getState();
  if (!last) return null;
  const age = Date.now() - last.wallAt;
  // A negative age is a clock set back, not a recent error.
  return age >= 0 && age < RELATED_MS ? last : null;
};

class RootErrorBoundaryInner extends Component {
  state = { error: null, info: null, takeover: false, before: null };

  static getDerivedStateFromError(error) {
    return { error, info: null, takeover: false, before: errorJustBefore() };
  }

  componentDidMount() {
    this.releaseHost = errorStore.addHost();
    this.unsubscribe = errorStore.subscribe(this.onErrorStore);
    this.onErrorStore();
  }

  componentWillUnmount() {
    this.unsubscribe?.();
    this.releaseHost?.();
  }

  componentDidCatch(error, info) {
    this.setState({ info });
    // Surfaces in `adb logcat` (filter: ReactNativeJS) and Metro too.
    console.error('RootErrorBoundary caught:', error, info?.componentStack);
  }

  onErrorStore = () => {
    const { takeover, last } = errorStore.getState();
    if (!takeover || !last) return;
    this.setState((s) => (s.error ? null : { error: last, info: null, takeover: true, before: null }));
  };

  reset = async () => {
    try {
      await clearActiveOrgId();
      await clearActiveCampaign();
    } catch {
      // ignore — best effort
    }
    // Cleared right before the screens come back, so errors that landed during the awaits above can't
    // follow the person back in.
    errorStore.clear();
    this.setState({ error: null, info: null, takeover: false, before: null });
    router.replace('/');
  };

  render() {
    const { error, info, takeover, before } = this.state;
    if (!error) return this.props.children;
    return <RootCrashScreen error={error} info={info} takeover={takeover} before={before} onReset={this.reset} />;
  }
}

const RootCrashScreen = ({ error, info, takeover, before, onReset }) => {
  const styles = useThemedStyles(makeCrashStyles);
  const [resetting, setResetting] = useState(false);
  // Not while a Restart waits to happen: bringing the screens back would let new work start and then be
  // cut off by the reload.
  const reloadPending = useReloadPending();
  const shown = normalizeError(error);
  const details = [shown.stack, info?.componentStack].filter((part) => typeof part === 'string' && part).join('\n\n');
  // The first error, when a different one landed a moment before this crash (see errorJustBefore).
  const fields =
    before && before.message !== shown.message
      ? [{ label: 'Just before', value: `${before.name}: ${before.message}` }]
      : [];
  const reset = () => {
    if (resetting || reloadPending) return;
    setResetting(true);
    onReset();
  };
  return (
    <CrashFrame
      styles={styles}
      title="Something crashed"
      notes={[takeover ? 'Doorline kept hitting an error.' : 'This screen hit an error.']}
      error={error}
      fields={fields}
      details={details || null}
    >
      <RestartBlock styles={styles} />
      <Pressable
        onPress={reset}
        disabled={resetting || reloadPending}
        accessibilityRole="button"
        style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
      >
        <Text style={styles.secondaryText}>Reset &amp; go home</Text>
      </Pressable>
      <Text style={styles.note}>
        Use this only if Restart brings you straight back here. You’ll choose your organization and campaign
        again, and your houses download again, so you need signal. Saved work waiting to send is kept.
      </Text>
    </CrashFrame>
  );
};

// Keeps the error store's door-flag current, so a loop never takes over a door
// (lib/errorRecovery.js shouldTakeOver). Exact, not a lag: a navigation here is a synchronous update
// whose effects flush before any timer, native event or Alert callback can run. Don't replace it with
// a render-time ref.
const RootErrorBoundary = ({ children }) => {
  const pathname = usePathname();
  useLayoutEffect(() => {
    errorStore.setInDoorFlow(inCanvassFlow(pathname));
  }, [pathname]);
  return <RootErrorBoundaryInner>{children}</RootErrorBoundaryInner>;
};

export default RootErrorBoundary;
