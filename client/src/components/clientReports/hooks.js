import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, getToken, getActiveOrgId } from '../../api/client.js';
import { createAutoSaver } from './autoSave.js';
import { buildPollInterval, freshestBuild, isLiveBuild } from './buildState.js';

// The Client Reports pages' small hooks. Every effect here that starts something stops it: media
// listeners, timers, the beforeunload guard, the saver (whose detach flushes with keepalive).

export const reportKey = (id) => ['admin', 'client-report', id];
export const reportsKey = (campaignId) => ['admin', 'client-reports', campaignId];
export const buildKey = (id) => ['admin', 'client-report-build', id];
export const seriesKey = (campaignId) => ['admin', 'client-report-series', campaignId];
export const sharesKey = (campaignId) => ['admin', 'client-report-shares', campaignId];
// The Client Reports History asks the campaign feed with ?include=client_reports and gets ONLY those
// rows — so it has its OWN key: the general drawer and the phone share ['admin','campaign-history',id].
export const historyKey = (campaignId) => ['admin', 'client-report-history', campaignId];
export const brandingKey = ['admin', 'branding'];

/** True while a CSS media query matches; follows changes, and stops listening on unmount. */
export const useMediaQuery = (query) => {
  const get = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false);
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    onChange();
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, [query]);
  return matches;
};

/** Copy text to the clipboard; `copied` names what was copied for 1.5 s. The timer dies with the page. */
export const useCopy = () => {
  const [copied, setCopied] = useState(null);
  const timerRef = useRef(null);
  useEffect(() => () => clearTimeout(timerRef.current), []);
  const copy = useCallback((text, key = 'default') => {
    const done = () => {
      setCopied(key);
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(null), 1500);
    };
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      return navigator.clipboard.writeText(text).then(done, () => setCopied(`${key}:failed`));
    }
    setCopied(`${key}:failed`);
    return Promise.resolve();
  }, []);
  return { copied, copy };
};

/**
 * A report's build, polled while it is live (§G1): GET /:id/build every 3 s while queued or running,
 * every 15 s while it waits, never otherwise. `build` is the build from the page's own data (the list
 * row or the report) and `sourceUpdatedAt` when that data arrived; whichever is newer is shown. When a
 * live build settles, `onSettled` runs once (the page re-reads its numbers).
 *
 * A failed poll (ADMINUX-7): 404 (the report was deleted) or 403 (no longer yours to see) stops the
 * polling and re-reads the report and the lists, so the page says so instead of "Queued" forever;
 * anything else backs off — 6 s, 12 s, 24 s … up to a minute — until a poll answers again.
 */
export const useBuildPoll = ({ reportId, build, sourceUpdatedAt = 0, onSettled }) => {
  const qc = useQueryClient();
  // Enabled while the freshest view of the build (freshestBuild) is live. The last poll is read
  // without subscribing (the observer below re-renders on every poll, so this read is never stale); a
  // fresh live build from the page — a claim just made — re-enables it, and react-query fetches at
  // once because the cached poll is stale.
  const last = reportId ? qc.getQueryState(buildKey(reportId)) : null;
  const before = freshestBuild({ polled: last?.data, polledAt: last?.dataUpdatedAt, source: build, sourceAt: sourceUpdatedAt });
  const failures = useRef(0); // polls failed in a row (react-query's own count restarts every fetch)
  const q = useQuery({
    queryKey: buildKey(reportId),
    queryFn: ({ signal }) =>
      api(`/admin/client-reports/${reportId}/build`, { signal }).then(
        (r) => {
          failures.current = 0;
          return r.build;
        },
        (err) => {
          if (err?.name !== 'AbortError') failures.current += 1;
          if (err?.status === 404 || err?.status === 403) {
            qc.invalidateQueries({ queryKey: reportKey(reportId) });
            qc.invalidateQueries({ queryKey: ['admin', 'client-reports'] });
          }
          throw err;
        }
      ),
    enabled: !!reportId && isLiveBuild(before),
    refetchInterval: (query) => {
      if (query.state.status === 'error') {
        const gone = query.state.error?.status === 404 || query.state.error?.status === 403;
        return gone ? false : Math.min(60000, 3000 * 2 ** Math.min(Math.max(failures.current, 1), 5));
      }
      return query.state.data ? buildPollInterval(query.state.data) : 3000;
    },
    refetchIntervalInBackground: false,
    retry: false,
  });
  const current = freshestBuild({ polled: q.data, polledAt: q.dataUpdatedAt, source: build, sourceAt: sourceUpdatedAt }) || { status: 'idle' };
  const live = isLiveBuild(current);
  const wasLive = useRef(live);
  const settledRef = useRef(onSettled);
  settledRef.current = onSettled;
  useEffect(() => {
    if (wasLive.current && !live) settledRef.current?.(current);
    wasLive.current = live;
    // `current` is read only on the live → settled edge; the status is the dependency that matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, current?.status]);
  return { build: current, isFetching: q.isFetching };
};

// ── The copy kept on this device ──────────────────────────────────────────────────────────────
// A change that hasn't reached the report: an unsent edit of a published report, a draft change
// refused because someone published it (C5), or one the unmount keepalive tried (P-3). Kept with
// the settings it was made against (`base`) and their editVersion, so restoring it later runs the
// same three-way merge as any change made elsewhere — only YOUR changes go back on top.
const UNSENT_KEY = (id) => `doorline.clientReport.unsentEdit.${id}`;
export const readUnsent = (id) => {
  try {
    const raw = localStorage.getItem(UNSENT_KEY(id));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};
export const writeUnsent = (id, value) => {
  try {
    if (value) localStorage.setItem(UNSENT_KEY(id), JSON.stringify(value));
    else localStorage.removeItem(UNSENT_KEY(id));
  } catch {
    /* private window or blocked storage: the edit just isn't kept */
  }
};

/**
 * A PATCH that outlives the page (fetch keepalive): the unmount flush of a pending auto-save. A draft
 * save, so it carries ifStatus: 'draft' like the rest (contract C5) — if the report was published
 * meanwhile it is refused, never written onto the client's page — and the version the screen was
 * built on (C8), so it never writes over a change made elsewhere. The page kept a copy first.
 * Resolves true when the server took it (2xx), false otherwise — a refusal, a failure, or nobody left
 * to hear the answer (the tab closed: the copy then waits for the next visit's check).
 */
export const keepalivePatch = (reportId, body, version = null) => {
  if (typeof fetch === 'undefined') return Promise.resolve(false);
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  const orgId = getActiveOrgId();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (orgId) headers['X-Org-Id'] = orgId;
  const sent = { ...body, ifStatus: 'draft', ...(Number.isInteger(version) ? { ifEditVersion: version } : {}) };
  return fetch(`/api/admin/client-reports/${reportId}`, { method: 'PATCH', headers, body: JSON.stringify(sent), keepalive: true }).then(
    (res) => !!res?.ok,
    () => false
  );
};

/**
 * Auto-save for a draft's settings (§G3), mounted once per report. Returns the saver and its state.
 * `onSaved(report, body, version)` gets the server's fresh report, what was sent and the version it
 * was pinned to after each save; `onAdopt` the settings the server normalized. On unmount anything
 * still unsaved is kept on this device, then leaves with keepalive.
 *
 * Every save says it is a DRAFT save (ifStatus: 'draft', contract C5): a report someone published
 * while this page was open refuses it 409 STATUS_CHANGED, so half-written text never goes live without
 * a confirm (ADMINUX-2) — the page keeps it as an unsent edit instead. And every save is pinned to
 * `versionOf()`, the editVersion the screen was built on (C8): one refused 409 CHANGED_ELSEWHERE
 * hands the report that came back to `onChangedElsewhere(report)` and parks the saver until the page
 * has merged.
 */
export const useAutoSave = ({ reportId, versionOf, onSaved, onAdopt, onChangedElsewhere }) => {
  const [state, setState] = useState({ status: 'idle', error: null, savedAt: null, dirty: false, held: false, parked: false });
  const cbs = useRef({ versionOf, onSaved, onAdopt, onChangedElsewhere });
  cbs.current = { versionOf, onSaved, onAdopt, onChangedElsewhere };
  const saverRef = useRef(null);
  if (!saverRef.current || saverRef.current.reportId !== reportId) {
    const versionNow = () => {
      const v = cbs.current.versionOf?.();
      return Number.isInteger(v) ? v : null;
    };
    let keptAt = null; // the `at` of the copy the last way out kept
    saverRef.current = {
      reportId,
      saver: createAutoSaver({
        send: (body) => {
          const version = versionNow();
          return api(`/admin/client-reports/${reportId}`, {
            method: 'PATCH',
            body: { ...body, ifStatus: 'draft', ...(version != null ? { ifEditVersion: version } : {}) },
          }).then(
            (res) => {
              cbs.current.onSaved?.(res.report, body, version);
              return res.report;
            },
            (err) => {
              // The builder re-reads the report on this refusal, so its words say what the page shows
              // next (parts.jsx errorText), never "reload it".
              if (err?.code === 'STATUS_CHANGED') err.reread = true;
              if (err?.code === 'CHANGED_ELSEWHERE') cbs.current.onChangedElsewhere?.(err.data?.report || null);
              throw err;
            }
          );
        },
        // The way out (P-3): the copy is kept BEFORE the keepalive leaves, and taken back as soon as the
        // server says it took the change (VERIFY2-2) — otherwise a change that DID save would come back
        // later as "didn't save" once someone changed the same field. Only the copy this way out wrote
        // (its `at`): never a newer one. Refused or failed, it stays and is offered next time.
        sendKeepalive: (body) => {
          const at = keptAt;
          keepalivePatch(reportId, body, versionNow()).then((ok) => {
            if (ok && at != null && readUnsent(reportId)?.at === at) writeUnsent(reportId, null);
          });
        },
        onDetach: ({ settings, base }) => {
          keptAt = Date.now();
          writeUnsent(reportId, { settings, base, version: versionNow(), at: keptAt });
        },
        onState: setState,
        onAdopt: (settings, info) => cbs.current.onAdopt?.(settings, info),
      }),
    };
  }
  const saver = saverRef.current.saver;
  // Detach when the page leaves (or the report changes): what is unsaved leaves with keepalive.
  useEffect(() => {
    saver.attach();
    return () => saver.detach();
  }, [saver]);
  return { saver, state };
};

/**
 * The browser's own "Leave site?" prompt while `dirty` — a save pending, in flight or failed (§G3).
 * There is no data router here (<BrowserRouter>), so in-app links are guarded by the builder itself.
 */
export const useLeaveGuard = (dirty) => {
  useEffect(() => {
    if (!dirty || typeof window === 'undefined') return undefined;
    const onBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = '';
      return '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);
};

/** Invalidate everything a report change can move: the report, its build, the list and the series. */
export const useReportInvalidator = (campaignId) => {
  const qc = useQueryClient();
  return useCallback(
    (reportId) => {
      if (reportId) {
        qc.invalidateQueries({ queryKey: reportKey(reportId) });
        qc.invalidateQueries({ queryKey: ['admin', 'client-report-preview', reportId] });
      }
      qc.invalidateQueries({ queryKey: reportsKey(campaignId) });
      qc.invalidateQueries({ queryKey: historyKey(campaignId) });
    },
    [qc, campaignId]
  );
};
