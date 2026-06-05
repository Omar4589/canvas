import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { useOrgTimeZone } from '../auth/AuthContext.jsx';
import { formatInTz } from '../lib/datetime.js';

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

function Section({ title, right, children }) {
  return (
    <section className="mb-6 rounded-lg border border-border bg-card p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-fg">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

const EDIT_FIELDS = [
  ['firstName', 'First name'], ['lastName', 'Last name'],
  ['phone', 'Phone'], ['cellPhone', 'Cell phone'], ['phoneType', 'Phone type'],
  ['party', 'Party'], ['gender', 'Gender'], ['registrationStatus', 'Registration status'],
  ['registeredState', 'Registered state'],
  ['congressionalDistrict', 'Congressional district'], ['stateSenateDistrict', 'State senate district'],
  ['stateHouseDistrict', 'State house district'], ['precinct', 'Precinct'],
];

function VoterFields({ voter, onSave, saving, tz }) {
  const [edit, setEdit] = useState(false);
  const [form, setForm] = useState({});

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
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {EDIT_FIELDS.map(([k, label]) => (
            <label key={k} className="block text-xs font-medium text-fg-muted">
              {label}
              <input
                value={form[k] ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))}
                className="mt-1 w-full rounded border border-border-strong px-2 py-1.5 text-sm text-fg focus:border-brand-accent focus:outline-none"
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

function SurveyCard({ survey, onSave, onDelete, busy, tz }) {
  const [edit, setEdit] = useState(false);
  const [vals, setVals] = useState({});
  const [note, setNote] = useState('');

  function startEdit() {
    const map = {};
    for (const a of survey.answers) map[a.questionKey] = a.answer;
    setVals(map);
    setNote(survey.note || '');
    setEdit(true);
  }
  function submit() {
    const answers = survey.questions.map((q) => ({
      questionKey: q.key,
      questionLabel: q.label,
      answer: vals[q.key] ?? null,
    }));
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
          {survey.questions.map((q) => (
            <div key={q.key}>
              <div className="mb-1 text-xs font-medium text-fg-muted">{q.label}</div>
              {q.type === 'single_choice' ? (
                <select
                  value={vals[q.key] ?? ''}
                  onChange={(e) => setVals((v) => ({ ...v, [q.key]: e.target.value }))}
                  className="w-full rounded border border-border-strong px-2 py-1.5 text-sm"
                >
                  <option value="">—</option>
                  {q.options.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : q.type === 'multiple_choice' ? (
                <div className="flex flex-wrap gap-3">
                  {q.options.map((o) => (
                    <label key={o} className="flex items-center gap-1 text-sm">
                      <input type="checkbox" checked={Array.isArray(vals[q.key]) && vals[q.key].includes(o)} onChange={() => toggleMulti(q.key, o)} />
                      {o}
                    </label>
                  ))}
                </div>
              ) : (
                <input
                  value={vals[q.key] ?? ''}
                  onChange={(e) => setVals((v) => ({ ...v, [q.key]: e.target.value }))}
                  className="w-full rounded border border-border-strong px-2 py-1.5 text-sm"
                />
              )}
            </div>
          ))}
          <label className="block text-xs font-medium text-fg-muted">
            Note
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="mt-1 w-full rounded border border-border-strong px-2 py-1.5 text-sm" />
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

  if (profileQ.isLoading) return <div className="p-6 text-sm text-fg-muted">Loading…</div>;
  if (profileQ.error) return <div className="p-6 text-sm text-danger">Error: {profileQ.error.message}</div>;

  const p = profileQ.data;
  const v = p.voter;
  const h = p.household;

  return (
    <div className="max-w-4xl">
      <Link to="/voters" className="text-sm font-medium text-brand-accent hover:underline">‹ Voters</Link>
      <div className="mb-6 mt-1 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold text-fg">{v.fullName}</h1>
        <span className="font-mono text-xs text-fg-subtle">{v.stateVoterId}</span>
        {v.party && <span className="rounded-full bg-sunken px-2 py-0.5 text-xs text-fg-muted">{v.party}</span>}
        <span className={'rounded-full px-2 py-0.5 text-xs font-medium ' + (v.surveyStatus === 'surveyed' ? 'bg-success-tint text-success' : 'bg-sunken text-fg-muted')}>
          {v.surveyStatus === 'surveyed' ? 'Surveyed' : 'Not surveyed'}
        </span>
        {p.voted?.isVoted && <span className="rounded-full bg-teal-500/15 px-2 py-0.5 text-xs font-medium text-teal-600">✓ Voted</span>}
      </div>

      {err && <div className="mb-4 rounded border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger">{err}</div>}

      <VoterFields
        voter={v}
        saving={saveVoter.isPending}
        onSave={(body, done) => saveVoter.mutate(body, { onSuccess: done })}
        tz={orgTz}
      />

      <Section title="Household & campaign">
        {h ? (
          <div className="text-sm text-fg-muted">
            <p className="font-medium text-fg">{h.addressLine1}{h.addressLine2 ? `, ${h.addressLine2}` : ''}</p>
            <p>{h.city}, {h.state} {h.zipCode}</p>
            <p className="mt-1 text-fg-muted">
              Campaign: {h.campaign ? <Link to={`/dashboard/${h.campaign.id}`} className="text-brand-accent hover:underline">{h.campaign.name}</Link> : '—'}
              {h.fullyVoted && <span className="ml-2 text-teal-600">· fully voted</span>}
            </p>
            {h.members.length > 0 && (
              <div className="mt-3">
                <div className="text-xs uppercase tracking-wide text-fg-subtle">Household members</div>
                <ul className="mt-1 space-y-1">
                  {h.members.map((m) => (
                    <li key={m.id}>
                      <Link to={`/voters/${m.id}`} className="text-brand-accent hover:underline">{m.fullName}</Link>
                      <span className="text-fg-subtle"> · {m.surveyStatus === 'surveyed' ? 'surveyed' : 'not surveyed'}{m.voted ? ' · voted' : ''}</span>
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
            className="w-full rounded border border-border-strong px-3 py-2 text-sm focus:border-brand-accent focus:outline-none"
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
