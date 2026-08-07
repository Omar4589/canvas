import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client.js';
import SourcePicker from '../components/packet/SourcePicker.jsx';
import DesignPanel from '../components/packet/DesignPanel.jsx';
import PaperPreview from '../components/packet/PaperPreview.jsx';
import { loadSettings, saveSettings, resolveLayout } from '../lib/packet/packetSettings.js';
import { renderPacketPdf, packetFilename } from '../lib/packet/packetPdf.js';
import { scanUnprintableNames } from '../lib/pdfText.js';

// The Print Studio. Pick books on the left, watch the real PDF in the middle, turn knobs on
// the right — and the number that moves while you turn them is PAGES, because paper is the
// cost this screen exists to make visible before someone commits to a print run.
//
// Print-only, permanently: nothing a volunteer writes on these sheets comes back into
// Doorline. That is a product decision, not a gap, and the page says so out loud rather than
// letting a field director assume a returned packet means the work is recorded.

const EMPTY = { kind: 'books', turfIds: [] };

export default function PrintPacketsPage() {
  const { campaignId } = useParams();
  const [params] = useSearchParams();

  const [selection, setSelection] = useState(EMPTY);
  const [settings, setSettings] = useState(() => loadSettings(campaignId));
  const [debounced, setDebounced] = useState(settings);
  const [pages, setPages] = useState(0);
  const [downloading, setDownloading] = useState(false);

  // Deep links from the Books panel and the Saved Searches page land here pre-selected.
  useEffect(() => {
    const turfIds = params.get('turfIds');
    const walkListId = params.get('walkListId');
    if (walkListId) setSelection({ kind: 'walklist', walkListId });
    else if (turfIds) setSelection({ kind: 'books', turfIds: turfIds.split(',').filter(Boolean) });
  }, [params]);

  // Settings drive a full re-render of the document, so they are debounced; the panel itself
  // stays instant because it reads `settings`, not `debounced`.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(settings), 250);
    return () => clearTimeout(t);
  }, [settings]);

  useEffect(() => { saveSettings(campaignId, settings); }, [campaignId, settings]);

  const sourcesQ = useQuery({
    queryKey: ['admin', 'packet-sources', campaignId],
    queryFn: ({ signal }) => api(`/admin/campaigns/${campaignId}/packets/sources`, { signal }),
    staleTime: 60 * 1000,
  });

  const hasPick =
    selection.kind === 'walklist' ? !!selection.walkListId : selection.turfIds.length > 0;

  const dataKey = useMemo(
    () =>
      selection.kind === 'walklist'
        ? `w:${selection.walkListId}`
        : `b:${[...selection.turfIds].sort().join(',')}`,
    [selection]
  );

  const dataQ = useQuery({
    queryKey: ['admin', 'packet-data', campaignId, dataKey, debounced.includePhone],
    enabled: hasPick,
    // The payload is the same for every layout, so switching layout or note lines re-renders
    // the PDF without going back to the server. Only the phone opt-in changes what is sent.
    staleTime: 60 * 1000,
    retry: false,
    queryFn: ({ signal }) => {
      const qs = new URLSearchParams();
      if (selection.kind === 'walklist') qs.set('walkListId', selection.walkListId);
      else qs.set('turfIds', selection.turfIds.join(','));
      if (debounced.includePhone) qs.set('includePhone', '1');
      return api(`/admin/campaigns/${campaignId}/packets/data?${qs}`, { signal });
    },
  });

  const payload = dataQ.data || null;
  const hasSurvey = !!payload?.books?.some((b) => b.survey) || !!sourcesQ.data?.hasSurvey;
  const effective = useMemo(
    () => ({ ...debounced, layout: resolveLayout(debounced, hasSurvey) }),
    [debounced, hasSurvey]
  );
  const unprintable = useMemo(() => (payload ? scanUnprintableNames(payload) : null), [payload]);

  const onPages = useCallback((n) => setPages(n), []);

  const download = async () => {
    if (!payload) return;
    setDownloading(true);
    try {
      const doc = await renderPacketPdf(payload, effective);
      doc.save(packetFilename(payload, effective));
    } finally {
      setDownloading(false);
    }
  };

  const capError = dataQ.error?.data?.error === 'packet-too-large' ? dataQ.error.data : null;

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div className="px-6 pt-5 pb-3 border-b border-border">
        <h1 className="text-xl font-semibold text-fg">Print packets</h1>
        <p className="text-sm text-muted-fg mt-1 max-w-3xl">
          Paper walk packets for volunteers who aren&apos;t using the app.{' '}
          <strong className="text-fg">
            Nothing written on these sheets comes back into Doorline
          </strong>{' '}
          — a book walked on paper keeps reading as unknocked in coverage, on the map, and in
          reports.
        </p>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <aside
          className="border-r border-border overflow-y-auto p-4"
          style={{ width: 260, flex: 'none', minHeight: 0 }}
        >
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-fg mb-3">
            What to print
          </h2>
          <SourcePicker
            sources={sourcesQ.data}
            loading={sourcesQ.isLoading}
            selection={selection}
            onChange={setSelection}
          />
        </aside>

        <main style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }} className="p-4">
          {capError ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="max-w-sm text-center">
                <p className="text-sm font-medium text-fg">{capError.message}</p>
                <p className="text-xs text-muted-fg mt-2">
                  Deselect a few books and print the rest separately — a packet that quietly
                  stopped short would send nobody to those doors.
                </p>
              </div>
            </div>
          ) : dataQ.isError ? (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-sm text-muted-fg">{dataQ.error?.message || 'Could not load those doors.'}</p>
            </div>
          ) : !hasPick ? (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-sm text-muted-fg">Pick a book on the left to see the packet.</p>
            </div>
          ) : dataQ.isLoading ? (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-sm text-muted-fg">Loading doors…</p>
            </div>
          ) : (
            <PaperPreview payload={payload} settings={effective} onPages={onPages} />
          )}

          {payload?.warnings?.length > 0 && (
            <ul className="mt-3 text-xs text-muted-fg space-y-1">
              {payload.warnings.map((w) => <li key={w}>{w}</li>)}
            </ul>
          )}
        </main>

        <aside
          className="border-l border-border p-4"
          style={{ width: 250, flex: 'none', minHeight: 0, display: 'flex', flexDirection: 'column' }}
        >
          <DesignPanel
            settings={settings}
            onChange={setSettings}
            hasSurvey={hasSurvey}
            unprintable={unprintable}
            pages={pages}
            doorCount={payload?.totals?.doors || 0}
            busy={downloading || dataQ.isFetching}
            onDownload={download}
          />
        </aside>
      </div>
    </div>
  );
}
