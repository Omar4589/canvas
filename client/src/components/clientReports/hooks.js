import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, getToken, getActiveOrgId } from '../../api/client.js';
import { createAutoSaver } from './autoSave.js';
import { buildPollInterval, freshestBuild, isLiveBuild } from './buildState.js';

// The Client Reports pages' small hooks. Every effect here that starts something stops it: media
// listeners, timers, the beforeunload guard, the saver (whose detach flushes with keepalive), a link
// password's request (aborted). The focus one starts nothing.

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

// ── Client links (docs/PROPOSAL_CLIENT_REPORT_LINKS.md §D1) ─────────────────────────────────────────

/**
 * A link's new row, put into the campaign's links list at once: Share, the rows' link lines and the
 * old-links card all read that list, so each follows a change before the list is read again. A row the
 * list hasn't got yet (a link just made) goes first — the list is newest first.
 */
export const putShareRow = (qc, campaignId, row) => {
  if (!row?.id) return;
  qc.setQueryData(sharesKey(campaignId), (d) => {
    if (!d?.shares) return d;
    const has = d.shares.some((s) => s.id === row.id);
    return { ...d, shares: has ? d.shares.map((s) => (s.id === row.id ? row : s)) : [row, ...d.shares] };
  });
};

/** A deleted link leaves the list at once. */
export const dropShareRow = (qc, campaignId, id) =>
  qc.setQueryData(sharesKey(campaignId), (d) => (d?.shares ? { ...d, shares: d.shares.filter((s) => s.id !== id) } : d));

/**
 * Refusals that mean the link changed somewhere else (code review CC-4): deleted (SHARE_NOT_FOUND),
 * renewed (SHARE_NOT_EXPIRED), extended or changed (SHARE_CHANGED), expired meanwhile
 * (SHARE_NEEDS_RENEW), or turned off for everyone by the switch (ALL_REPORTS_LINK, on the old-links
 * card). The screen is showing a link that no longer stands, so the list is read again — otherwise it
 * would keep offering what the server will refuse every time.
 */
export const LINK_MOVED_CODES = new Set(['SHARE_NOT_FOUND', 'SHARE_NOT_EXPIRED', 'SHARE_CHANGED', 'SHARE_NEEDS_RENEW', 'ALL_REPORTS_LINK']);

/**
 * One request on one link — extend, renew, new address, unlock, turn on, change password, delete:
 * `mutate({ path, method, body })` on /admin/client-reports/shares/:id. The answer's row goes into the
 * links list at once (a deleted link leaves it), then `onChanged` reads the list and History again — as
 * it does after a refusal that means the link changed elsewhere (LINK_MOVED_CODES).
 * `onBusy(true | false)` follows the request, for a dialog that must stay open until its answer lands.
 * A changed password rides the answer, so the mutation leaves react-query's cache the moment nothing
 * watches it (gcTime 0): it lives no longer than the screen that shows it.
 */
export const useLinkAction = ({ campaignId, linkId, onChanged, onBusy }) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ path = '', method = 'POST', body }) => api(`/admin/client-reports/shares/${linkId}${path}`, { method, body }),
    gcTime: 0,
    onMutate: () => onBusy?.(true),
    onSettled: () => onBusy?.(false),
    onSuccess: (res, { method }) => {
      if (method === 'DELETE') dropShareRow(qc, campaignId, linkId);
      else if (res?.share) putShareRow(qc, campaignId, res.share);
      onChanged?.();
    },
    onError: (err) => {
      if (LINK_MOVED_CODES.has(err?.code)) onChanged?.();
    },
  });
};

/**
 * The keyboard's next stop after a press that changes what's on screen (code review V2-1, N1). Share and
 * the old-links card swap their controls as a request lands — Turn on goes once the link is on, Renew
 * once it's renewed, Delete with its link, a confirm or a panel once it's done — and a focused button that
 * goes drops the keyboard to <body>, outside the dialog's Tab loop. `focusAfter(find)`, called as the
 * button is pressed, says where it goes instead. It waits while the element that had the keyboard then is
 * still on screen — the answer that takes it away hasn't been drawn yet — and react-query's notification
 * and the screen's own state can be drawn in either order, so it looks again after every render. Then
 * `find()` reads what's drawn: `undefined` while what it wants isn't there yet, else the element to focus
 * (null: none). A request is dropped once the keyboard has moved on by itself (a Tab or a click
 * elsewhere, Copy password taking it as it appears), and a later one replaces it. Focus only: nothing to
 * stop.
 */
export const useFocusAfter = () => {
  const [want, setWant] = useState(null); // { find, from }
  // No dependency list on purpose: what's drawn can catch up on any render.
  useEffect(() => {
    if (!want) return;
    const { activeElement, body } = document;
    const from = want.from && want.from !== body ? want.from : null;
    if (activeElement && activeElement !== body && activeElement !== from) {
      setWant(null);
      return;
    }
    if (from?.isConnected) return;
    const el = want.find();
    if (el === undefined) return;
    el?.focus();
    setWant(null);
  });
  return useCallback((find) => setWant({ find, from: typeof document === 'undefined' ? null : document.activeElement }), []);
};

/**
 * Show (§D1): a link's password, fetched into this component's state — never a react-query cache
 * entry — and gone when it unmounts. `shown` is null, or { id, status, password }: 'loading', 'shown',
 * 'failed' (Try again), 'unavailable' (409 PASSWORD_NOT_VIEWABLE: no copy Doorline can open) or 'staff'
 * (403: Doorline staff never see one). One request at a time: a new Show, `hide` and the unmount each
 * abort the one in flight, and an answer for anything but the latest Show is dropped. A 404 means the
 * link was deleted somewhere else: `onChanged` reads the links list again (code review CC-4), so the
 * link — and its Try again — leave the screen instead of failing forever.
 */
export const useLinkPassword = ({ onChanged } = {}) => {
  const [shown, setShown] = useState(null);
  const ctrl = useRef(null);
  // Read at answer time: `show` is made once, and the screen's handler is often an inline arrow.
  const changedRef = useRef(onChanged);
  changedRef.current = onChanged;
  useEffect(
    () => () => {
      ctrl.current?.abort();
      ctrl.current = null;
    },
    []
  );
  const show = useCallback((id) => {
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    setShown({ id, status: 'loading', password: null });
    api(`/admin/client-reports/shares/${id}/password`, { signal: c.signal }).then(
      (res) => {
        if (ctrl.current !== c) return;
        ctrl.current = null;
        setShown({ id, status: 'shown', password: String(res?.password ?? '') });
      },
      (err) => {
        if (ctrl.current !== c || err?.name === 'AbortError') return;
        ctrl.current = null;
        const status = err?.status === 403 && err?.code === 'STAFF_CANNOT_VIEW_PASSWORD' ? 'staff' : err?.status === 409 ? 'unavailable' : 'failed';
        setShown({ id, status, password: null });
        if (err?.status === 404) changedRef.current?.();
      }
    );
  }, []);
  const hide = useCallback(() => {
    ctrl.current?.abort();
    ctrl.current = null;
    setShown(null);
  }, []);
  return { shown, show, hide };
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
