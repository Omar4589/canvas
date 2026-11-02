import { Alert } from 'react-native';
import { hasInFlightActions, inFlightCount, alertWhenActive } from './recordAction';
import { getPendingCount } from './offlineQueue';
import { loadQueueHoldEnabled } from './cache';
import { signOut } from './authState';
import { SIGN_OUT_TITLE, signOutQuestion } from './queueRules';

// Every manual Sign out goes through confirmSignOut (docs/PROPOSAL_OFFLINE_QUEUE.md §C, decision 10):
//
//   1. A save still on its way (a weak signal can take 20 s) is waited for first, behind SessionGate's
//      "Finishing a save…" cover — an Alert can't be taken down from code, and the drawer has already
//      closed. Still sending after 20 s, it's counted with the rest: it will be queued, held for its
//      recorder.
//   2. With nothing of this person's waiting, it signs out at once.
//   3. Otherwise it asks: "3 saved items haven't uploaded yet. They'll stay on this phone and upload the
//      next time you sign in here." Sign out · Cancel. (With the kill switch off, today's words.)
//
// It runs BEFORE the caller's cache clear, so Cancel leaves the screens as they were. Resolves true
// once signed out, false when the person cancelled.

const WAIT_MS = 20 * 1000;
const STEP_MS = 250;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// "Finishing a save…" — read by components/SessionGate.jsx, which draws it over everything.
let finishing = false;
const listeners = new Set();
const setFinishing = (value) => {
  finishing = value;
  for (const fn of listeners) fn();
};
export const subscribeFinishing = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
export const getFinishing = () => finishing;

const ask = (n, holdOn) =>
  new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    // Cancel first: Android shows the buttons in this order. Asked only while the app is in front: the
    // wait for a save can run 20 s, the phone may be pocketed meanwhile, and Android drops an alert
    // fired in the background — this would never resolve.
    alertWhenActive(() =>
      Alert.alert(
        SIGN_OUT_TITLE,
        signOutQuestion(n, holdOn),
        [
          { text: 'Cancel', style: 'cancel', onPress: () => done(false) },
          { text: 'Sign out', style: 'destructive', onPress: () => done(true) },
        ],
        { cancelable: true, onDismiss: () => done(false) }
      )
    );
  });

export const confirmSignOut = async ({ qc, beforeSignOut } = {}) => {
  let stillSending = 0;
  if (hasInFlightActions()) {
    setFinishing(true);
    try {
      for (let waited = 0; waited < WAIT_MS && hasInFlightActions(); waited += STEP_MS) await sleep(STEP_MS);
    } finally {
      setFinishing(false);
    }
    stillSending = inFlightCount();
  }
  const holdOn = await loadQueueHoldEnabled().catch(() => true);
  const n = (await getPendingCount().catch(() => 0)) + stillSending;
  if (n > 0 && !(await ask(n, holdOn))) return false;
  beforeSignOut?.();
  qc?.clear?.();
  await signOut();
  return true;
};
