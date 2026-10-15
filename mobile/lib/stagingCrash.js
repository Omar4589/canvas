import { useSyncExternalStore } from 'react';
import * as Updates from 'expo-updates';

// Staging-only crash hooks for the error-recovery test rows on the Profile screen
// (components/ErrorRecoveryTests.jsx, docs/PROPOSAL_ERROR_RECOVERY.md §B11). "Crash the next door"
// arms 'household'; the next render of that route throws, so the boundary that catches it can be
// tested on a real phone.
//
// Arming does nothing unless this binary's channel is staging (TestFlight and Play internal), which
// is fixed for the life of the app — so on a store build the hooks below can never throw.
//
// The hook throws on EVERY render while armed and never disarms itself: React retries a failed render
// once, synchronously, and would commit a clean retry — the boundary would never show. The crash card
// (components/CrashCard.jsx) disarms it from its mount effect, i.e. only once a boundary has caught it.
const STAGING = Updates.channel === 'staging';

const TARGETS = {
  household: 'door',
  survey: 'survey',
  practice: 'practice survey',
  root: 'app frame',
};

let armed = null; // a TARGETS key, or null
const listeners = new Set();
const subscribe = (fn) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
const getArmed = () => armed;
const emit = () => {
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      // one listener's fault must not stop the others
    }
  }
};

export const isStagingChannel = () => STAGING;

export const armStagingCrash = (target) => {
  if (!STAGING || !TARGETS[target]) return;
  armed = target;
  emit();
};

export const disarmStagingCrash = () => {
  if (armed === null) return;
  armed = null;
  emit();
};

// The first statement of RootLayout and of each door route (before any early return), so the hook
// order never changes. Production cost: one subscription per mounted route.
export const useStagingCrash = (target) => {
  const current = useSyncExternalStore(subscribe, getArmed);
  if (current !== null && current === target) {
    throw new Error(`Staging test: crash the ${TARGETS[target]}`);
  }
};
