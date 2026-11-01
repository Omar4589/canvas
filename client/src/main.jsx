import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient } from '@tanstack/react-query';
import { retryUnless401 } from './lib/sessionEnd.js';
import { BrowserRouter } from 'react-router-dom';
import AppTree from './AppTree.jsx';
import { reloadOnceForStaleChunk } from './components/ErrorBoundary.jsx';
// Self-hosted Inter (variable weight) — the app-wide typeface, no external font requests.
import '@fontsource-variable/inter';
import './index.css';

// Vite fires this on window when a lazy chunk's preload 404s — the earliest signal that the tab is
// running against a build that a deploy has since replaced. Reload once to fetch the fresh bundle.
// (The ErrorBoundary catches the same failure when import() rejects at call time; this is belt-and-
// suspenders for the preload path.)
window.addEventListener('vite:preloadError', (e) => {
  e.preventDefault?.();
  reloadOnceForStaleChunk();
});

const queryClient = new QueryClient({
  defaultOptions: {
    // One retry, as before — except a 401, which can't succeed a second later.
    queries: { retry: retryUnless401, refetchOnWindowFocus: false },
  },
});

// No `future` flags on BrowserRouter on purpose for now: useSignOut (auth/AuthContext.jsx) relies on
// logout() and navigate('/login') landing in ONE render, so ProtectedRoute never stashes the
// signed-out page for the next person. Turning on v7_startTransition (or moving to v7) defers the
// navigate; re-check Sign out when that happens.
const tree = (pages) => (
  <React.StrictMode>
    <AppTree queryClient={queryClient} Router={BrowserRouter} pages={pages} />
  </React.StrictMode>
);

const rootEl = document.getElementById('root');

// A prerendered marketing page (client/scripts/prerender.js marks #root with its name) hydrates in
// place — but only once its own module has loaded. Hydrating while the lazy route's chunk was still
// in flight let AuthProvider's first state change throw the server HTML away (React #421) and flash
// "Loading…" over the page. If the page's chunk can't load at all, render from scratch as before.
if (rootEl.dataset.prerendered === 'landing') {
  import('./pages/LandingPage.jsx')
    .then(({ default: LandingPage }) => ReactDOM.hydrateRoot(rootEl, tree({ landing: LandingPage })))
    .catch(() => ReactDOM.createRoot(rootEl).render(tree()));
} else {
  ReactDOM.createRoot(rootEl).render(tree());
}
