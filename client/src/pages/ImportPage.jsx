import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { useOrgTimeZone } from '../auth/AuthContext.jsx';
import { formatInTz } from '../lib/datetime.js';
import RowMenu from '../components/RowMenu.jsx';
import NextStepBanner from '../components/NextStepBanner.jsx';

const MAX_FILE_BYTES = 50 * 1024 * 1024; // server-enforced upload cap
// Previews always run on the worker (enqueued + polled) — the old 15 MB sync/async
// fork was a memory cliff: a 14.9 MB file parsed inline on the web dyno.
const fmtMB = (b) => `${(b / (1024 * 1024)).toFixed(1)} MB`;

function fmt(n) {
  return n == null ? '—' : Number(n).toLocaleString();
}

const STATUS_LABEL = {
  pending: 'Pending',
  parsing: 'Parsing',
  geocoding: 'Geocoding',
  linking: 'Linking',
  importing: 'Importing',
  completed: 'Completed',
  failed: 'Failed',
  // phase-only value (a preview's status stays 'parsing' while it diffs)
  diffing: 'Comparing',
};

// Every non-terminal server status. Poll predicates and progress display key off
// this — a status missing here silently stops the jobs list from polling mid-run.
const ACTIVE_STATUSES = ['pending', 'parsing', 'geocoding', 'linking', 'importing'];

// Pending-preview button text: "queued" and "working" must read as different
// states — a job stuck at pending means no worker has claimed it, and the elapsed
// clock is what makes that visibly wrong. Re-renders ride the 1.5s poll.
function previewPendingLabel(job) {
  if (!job) return 'Analyzing…';
  if (job.status === 'pending') {
    const ms = Date.now() - new Date(job.createdAt).getTime();
    const s = Math.max(0, Math.floor(ms / 1000));
    return `Queued — waiting for a worker (${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')})`;
  }
  const stage = STATUS_LABEL[job.phase] || STATUS_LABEL[job.status] || 'Analyzing';
  const pct = job.progress != null && job.status !== 'pending' ? ` ${job.progress}%` : '';
  return `${stage}${pct}…`;
}

function StatusBadge({ job }) {
  const cls = {
    pending: 'bg-sunken text-fg-muted',
    parsing: 'bg-warning-tint text-warning-fg',
    geocoding: 'bg-warning-tint text-warning-fg',
    linking: 'bg-warning-tint text-warning-fg',
    importing: 'bg-brand-tint text-brand-accent',
    completed: 'bg-success-tint text-success',
    failed: 'bg-danger-tint text-danger',
  }[job.status] || 'bg-sunken text-fg-muted';
  const inProgress = ACTIVE_STATUSES.includes(job.status);
  const showPct = inProgress && job.progress != null;
  return (
    <span className={`rounded px-2 py-0.5 text-xs ${cls}`}>
      {STATUS_LABEL[job.status] || job.status}
      {showPct ? ` ${job.progress}%` : ''}
    </span>
  );
}

const addr1 = (norm) => String(norm || '').split('|')[0];

// Excel error literals ("=#NUM!", "#REF!", …) frozen into cell text by a failed
// formula in the source spreadsheet. Mirrors SPREADSHEET_ERROR_RE in
// server/src/services/import/csvImporter.js — keep in sync.
const SPREADSHEET_ERROR_RE = /^=?#(NULL!|DIV\/0!|VALUE!|REF!|NAME\?|NUM!|N\/A|SPILL!|CALC!)$/i;

// Above this share of skipped rows, Confirm & import requires an explicit
// acknowledgment — a broken or mis-mapped ID column silently losing most of a
// file should never be one unread click away.
const SKIP_ACK_SHARE = 0.2;

const skippedRowCount = (rowIssues) =>
  rowIssues.missingRequired + rowIssues.noCoordinates + rowIssues.duplicateInFile + (rowIssues.spreadsheetErrors || 0);

function DiffStat({ label, value, amber }) {
  const hot = amber && value > 0;
  return (
    <div className={`rounded border p-3 ${hot ? 'border-warning/30 bg-warning-tint' : 'border-border bg-card'}`}>
      <div className="text-xs uppercase tracking-wide text-fg-muted">{label}</div>
      <div className={`mt-1 text-xl font-semibold ${hot ? 'text-warning-fg' : 'text-fg'}`}>{fmt(value)}</div>
    </div>
  );
}

function SampleList({ title, count, children }) {
  if (!count) return null;
  return (
    <details className="rounded border border-border bg-card">
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium">{title} ({fmt(count)})</summary>
      <div className="border-t border-border px-3 py-2 text-xs text-fg-muted">{children}</div>
    </details>
  );
}

function ReviewPanel({ diff }) {
  const { totals, rowIssues, samples } = diff;
  const spreadsheetErrors = rowIssues.spreadsheetErrors || 0; // pre-upgrade persisted diffs lack the field
  const skipped = skippedRowCount(rowIssues);
  const skipShare = totals.totalRows ? skipped / totals.totalRows : 0;
  const hasWarnings = totals.movedVoters > 0 || totals.orphanedDoors > 0 || totals.nearDuplicates > 0;
  return (
    <div className="mb-4 rounded border border-border bg-sunken p-4">
      <h3 className="mb-3 text-sm font-medium">Review changes before importing</h3>
      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
        <DiffStat label="New doors" value={totals.newDoors} />
        <DiffStat label="Existing doors" value={totals.existingDoors} />
        <DiffStat label="New voters" value={totals.newVoters} />
        <DiffStat label="Updated voters" value={totals.updatedVoters} />
        <DiffStat label="Voters moving doors" value={totals.movedVoters} amber />
        <DiffStat label="Doors emptied" value={totals.orphanedDoors} amber />
        <DiffStat label="Near-dup addresses" value={totals.nearDuplicates} amber />
        <DiffStat label="Rows skipped" value={skipped} amber />
      </div>

      <p className="mt-2 text-xs text-fg-muted">
        {fmt(totals.validCount)} of {fmt(totals.totalRows)} rows in the file will import.
      </p>

      {/* A broken ID column (spreadsheet error literals) or a heavy skip share is a
          file problem, not routine cleanup — say so in red, with the repeated values
          named, before the operator reads the healthy-looking counts above. */}
      {(spreadsheetErrors > 0 || skipShare > SKIP_ACK_SHARE) && (
        <div className="mt-3 rounded border border-danger/30 bg-danger-tint px-3 py-2 text-xs text-danger">
          <p className="text-sm font-semibold">
            {spreadsheetErrors > 0
              ? 'The column mapped to State Voter ID is broken in this file.'
              : 'Most of this file would be skipped.'}
          </p>
          <p className="mt-1">
            {spreadsheetErrors > 0 &&
              `${fmt(spreadsheetErrors)} rows have a spreadsheet error value (like =#NUM!) where their ID should
              be — the formula that built that column failed before the file was exported. `}
            {rowIssues.duplicateInFile > 0 &&
              `${fmt(rowIssues.duplicateInFile)} rows repeat an earlier row's ID and would be dropped (first kept). `}
            Only {fmt(totals.validCount)} of {fmt(totals.totalRows)} rows would import.
          </p>
          {samples.dupValues?.length > 0 && (
            <ul className="mt-1 space-y-0.5">
              {samples.dupValues.map((d, i) => (
                <li key={i}>
                  <code className="rounded bg-danger-tint px-1">{d.value}</code> — {fmt(d.dropped)} row{d.dropped === 1 ? '' : 's'} dropped
                </li>
              ))}
            </ul>
          )}
          <p className="mt-1">
            Fix the file and re-export it, or go Back and map a column that uniquely identifies each
            person (a vendor ID) as State Voter ID.
          </p>
        </div>
      )}

      {diff.persons?.enabled && (
        <p className="mt-3 text-xs text-fg-muted">
          <span className="font-medium text-fg">Shared voter database:</span>{' '}
          links to {fmt(diff.persons.existingPeople)} existing {diff.persons.existingPeople === 1 ? 'person' : 'people'} ·
          {' '}adds {fmt(diff.persons.newPeople)} new {diff.persons.newPeople === 1 ? 'person' : 'people'}
        </p>
      )}

      {hasWarnings && (
        <p className="mt-3 text-xs text-warning-fg">
          Amber items are worth a look before you confirm: voters changing addresses, doors that will be
          emptied (and dropped from the field), and addresses that look like re-spellings of existing ones.
        </p>
      )}

      <div className="mt-3 space-y-2">
        <SampleList title="Voters moving to a different door" count={totals.movedVoters}>
          <ul className="space-y-1">
            {samples.moved.map((m, i) => (
              <li key={i}>
                <span className="font-medium">{m.name || m.stateVoterId}</span>: {addr1(m.fromAddress)} → {addr1(m.toAddress)}{m.toIsNew ? ' (new door → Intake)' : ''}
              </li>
            ))}
            {totals.movedVoters > samples.moved.length && (
              <li className="text-fg-subtle">+{fmt(totals.movedVoters - samples.moved.length)} more</li>
            )}
          </ul>
        </SampleList>
        <SampleList title="Doors that will be emptied" count={totals.orphanedDoors}>
          <ul className="space-y-1">
            {samples.orphans.map((o, i) => (
              <li key={i}>{addr1(o.address)} ({fmt(o.voterCount)} voter{o.voterCount === 1 ? '' : 's'} leaving)</li>
            ))}
            {totals.orphanedDoors > samples.orphans.length && (
              <li className="text-fg-subtle">+{fmt(totals.orphanedDoors - samples.orphans.length)} more</li>
            )}
          </ul>
        </SampleList>
        <SampleList title="Near-duplicate addresses (won't merge)" count={totals.nearDuplicates}>
          <ul className="space-y-1">
            {samples.nearDups.map((n, i) => (
              <li key={i}>{addr1(n.newAddress)} ↔ {addr1(n.existingAddress)}</li>
            ))}
            {totals.nearDuplicates > samples.nearDups.length && (
              <li className="text-fg-subtle">+{fmt(totals.nearDuplicates - samples.nearDups.length)} more</li>
            )}
          </ul>
        </SampleList>
        <SampleList title="Rows skipped" count={skipped}>
          {rowIssues.missingRequired > 0 && <div>{fmt(rowIssues.missingRequired)} missing required fields</div>}
          {rowIssues.noCoordinates > 0 && <div>{fmt(rowIssues.noCoordinates)} missing/invalid coordinates</div>}
          {rowIssues.duplicateInFile > 0 && <div>{fmt(rowIssues.duplicateInFile)} rows repeating an earlier row&apos;s Voter ID (first kept)</div>}
          {spreadsheetErrors > 0 && <div>{fmt(spreadsheetErrors)} rows with a spreadsheet error value (=#NUM!, #REF!, …) as their Voter ID</div>}
        </SampleList>
        {/* Kept doors whose PIN is suspect — nothing here is skipped (a suspect pin walks; a
            dropped door doesn't). These import as-is and are what `repair:import-pins` cleans
            up afterward. The gate and the count use the SAME expression: only what still needs
            a human's attention (unsettled ties + placeholder-pin doors) — a disagreement the
            majority vote already settled is resolved, not suspect. Old persisted diffs lack
            the fields, hence the || 0 guards. */}
        {(rowIssues.coordConflictTies || 0) + (rowIssues.placeholderPinDoors || 0) > 0 && (
          <SampleList
            title="Doors imported with a suspect map pin"
            count={(rowIssues.coordConflictTies || 0) + (rowIssues.placeholderPinDoors || 0)}
          >
            {(rowIssues.coordConflictTies || 0) > 0 && (
              <div>
                {fmt(rowIssues.coordConflictTies)}{' '}
                {rowIssues.coordConflictTies === 1 ? 'address' : 'addresses'} had rows disagreeing about where
                the house is, with nothing to settle it — the first pin was kept
              </div>
            )}
            {(rowIssues.placeholderPinDoors || 0) > 0 && (
              <div>
                {fmt(rowIssues.placeholderPinDoors)} {rowIssues.placeholderPinDoors === 1 ? 'door sits' : 'doors sit'} on
                an exact map spot shared with doors from <em>other streets</em> — usually placeholder coordinates the
                vendor stamped on addresses it couldn&apos;t place. They import and stay walkable, but on the wrong
                dot; ask your Doorline contact to run the pin repair before cutting turf.
              </div>
            )}
          </SampleList>
        )}
      </div>
    </div>
  );
}

// Fields whose hand edits are protected from imports — field key → user-facing label.
const HAND_EDIT_FIELD_LABELS = {
  firstName: 'First name',
  lastName: 'Last name',
  fullName: 'Full name',
  phone: 'Phone',
  phoneType: 'Phone type',
  cellPhone: 'Cell phone',
  party: 'Party',
  gender: 'Gender',
  dateOfBirth: 'Date of birth',
  registrationStatus: 'Registration status',
};
const handEditFieldLabel = (f) => HAND_EDIT_FIELD_LABELS[f] || f;

function fmtHandEditValue(field, v) {
  if (v == null || v === '') return '—';
  if (field === 'dateOfBirth') {
    const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/); // ISO date — render date-only, no timezone shift
    if (m) return `${Number(m[2])}/${Number(m[3])}/${m[1]}`;
  }
  return String(v);
}
const quoteHandEditValue = (field, v) => {
  const t = fmtHandEditValue(field, v);
  return t === '—' ? t : `“${t}”`;
};

function HandEditConflictsPanel({ conflicts, overwrite, onToggle }) {
  if (!conflicts?.fields) return null;
  const { voters, fields, byField = {}, sample = [] } = conflicts;
  const chipFields = [
    ...Object.keys(HAND_EDIT_FIELD_LABELS).filter((f) => byField[f] > 0),
    ...Object.keys(byField).filter((f) => !(f in HAND_EDIT_FIELD_LABELS) && byField[f] > 0),
  ];
  return (
    <div className={`mb-4 rounded border p-4 ${overwrite ? 'border-danger/30 bg-danger-tint' : 'border-warning/30 bg-warning-tint'}`}>
      <h3 className={`mb-2 text-sm font-medium ${overwrite ? 'text-danger' : 'text-warning-fg'}`}>
        Hand-edited voter info differs from this file
      </h3>
      <p className="text-sm text-fg-muted">
        Your team hand-corrected <strong className="text-fg">{fmt(fields)}</strong> value{fields === 1 ? '' : 's'} on{' '}
        <strong className="text-fg">{fmt(voters)}</strong> voter{voters === 1 ? '' : 's'} — for example a phone number
        confirmed at the door. This file has different values for them. By default your edits are kept and everything
        else imports normally.
      </p>
      {chipFields.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {chipFields.map((f) => (
            <span
              key={f}
              className={`rounded border bg-card px-2 py-0.5 text-xs text-fg ${overwrite ? 'border-danger/30' : 'border-warning/30'}`}
            >
              {handEditFieldLabel(f)} ×{fmt(byField[f])}
            </span>
          ))}
        </div>
      )}
      {sample.length > 0 && (
        <div className="mt-3">
          <SampleList title="Hand-edited values that differ" count={fields}>
            <ul className="space-y-1">
              {sample.map((s, i) => (
                <li key={i}>
                  <span className="font-medium">{s.name || s.stateVoterId}</span> — {handEditFieldLabel(s.field)}:
                  keeps {quoteHandEditValue(s.field, s.keptValue)} · file has {quoteHandEditValue(s.field, s.fileValue)}
                </li>
              ))}
              {fields > sample.length && (
                <li className="text-fg-subtle">+{fmt(fields - sample.length)} more</li>
              )}
            </ul>
          </SampleList>
        </div>
      )}
      <label className="mt-3 flex items-start gap-2 rounded border border-border bg-card p-3 text-sm">
        <input
          type="checkbox"
          checked={overwrite}
          onChange={(e) => onToggle(e.target.checked)}
          className="mt-0.5"
        />
        <span>
          <span className="font-medium text-fg">Overwrite these hand edits with the file&apos;s values</span>
          <span className="mt-0.5 block text-xs text-fg-muted">
            Replaces every value shown above and clears its protection, so future imports update these fields again.
            This cannot be undone — Undo import never reverts changes to existing voters.
          </span>
        </span>
      </label>
    </div>
  );
}

function DetectionPanel({ detection, explode, onToggleExplode, busy }) {
  if (!detection) return null;
  const { multiMember, warnings = [], format } = detection;
  if (!multiMember?.detected && !warnings.length) return null;
  const blocking = warnings.find((w) => w.type === 'missing_coordinates');
  const advisories = warnings.filter((w) => w.type !== 'missing_coordinates');
  return (
    <div className="mb-4 rounded border border-border bg-card p-4">
      <h3 className="mb-2 text-sm font-medium">What we detected{format === 'xlsx' ? ' · Excel file' : ''}</h3>
      {multiMember?.detected && (
        <div className="mb-3 rounded border border-border-strong bg-sunken px-3 py-2">
          <div className="text-sm font-medium">This file packs multiple voters per row — up to {multiMember.memberCount}.</div>
          <label className="mt-2 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={!!explode} disabled={busy} onChange={(e) => onToggleExplode(e.target.checked)} />
            <span>Explode multi-member rows into one voter each</span>
          </label>
          <p className="mt-1 text-xs text-fg-muted">
            {explode
              ? `${fmt(multiMember.sourceRows)} rows → ${fmt(multiMember.explodedVoters)} voters.`
              : `Off — importing only the first voter per row (${fmt(multiMember.sourceRows)} voters; the rest are skipped).`}
          </p>
        </div>
      )}
      {blocking && (
        <div className="mb-2 rounded border border-danger/30 bg-danger-tint px-3 py-2 text-xs text-danger">{blocking.detail}</div>
      )}
      {advisories.map((w, i) => (
        <div key={i} className="mb-2 rounded border border-warning/30 bg-warning-tint px-3 py-2 text-xs text-warning-fg">{w.detail}</div>
      ))}
    </div>
  );
}

function GeocodingPanel({ geocoding, result, onCheck, checking }) {
  if (!geocoding || !geocoding.uniqueNeedingGeocode) return null;
  const { uniqueNeedingGeocode, cachedMatched, newToGeocode, badZip } = geocoding;
  return (
    <div className="mb-4 rounded border border-border bg-card p-4">
      <h3 className="mb-2 text-sm font-medium">Geocoding</h3>
      {!result ? (
        <>
          <p className="text-sm text-fg-muted">
            <strong>{fmt(uniqueNeedingGeocode)}</strong> address{uniqueNeedingGeocode === 1 ? '' : 'es'} need coordinates.{' '}
            {cachedMatched > 0 && <>{fmt(cachedMatched)} already cached · </>}
            {newToGeocode > 0 ? (
              <><strong>{fmt(newToGeocode)}</strong> new lookup{newToGeocode === 1 ? '' : 's'}</>
            ) : 'all cached'}.
            {badZip > 0 && <> {fmt(badZip)} have no valid ZIP and can’t be geocoded.</>}
          </p>
          <p className="mt-1 text-xs text-fg-subtle">
            Geocoding runs when you import (Geocodio typically places ~95%+ of US addresses). Results are cached, so re-imports are free.
          </p>
          {newToGeocode > 0 && (
            <button
              onClick={onCheck}
              disabled={checking}
              className="mt-2 rounded border border-border-strong px-3 py-1 text-xs font-medium hover:bg-sunken disabled:opacity-60"
            >
              {checking ? 'Geocoding…' : 'See exact placement'}
            </button>
          )}
        </>
      ) : (
        <div className="text-sm">
          <p>
            <strong className="text-success">{fmt(result.placeable)}</strong> will place and import.{' '}
            {result.unplaceable > 0 && <><strong className="text-warning-fg">{fmt(result.unplaceable)}</strong> couldn’t be located.</>}
            {result.failed > 0 && <> {fmt(result.failed)} hit a temporary error (re-import retries).</>}
          </p>
          <p className="mt-1 text-xs text-fg-muted">
            Geocoded {fmt(result.geocodedNew)} new + {fmt(result.geocodedCached)} cached. The import is now free (cached).
          </p>
          {result.sample?.length > 0 && (
            <details className="mt-2 rounded border border-border bg-sunken">
              <summary className="cursor-pointer px-3 py-1 text-xs font-medium">Couldn’t place — sample ({result.sample.length})</summary>
              <ul className="space-y-0.5 border-t border-border px-3 py-2 text-xs text-fg-muted">
                {result.sample.map((s, i) => <li key={i}>{addr1(s.address)} — {s.reason}</li>)}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

export default function ImportPage() {
  const queryClient = useQueryClient();
  const orgTz = useOrgTimeZone();
  const navigate = useNavigate();
  const [file, setFile] = useState(null);
  // The campaign being imported into comes from the drill-in URL (/campaigns/:id/import).
  const { campaignId } = useParams();
  const [columns, setColumns] = useState([]);
  const [mapping, setMapping] = useState({});
  const [profileName, setProfileName] = useState('');
  const [step, setStep] = useState('select'); // 'select' | 'map' | 'review'
  const [justImported, setJustImported] = useState(null); // campaignId of the last queued import
  // Job ids survive a refresh via sessionStorage — losing them orphaned the queued
  // job with no way to see its result or cancel it.
  const [previewJobId, setPreviewJobIdState] = useState(() => {
    try { return sessionStorage.getItem('import.previewJobId') || null; } catch { return null; }
  });
  const setPreviewJobId = (id) => {
    setPreviewJobIdState(id);
    try {
      if (id) sessionStorage.setItem('import.previewJobId', id);
      else sessionStorage.removeItem('import.previewJobId');
    } catch { /* storage unavailable — state alone still works */ }
  };
  const [fileNote, setFileNote] = useState(null); // { tooBig } | { sizeText, estRows, sheetName?, otherSheets? }
  const latestFileRef = useRef(null); // the pick a returning peek must still match
  const [explode, setExplode] = useState(true); // smart import: explode multi-voter-per-row files
  const [geocodeCheckJobId, setGeocodeCheckJobIdState] = useState(() => {
    try { return sessionStorage.getItem('import.geocodeCheckJobId') || null; } catch { return null; }
  });
  const setGeocodeCheckJobId = (id) => {
    setGeocodeCheckJobIdState(id);
    try {
      if (id) sessionStorage.setItem('import.geocodeCheckJobId', id);
      else sessionStorage.removeItem('import.geocodeCheckJobId');
    } catch { /* ignore */ }
  };
  const [uidSource, setUidSource] = useState(''); // per-vendor namespace for cross-org uid matching
  const [revisitNewVoters, setRevisitNewVoters] = useState(false); // collect already-worked homes that gain a new voter into a revisit walk list
  const [overwriteHandEdits, setOverwriteHandEdits] = useState(false); // let this file replace values the team hand-corrected (default: keep the edits)
  const [sampleRows, setSampleRows] = useState([]); // preview-headers' 5-row peek — powers the mapping-step error-literal warning
  const [ackSkip, setAckSkip] = useState(false); // explicit "import anyway" consent when most of the file would be skipped

  const campaignsQ = useQuery({
    queryKey: ['admin', 'campaigns'],
    queryFn: () => api('/admin/campaigns'),
  });
  const fieldsQ = useQuery({
    queryKey: ['admin', 'imports', 'fields'],
    queryFn: () => api('/admin/imports/fields'),
  });
  const profilesQ = useQuery({
    queryKey: ['admin', 'imports', 'profiles'],
    queryFn: () => api('/admin/imports/profiles'),
  });

  const { data, isLoading } = useQuery({
    queryKey: ['imports', campaignId],
    queryFn: () => api(`/admin/imports?campaignId=${campaignId}`),
    refetchInterval: (q) => {
      const jobs = q.state.data?.jobs || [];
      return jobs.some((j) => ACTIVE_STATUSES.includes(j.status)) ? 1500 : false;
    },
  });
  const workerStatusQ = useQuery({
    queryKey: ['admin', 'imports', 'worker-status'],
    queryFn: () => api('/admin/imports/worker-status'),
    refetchInterval: 15000,
  });
  const workerOffline = workerStatusQ.data?.online === false;

  const fields = fieldsQ.data?.fields || [];
  const requiredKeys = fieldsQ.data?.required || [];

  const preview = useMutation({
    mutationFn: async (f) => {
      const fd = new FormData();
      fd.append('file', f);
      return api('/admin/imports/preview-headers', { method: 'POST', formData: fd });
    },
    onSuccess: (res, pickedFile) => {
      // Picking a second file before the first peek returns leaves that first
      // response in flight; landing it would paint the wrong file's columns.
      if (pickedFile !== latestFileRef.current) return;
      setColumns(res.columns || []);
      setSampleRows(res.sample || []);
      setMapping(res.suggestedMapping || {});
      // Only the first tab of a workbook is imported — name it, and say what was
      // skipped. Also swap the crude size-based row guess for the real estimate:
      // a file whose data isn't on the first tab otherwise still reads "~200,000
      // rows" while the mapping step shows nine rows of a README.
      setFileNote((n) => (n ? { ...n, sheetName: res.sheetName || null, otherSheets: res.otherSheets || [], estRows: Number.isFinite(res.estimatedRows) ? res.estimatedRows : n.estRows } : n));
      setStep('map');
    },
  });

  const saveProfile = useMutation({
    mutationFn: ({ name, mapping, uidSource }) => api('/admin/imports/profiles', { method: 'POST', body: { name, mapping, uidSource } }),
    onSuccess: () => {
      setProfileName('');
      queryClient.invalidateQueries({ queryKey: ['admin', 'imports', 'profiles'] });
    },
  });

  // Previews run on the worker (parse+diff can exceed the 30s request timeout AND
  // the web dyno's memory) — enqueue, then poll GET /:importId for job.diff.
  const enqueuePreview = useMutation({
    mutationFn: async ({ file, campaignId, mapping, explode }) => {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('campaignId', campaignId);
      fd.append('mapping', JSON.stringify(mapping));
      fd.append('uidSource', uidSource || '');
      fd.append('explode', String(explode !== false));
      return api('/admin/imports/csv/preview-enqueue', { method: 'POST', formData: fd });
    },
    onSuccess: (res) => setPreviewJobId(res.job?._id || null),
  });
  const previewJobQ = useQuery({
    queryKey: ['admin', 'imports', 'preview-job', previewJobId],
    queryFn: () => api(`/admin/imports/${previewJobId}`),
    enabled: !!previewJobId,
    refetchInterval: (q) => {
      const s = q.state.data?.job?.status;
      return s === 'completed' || s === 'failed' ? false : 1500;
    },
  });
  const previewAsyncJob = previewJobQ.data?.job || null;
  useEffect(() => {
    if (previewAsyncJob?.status === 'completed') setStep('review');
  }, [previewAsyncJob?.status]);

  // Cancel a queued preview/import job. 409 means a worker is actively running it.
  const cancelPreview = useMutation({
    mutationFn: (jobId) => api(`/admin/imports/${jobId}/cancel`, { method: 'POST' }),
    onSuccess: () => {
      setPreviewJobId(null);
      enqueuePreview.reset();
    },
  });

  // "See exact placement" — opt-in live geocode (worker-backed, cached), then poll.
  const runGeocodeCheck = useMutation({
    mutationFn: async ({ file, campaignId, mapping, explode }) => {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('campaignId', campaignId);
      fd.append('mapping', JSON.stringify(mapping));
      fd.append('uidSource', uidSource || '');
      fd.append('explode', String(explode !== false));
      return api('/admin/imports/geocode-check', { method: 'POST', formData: fd });
    },
    onSuccess: (res) => setGeocodeCheckJobId(res.job?._id || null),
  });
  const geocodeCheckJobQ = useQuery({
    queryKey: ['admin', 'imports', 'geocode-check', geocodeCheckJobId],
    queryFn: () => api(`/admin/imports/${geocodeCheckJobId}`),
    enabled: !!geocodeCheckJobId,
    refetchInterval: (q) => {
      const s = q.state.data?.job?.status;
      return s === 'completed' || s === 'failed' ? false : 1500;
    },
  });
  const geocodeCheckJob = geocodeCheckJobQ.data?.job || null;
  const geocodeCheckResult = geocodeCheckJob?.status === 'completed' ? geocodeCheckJob.geocodeCheck : null;
  const geocodeChecking =
    runGeocodeCheck.isPending ||
    (!!geocodeCheckJobId && geocodeCheckJob?.status !== 'completed' && geocodeCheckJob?.status !== 'failed');

  const upload = useMutation({
    mutationFn: async ({ file, campaignId, mapping, explode }) => {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('campaignId', campaignId);
      fd.append('mapping', JSON.stringify(mapping));
      fd.append('uidSource', uidSource || '');
      fd.append('explode', String(explode !== false));
      fd.append('revisitNewVoters', String(revisitNewVoters));
      fd.append('overwriteHandEdits', String(overwriteHandEdits));
      return api('/admin/imports/csv', { method: 'POST', formData: fd });
    },
    onSuccess: (_data, variables) => {
      resetSelection();
      queryClient.invalidateQueries({ queryKey: ['imports'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'setup-status', variables.campaignId] });
      queryClient.invalidateQueries({ queryKey: ['campaign-rollup'] });
      setJustImported(variables.campaignId);
    },
  });

  const undo = useMutation({
    mutationFn: (importId) => api(`/admin/imports/${importId}/undo`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['imports'] }),
  });

  function onUndo(job) {
    if (
      !window.confirm(
        'Undo this import? It removes the net-new doors and voters it added that haven’t been claimed, ' +
          'cut, canvassed, surveyed, or voted. Anything already in use is kept. This cannot be re-done.'
      )
    ) return;
    undo.mutate(job._id);
  }

  function resetSelection() {
    setFile(null);
    latestFileRef.current = null; // mirror setFile — else a peek still in flight repaints the cleared form
    setColumns([]);
    setSampleRows([]);
    setAckSkip(false);
    setMapping({});
    setStep('select');
    setFileNote(null);
    setPreviewJobId(null);
    setExplode(true);
    setGeocodeCheckJobId(null);
    setUidSource('');
    setRevisitNewVoters(false);
    setOverwriteHandEdits(false);
    enqueuePreview.reset();
  }

  // Any change to the inputs makes a computed diff stale — drop back to mapping.
  function dropReview() {
    enqueuePreview.reset();
    setPreviewJobId(null);
    setGeocodeCheckJobId(null);
    setAckSkip(false); // consent was given to the OLD diff's skip count
    setStep((s) => (s === 'review' ? 'map' : s));
  }

  function onPickFile(f) {
    setPreviewJobId(null);
    enqueuePreview.reset();
    latestFileRef.current = f; // in-flight peeks for any earlier pick are now stale
    if (!f) { setFile(null); setFileNote(null); setStep('select'); return; }
    setFile(f);
    if (f.size > MAX_FILE_BYTES) {
      setFileNote({ tooBig: true }); // block — server would 413; don't even read headers
      setStep('select');
      return;
    }
    setFileNote({ sizeText: fmtMB(f.size), estRows: Math.round(f.size / 250) });
    preview.mutate(f); // header read is cheap (5-row peek) even for big files
  }

  function applyMapping(next) {
    // Keep only mappings whose column exists in this file's headers.
    const filtered = {};
    for (const [k, col] of Object.entries(next || {})) {
      if (columns.includes(col)) filtered[k] = col;
    }
    setMapping(filtered);
    dropReview();
  }

  const campaign = (campaignsQ.data?.campaigns || []).find((c) => String(c._id) === String(campaignId)) || null;
  const requiredUnmapped = requiredKeys.filter((k) => !mapping[k]);

  // Mapping-step early warning: does the column mapped to State Voter ID carry an
  // Excel error literal in the 5-row peek? Best-effort (the full-file preview is
  // authoritative) but on real broken exports the head of the file is riddled.
  const idColumnLooksBroken =
    !!mapping.stateVoterId &&
    sampleRows.some((r) => SPREADSHEET_ERROR_RE.test(String(r?.[mapping.stateVoterId] ?? '').trim()));

  const tooBig = !!fileNote?.tooBig;
  const diff = previewAsyncJob?.diff;

  // "Import anyway" gate: past SKIP_ACK_SHARE of the file skipped, confirming
  // requires ticking the acknowledgment — the decide-and-continue moment for a
  // broken ID column, made explicit instead of silent.
  const skippedRows = diff ? skippedRowCount(diff.rowIssues) : 0;
  const skipShare = diff?.totals?.totalRows ? skippedRows / diff.totals.totalRows : 0;
  const needsSkipAck = skipShare > SKIP_ACK_SHARE;
  const previewPending =
    enqueuePreview.isPending ||
    Boolean(previewJobId && previewAsyncJob?.status !== 'completed' && previewAsyncJob?.status !== 'failed');
  const previewError =
    enqueuePreview.error ||
    (previewAsyncJob?.status === 'failed'
      ? { message: previewAsyncJob?.errors?.[0]?.reason || 'Background preview failed — check the file and try again.' }
      : null);

  // Not gated on step === 'map': if a race leaves step === 'review' with the diff
  // cleared, the fallback "Preview changes" button must still be usable to recover.
  const canPreview = file && campaignId && requiredUnmapped.length === 0 && !previewPending && !tooBig;
  function triggerPreview() {
    if (!canPreview) return;
    enqueuePreview.mutate({ file, campaignId, mapping, explode });
  }

  // Toggling explode changes the voter count, so re-run the preview with the new value.
  function onToggleExplode(next) {
    setExplode(next);
    setGeocodeCheckJobId(null); // explode change invalidates a prior exact-placement check
    if (!file || !campaignId || requiredUnmapped.length > 0 || tooBig) return;
    enqueuePreview.mutate({ file, campaignId, mapping, explode: next });
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold">Import voters</h1>

      {workerOffline && (
        <div className="mb-6 rounded-md border border-danger/40 bg-danger-tint px-4 py-3 text-sm text-red-800">
          <strong>The import worker appears to be offline.</strong> Queued imports won't run until the
          worker dyno is back on (Heroku → Resources → <code className="rounded bg-danger-tint px-1">worker</code>).
          {workerStatusQ.data?.waiting > 0 && ` ${fmt(workerStatusQ.data.waiting)} import(s) waiting.`}
        </div>
      )}

      <section className="mb-8 rounded-lg border border-border bg-card p-5">
        <h2 className="mb-3 text-base font-medium">Upload voter file</h2>
        <p className="mb-4 text-sm text-fg-muted">
          Each upload is scoped to a single campaign and runs in the background. Map your vendor's
          columns to our fields (i360, L2, a state file, …) — re-uploading is safe and won't lose
          canvass activity. New households fold in via the books editor, not automatically.
        </p>

        <div className="mb-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-fg-muted">Campaign</label>
            <p className="py-2 text-sm font-semibold text-fg">
              {campaign
                ? `${campaign.name} (${campaign.state} · ${campaign.type === 'survey' ? 'Survey' : 'Lit drop'})`
                : campaignsQ.isLoading
                  ? 'Loading…'
                  : 'Unknown campaign'}
            </p>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-fg-muted">CSV or Excel (.xlsx) file</label>
            <input
              type="file"
              accept=".csv,.xlsx"
              onChange={(e) => onPickFile(e.target.files?.[0] || null)}
              className="block w-full text-sm"
            />
            {fileNote?.tooBig && (
              <div className="mt-2 rounded border border-danger/30 bg-danger-tint px-3 py-2 text-xs text-danger">
                This file is over the 50 MB limit. Split it into smaller files (e.g. by region or county) and
                upload each — imports are additive, so the end result is identical.
              </div>
            )}
            {fileNote && !fileNote.tooBig && (
              <p className="mt-1 text-xs text-fg-muted">
                {fileNote.sizeText} · ~{fileNote.estRows.toLocaleString()} rows (est.)
                <span className="text-fg-subtle"> · analyzed in the background (needs the import worker running)</span>
              </p>
            )}
            {preview.isPending && <p className="mt-1 text-xs text-fg-muted">Reading columns…</p>}
            {preview.error && (
              <p className="mt-1 text-xs text-danger">{preview.error.message}</p>
            )}
          </div>
        </div>

        {step === 'map' && (
          <div className="mb-4 rounded border border-border bg-sunken p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-medium">Map columns → fields</h3>
              <div className="flex items-center gap-2">
                <select
                  defaultValue=""
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === 'default') applyMapping(fieldsQ.data?.defaultMapping);
                    else if (v) {
                      const p = (profilesQ.data?.profiles || []).find((x) => x._id === v);
                      if (p) { applyMapping(p.mapping); setUidSource(p.uidSource || ''); }
                    }
                    e.target.value = '';
                  }}
                  className="rounded border border-border-strong bg-card text-fg px-2 py-1 text-xs"
                >
                  <option value="">Apply a saved mapping…</option>
                  <option value="default">Built-in (current format)</option>
                  {(profilesQ.data?.profiles || []).map((p) => (
                    <option key={p._id} value={p._id}>{p.name}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Only the workbook's first tab is imported. Silent for CSVs and
                single-tab files; when tabs WERE skipped, saying so turns "these
                columns are wrong" into a fixable, self-explanatory problem. */}
            {fileNote?.sheetName && fileNote.otherSheets?.length > 0 && (
              <div className="mb-3 rounded border border-info/30 bg-info-tint px-3 py-2 text-xs text-info">
                These columns come from the <strong>{fileNote.sheetName}</strong> tab — the first tab in the
                file, and the only one imported.{' '}
                {fileNote.otherSheets.length === 1
                  ? `The ${fileNote.otherSheets[0]} tab is ignored.`
                  : `${fileNote.otherSheets.length} other tabs are ignored (${fileNote.otherSheets
                      .slice(0, 6)
                      .join(', ')}${fileNote.otherSheets.length > 6 ? `, and ${fileNote.otherSheets.length - 6} more` : ''}).`}{' '}
                If your voter data is on a different tab, move it to the front of the workbook and upload again.
              </div>
            )}

            <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
              {fields.map((f) => {
                const isReqUnmapped = f.required && !mapping[f.key];
                return (
                  <div key={f.key} className="flex items-center gap-2 text-sm">
                    <label className="w-40 shrink-0 text-fg-muted">
                      {f.label}
                      {f.required && <span className="text-danger"> *</span>}
                    </label>
                    <select
                      value={mapping[f.key] || ''}
                      onChange={(e) => { setMapping((m) => ({ ...m, [f.key]: e.target.value || undefined })); dropReview(); }}
                      className={`min-w-0 flex-1 rounded border px-2 py-1 text-xs ${
                        isReqUnmapped ? 'border-danger/40 bg-danger-tint' : 'border-border-strong bg-card text-fg'
                      }`}
                    >
                      <option value="">— not mapped —</option>
                      {columns.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </div>
                );
              })}
            </div>

            {/* Early best-effort warning off the 5-row peek: an error literal in the
                ID column here means the full-file preview will skip those rows. The
                preview's own (authoritative, full-file) callout still runs — this
                just surfaces the problem before a 50k-row background parse. */}
            {idColumnLooksBroken && (
              <div className="mt-3 rounded border border-warning/30 bg-warning-tint px-3 py-2 text-xs text-warning-fg">
                The <strong>{mapping.stateVoterId}</strong> column contains spreadsheet error values (like{' '}
                <code>=#NUM!</code>) in this file&apos;s first rows — the formula that built it failed before the
                file was exported. Rows with an error value where their ID should be are skipped. If you
                can&apos;t fix and re-export the file, map a different column that uniquely identifies each
                person (a vendor ID) as State Voter ID instead.
              </div>
            )}

            {requiredUnmapped.length > 0 && (
              <p className="mt-3 text-xs text-danger">
                Map all required (*) fields to continue: {requiredUnmapped.join(', ')}
                {fileNote?.otherSheets?.length > 0 &&
                  ' — if none of the columns above look like voter data, it is probably on one of the other tabs (see the note above).'}
              </p>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {/* The vendor-uid namespace input is DELIBERATELY NOT RENDERED (owner decision
                  2026-07-19). It only applies to commercial vendor files carrying that vendor's own
                  person ID; every file we actually import is matched on State Voter ID, which is a
                  hard-required column. Two reasons it's hidden rather than merely relabeled: admins
                  read it as "name this import" and type something, and `UID` is an offerable column
                  mapping — a namespace PLUS a column mapped to UID makes the uid the AUTHORITATIVE
                  match key over the state voter ID (services/person/resolvePerson.js), so a
                  non-unique column (precinct, county code) would collapse different people onto one
                  Person. The namespace is the master switch for that whole path: with it absent,
                  `hasUid` is false and a mis-mapped UID column is inert. Typing a name with no uid
                  column was always harmless — this closes the case where both line up.
                  The state + setter stay wired (a legacy saved profile still loads its value) and
                  every request still sends the field, so NO server or matching logic changed.
                  Restoring the input is all that's needed if a vendor-data customer ever appears. */}
              <input
                value={profileName}
                onChange={(e) => setProfileName(e.target.value)}
                placeholder="Save this mapping as… (e.g. i360)"
                className="rounded border border-border-strong bg-card text-fg placeholder:text-fg-subtle px-2 py-1 text-xs"
              />
              <button
                onClick={() => profileName.trim() && saveProfile.mutate({ name: profileName.trim(), mapping, uidSource: uidSource.trim() || null })}
                disabled={!profileName.trim() || saveProfile.isPending}
                className="rounded border border-border-strong px-3 py-1 text-xs font-medium hover:bg-sunken disabled:opacity-60"
              >
                {saveProfile.isPending ? 'Saving…' : 'Save profile'}
              </button>
            </div>
          </div>
        )}

        {step === 'review' && diff && (
          <DetectionPanel detection={diff.detection} explode={explode} onToggleExplode={onToggleExplode} busy={previewPending} />
        )}
        {step === 'review' && diff && (
          <GeocodingPanel
            geocoding={diff.geocoding}
            result={geocodeCheckResult}
            onCheck={() => runGeocodeCheck.mutate({ file, campaignId, mapping, explode })}
            checking={geocodeChecking}
          />
        )}
        {step === 'review' && diff && <ReviewPanel diff={diff} />}

        {step === 'review' && diff && (
          <HandEditConflictsPanel
            conflicts={diff.handEditConflicts}
            overwrite={overwriteHandEdits}
            onToggle={setOverwriteHandEdits}
          />
        )}

        {step === 'review' && diff && (
          <label className="flex items-start gap-2 rounded border border-border bg-card p-3 text-sm">
            <input
              type="checkbox"
              checked={revisitNewVoters}
              onChange={(e) => setRevisitNewVoters(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              <span className="font-medium text-fg">Revisit already-worked homes that gain a new voter</span>
              <span className="mt-0.5 block text-xs text-fg-muted">
                If this file adds a new target voter to a home you&apos;ve already knocked or surveyed, collect those
                homes into a walk list so you can cut a fresh round and go back — it counts as a new knock. New
                addresses go to Intake as usual.
              </span>
            </span>
          </label>
        )}

        {step === 'review' && diff ? (
          <>
            {needsSkipAck && (
              <label className="mb-3 flex items-start gap-2 rounded border border-danger/30 bg-danger-tint p-3 text-sm text-danger">
                <input
                  type="checkbox"
                  checked={ackSkip}
                  onChange={(e) => setAckSkip(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  <span className="font-medium">
                    Import anyway — skip {fmt(skippedRows)} of {fmt(diff.totals.totalRows)} rows ({Math.round(skipShare * 100)}%).
                  </span>
                  <span className="mt-0.5 block text-xs">
                    Most of this file won&apos;t import. Usually the right move is Back → fix the mapping
                    (or the file) instead of confirming.
                  </span>
                </span>
              </label>
            )}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setStep('map')}
                className="rounded border border-border-strong px-4 py-2 text-sm font-medium hover:bg-sunken"
              >
                Back
              </button>
              <button
                onClick={() => upload.mutate({ file, campaignId, mapping, explode })}
                disabled={upload.isPending || (needsSkipAck && !ackSkip)}
                className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 disabled:opacity-60"
              >
                {upload.isPending ? 'Importing…' : 'Confirm & import'}
              </button>
            </div>
          </>
        ) : (
          <div className="flex items-center gap-3">
            <button
              onClick={triggerPreview}
              disabled={!canPreview}
              className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 disabled:opacity-60"
            >
              {previewPending ? previewPendingLabel(previewAsyncJob) : 'Preview changes'}
            </button>
            {previewPending && previewJobId && (
              <button
                onClick={() => cancelPreview.mutate(previewJobId)}
                disabled={cancelPreview.isPending}
                className="rounded-md border border-border px-3 py-2 text-sm text-fg-muted transition-colors hover:bg-sunken disabled:opacity-60"
              >
                Cancel
              </button>
            )}
            {cancelPreview.error && (
              <span className="text-xs text-fg-muted">{cancelPreview.error.message}</span>
            )}
          </div>
        )}
        {previewError && (
          <div className="mt-3 rounded border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger">
            {previewError.message}
          </div>
        )}
        {upload.error && (
          <div className="mt-3 rounded border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger">
            {upload.error.message}
          </div>
        )}
        {upload.data?.job && (
          <NextStepBanner
            tone="success"
            className="mt-3"
            title="Import queued — processing in the background."
            action={
              justImported
                ? { label: 'Go to Walk Lists', to: `/campaigns/${justImported}/efforts` }
                : null
            }
          >
            New addresses land in Intake until a walk list claims them.
          </NextStepBanner>
        )}
      </section>

      <h2 className="mb-3 text-base font-medium">Recent imports</h2>
      {undo.data && (() => {
        const d = undo.data;
        const removed = (d.doorsDeleted || 0) + (d.votersDeleted || 0);
        const tracked = (d.trackedDoors || 0) + (d.trackedVoters || 0);
        const ok = removed > 0;
        return (
          <div className={`mb-3 rounded border px-3 py-2 text-sm ${ok ? 'border-success/30 bg-success-tint text-green-800' : 'border-warning/30 bg-warning-tint text-warning-fg'}`}>
            {removed > 0 ? (
              <>
                Removed {fmt(d.doorsDeleted)} door(s) and {fmt(d.votersDeleted)} voter(s)
                {d.jobsUndone > 1 ? ` across ${fmt(d.jobsUndone)} upload attempts` : ''}.
                {d.doorsSkipped > 0 || d.votersSkipped > 0
                  ? ` Kept ${fmt(d.doorsSkipped)} door(s) and ${fmt(d.votersSkipped)} voter(s) already in use.`
                  : ''}
                {d.jobsUndone > 1 && (
                  <div className="mt-1 text-xs">
                    If some doors remain, an earlier crashed attempt created them without a record — undo can’t reach those; re-import the file to fully reset.
                  </div>
                )}
              </>
            ) : tracked > 0 ? (
              <>Nothing removed — the {fmt(tracked)} record(s) tracked for this file are all claimed or canvassed, so they were kept.</>
            ) : (
              <>Nothing to undo — no insert records were found for this file. An earlier crashed attempt created its rows without recording them, so undo can’t reach them. Re-import the file to start fresh.</>
            )}
          </div>
        );
      })()}
      {undo.error && (
        <div className="mb-3 rounded border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger">{undo.error.message}</div>
      )}
      {isLoading ? (
        <div>Loading…</div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="min-w-full text-sm">
            <thead className="bg-sunken text-xs uppercase tracking-wide text-fg-muted">
              <tr>
                <th className="px-4 py-2 text-left">When</th>
                <th className="px-4 py-2 text-left">File</th>
                <th className="px-4 py-2 text-left">Status</th>
                <th className="px-4 py-2 text-right">Voters</th>
                <th className="px-4 py-2 text-right">Households</th>
                <th className="px-4 py-2 text-right">New</th>
                <th className="px-4 py-2 text-right">Moved / Emptied</th>
                <th className="px-4 py-2 text-right">Errors</th>
                <th className="px-4 py-2 text-right"></th>
              </tr>
            </thead>
            <tbody>
              {(data?.jobs || []).map((j) => (
                <tr key={j._id} className="border-t border-border">
                  <td className="px-4 py-2 text-fg-muted">{formatInTz(j.createdAt, orgTz, { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' }, true)}</td>
                  <td className="px-4 py-2">
                    {j.filename || '—'}
                    {(j.geocodedNew > 0 || j.geocodedCached > 0 || j.geocodeUnmatched > 0) && (
                      <div className="text-xs text-fg-subtle">
                        geocoded {fmt((j.geocodedNew || 0) + (j.geocodedCached || 0))}
                        {j.geocodeUnmatched > 0 ? ` · ${fmt(j.geocodeUnmatched)} unplaced` : ''}
                        {j.geocodeFailed > 0 ? ` · ${fmt(j.geocodeFailed)} retry` : ''}
                      </div>
                    )}
                    {j.revisitHouseholdCount > 0 && !j.undone && (
                      <div className="mt-0.5 text-xs text-fg-muted">
                        {fmt(j.revisitHouseholdCount)} already-worked home{j.revisitHouseholdCount === 1 ? '' : 's'} gained a new voter
                        {j.campaignId?._id && j.revisitSavedSearchId && (
                          <>
                            {' · '}
                            <button
                              onClick={() => navigate(`/campaigns/${j.campaignId._id}/efforts?seed=${j.revisitSavedSearchId}`)}
                              className="font-medium text-brand-accent hover:underline"
                            >
                              Create revisit walk list →
                            </button>
                          </>
                        )}
                      </div>
                    )}
                    {j.keptHandEdits > 0 && (
                      <div className="mt-0.5 text-xs text-fg-muted">
                        {fmt(j.keptHandEdits)} hand-edited value{j.keptHandEdits === 1 ? '' : 's'} kept
                      </div>
                    )}
                    {j.overwrittenHandEdits > 0 && (
                      <div className="mt-0.5 text-xs text-fg-muted">
                        {fmt(j.overwrittenHandEdits)} hand-edited value{j.overwrittenHandEdits === 1 ? '' : 's'} replaced by the file
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2"><StatusBadge job={j} /></td>
                  <td className="px-4 py-2 text-right">{fmt(j.uniqueVoters)}</td>
                  <td className="px-4 py-2 text-right">{fmt(j.uniqueHouseholds)}</td>
                  <td className="px-4 py-2 text-right">{fmt(j.newVoters)} v / {fmt(j.newHouseholds)} h</td>
                  <td className="px-4 py-2 text-right">{fmt(j.movedVoters)} / {fmt(j.deactivatedDoors)}</td>
                  <td className="px-4 py-2 text-right">{fmt(j.errorCount)}</td>
                  <td className="px-4 py-2 text-right">
                    {j.status === 'completed' && !j.undone ? (
                      <RowMenu
                        items={[
                          ...(j.campaignId?._id ? [{ label: 'View on map', onClick: () => navigate(`/campaigns/${j.campaignId._id}/map?importId=${j._id}`) }] : []),
                          { label: 'Undo import', danger: true, onClick: () => onUndo(j) },
                        ]}
                      />
                    ) : j.undone ? (
                      <span className="text-xs italic text-fg-subtle">undone</span>
                    ) : null}
                  </td>
                </tr>
              ))}
              {!data?.jobs?.length && (
                <tr>
                  <td colSpan="9" className="px-4 py-6 text-center text-fg-muted">No imports yet for this campaign.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
