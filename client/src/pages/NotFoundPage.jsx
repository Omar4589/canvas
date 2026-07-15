import { useEffect } from 'react';

// Rendered by App.jsx's catch-all for junk paths typed INSIDE the SPA, which used to bounce
// silently to the homepage — a soft 404, the worst answer for both a user and a crawler.
// Unknown top-level paths never reach React anymore: the server answers them with a real
// HTTP 404 and the static twin of this page (client/public/404.html — keep the two visually
// in step). Plain <a href> on purpose: a hard nav out of a dead end is correct.
export default function NotFoundPage() {
  useEffect(() => {
    document.title = 'Page not found — Doorline';
  }, []);

  return (
    // Public page — keep light regardless of the app's saved theme.
    <div className="theme-light flex min-h-screen items-center justify-center bg-gray-50 px-4 text-gray-900">
      <div className="w-full max-w-md rounded-lg bg-white p-8 text-center shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-wide text-red-600">404</p>
        <h1 className="mt-2 text-2xl font-semibold text-gray-900">Page not found</h1>
        <p className="mt-3 text-sm leading-relaxed text-gray-600">
          This page doesn&rsquo;t exist, or it moved. If you followed a link from an email, it may
          have expired.
        </p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <a href="/" className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700">
            Go to doorline.app
          </a>
          <a href="/login" className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
            Sign in
          </a>
        </div>
      </div>
    </div>
  );
}
