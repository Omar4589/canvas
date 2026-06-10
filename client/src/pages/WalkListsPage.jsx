import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';
import CampaignSelector, { useCampaignSelection } from '../components/CampaignSelector.jsx';
import AnswerFilters from '../components/AnswerFilters.jsx';
import { useOrgTimeZone } from '../auth/AuthContext.jsx';
import { formatInTz } from '../lib/datetime.js';

const STATUSES = ['unknocked', 'not_home', 'surveyed', 'wrong_address', 'lit_dropped'];
const STATUS_LABEL = {
  unknocked: 'Unknocked',
  not_home: 'Not home',
  surveyed: 'Surveyed',
  wrong_address: 'Wrong address',
  lit_dropped: 'Lit dropped',
};

const EMPTY = {
  genders: [], parties: [], precincts: [], congressional: [], stateSenate: [], stateHouse: [],
  cities: [], zips: [], counties: [], ageMin: '', ageMax: '',
  priorPassId: '', priorPassStatuses: [], surveyResponse: 'any', answerFilters: [], combine: 'and',
};

function buildFilter(f) {
  const out = {};
  const arrs = {
    genders: f.genders, parties: f.parties, precincts: f.precincts,
    congressionalDistricts: f.congressional, stateSenateDistricts: f.stateSenate,
    stateHouseDistricts: f.stateHouse, cities: f.cities, zips: f.zips, counties: f.counties,
  };
  for (const [k, v] of Object.entries(arrs)) {
    const a = (v || []).map((x) => String(x).trim()).filter(Boolean);
    if (a.length) out[k] = a;
  }
  if (f.ageMin) out.ageMin = Number(f.ageMin);
  if (f.ageMax) out.ageMax = Number(f.ageMax);
  if (f.priorPassId) out.priorPassId = f.priorPassId;
  if (f.priorPassStatuses.length) out.priorPassStatuses = f.priorPassStatuses;
  if (f.surveyResponse && f.surveyResponse !== 'any') out.surveyResponse = f.surveyResponse;
  if (f.answerFilters?.length) out.answerFilters = f.answerFilters;
  out.combine = f.combine;
  return out;
}

function TextFilter({ label, value, onChange, placeholder }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-xs font-medium text-fg-muted">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded border border-border-strong bg-card px-2 py-1.5 text-sm text-fg placeholder:text-fg-subtle focus:border-brand-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
      />
    </label>
  );
}

// Searchable multi-select chips. Suggests the campaign's real values but also
// accepts a typed custom value (Enter) so empty/odd data is never a dead end.
function MultiSelect({ label, value, onChange, options = [], placeholder }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const selected = value || [];
  const add = (v) => {
    const t = String(v).trim();
    if (t && !selected.includes(t)) onChange([...selected, t]);
    setQuery('');
  };
  const remove = (v) => onChange(selected.filter((x) => x !== v));
  const filtered = options
    .filter((o) => !selected.includes(o))
    .filter((o) => o.toLowerCase().includes(query.trim().toLowerCase()))
    .slice(0, 50);
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-xs font-medium text-fg-muted">{label}</span>
      <div className="relative">
        <div className="flex min-h-[34px] flex-wrap items-center gap-1 rounded border border-border-strong bg-card px-1.5 py-1 focus-within:border-brand-accent focus-visible:ring-2 focus-visible:ring-ring/30">
          {selected.map((v) => (
            <span key={v} className="flex items-center gap-1 rounded bg-brand-tint px-1.5 py-0.5 text-xs text-brand-accent">
              {v}
              <button type="button" onClick={() => remove(v)} className="text-brand-accent hover:text-brand-accent" aria-label={`Remove ${v}`}>×</button>
            </span>
          ))}
          <input
            value={query}
            autoComplete="off"
            onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 120)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); if (query.trim()) add(query); }
              else if (e.key === 'Backspace' && !query && selected.length) remove(selected[selected.length - 1]);
            }}
            placeholder={selected.length ? '' : (placeholder || 'Type or pick…')}
            className="min-w-[60px] flex-1 border-0 bg-transparent p-0.5 text-sm text-fg placeholder:text-fg-subtle focus:outline-none focus:ring-0"
          />
        </div>
        {open && filtered.length > 0 && (
          <ul className="absolute left-0 right-0 top-full z-20 mt-1 max-h-48 overflow-auto rounded border border-border bg-card py-1 text-sm shadow-lg">
            {filtered.map((o) => (
              <li key={o}>
                <button
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); add(o); }}
                  className="block w-full px-2 py-1 text-left hover:bg-brand-tint"
                >
                  {o}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </label>
  );
}

export default function WalkListsPage() {
  const qc = useQueryClient();
  const orgTz = useOrgTimeZone();
  const { campaignId, setCampaignId, campaigns, isLoading } = useCampaignSelection();
  // Walk lists belong to the selected campaign → show times in its tz (fallback org).
  const tz = campaigns.find((c) => String(c._id) === String(campaignId))?.timeZone || orgTz;
  const [f, setF] = useState(EMPTY);
  const [name, setName] = useState('');
  const [mode, setMode] = useState('filter');
  const [csvFile, setCsvFile] = useState(null);
  const [idColumn, setIdColumn] = useState('');
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));

  const listsQ = useQuery({
    queryKey: ['admin', 'walklists', campaignId],
    queryFn: () => api(`/admin/campaigns/${campaignId}/walklists`),
    enabled: !!campaignId,
  });
  const passesQ = useQuery({
    queryKey: ['admin', 'passes', campaignId],
    queryFn: () => api(`/admin/campaigns/${campaignId}/passes`),
    enabled: !!campaignId,
  });
  const lists = listsQ.data?.walkLists || [];
  const passes = passesQ.data?.passes || [];

  const distinctQ = useQuery({
    queryKey: ['admin', 'walklist-distinct', campaignId],
    queryFn: () => api(`/admin/campaigns/${campaignId}/walklists/distinct`),
    enabled: !!campaignId,
  });
  const opts = distinctQ.data || {};

  // Survey questions+options for the per-question answer filter (survey campaigns).
  const campaign = campaigns.find((c) => String(c._id) === String(campaignId));
  const surveyQ = useQuery({
    queryKey: ['reports', 'survey-results', campaignId],
    queryFn: () => api(`/admin/reports/survey-results?campaignId=${campaignId}`),
    enabled: !!campaignId && campaign?.type !== 'lit_drop',
  });
  const surveyQuestions = (surveyQ.data?.questions || []).filter(
    (q) => q.type === 'single_choice' || q.type === 'multiple_choice'
  );

  const preview = useMutation({
    mutationFn: () => api(`/admin/campaigns/${campaignId}/walklists/preview`, { method: 'POST', body: { filter: buildFilter(f) } }),
  });
  const save = useMutation({
    mutationFn: () => api(`/admin/campaigns/${campaignId}/walklists`, { method: 'POST', body: { name, filter: buildFilter(f) } }),
    onSuccess: () => {
      setName('');
      qc.invalidateQueries({ queryKey: ['admin', 'walklists', campaignId] });
    },
  });
  const del = useMutation({
    mutationFn: (id) => api(`/admin/campaigns/${campaignId}/walklists/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'walklists', campaignId] }),
  });

  // Build a frozen list by uploading a CSV of Voter IDs (matched by stateVoterId).
  const csvPreview = useMutation({
    mutationFn: ({ file, idColumn: col }) => {
      const fd = new FormData();
      fd.append('file', file);
      if (col) fd.append('idColumn', col);
      return api(`/admin/campaigns/${campaignId}/walklists/from-csv/preview`, { method: 'POST', formData: fd });
    },
  });
  const csvSave = useMutation({
    mutationFn: ({ file, name: listName, idColumn: col }) => {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('name', listName);
      if (col) fd.append('idColumn', col);
      return api(`/admin/campaigns/${campaignId}/walklists/from-csv`, { method: 'POST', formData: fd });
    },
    onSuccess: () => {
      setName('');
      setCsvFile(null);
      setIdColumn('');
      csvPreview.reset();
      qc.invalidateQueries({ queryKey: ['admin', 'walklists', campaignId] });
    },
  });

  // When the server can't auto-detect the Voter-ID column it 400s with the column list.
  const colError = csvPreview.error?.data?.columns ? csvPreview.error.data : null;

  function onPickCsv(file) {
    setCsvFile(file);
    setIdColumn('');
    csvSave.reset();
    if (file && campaignId) csvPreview.mutate({ file });
    else csvPreview.reset();
  }

  function downloadUnmatched() {
    const ids = csvPreview.data?.notFoundIds || [];
    if (!ids.length) return;
    const blob = new Blob([`voterId\n${ids.join('\n')}\n`], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'unmatched-voter-ids.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  function toggleStatus(s) {
    set('priorPassStatuses', f.priorPassStatuses.includes(s)
      ? f.priorPassStatuses.filter((x) => x !== s)
      : [...f.priorPassStatuses, s]);
  }

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Walk Lists</h1>
        <CampaignSelector campaignId={campaignId} onChange={setCampaignId} campaigns={campaigns} isLoading={isLoading} />
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        {/* Builder */}
        <section className="rounded-lg border border-border bg-card p-5">
          <h2 className="mb-1 text-base font-medium">Build a list</h2>
          <p className="mb-3 text-xs text-fg-muted">Build from demographic/geographic filters, or upload a CSV of Voter IDs. Saved lists are frozen snapshots.</p>

          <div className="mb-4 inline-flex rounded-md border border-border-strong p-0.5 text-sm">
            {[['filter', 'Filter builder'], ['csv', 'Upload CSV']].map(([m, label]) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`rounded px-3 py-1 font-medium ${mode === m ? 'bg-brand-600 text-white' : 'text-fg-muted hover:bg-sunken'}`}
              >
                {label}
              </button>
            ))}
          </div>

          {mode === 'filter' && (
          <>
          <p className="mb-4 text-xs text-fg-muted">Pick values from each list (or type a custom one and press Enter). Empty = no restriction.</p>

          <div className="mb-4">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-subtle">Demographics</div>
            <div className="grid gap-3 sm:grid-cols-3">
              <MultiSelect label="Genders" value={f.genders} onChange={(v) => set('genders', v)} options={opts.genders} placeholder="M, F" />
              <MultiSelect label="Parties" value={f.parties} onChange={(v) => set('parties', v)} options={opts.parties} placeholder="DEM, REP" />
              <MultiSelect label="Precincts" value={f.precincts} onChange={(v) => set('precincts', v)} options={opts.precincts} placeholder="12, 13" />
              <MultiSelect label="Congressional" value={f.congressional} onChange={(v) => set('congressional', v)} options={opts.congressional} />
              <MultiSelect label="State senate" value={f.stateSenate} onChange={(v) => set('stateSenate', v)} options={opts.stateSenate} />
              <MultiSelect label="State house" value={f.stateHouse} onChange={(v) => set('stateHouse', v)} options={opts.stateHouse} />
              <div className="grid grid-cols-2 gap-2">
                <TextFilter label="Age min" value={f.ageMin} onChange={(v) => set('ageMin', v)} placeholder="18" />
                <TextFilter label="Age max" value={f.ageMax} onChange={(v) => set('ageMax', v)} placeholder="35" />
              </div>
            </div>
          </div>

          <div className="mb-4">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-subtle">Geography</div>
            <div className="grid gap-3 sm:grid-cols-3">
              <MultiSelect label="Cities" value={f.cities} onChange={(v) => set('cities', v)} options={opts.cities} />
              <MultiSelect label="ZIPs" value={f.zips} onChange={(v) => set('zips', v)} options={opts.zips} />
              <MultiSelect label="Counties" value={f.counties} onChange={(v) => set('counties', v)} options={opts.counties} />
            </div>
          </div>

          <div className="mb-4">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-subtle">Prior pass</div>
            <div className="flex flex-wrap items-end gap-4">
              <label className="text-sm">
                <span className="mb-1 block text-xs font-medium text-fg-muted">From pass</span>
                <select
                  value={f.priorPassId}
                  onChange={(e) => set('priorPassId', e.target.value)}
                  className="rounded border border-border-strong bg-card px-2 py-1.5 text-sm text-fg focus:border-brand-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                >
                  <option value="">—</option>
                  {passes.map((p) => (
                    <option key={p._id} value={p._id}>Pass {p.roundNumber} · {p.name}</option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-xs font-medium text-fg-muted">Has survey response</span>
                <select
                  value={f.surveyResponse}
                  onChange={(e) => set('surveyResponse', e.target.value)}
                  className="rounded border border-border-strong bg-card px-2 py-1.5 text-sm text-fg focus:border-brand-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                >
                  <option value="any">Any</option>
                  <option value="exists">Has a response</option>
                  <option value="not_exists">No response</option>
                </select>
              </label>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
              <span className="font-medium text-fg-muted">Door status:</span>
              {STATUSES.map((s) => (
                <label key={s} className="flex items-center gap-1">
                  <input type="checkbox" checked={f.priorPassStatuses.includes(s)} onChange={() => toggleStatus(s)} />
                  {STATUS_LABEL[s]}
                </label>
              ))}
              <span className="text-fg-subtle">
                {f.priorPassId ? 'status within the selected pass' : 'no pass picked → the door’s current status'}
              </span>
            </div>

            {surveyQuestions.length > 0 && (
              <div className="mt-3">
                <div className="mb-1 text-xs font-medium text-fg-muted">Survey answers</div>
                <AnswerFilters questions={surveyQuestions} value={f.answerFilters} onChange={(v) => set('answerFilters', v)} />
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
            <label className="flex items-center gap-2 text-sm">
              <span className="text-xs font-medium text-fg-muted">Combine</span>
              <select value={f.combine} onChange={(e) => set('combine', e.target.value)} className="rounded border border-border-strong bg-card px-2 py-1 text-sm text-fg">
                <option value="and">AND (match all)</option>
                <option value="or">OR (match any)</option>
              </select>
              <span className="text-xs text-fg-subtle">only affects results when 2+ filters are set</span>
            </label>
            <button onClick={() => preview.mutate()} disabled={preview.isPending} className="rounded border border-border-strong px-3 py-1.5 text-sm font-medium hover:bg-sunken disabled:opacity-60">
              {preview.isPending ? 'Counting…' : 'Preview count'}
            </button>
            {preview.data && (
              <span className="text-sm text-fg-muted">
                <b>{preview.data.householdCount?.toLocaleString()}</b> households · <b>{preview.data.voterCount?.toLocaleString()}</b> voters
              </span>
            )}
          </div>

          <div className="mt-4 flex items-center gap-2">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="List name (e.g. Undecideds R1)" className="rounded border border-border-strong bg-card px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-brand-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30" />
            <button onClick={() => name && save.mutate()} disabled={!name || save.isPending} className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
              {save.isPending ? 'Saving…' : 'Save list'}
            </button>
            <button onClick={() => { setF(EMPTY); preview.reset(); }} className="text-xs text-fg-muted hover:underline">Reset</button>
          </div>
          {(save.error || preview.error) && (
            <div className="mt-2 text-xs text-danger">{(save.error || preview.error).message}</div>
          )}
          </>
          )}

          {mode === 'csv' && (
            <div>
              <p className="mb-3 text-xs text-fg-muted">
                Upload a CSV of Voter IDs (any column that looks like a Voter ID is auto-detected). We match them to
                this campaign's voters and freeze the doors they live at into a list. A door joins the list if <em>any</em> of
                its voters is in your file — claiming the door later moves <em>all</em> voters there. IDs not yet imported
                into this campaign won't match.
              </p>
              <label className="block text-sm">
                <span className="mb-1 block text-xs font-medium text-fg-muted">Voter-ID CSV</span>
                <input
                  type="file"
                  accept=".csv"
                  disabled={!campaignId}
                  onChange={(e) => onPickCsv(e.target.files?.[0] || null)}
                  className="block w-full text-sm disabled:opacity-50"
                />
              </label>
              {csvPreview.isPending && <p className="mt-2 text-xs text-fg-muted">Matching…</p>}

              {colError && (
                <div className="mt-3 rounded border border-warning/30 bg-warning-tint p-3 text-xs text-warning-fg">
                  Couldn't auto-detect a Voter ID column. Pick the column that holds Voter IDs:
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <select value={idColumn} onChange={(e) => setIdColumn(e.target.value)} className="rounded border border-border-strong bg-card px-2 py-1 text-sm text-fg">
                      <option value="">— Choose column —</option>
                      {colError.columns.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <button
                      type="button"
                      onClick={() => idColumn && csvFile && csvPreview.mutate({ file: csvFile, idColumn })}
                      disabled={!idColumn}
                      className="rounded border border-border-strong px-2 py-1 text-sm font-medium hover:bg-card disabled:opacity-50"
                    >
                      Match column
                    </button>
                  </div>
                </div>
              )}
              {csvPreview.error && !colError && <p className="mt-2 text-xs text-danger">{csvPreview.error.message}</p>}

              {csvPreview.data && (
                <div className="mt-3 rounded border border-border bg-sunken p-4 text-sm">
                  <div className="mb-2 text-xs text-fg-muted">
                    Matched on column <span className="font-mono font-medium">{csvPreview.data.idColumn}</span> · {csvPreview.data.idsInFile?.toLocaleString()} IDs in file
                  </div>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <div><span className="text-fg-muted">Matched voters</span><div className="text-lg font-semibold text-success">{csvPreview.data.matched?.toLocaleString()}</div></div>
                    <div><span className="text-fg-muted">Doors (households)</span><div className="text-lg font-semibold text-fg">{csvPreview.data.householdCount?.toLocaleString()}</div></div>
                    <div><span className="text-fg-muted">Voters at those doors</span><div className="text-lg font-semibold text-fg-muted">{csvPreview.data.voterCount?.toLocaleString()}</div></div>
                    <div><span className="text-fg-muted">Not in this campaign</span><div className="text-lg font-semibold text-fg-subtle">{csvPreview.data.notFound?.toLocaleString()}</div></div>
                  </div>
                  {csvPreview.data.ownedDoors > 0 && (
                    <div className="mt-3 rounded border border-warning/30 bg-warning-tint px-3 py-2 text-xs text-warning-fg">
                      <strong>{csvPreview.data.ownedDoors.toLocaleString()}</strong> of these doors are already in another effort
                      {csvPreview.data.ownedByEffort?.length ? ` (${csvPreview.data.ownedByEffort.map((o) => `${o.name}: ${o.count}`).join(', ')})` : ''}.
                      You can still save this list — but claiming it into an effort will ask you to move (re-carve) those doors.
                    </div>
                  )}
                  {csvPreview.data.noCoordinates > 0 && (
                    <p className="mt-2 text-xs text-fg-muted">{csvPreview.data.noCoordinates.toLocaleString()} matched door(s) have no map coordinates and were left out (they can't be cut).</p>
                  )}
                  {csvPreview.data.notFound > 0 && (
                    <button type="button" onClick={downloadUnmatched} className="mt-3 text-xs font-semibold text-brand-accent hover:underline">
                      Download {csvPreview.data.notFound.toLocaleString()} unmatched ID{csvPreview.data.notFound === 1 ? '' : 's'}
                    </button>
                  )}
                </div>
              )}

              <div className="mt-4 flex items-center gap-2">
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="List name (e.g. First-election voters)" className="rounded border border-border-strong bg-card px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-brand-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30" />
                <button
                  onClick={() => name && csvFile && csvSave.mutate({ file: csvFile, name, idColumn: idColumn || undefined })}
                  disabled={!name || !csvFile || !csvPreview.data?.householdCount || csvSave.isPending}
                  className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
                >
                  {csvSave.isPending ? 'Saving…' : 'Save list'}
                </button>
              </div>
              {csvSave.error && <div className="mt-2 text-xs text-danger">{csvSave.error.message}</div>}
            </div>
          )}
        </section>

        {/* Saved lists */}
        <section className="rounded-lg border border-border bg-card p-5">
          <h2 className="mb-3 text-base font-medium">Saved lists</h2>
          {listsQ.isLoading ? (
            <div className="text-sm text-fg-muted">Loading…</div>
          ) : !lists.length ? (
            <div className="text-sm text-fg-muted">None yet.</div>
          ) : (
            <ul className="space-y-2">
              {lists.map((w) => (
                <li key={w._id} className="rounded border border-border p-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate font-medium">{w.name}</span>
                      {w.source === 'csv' && (
                        <span className="shrink-0 rounded bg-brand-tint px-1.5 py-0.5 text-[10px] font-medium text-brand-accent" title={w.sourceMeta?.fileName || 'Built from an uploaded Voter-ID CSV'}>from CSV</span>
                      )}
                    </span>
                    <button onClick={() => del.mutate(w._id)} className="shrink-0 text-xs text-danger hover:underline">Delete</button>
                  </div>
                  <div className="text-xs text-fg-muted">
                    {w.householdCount?.toLocaleString()} hh · {w.voterCount?.toLocaleString()} voters · {formatInTz(w.createdAt, tz, { year: 'numeric', month: 'numeric', day: 'numeric' }, false)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
