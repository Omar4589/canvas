import { renderToString } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import { QueryClient } from '@tanstack/react-query';
import AppTree from './AppTree.jsx';
import LandingPage from './pages/LandingPage.jsx';
import { AAPC, aapcPhaseScript } from './marketing/aapc.js';

// Build-time entry: `vite build --ssr src/entry-prerender.jsx --outDir .ssr`, then
// client/scripts/prerender.js renders each page below to dist/.prerendered/<file>, which
// server/src/app.js serves at the page's clean URL. The first paint — a QR scan on conference Wi-Fi —
// then needs no JavaScript at all; the page hydrates in place once the bundle arrives.
//
// Each page renders through the SAME tree the browser hydrates (AppTree), signed out, with its
// component handed in directly instead of lazy-loaded: renderToString can't wait on a lazy import, and
// main.jsx loads the page's module before hydrating for the same reason. `module` is the page's
// source path as the client build's manifest names it, so the script can preload exactly that chunk.
export const PAGES = {
  landing: { path: '/', file: 'index.html', module: 'src/pages/LandingPage.jsx', Component: LandingPage },
};

export const render = (name) => {
  const { path, Component } = PAGES[name];
  return renderToString(
    <AppTree
      queryClient={new QueryClient()}
      Router={StaticRouter}
      routerProps={{ location: path }}
      pages={{ [name]: Component }}
    />
  );
};

// The AAPC banner's date switch, inlined into <head> before first paint (marketing/aapc.js). Null
// while /aapc isn't live — the banner isn't in the page then either.
export const headScript = () => (AAPC.pageLive ? aapcPhaseScript() : null);
