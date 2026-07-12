import { Component } from 'react';

// Errors that mean a lazy page's JS chunk no longer exists — a deploy replaced the content-hashed
// bundles while this tab was open, so the dynamic import() 404s. Different browsers word it
// differently, hence the union.
const STALE_CHUNK = /loading chunk|dynamically imported module|importing a module script failed|chunkloaderror|failed to fetch dynamically/i;

function isStaleChunkError(err) {
  return STALE_CHUNK.test(err?.message || '') || STALE_CHUNK.test(err?.name || '');
}

// Reload ONCE to pull the fresh index.html (which references the new chunk names). Timestamp-
// guarded in sessionStorage so a genuinely-missing chunk can't loop the tab; returns false when
// the guard suppresses the reload (i.e. we just reloaded and it didn't help → let the caller show
// a manual fallback instead). Exported so main.jsx's `vite:preloadError` handler shares it.
export function reloadOnceForStaleChunk() {
  try {
    const last = Number(sessionStorage.getItem('chunkReloadAt') || 0);
    if (Date.now() - last < 10000) return false;
    sessionStorage.setItem('chunkReloadAt', String(Date.now()));
  } catch {
    /* sessionStorage unavailable (private mode) — reload anyway; a loop is unlikely and recoverable */
  }
  window.location.reload();
  return true;
}

// App-wide safety net. Without it, a stale-chunk import rejection (or any render crash) unwinds
// through Suspense with nothing to catch it and the whole tree unmounts to a blank white page.
export default class ErrorBoundary extends Component {
  state = { phase: null }; // null | 'reloading' | 'crashed'

  static getDerivedStateFromError(err) {
    // Render a static splash for a stale chunk (stops the throw-loop while the reload is in flight);
    // a real crash gets the manual fallback.
    return { phase: isStaleChunkError(err) ? 'reloading' : 'crashed' };
  }

  componentDidCatch(err) {
    if (isStaleChunkError(err)) {
      // If the guard blocked the reload, the reload already didn't fix it → show the manual fallback.
      if (!reloadOnceForStaleChunk()) this.setState({ phase: 'crashed' });
      return;
    }
    console.error('[app] uncaught render error', err);
  }

  render() {
    if (this.state.phase === 'reloading') {
      return (
        <div className="flex min-h-screen items-center justify-center bg-surface p-6 text-sm text-fg-muted">
          Updating to the latest version…
        </div>
      );
    }
    if (this.state.phase === 'crashed') {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-surface p-6 text-center">
          <h1 className="text-lg font-semibold text-fg">Something went wrong</h1>
          <p className="max-w-sm text-sm text-fg-muted">
            The page hit an unexpected error. Reloading usually fixes it.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-700"
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
