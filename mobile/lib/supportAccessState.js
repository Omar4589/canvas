import { useEffect, useState } from 'react';

// Tiny subscriber-based store for the "you need a support session" prompt — same shape as
// authState.js, for the same reason: the producer and the consumer live in different trees.
//
// The 403 is detected in the react-query error handler, which is module scope in
// app/_layout.jsx; the sheet that answers it is a component mounted in (app)/_layout.jsx. This
// is the seam between them. (Web solves the same problem with a window CustomEvent — see
// client/src/api/client.js; React Native has no window, so a store it is.)
//
// State:
//   null                                    = idle, nothing to ask
//   { organizationId, organizationName }    = a prompt is open for that org

let _pending = null;
const _listeners = new Set();

function emit() {
  for (const fn of _listeners) fn(_pending);
}

// FIRST PROMPT WINS. Entering an org fires several queries at once and every one of them 403s,
// so this would otherwise stack prompts (or thrash the sheet's state) for a single user action.
// The web client de-dupes the identical way — `setOrg((cur) => cur || e.detail)`.
export function promptSupportAccess(detail) {
  if (_pending) return;
  if (!detail?.organizationId) return; // nothing to grant against — let the error surface normally
  _pending = { organizationId: detail.organizationId, organizationName: detail.organizationName || null };
  emit();
}

export function clearSupportAccessPrompt() {
  if (!_pending) return;
  _pending = null;
  emit();
}

export function useSupportAccessPrompt() {
  const [pending, setPending] = useState(_pending);
  useEffect(() => {
    const listener = (p) => setPending(p);
    _listeners.add(listener);
    // Resync in case a prompt was raised between render and subscribe.
    setPending(_pending);
    return () => {
      _listeners.delete(listener);
    };
  }, []);
  return pending;
}
