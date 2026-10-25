import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client.js';
import { formatInTz, formatDateInTz } from '../../lib/datetime.js';
import { todayInTz } from '../../lib/datePresets.js';
import { actionLabel } from '../../lib/statusColors.js';
import { summarySentence, secondsText } from '../../lib/pacePause.js';

// "What automatic pause would have done" (docs/PROPOSAL_PACE_PAUSE.md §I.1): every moment the rule WOULD have
// paused someone on this campaign over a range, nobody actually paused. Org admins only, and loaded only when
// opened — it reads the canvassers' whole timelines on the server.
const MAX_DAYS = 120;
// 1st, 2nd, 3rd, 4th … 11th, 12th, 13th … 21st.
export const ordinal = (n) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};

const shiftDay = (ymd, days) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};

export const PreviewList = ({ data, tz }) => {
  const pauses = data?.pauses || [];
  if (!pauses.length) {
    return <p className="text-sm text-fg-muted">It would not have paused anyone on this campaign in that range.</p>;
  }
  return (
    <ul className="divide-y divide-border">
      {pauses.map((p, i) => (
        <li key={i} className="py-3">
          <p className="text-sm font-medium text-fg">
            {p.name || 'A canvasser'}
            <span className="ml-2 text-xs font-normal text-fg-muted">
              would have been paused {formatInTz(p.at, tz)}{p.entry ? `, on their ${ordinal(p.entry)} door that day` : ''}
            </span>
          </p>
          <p className="mt-0.5 text-xs text-fg">{summarySentence(p.summary)}</p>
          <details className="mt-1 text-xs">
            <summary className="cursor-pointer text-brand-accent">The doors</summary>
            <ul className="mt-1 space-y-0.5">
              {p.window.map((v, j) => (
                <li key={j} className={v.fail ? 'text-danger' : 'text-fg-muted'}>
                  {formatInTz(v.at, tz, { hour: 'numeric', minute: '2-digit', second: '2-digit' })} · {v.address || '—'} · {actionLabel(v.result)}
                  {v.gapSec != null ? ` · ${secondsText(v.gapSec)} after the last house` : ''}
                  {v.fail ? ' · too fast' : ''}
                </li>
              ))}
            </ul>
          </details>
        </li>
      ))}
    </ul>
  );
};

const PacePausePreview = ({ campaignId, tz }) => {
  const today = todayInTz(tz);
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(() => shiftDay(today, -29));
  const [to, setTo] = useState(today);
  const span = (Date.parse(to) - Date.parse(from)) / 86400000 + 1;
  const valid = span >= 1 && span <= MAX_DAYS;
  const q = useQuery({
    queryKey: ['admin', 'pace-pauses', 'preview', campaignId, from, to],
    queryFn: () => api(`/admin/pace-pauses/preview?campaignId=${campaignId}&from=${from}&to=${to}`),
    enabled: open && valid,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  return (
    <section className="mb-6 rounded-lg border border-border bg-card p-4" aria-label="What automatic pause would have done">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-fg">What automatic pause would have done</h2>
          <p className="text-xs text-fg-muted">
            Every time the rule would have paused someone on this campaign — nobody is actually paused. Includes doors since
            unknocked; the live check reads only the doors still recorded.
          </p>
        </div>
        <button type="button" onClick={() => setOpen((v) => !v)} className="text-xs font-semibold text-brand-accent hover:underline">
          {open ? 'Hide' : 'Show'}
        </button>
      </div>
      {open && (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
            <label>
              From <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="ml-1 rounded border border-border-strong bg-card px-2 py-1 text-fg" />
            </label>
            <label>
              To <input type="date" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} className="ml-1 rounded border border-border-strong bg-card px-2 py-1 text-fg" />
            </label>
            {!valid && <span className="text-danger">Choose a range of 1 to {MAX_DAYS} days.</span>}
          </div>
          {q.isLoading ? (
            <p className="text-sm text-fg-muted">Working it out for {formatDateInTz(`${from}T12:00:00Z`, tz)} to {formatDateInTz(`${to}T12:00:00Z`, tz)}…</p>
          ) : q.error ? (
            <p className="text-sm text-danger">{q.error.message}</p>
          ) : q.data ? (
            <PreviewList data={q.data} tz={q.data.campaign?.timeZone || tz} />
          ) : null}
        </div>
      )}
    </section>
  );
};

export default PacePausePreview;
