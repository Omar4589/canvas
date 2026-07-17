import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, Link, useLocation } from 'react-router-dom';
import { api } from '../api/client.js';
import { useOrgTimeZone } from '../auth/AuthContext.jsx';
import { formatInTz } from '../lib/datetime.js';
import Section from '../components/Section.jsx';

function fmtDate(d, tz, withTime = true) {
  if (!d) return '—';
  return (
    formatInTz(
      d,
      tz,
      withTime
        ? { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' }
        : { year: 'numeric', month: 'numeric', day: 'numeric' },
      withTime
    ) || '—'
  );
}
function answerText(a) {
  if (a == null || a === '') return '—';
  return Array.isArray(a) ? a.join(', ') : String(a);
}

const EDIT_FIELDS = [
  ['firstName', 'First name'], ['lastName', 'Last name'],
  ['phone', 'Phone'], ['cellPhone', 'Cell phone'], ['phoneType', 'Phone type'],
  ['party', 'Party'], ['gender', 'Gender'], ['registrationStatus', 'Registration status'],
  ['registeredState', 'Registered state'],
  ['congressionalDistrict', 'Congressional district'], ['stateSenateDistrict', 'State senate district'],
  ['stateHouseDistrict', 'State house district'], ['precinct', 'Precinct'],
];

function VoterFields({ voter, person, onSave, saving, tz }) {
  const [edit, setEdit] = useState(false);
  const [form, setForm] = useState({});
  // There used to be a "🔒 This person's identity is managed by {Other Customer Ltd}" banner here.
  // It named a DIFFERENT customer organization to this one — telling a consulting firm, by name,
  // which of its voters a rival firm also held. It existed because a Person was a global record
  // shared between customers.
  //
  // Persons are org-scoped now (server/src/models/Person.js), so a voter's identity is only ever
  // this org's. There is no other owner, no proposal flow, and nothing to disclose. Every edit
  // applies directly to this org's own copy, which is what an admin always expected anyway.
  const lockNote = null;

  function startEdit() {
    const f = {};
    for (const [k] of EDIT_FIELDS) f[k] = voter[k] ?? '';
    setForm(f);
    setEdit(true);
  }
  function submit(e) {
    e.preventDefault();
    const body = {};
    for (const [k] of EDIT_FIELDS) body[k] = form[k] === '' ? null : form[k];
    onSave(body, () => setEdit(false));
  }

  if (!edit) {
    return (
      <Section
        title="Identity & contact"
        right={
          <button onClick={startEdit} className="text-sm font-medium text-brand-accent hover:underline">
            Edit
          </button>
        }
      >
        {lockNote}
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-3">
          <Detail label="Voter ID" value={voter.stateVoterId} mono />
          {EDIT_FIELDS.map(([k, label]) => <Detail key={k} label={label} value={voter[k]} />)}
          <Detail label="Date of birth" value={fmtDate(voter.dateOfBirth, tz, false)} />
        </dl>
        {voter.lastEditedAt && (
          <p className="mt-3 text-xs text-fg-subtle">
            Last edited {fmtDate(voter.lastEditedAt, tz)}{voter.lastEditedBy ? ` by ${voter.lastEditedBy.name}` : ''}
          </p>
        )}
      </Section>
    );
  }

  return (
    <Section title="Identity & contact">
      <form onSubmit={submit}>
        {lockNote}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {EDIT_FIELDS.map(([k, label]) => (
            <label key={k} className="block text-xs font-medium text-fg-muted">
              {label}
              <input
                value={form[k] ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))}
                className="mt-1 w-full rounded border border-border-strong bg-card px-2 py-1.5 text-sm text-fg focus:border-brand-accent focus:outline-none"
              />
            </label>
          ))}
        </div>
        <div className="mt-4 flex gap-2">
          <button type="submit" disabled={saving} className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button type="button" onClick={() => setEdit(false)} className="rounded-md border border-border-strong px-4 py-2 text-sm">
            Cancel
          </button>
        </div>
      </form>
    </Section>
  );
}

function Detail({ label, value, mono }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-fg-subtle">{label}</dt>
      <dd className={'text-fg ' + (mono ? 'font-mono text-xs' : '')}>{value || '—'}</dd>
    </div>
  );
}

function DncSection({ dnc, onFlag, onUnflag, busy, tz }) {
  const [reason, setReason] = useState('');

  if (!dnc?.flagged) {
    return (
      <Section title="Do not contact">
        <p className="mb-3 text-sm text-fg-muted">
          Excluded from walk-list exports and surveys across all campaigns; the door drops off books
          once everyone there is flagged.
        </p>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          placeholder="Reason (required) — why should this voter not be contacted?"
          className="w-full rounded border border-border-strong bg-card px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-brand-accent focus:outline-none"
        />
        <button
          onClick={() => onFlag(reason.trim())}
          disabled={reason.trim().length < 3 || busy}
          className="mt-2 rounded-md bg-danger px-3 py-1.5 text-sm font-semibold text-white shadow-sm hover:opacity-90 disabled:opacity-50"
        >
          {busy ? 'Marking…' : 'Mark do-not-contact'}
        </button>
      </Section>
    );
  }

  return (
    <Section title="Do not contact">
      <div className="rounded border border-danger/30 bg-danger-tint p-4 text-sm">
        <p className="font-medium text-danger">
          ⛔ Flagged do-not-contact{dnc.source === 'upload' ? ' via list upload' : ''}
        </p>
        <p className="mt-1 text-fg">{dnc.reason}</p>
        <p className="mt-1 text-xs text-fg-muted">
          {dnc.by ? `${dnc.by.name} · ` : ''}{fmtDate(dnc.at, tz)}
        </p>
        <button
          onClick={onUnflag}
          disabled={busy}
          className="mt-3 text-xs font-semibold text-danger hover:underline disabled:opacity-50"
        >
          {busy ? 'Removing…' : 'Remove flag'}
        </button>
      </div>
    </Section>
  );
}

function SurveyCard({ survey, onSave, onDelete, busy, tz }) {
  const [edit, setEdit] = useState(false);
  const [vals, setVals] = useState({});
  const [note, setNote] = useState('');

  function startEdit() {
    // Seed editor state with option IDS (choice) / text (free-text). Prefer stored
    // optionIds; fall back to mapping the snapshot text back to ids for legacy rows.
    const map = {};
    for (const q of survey.questions) {
      const a = survey.answers.find((x) => x.questionKey === q.key);
      if (q.type === 'text') {
        map[q.key] = a?.answer ?? '';
        continue;
      }
      let ids = Array.isArray(a?.optionIds) && a.optionIds.length ? a.optionIds : null;
      if (!ids && a?.answer != null) {
        const byText = new Map((q.options || []).map((o) => [o.text, o.id]));
        const texts = Array.isArray(a.answer) ? a.answer : [a.answer];
        ids = texts.map((t) => byText.get(t)).filter(Boolean);
      }
      ids = ids || [];
      map[q.key] = q.type === 'multiple_choice' ? ids : ids[0] ?? '';
    }
    setVals(map);
    setNote(survey.note || '');
    setEdit(true);
  }
  function submit() {
    const editable = survey.questions.filter((q) => !q.retired);
    const answers = editable.map((q) => {
      const v = vals[q.key];
      if (q.type === 'text') {
        return { questionKey: q.key, questionLabel: q.label, answer: v ?? null, optionIds: [] };
      }
      const ids = q.type === 'multiple_choice' ? (Array.isArray(v) ? v : []) : v ? [v] : [];
      const byId = new Map((q.options || []).map((o) => [o.id, o.text]));
      const texts = ids.map((id) => byId.get(id)).filter((t) => t != null);
      const answer = q.type === 'multiple_choice' ? texts : texts[0] ?? null;
      return { questionKey: q.key, questionLabel: q.label, answer, optionIds: ids };
    });
    // Carry through answers to retired/removed questions (not shown in the editor).
    const editedKeys = new Set(editable.map((q) => q.key));
    for (const a of survey.answers) if (!editedKeys.has(a.questionKey)) answers.push(a);
    onSave({ answers, note: note || null }, () => setEdit(false));
  }
  function toggleMulti(key, opt) {
    setVals((v) => {
      const cur = Array.isArray(v[key]) ? v[key] : [];
      return { ...v, [key]: cur.includes(opt) ? cur.filter((o) => o !== opt) : [...cur, opt] };
    });
  }

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-medium text-fg">
          {survey.templateName || 'Survey'} <span className="text-xs font-normal text-fg-subtle">· {fmtDate(survey.submittedAt, tz)}{survey.by ? ` · ${survey.by.name}` : ''}</span>
        </div>
        {!edit && (
          <div className="flex gap-3 text-sm">
            <button onClick={startEdit} className="font-medium text-brand-accent hover:underline">Edit</button>
            <button onClick={() => onDelete()} disabled={busy} className="font-medium text-danger hover:underline disabled:opacity-50">Delete</button>
          </div>
        )}
      </div>

      {!edit ? (
        <>
          <dl className="space-y-1.5 text-sm">
            {survey.answers.map((a) => (
              <div key={a.questionKey} className="flex gap-2">
                <dt className="text-fg-muted">{a.questionLabel}:</dt>
                <dd className="font-medium text-fg">{answerText(a.answer)}</dd>
              </div>
            ))}
          </dl>
          {survey.note && <p className="mt-2 rounded bg-sunken p-2 text-sm text-fg-muted">📝 {survey.note}</p>}
          {survey.editedAt && (
            <p className="mt-2 text-xs text-amber-600">Edited {fmtDate(survey.editedAt, tz)}{survey.editedBy ? ` by ${survey.editedBy.name}` : ''}</p>
          )}
        </>
      ) : (
        <div className="space-y-3">
          {survey.questions.filter((q) => !q.retired).map((q) => (
            <div key={q.key}>
              <div className="mb-1 text-xs font-medium text-fg-muted">{q.label}</div>
              {q.type === 'single_choice' ? (
                <select
                  value={vals[q.key] ?? ''}
                  onChange={(e) => setVals((v) => ({ ...v, [q.key]: e.target.value }))}
                  className="w-full rounded border border-border-strong bg-card px-2 py-1.5 text-sm text-fg"
                >
                  <option value="">—</option>
                  {q.options.filter((o) => !o.retired).map((o) => <option key={o.id} value={o.id}>{o.text}</option>)}
                </select>
              ) : q.type === 'multiple_choice' ? (
                <div className="flex flex-wrap gap-3">
                  {q.options.filter((o) => !o.retired).map((o) => (
                    <label key={o.id} className="flex items-center gap-1 text-sm">
                      <input type="checkbox" checked={Array.isArray(vals[q.key]) && vals[q.key].includes(o.id)} onChange={() => toggleMulti(q.key, o.id)} />
                      {o.text}
                    </label>
                  ))}
                </div>
              ) : (
                <input
                  value={vals[q.key] ?? ''}
                  onChange={(e) => setVals((v) => ({ ...v, [q.key]: e.target.value }))}
                  className="w-full rounded border border-border-strong bg-card px-2 py-1.5 text-sm text-fg"
                />
              )}
            </div>
          ))}
          <label className="block text-xs font-medium text-fg-muted">
            Note
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="mt-1 w-full rounded border border-border-strong bg-card px-2 py-1.5 text-sm text-fg" />
          </label>
          <div className="flex gap-2">
            <button onClick={submit} disabled={busy} className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60">Save</button>
            <button onClick={() => setEdit(false)} className="rounded-md border border-border-strong px-3 py-1.5 text-sm">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function VoterDetailPage() {
  const { voterId } = useParams();
  const orgTz = useOrgTimeZone();
  const { state } = useLocation(); // referrer (e.g. { from: 'notes', campaignId }) for a contextual back
  const qc = useQueryClient();
  const [newNote, setNewNote] = useState('');
  const [err, setErr] = useState('');

  const key = ['admin', 'voter', voterId];
  const profileQ = useQuery({ queryKey: key, queryFn: () => api(`/admin/voters/${voterId}`) });

  const invalidate = () => qc.invalidateQueries({ queryKey: key });
  const onErr = (e) => setErr(e.message);

  const saveVoter = useMutation({
    mutationFn: (body) => api(`/admin/voters/${voterId}`, { method: 'PATCH', body }),
    onSuccess: () => { setErr(''); invalidate(); },
    onError: onErr,
  });
  const addNote = useMutation({
    mutationFn: (body) => api(`/admin/voters/${voterId}/notes`, { method: 'POST', body: { body } }),
    onSuccess: () => { setNewNote(''); invalidate(); },
    onError: onErr,
  });
  const delNote = useMutation({
    mutationFn: (noteId) => api(`/admin/voters/${voterId}/notes/${noteId}`, { method: 'DELETE' }),
    onSuccess: invalidate, onError: onErr,
  });
  const editSurvey = useMutation({
    mutationFn: ({ responseId, body }) => api(`/admin/voters/${voterId}/surveys/${responseId}`, { method: 'PATCH', body }),
    onSuccess: () => { setErr(''); invalidate(); }, onError: onErr,
  });
  const delSurvey = useMutation({
    mutationFn: (responseId) => api(`/admin/voters/${voterId}/surveys/${responseId}`, { method: 'DELETE' }),
    onSuccess: invalidate, onError: onErr,
  });
  const flagDnc = useMutation({
    mutationFn: (reason) => api(`/admin/voters/${voterId}/dnc`, { method: 'POST', body: { reason } }),
    onSuccess: () => { setErr(''); invalidate(); }, onError: onErr,
  });
  const unflagDnc = useMutation({
    mutationFn: () => api(`/admin/voters/${voterId}/dnc`, { method: 'DELETE' }),
    onSuccess: () => { setErr(''); invalidate(); }, onError: onErr,
  });

  if (profileQ.isLoading) return <div className="p-6 text-sm text-fg-muted">Loading…</div>;
  if (profileQ.error) return <div className="p-6 text-sm text-danger">Error: {profileQ.error.message}</div>;

  const p = profileQ.data;
  const v = p.voter;
  const h = p.household;

  return (
    <div className="max-w-4xl">
      <Link
        to={state?.from === 'notes' && state.campaignId ? `/campaigns/${state.campaignId}/notes` : '/voters'}
        className="text-sm font-medium text-brand-accent hover:underline"
      >
        {state?.from === 'notes' && state.campaignId ? '‹ Notes' : '‹ Voters'}
      </Link>
      <div className="mb-6 mt-1 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold text-fg">{v.fullName}</h1>
        <span className="font-mono text-xs text-fg-subtle">{v.stateVoterId}</span>
        {v.party && <span className="rounded-full bg-sunken px-2 py-0.5 text-xs text-fg-muted">{v.party}</span>}
        <span className={'rounded-full px-2 py-0.5 text-xs font-medium ' + (v.surveyStatus === 'surveyed' ? 'bg-success-tint text-success' : 'bg-sunken text-fg-muted')}>
          {v.surveyStatus === 'surveyed' ? 'Surveyed' : 'Not surveyed'}
        </span>
        {p.voted?.isVoted && <span className="rounded-full bg-teal-500/15 px-2 py-0.5 text-xs font-medium text-teal-600">✓ Voted</span>}
        {v.doNotContact?.flagged && <span className="rounded-full bg-danger-tint px-2 py-0.5 text-xs font-medium text-danger">⛔ Do not contact</span>}
      </div>

      {err && <div className="mb-4 rounded border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger">{err}</div>}

      <VoterFields
        voter={v}
        person={p.person}
        saving={saveVoter.isPending}
        onSave={(body, done) => saveVoter.mutate(body, { onSuccess: done })}
        tz={orgTz}
      />

      <DncSection
        dnc={v.doNotContact}
        busy={flagDnc.isPending || unflagDnc.isPending}
        onFlag={(reason) => flagDnc.mutate(reason)}
        onUnflag={() => { if (window.confirm('Remove the do-not-contact flag from this voter?')) unflagDnc.mutate(); }}
        tz={orgTz}
      />

      <Section title="Household & campaign">
        {h ? (
          <div className="text-sm text-fg-muted">
            <p className="font-medium text-fg">{h.addressLine1}{h.addressLine2 ? `, ${h.addressLine2}` : ''}</p>
            <p>{h.city}, {h.state} {h.zipCode}</p>
            <p className="mt-1 text-fg-muted">
              Campaign: {h.campaign ? <Link to={`/campaigns/${h.campaign.id}`} className="text-brand-accent hover:underline">{h.campaign.name}</Link> : '—'}
              {h.fullyVoted && <span className="ml-2 text-teal-600">· fully voted</span>}
              {h.fullyDnc && <span className="ml-2 text-danger">· fully do-not-contact</span>}
            </p>
            {h.members.length > 0 && (
              <div className="mt-3">
                <div className="text-xs uppercase tracking-wide text-fg-subtle">Household members</div>
                <ul className="mt-1 space-y-1">
                  {h.members.map((m) => (
                    <li key={m.id}>
                      <Link to={`/voters/${m.id}`} className="text-brand-accent hover:underline">{m.fullName}</Link>
                      <span className="text-fg-subtle"> · {m.surveyStatus === 'surveyed' ? 'surveyed' : 'not surveyed'}{m.voted ? ' · voted' : ''}</span>
                      {m.dnc && <span className="text-danger"> · do not contact</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : <p className="text-sm text-fg-muted">No household on file.</p>}
      </Section>

      <Section title={`Survey responses (${p.surveys.length})`}>
        {p.surveys.length === 0 ? (
          <p className="text-sm text-fg-muted">No survey responses.</p>
        ) : (
          <div className="space-y-3">
            {p.surveys.map((s) => (
              <SurveyCard
                key={s.id}
                survey={s}
                busy={editSurvey.isPending || delSurvey.isPending}
                onSave={(body, done) => editSurvey.mutate({ responseId: s.id, body }, { onSuccess: done })}
                onDelete={() => { if (window.confirm('Delete this survey response?')) delSurvey.mutate(s.id); }}
                tz={orgTz}
              />
            ))}
          </div>
        )}
      </Section>

      <Section title={`Notes (${p.notes.admin.length})`}>
        <div className="mb-4">
          <textarea
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            rows={2}
            placeholder="Add a note about this voter…"
            className="w-full rounded border border-border-strong bg-card px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-brand-accent focus:outline-none"
          />
          <button
            onClick={() => newNote.trim() && addNote.mutate(newNote.trim())}
            disabled={!newNote.trim() || addNote.isPending}
            className="mt-2 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {addNote.isPending ? 'Adding…' : 'Add note'}
          </button>
        </div>
        {p.notes.admin.length > 0 && (
          <ul className="space-y-2">
            {p.notes.admin.map((n) => (
              <li key={n.id} className="rounded border border-border bg-sunken p-3 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <p className="whitespace-pre-wrap text-fg">{n.body}</p>
                  <button onClick={() => delNote.mutate(n.id)} className="shrink-0 text-xs text-danger hover:underline">Delete</button>
                </div>
                <p className="mt-1 text-xs text-fg-subtle">{n.author ? n.author.name : 'Unknown'} · {fmtDate(n.createdAt, orgTz)}{n.editedAt ? ' · edited' : ''}</p>
              </li>
            ))}
          </ul>
        )}
        {p.notes.field.length > 0 && (
          <div className="mt-4">
            <div className="mb-1 text-xs uppercase tracking-wide text-fg-subtle">From the field (read-only)</div>
            <ul className="space-y-2">
              {p.notes.field.map((n) => (
                <li key={`${n.source}-${n.id}`} className="rounded border border-border p-3 text-sm">
                  <p className="whitespace-pre-wrap text-fg">{n.note}</p>
                  <p className="mt-1 text-xs text-fg-subtle">{n.source === 'survey' ? 'Survey' : n.actionType} · {n.by ? n.by.name : 'Unknown'} · {fmtDate(n.timestamp, orgTz)}</p>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Section>

      <Section title="Canvass activity">
        {p.activity.length === 0 ? (
          <p className="text-sm text-fg-muted">No canvass activity at this household.</p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {p.activity.map((a) => (
              <li key={a.id} className="flex flex-wrap gap-x-2 text-fg-muted">
                <span className="font-medium text-fg">{a.actionType.replace('_', ' ')}</span>
                <span className="text-fg-subtle">· {fmtDate(a.timestamp, orgTz)}{a.by ? ` · ${a.by.name}` : ''}</span>
                {a.note && <span className="text-fg-muted">— {a.note}</span>}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
