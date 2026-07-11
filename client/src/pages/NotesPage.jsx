import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth, useOrgTimeZone } from '../auth/AuthContext.jsx';
import DateRangeSelector, { RANGE_PRESETS } from '../components/DateRangeSelector.jsx';
import { defaultRange, labelForRange } from '../lib/datePresets.js';
import { formatInTz } from '../lib/datetime.js';
import { useCampaignTeam } from '../lib/useCampaignTeam.js';
import { Card, Badge } from '../components/ui/index.js';

function buildQuery(params) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === '') continue;
    sp.set(k, v);
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

// Door / Survey / Admin(VoterNote). `countKey` maps to the server counts object.
const SOURCES = [
  { key: 'door', label: 'Door', countKey: 'door', color: '#3b82f6' },
  { key: 'survey', label: 'Survey', countKey: 'survey', color: '#22c55e' },
  { key: 'voter', label: 'Admin', countKey: 'voter', color: '#8b5cf6' },
];

const ACTION_LABEL = {
  not_home: 'Not home',
  wrong_address: 'Wrong address',
  refused: 'Refused',
  restricted: 'Restricted',
  lit_dropped: 'Lit dropped',
  survey_submitted: 'Survey',
  note_added: 'Note',
};

const LIMIT = 50;

// Centralized campaign notes hub: every field door note, survey note, and admin/profile note in one
// searchable, filterable, VIEW-ONLY list. Campaign-scoped (like Timeline/Audit). Voter-scoped notes
// link to the voter profile; household-only notes link to the map focused on that household.
export default function NotesPage() {
  const { campaignId } = useParams();
  const orgTz = useOrgTimeZone();
  const { homePath } = useAuth();

  const campaignsQ = useQuery({
    queryKey: ['admin', 'campaigns'],
    queryFn: () => api('/admin/campaigns'),
    staleTime: 60 * 1000,
  });
  const campaigns = campaignsQ.data?.campaigns || [];
  const current = campaigns.find((c) => String(c._id) === String(campaignId)) || undefined;
  const tz = current?.timeZone || orgTz;
  const tzReady = !campaignsQ.isLoading;

  const [dateRange, setDateRange] = useState(() => defaultRange('today', orgTz));
  const rangeTouchedRef = useRef(false);
  const [types, setTypes] = useState([]); // [] = all sources
  const [authorId, setAuthorId] = useState('');
  const [effortId, setEffortId] = useState('');
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);

  // Reset all filters when the admin switches campaigns (one mounted element serves every campaign).
  const [prevCampaignId, setPrevCampaignId] = useState(campaignId);
  if (prevCampaignId !== campaignId) {
    setPrevCampaignId(campaignId);
    setDateRange(defaultRange('today', tz));
    rangeTouchedRef.current = false;
    setTypes([]);
    setAuthorId('');
    setEffortId('');
    setQInput('');
    setQ('');
    setPage(0);
  }

  // Default the range to the campaign's "today" once its tz is known (so it's the
  // campaign's day for every admin). Skips if the admin already picked a range.
  useEffect(() => {
    if (rangeTouchedRef.current || !tzReady) return;
    setDateRange(defaultRange('today', tz));
  }, [tzReady, tz]);

  // Debounce the search box.
  useEffect(() => {
    const t = setTimeout(() => setQ(qInput.trim()), 300);
    return () => clearTimeout(t);
  }, [qInput]);

  const typeCsv = types.join(',');
  // Any filter change returns to the first page.
  useEffect(() => {
    setPage(0);
  }, [q, typeCsv, authorId, effortId, dateRange.from, dateRange.to]);

  const effortsQ = useQuery({
    queryKey: ['admin', 'efforts', campaignId],
    queryFn: () => api(`/admin/campaigns/${campaignId}/efforts`),
    enabled: !!campaignId,
  });
  const efforts = effortsQ.data?.efforts || [];

  const { members } = useCampaignTeam(campaignId);
  const authorOptions = useMemo(
    () =>
      (members || [])
        .map((m) => ({ id: String(m.user.id), name: `${m.user.firstName || ''} ${m.user.lastName || ''}`.trim() || m.user.email }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [members]
  );

  const notesQ = useQuery({
    queryKey: ['admin', 'notes', campaignId, q, typeCsv, authorId, effortId, dateRange.from, dateRange.to, page],
    queryFn: () =>
      api(
        `/admin/reports/notes${buildQuery({
          campaignId,
          from: dateRange.from,
          to: dateRange.to,
          type: typeCsv || undefined,
          userId: authorId || undefined,
          effortId: effortId || undefined,
          q: q || undefined,
          page,
          limit: LIMIT,
        })}`
      ),
    enabled: !!campaignId,
    placeholderData: keepPreviousData,
  });
  const data = notesQ.data || {};
  const notes = data.notes || [];
  const counts = data.counts || { door: 0, survey: 0, voter: 0, total: 0 };
  const total = data.total || 0;
  const reportTz = data.timeZone || tz;

  function toggleType(key) {
    setTypes((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

  function onRangeChange(next) {
    rangeTouchedRef.current = true;
    setDateRange(next);
  }

  if (!campaignId || (!campaignsQ.isLoading && !current)) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
        <h1 className="text-xl font-semibold text-fg">Campaign not found</h1>
        <Link to={homePath} className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">
          {homePath === '/campaigns' ? 'Go to Campaigns' : 'Go to Overview'}
        </Link>
      </div>
    );
  }

  const pageStart = page * LIMIT;
  const hasNext = pageStart + notes.length < total;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-fg">{current?.name || 'Campaign'}</h1>
          <div className="mt-1 text-sm text-fg-muted">Notes — everything the field and admins left</div>
        </div>
        <DateRangeSelector value={dateRange} onChange={onRangeChange} tz={tz} presets={RANGE_PRESETS} />
      </div>

      <div className="mb-4 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="search"
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            placeholder="Search note text…"
            className="w-64 rounded border border-border bg-card px-3 py-1.5 text-sm text-fg placeholder:text-fg-subtle focus:border-brand-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
          />
          <div className="flex flex-wrap gap-1">
            {SOURCES.map((s) => {
              const active = types.includes(s.key);
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => toggleType(s.key)}
                  className={
                    'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors ' +
                    (active ? 'border-brand-600 bg-brand-tint text-brand-accent' : 'border-border bg-card text-fg-muted hover:bg-sunken')
                  }
                >
                  <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
                  {s.label}
                  <span className="text-fg-subtle">{counts[s.countKey] ?? 0}</span>
                </button>
              );
            })}
          </div>
          {authorOptions.length > 0 && (
            <select
              value={authorId}
              onChange={(e) => setAuthorId(e.target.value)}
              title="Filter by author"
              className="rounded border border-border-strong bg-card px-2 py-1 text-sm text-fg-muted focus:border-brand-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
            >
              <option value="">Any author</option>
              {authorOptions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          )}
          {efforts.length > 1 && (
            <select
              value={effortId}
              onChange={(e) => setEffortId(e.target.value)}
              title="Filter to one walk list"
              className="rounded border border-border-strong bg-card px-2 py-1 text-sm text-fg-muted focus:border-brand-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
            >
              <option value="">All walk lists</option>
              {efforts.map((ef) => (
                <option key={ef._id} value={ef._id}>
                  {ef.name}
                </option>
              ))}
            </select>
          )}
        </div>
        {effortId && (
          <p className="text-xs text-fg-subtle">Admin notes aren&apos;t tied to a walk list, so they&apos;re hidden while a walk list is selected.</p>
        )}
      </div>

      {data.capped && (
        <div className="mb-3 rounded border border-warning/30 bg-warning-tint px-3 py-1.5 text-xs text-warning-fg">
          Showing the most recent {(data.resultCap || 500).toLocaleString()} per type — narrow the date range or
          filters to see the rest.
        </div>
      )}

      {notesQ.isLoading ? (
        <div className="rounded-lg border border-border bg-card p-4 text-sm text-fg-muted">Loading…</div>
      ) : notesQ.error ? (
        <div className="rounded-lg border border-danger/30 bg-danger-tint p-4 text-sm text-danger">
          Error: {notesQ.error.message}
        </div>
      ) : notes.length === 0 ? (
        <Card className="p-8 text-center text-sm text-fg-muted">
          No notes match these filters{dateRange.preset !== 'all' ? ` in ${labelForRange(dateRange)}` : ''}.
        </Card>
      ) : (
        <>
          <div className="space-y-3">
            {notes.map((n) => (
              <NoteCard key={`${n.source}:${n.id}`} note={n} campaignId={campaignId} tz={reportTz} />
            ))}
          </div>
          <div className="mt-4 flex items-center justify-between text-sm text-fg-muted">
            <span>
              {pageStart + 1}–{pageStart + notes.length} of {total.toLocaleString()}
              {data.capped ? '+' : ''}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="rounded border border-border-strong px-3 py-1 text-sm text-fg-muted hover:bg-sunken disabled:opacity-40"
              >
                ‹ Prev
              </button>
              <button
                type="button"
                onClick={() => setPage((p) => p + 1)}
                disabled={!hasNext}
                className="rounded border border-border-strong px-3 py-1 text-sm text-fg-muted hover:bg-sunken disabled:opacity-40"
              >
                Next ›
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function NoteCard({ note, campaignId, tz }) {
  const src = SOURCES.find((s) => s.key === note.source) || SOURCES[0];
  const when = formatInTz(note.timestamp, tz, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }, true) || '—';
  const link = note.voter
    ? { to: `/voters/${note.voter.id}`, label: 'Open voter →' }
    : note.household
      ? { to: `/campaigns/${campaignId}/map?household=${note.household.id}`, label: 'View on map →' }
      : null;

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="neutral">
            <span className="mr-1 inline-block h-2 w-2 rounded-full align-middle" style={{ backgroundColor: src.color }} />
            {src.label}
          </Badge>
          {note.actionType && note.source === 'door' && (
            <span className="text-xs text-fg-subtle">{ACTION_LABEL[note.actionType] || note.actionType}</span>
          )}
          {note.edited && <span className="text-xs italic text-fg-subtle">edited</span>}
        </div>
        {link && (
          <Link to={link.to} className="shrink-0 text-xs font-semibold text-brand-accent hover:underline">
            {link.label}
          </Link>
        )}
      </div>

      <p className="mt-2 whitespace-pre-wrap break-words text-sm italic text-fg">“{note.note}”</p>

      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-fg-muted">
        <span className="font-medium text-fg-muted">{note.author?.name || 'Unknown'}</span>
        <span aria-hidden="true">·</span>
        <span>{when}</span>
        {note.voter?.name && (
          <>
            <span aria-hidden="true">·</span>
            <span>{note.voter.name}</span>
          </>
        )}
        {note.household?.address && (
          <>
            <span aria-hidden="true">·</span>
            <span className="truncate">{note.household.address}</span>
          </>
        )}
      </div>
    </Card>
  );
}
