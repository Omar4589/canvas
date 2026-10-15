import { useSyncExternalStore } from 'react';
import * as Updates from 'expo-updates';
import { hasInFlightActions } from './recordAction';
import { getSessionState, sessionSettled } from './authState';
import { inCanvassFlow } from './sessionEnd';
import { createRestart } from './restartPolicy';

// The one way to restart the JavaScript app from inside it — the update banner, the error banner and
// the crash screens all call this. The rules live in lib/restartPolicy.js (pure, unit-tested); this
// file only wires the real modules in. Never automatic: every caller is a button the person tapped.
//
//   restartWhenSettled({ getPath, fromCrashScreen, beforeReload })
//     → 'reloading' | 'saving' | 'door' | 'password' | 'failed'

// True from the moment a reload is asked for until it happens (or fails). expo-updates runs the reload
// in the same queue as its update checks and downloads, so it can wait behind one — seconds, or a minute
// on a weak signal — while the app stays usable. components/RestartCover.jsx covers the app meanwhile, so
// no door, typed answer or sign-out can start and then be cut off by the reload.
let reloadPending = false;
const pendingListeners = new Set();
const setReloadPending = (value) => {
  if (reloadPending === value) return;
  reloadPending = value;
  for (const fn of pendingListeners) {
    try {
      fn();
    } catch {
      // one listener's fault must not stop the others
    }
  }
};
const subscribeReloadPending = (fn) => {
  pendingListeners.add(fn);
  return () => {
    pendingListeners.delete(fn);
  };
};
export const isReloadPending = () => reloadPending;
export const useReloadPending = () => useSyncExternalStore(subscribeReloadPending, isReloadPending);

export const restartWhenSettled = createRestart({
  hasInFlightActions,
  sessionSettled,
  getSessionState,
  inDoorFlow: inCanvassFlow,
  reloadAsync: () => Updates.reloadAsync(),
  onReloadStart: () => setReloadPending(true),
  onReloadFailed: () => setReloadPending(false),
  reloadAlreadyPending: isReloadPending,
});

// False in development and Expo Go, true on every store and staging build. A Restart button only
// renders when this is true.
export const canRestart = () => !!Updates.isEnabled;

// What each refusal tells the person (the error surfaces; the update banner just re-offers later).
export const RESTART_OUTCOME_TEXT = {
  saving: 'Still saving — try again in a moment.',
  door: 'Finish this door first.',
  password: 'Enter your password first, then restart.',
  failed: 'Couldn’t restart — close and reopen Doorline.',
};

// Shown with a 'saving' refusal wherever there is room (the Details sheet, the crash screens): a save
// that can never finish would otherwise block every Restart.
export const SAVING_HINT = 'If it keeps saying this, close Doorline and open it again.';
