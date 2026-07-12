import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
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
