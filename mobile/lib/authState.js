import { useEffect, useState } from 'react';
import { getToken, setToken as persistToken } from './auth';

// Tiny subscriber-based store. Token is the single source of truth for
// auth across screens, so login/logout updates propagate synchronously.
//
// State machine:
//   undefined = not loaded yet (initial)
//   null      = loaded, no token
//   string    = loaded, signed in

let _token = undefined;
const _listeners = new Set();

function emit() {
  for (const fn of _listeners) fn(_token);
}

// Hydrate from SecureStore once at module load.
const hydration = getToken().then((t) => {
  _token = t || null;
  emit();
});

export function getCurrentToken() {
  return _token;
}

export async function signIn(token) {
  await persistToken(token);
  _token = token;
  emit();
}

export async function signOut() {
  await persistToken(null);
  _token = null;
  emit();
}

export function useAuthToken() {
  const [token, setToken] = useState(_token);
  useEffect(() => {
    const listener = (t) => setToken(t);
    _listeners.add(listener);
    // Resync in case hydration finished between render and subscribe
    setToken(_token);
    return () => {
      _listeners.delete(listener);
    };
  }, []);
  return token;
}

export function useAuthReady() {
  const [ready, setReady] = useState(_token !== undefined);
  useEffect(() => {
    if (_token !== undefined) {
      setReady(true);
      return;
    }
    hydration.then(() => setReady(true));
  }, []);
  return ready;
}
