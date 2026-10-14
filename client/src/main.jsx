import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { retryUnless401 } from './lib/sessionEnd.js';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { AuthProvider } from './auth/AuthContext.jsx';
import ErrorBoundary, { reloadOnceForStaleChunk } from './components/ErrorBoundary.jsx';
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

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      {/* No `future` flags on purpose for now: useSignOut (auth/AuthContext.jsx) relies on logout()
          and navigate('/login') landing in ONE render, so ProtectedRoute never stashes the signed-out
          page for the next person. Turning on v7_startTransition (or moving to v7) defers the navigate;
          re-check Sign out when that happens. */}
      <BrowserRouter>
        <AuthProvider>
          <ErrorBoundary>
            <App />
          </ErrorBoundary>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);
