import { useEffect, useRef, useState } from 'react';
import { renderPacketPdf } from '../../lib/packet/packetPdf.js';
import { Button } from '../ui/index.js';

// The preview IS the artifact. It renders the real PDF and shows those exact bytes in an
// iframe, rather than mocking the page in HTML — a walk packet is mostly its pagination, and
// an HTML "paper look" would have to re-derive every page break in CSS and would drift from
// the printed result the first time either side changed.
//
// Two things this component must never leak: the object URL behind the iframe, and a render
// that finished after a newer one started.
export default function PaperPreview({ payload, settings, onPages, onReady }) {
  const [url, setUrl] = useState(null);
  const [pages, setPages] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [retry, setRetry] = useState(0);
  const urlRef = useRef(null);
  const genRef = useRef(0);

  useEffect(() => {
    if (!payload) return undefined;
    const gen = ++genRef.current;
    let cancelled = false;
    setBusy(true);
    setError(null);

    (async () => {
      try {
        const doc = await renderPacketPdf(payload, settings);
        // A slower earlier render must never paint over a newer one.
        if (cancelled || gen !== genRef.current) return;
        // Hand the rendered document up so Download can save THESE bytes instead of
        // spending another second re-rendering a PDF that is already in memory.
        onReady?.(doc);
        const blob = doc.output('blob');
        const next = URL.createObjectURL(blob);
        if (urlRef.current) URL.revokeObjectURL(urlRef.current);
        urlRef.current = next;
        setUrl(next);
        setPages(doc.getNumberOfPages());
        onPages?.(doc.getNumberOfPages());
      } catch (err) {
        if (!cancelled && gen === genRef.current) setError(err?.message || 'Could not build the preview.');
      } finally {
        if (!cancelled && gen === genRef.current) setBusy(false);
      }
    })();

    return () => { cancelled = true; };
  }, [payload, settings, onPages, onReady, retry]);

  // Unmount: the last URL still has to go, or the blob is pinned for the tab's lifetime.
  useEffect(() => () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
  }, []);

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div className="flex items-center justify-between gap-3 pb-3">
        <div className="text-sm text-fg-muted" aria-live="polite">
          {busy ? 'Building preview…' : pages ? `${pages} pages · ${Math.ceil(pages / 2)} sheets double-sided` : ' '}
        </div>
        {url && (
          <a href={url} target="_blank" rel="noreferrer" className="text-sm text-brand-accent hover:underline">
            Open in a new tab
          </a>
        )}
      </div>

      <div
        className="flex-1 rounded-lg border border-border bg-sunken overflow-hidden"
        style={{ minHeight: 0, position: 'relative' }}
      >
        {error ? (
          <div className="h-full flex items-center justify-center p-6 text-center">
            <div>
              <p className="text-sm font-medium text-fg">{error}</p>
              <Button className="mt-3" onClick={() => { setError(null); setRetry((n) => n + 1); }}>
                Try again
              </Button>
            </div>
          </div>
        ) : url ? (
          <iframe
            title="Walk packet preview"
            src={url}
            style={{ width: '100%', height: '100%', border: 0, opacity: busy ? 0.5 : 1, transition: 'opacity .15s' }}
          />
        ) : (
          <div className="h-full flex items-center justify-center text-sm text-fg-muted">
            {busy ? 'Building preview…' : 'Pick a book to see the packet.'}
          </div>
        )}
      </div>
    </div>
  );
}
