import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from './api';
import { loadActiveOrgId, loadQueueHoldEnabled } from './cache';
import { getCurrentToken } from './authState';
import { createOfflineQueue } from './queueCore';

// The offline queue: saves made without signal, uploaded when it returns. The engine and every rule
// live in lib/queueCore.js (plain, tested under node) and lib/queueRules.js; this file wires them to
// AsyncStorage, the request function, the session held in memory and the server's kill switch
// (MOBILE_QUEUE_HOLD, remembered by lib/cache.js). See docs/PROPOSAL_OFFLINE_QUEUE.md.
//
// What changed with it (2026-11): an item remembers who recorded it and uploads only while that
// person is signed in; one the server turns down goes to the Not saved list instead of vanishing; a
// deleted account's unsent items are removed; items left waiting for someone else go after 30 days.
const queue = createOfflineQueue({
  storage: AsyncStorage,
  api,
  getToken: getCurrentToken,
  loadHold: loadQueueHoldEnabled,
  loadActiveOrgId,
});

export const {
  enqueue,
  submitOrQueue,
  flushQueue,
  getPending,
  getPendingCount,
  getWaiting,
  getNotSaved,
  removeNotSaved,
  readNotices,
  clearNotices,
  cleanupDeletedAccount,
  prepareQueue,
  startupCleanup,
  setFlushPaceSink,
  setFlushRefusalSink,
  subscribe: subscribeQueue,
} = queue;
