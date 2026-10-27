import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, Link, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth, useOrgTimeZone } from '../auth/AuthContext.jsx';
import { formatInTz } from '../lib/datetime.js';
import Section from '../components/Section.jsx';
import { Badge } from '../components/ui/index.js';
import PerPersonAnswerEditor, { seedEditor, touchedAnswers } from '../components/surveys/PerPersonAnswerEditor.jsx';
import { ACTION_LABELS, actionLabel } from '../lib/statusColors.js';

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
  // An empty pick-several (a skipped or cleared question) prints the same dash as a blank.
  if (Array.isArray(a)) return a.length ? a.join(', ') : '—';
  return String(a);
}

const EDIT_FIELDS = [
  ['firstName', 'First name'], ['lastName', 'Last name'],
  ['phone', 'Phone'], ['cellPhone', 'Cell phone'], ['phoneType', 'Phone type'],
  ['email', 'Email'],
  ['party', 'Party'], ['gender', 'Gender'], ['registrationStatus', 'Registration status'],
  ['registeredState', 'Registered state'],
  ['congressionalDistrict', 'Congressional district'], ['stateSenateDistrict', 'State senate district'],
  ['stateHouseDistrict', 'State house district'], ['precinct', 'Precinct'],
];

// Labels for the import-protected (hand-edited) fields line — EDIT_FIELDS plus the two armable
// fields that aren't form inputs (derived fullName; DOB renders separately).
const PROTECTED_FIELD_LABELS = Object.fromEntries([
  ...EDIT_FIELDS,
  ['fullName', 'Full name'],
  ['dateOfBirth', 'Date of birth'],
]);

function VoterFields({ voter, person, onSave, saving, canEdit, tz }) {
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
          canEdit && (
            <button onClick={startEdit} className="text-sm font-medium text-brand-accent hover:underline">
              Edit
            </button>
          )
        }
      >
        {lockNote}
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-3">
          {/* A door-added row's synthetic `manual:` id is an implementation detail, not a
              state voter ID — show the provenance instead. */}
          <Detail
            label="Voter ID"
            value={voter.stateVoterId?.startsWith('manual:') ? 'None — added at the door' : voter.stateVoterId}
            mono={!voter.stateVoterId?.startsWith('manual:')}
          />
          {EDIT_FIELDS.map(([k, label]) => <Detail key={k} label={label} value={voter[k]} />)}
          <Detail label="Date of birth" value={fmtDate(voter.dateOfBirth, tz, false)} />
        </dl>
        {voter.lastEditedAt && (
          <p className="mt-3 text-xs text-fg-subtle">
            Last edited {fmtDate(voter.lastEditedAt, tz)}{voter.lastEditedBy ? ` by ${voter.lastEditedBy.name}` : ''}
          </p>
        )}
        {(voter.protectedFields || []).length > 0 && (
          <p className="mt-1 text-xs text-fg-subtle">
            <span className="font-medium text-fg-muted">Protected from re-imports:</span>{' '}
            {voter.protectedFields.map((f) => PROTECTED_FIELD_LABELS[f] || f).join(', ')} — voter-file
            uploads keep these hand-edited values (the import preview shows any conflicts).
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

// Address-level suppression, shown inside "Household & campaign" rather than beside the
// person-level DNC section — because it is a fact about the DOOR, and putting it next to the
// voter flag is how the two get conflated. Flagging this voter never sets this, and setting this
// never flags anyone: one is "don't talk to this person", the other is "don't come to this house".
function HouseholdDoNotKnockControl({ household, voterId }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState(null);
  const qc = useQueryClient();

  const done = () => {
    setOpen(false);
    setReason('');
    setErr(null);
    qc.invalidateQueries({ queryKey: ['admin', 'voter', voterId] });
  };
  const mark = useMutation({
    mutationFn: () =>
      api(`/admin/households/${household.id}/do-not-knock`, { method: 'POST', body: { reason: reason.trim() } }),
    onSuccess: done,
    onError: (e) => setErr(e?.message || 'Could not mark this address.'),
  });
  const lift = useMutation({
    mutationFn: () => api(`/admin/households/${household.id}/do-not-knock`, { method: 'DELETE' }),
    onSuccess: done,
    onError: (e) => setErr(e?.message || 'Could not lift the request.'),
  });
  const busy = mark.isPending || lift.isPending;

  if (household.doNotKnock) {
    return (
      <div className="mt-3 rounded border border-danger/30 bg-danger-tint p-3 text-sm">
        <p className="font-medium text-danger">Do not knock — nobody visits this address</p>
        <p className="mt-1 text-xs text-fg-muted">
          Applies in every campaign and does not reopen on its own, even when new residents are
          imported here. Residents keep their own do-not-contact status.
        </p>
        {err && <p className="mt-1 text-xs text-danger">{err}</p>}
        <button
          onClick={() => {
            if (window.confirm('Lift the do-not-knock request? This address becomes knockable again in every campaign.')) lift.mutate();
          }}
          disabled={busy}
          className="mt-2 text-xs font-semibold text-danger hover:underline disabled:opacity-50"
        >
          {lift.isPending ? 'Lifting…' : 'Lift request'}
        </button>
      </div>
    );
  }

  return (
    <div className="mt-3">
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="text-xs font-semibold text-fg-muted hover:underline"
        >
          Mark this address do not knock…
        </button>
      ) : (
        <div className="rounded border border-border-strong p-3">
          <p className="text-xs text-fg-muted">
            Nobody visits this address again, in this and every other campaign. This is separate
            from flagging a voter do-not-contact.
          </p>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder="Reason (required) — e.g. resident asked us never to return"
            className="mt-2 w-full rounded border border-border-strong bg-card px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-brand-accent focus:outline-none"
          />
          {err && <p className="mt-1 text-xs text-danger">{err}</p>}
          <div className="mt-2 flex gap-2">
            <button
              onClick={() => mark.mutate()}
              disabled={reason.trim().length < 3 || busy}
              className="rounded-md bg-danger px-3 py-1.5 text-sm font-semibold text-white shadow-sm hover:opacity-90 disabled:opacity-50"
            >
              {mark.isPending ? 'Marking…' : 'Mark do not knock'}
            </button>
            <button
              onClick={() => { setOpen(false); setErr(null); }}
              disabled={busy}
              className="rounded-md border border-border-strong px-3 py-1.5 text-sm font-medium text-fg-muted hover:bg-sunken disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function DncSection({ dnc, onFlag, onUnflag, busy, canEdit, tz }) {
  const [reason, setReason] = useState('');

  if (!dnc?.flagged) {
    // Read-only (a team lead on the campaign profile): every flag route is org-admin-only, so no
    // form — just the state, so the section reads the same in every mode.
    if (!canEdit) {
      return (
        <Section title="Do not contact">
          <p className="text-sm text-fg-muted">Not flagged. Only an organization admin can flag a voter.</p>
        </Section>
      );
    }
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
          Flagged do-not-contact{dnc.source === 'upload' ? ' via list upload' : ''}
        </p>
        <p className="mt-1 text-fg">{dnc.reason}</p>
        <p className="mt-1 text-xs text-fg-muted">
          {dnc.by ? `${dnc.by.name} · ` : ''}{fmtDate(dnc.at, tz)}
        </p>
        {/* The reason, who and when stay visible to a lead — the flag is org-wide by design (owner
            ruling 2026-09-30); only the clear control is admin-only. */}
        {canEdit && (
          <button
            onClick={onUnflag}
            disabled={busy}
            className="mt-3 text-xs font-semibold text-danger hover:underline disabled:opacity-50"
          >
            {busy ? 'Removing…' : 'Remove flag'}
          </button>
        )}
      </div>
    </Section>
  );
}

function SurveyCard({ survey, onSave, onDelete, busy, canEdit, tz }) {
  const [edit, setEdit] = useState(false);
  // The survey the editor was seeded from, its editors' version, and the editor state. Held
  // separately from the prop so a refused save can re-seed from the latest answers in place.
  const [base, setBase] = useState(null);
  const [editor, setEditor] = useState(null);
  const [note, setNote] = useState('');
  const [notice, setNotice] = useState(null);

  // The same per-person editor as Door Outcomes' one-person-at-a-time walkthrough: it follows the
  // survey's logic, keeps off-path and retired answers, and posts only what changed. The earlier
  // answers are kept as a card below (owner ruling 4) — Save no longer destroys them.
  const startEdit = (from = survey, typedNote = null) => {
    setBase(from);
    setEditor(seedEditor(from.questions, from.answers));
    setNote(typedNote ?? from.note ?? '');
    setEdit(true);
  };
  const submit = () => {
    onSave(
      { answers: touchedAnswers(base.questions, editor), note: note.trim() || null, version: base.version },
      () => {
        setEdit(false);
        setNotice(null);
      },
      (e) => {
        // Someone changed this survey while the editor was open: re-seed from the latest, here.
        // The answers are the latest (the admin makes their change again); a note they typed is kept.
        const fresh = e.data?.profile?.surveys?.find((x) => x.id === survey.id);
        const typed = note.trim() !== (base?.note || '').trim() ? note : null;
        if (fresh) startEdit(fresh, typed);
        setNotice(fresh && typed != null ? `${e.message} The note you typed is kept.` : e.message);
      }
    );
  };

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-medium text-fg">
          {survey.templateName || 'Survey'} <span className="text-xs font-normal text-fg-subtle">· {fmtDate(survey.submittedAt, tz)}{survey.by ? ` · ${survey.by.name}` : ''}</span>
        </div>
        {!edit && canEdit && (
          <div className="flex gap-3 text-sm">
            <button onClick={() => startEdit()} className="font-medium text-brand-accent hover:underline">Edit</button>
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
                <dd className="font-medium text-fg">
                  {answerText(a.answer)}
                  {/* The capture flow usually embeds the write-in INTO the snapshot; only append
                      it when it isn't already there. Same guard as ResponseDetailDrawer. */}
                  {a.otherText &&
                    !(Array.isArray(a.answer) ? a.answer.includes(a.otherText) : a.answer === a.otherText) && (
                      <span className="text-fg-muted"> — {a.otherText}</span>
                    )}
                </dd>
              </div>
            ))}
          </dl>
          {survey.note && <p className="mt-2 rounded bg-sunken p-2 text-sm text-fg-muted"><span className="font-medium text-fg">Note:</span> {survey.note}</p>}
          {survey.edited && (
            <p className="mt-2 text-xs text-warning-fg">
              Edited {fmtDate(survey.edited.at, tz)}{survey.edited.by ? ` by ${survey.edited.by.name}` : ''}
              {survey.editedEarlier ? ' · the earlier answers are kept below.' : ''}
            </p>
          )}
          {survey.noteEdited && (
            <p className="mt-1 text-xs text-fg-subtle">
              Note edited {fmtDate(survey.noteEdited.at, tz)}{survey.noteEdited.by ? ` by ${survey.noteEdited.by.name}` : ''}
            </p>
          )}
          {/* Desk-entered: typed by an admin correcting the door's outcome, not collected at the
              door. It counts in every rate exactly like a field answer — this line is provenance,
              so nobody reads it as a doorstep conversation that never happened. */}
          {survey.deskEntry && (
            <p className="mt-2 text-xs text-warning-fg">
              Entered by {survey.deskEntry.by?.name || 'an admin'} on {fmtDate(survey.deskEntry.at, tz)}
              {survey.deskEntry.fromOutcome
                ? ` — this door was recorded as ${(ACTION_LABELS[survey.deskEntry.fromOutcome] || survey.deskEntry.fromOutcome).toLowerCase()}`
                : ''}
            </p>
          )}
          {survey.replacedEarlier && (
            <p className="mt-2 text-xs text-warning-fg">
              Replaced {survey.replacedEarlier.by?.name || 'another canvasser'}&apos;s earlier answers
              from {fmtDate(survey.replacedEarlier.submittedAt, tz)} — the earlier response is
              preserved below.
            </p>
          )}
        </>
      ) : (
        <div className="space-y-3">
          {notice && (
            <p className="rounded border border-warning/40 bg-warning-tint px-3 py-2 text-sm text-warning-fg">{notice}</p>
          )}
          <PerPersonAnswerEditor
            questions={base.questions}
            answers={base.answers}
            editor={editor}
            onChange={setEditor}
            idPrefix={`edit-${survey.id}`}
          />
          <label className="block text-xs font-medium text-fg-muted">
            Note
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="mt-1 w-full rounded border border-border-strong bg-card px-2 py-1.5 text-sm text-fg" />
          </label>
          <p className="text-xs text-fg-subtle">
            Saving keeps the earlier answers on this record, where you can restore them or erase them.
          </p>
          <div className="flex gap-2">
            <button onClick={submit} disabled={busy} className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60">Save</button>
            <button onClick={() => { setEdit(false); setNotice(null); }} className="rounded-md border border-border-strong px-3 py-1.5 text-sm">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

// A quiet audit footnote: did Doorline staff (a vendor inside a support session, not a member of
// this org) touch THIS voter's record, and why? Own its own fetch so a hiccup here can never take
// the profile down — on error it renders nothing at all.
// A PRESERVED (overwritten) response — read-only, visually muted, restorable. The restore is a
// lossless swap: these answers become current and the current ones land here the same way, so
// flipping back and forth destroys nothing.
// Why Restore isn't offered: the server's restore guard (services/surveys/restoreGuard.js) refuses
// to put answers back into a visit that no longer reads Surveyed, and the card says so up front.
const restoreBlockedText = (reason) =>
  reason === 'kept_after_undo'
    ? 'These answers were removed on Door Outcomes. That change was undone, but by then this visit had been recorded again, so they can’t go back.'
    : reason === 'unknocked'
    ? 'This visit was unknocked, so there is no survey to put these answers into. Undo the unknock on Door Outcomes to bring them back.'
    : reason === 'converted'
      ? 'This door’s outcome was changed from Surveyed. Undo that change on Door Outcomes to bring these answers back.'
      : 'This visit no longer reads Surveyed, so these answers can’t be put back.';

function OverwrittenSurveyCard({ survey, onRestore, onErase, busy, canRestore, tz }) {
  // An 'outcome_convert' row was REMOVED by an admin converting this door away from Surveyed, not
  // overwritten by another canvasser. The default copy ("was X's · replaced by Y") would read as an
  // accusation against the canvasser for something an admin did, so this direction says so plainly.
  // An 'unknock' row is the same: an admin struck the visit itself from the record. An 'answer_edit'
  // row is this same survey before an admin changed some answers (the profile's Edit, or Door
  // Outcomes → Edit answers) — "Earlier answers", never "Overwritten". A 'restore' row was set aside
  // when an admin restored earlier answers in its place: the name is the admin's, never a canvasser
  // who "replaced" it (code review round 4; Duplicate Surveys has said so since round 3).
  const removedByConversion = survey.overwrittenVia === 'outcome_convert';
  const removedByUnknock = survey.overwrittenVia === 'unknock';
  const earlierAnswers = survey.overwrittenVia === 'answer_edit';
  const setAside = survey.overwrittenVia === 'restore';
  const blocked = survey.restorable === false;
  const recorded = survey.deskEntry ? `entered by ${survey.deskEntry.by?.name || 'an admin'}` : survey.by ? `recorded by ${survey.by.name}` : null;
  return (
    <div className="rounded-lg border border-dashed border-border bg-sunken p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-medium text-fg-muted">
          {survey.templateName || 'Survey'}{' '}
          <span className="text-xs font-normal text-fg-subtle">
            {earlierAnswers ? (
              <>
                · Before {survey.overwrittenBy ? `${survey.overwrittenBy.name}'s` : 'an admin’s'} change on {fmtDate(survey.overwrittenAt, tz)}
                {recorded ? ` · ${recorded}` : ''}
              </>
            ) : removedByConversion ? (
              <>
                · Removed {fmtDate(survey.overwrittenAt, tz)} when this door&rsquo;s outcome was changed
                {survey.by ? ` · recorded by ${survey.by.name}` : ''}
                {survey.overwrittenBy ? ` · changed by ${survey.overwrittenBy.name}` : ''}
              </>
            ) : removedByUnknock ? (
              <>
                · Removed {fmtDate(survey.overwrittenAt, tz)} when this visit was unknocked
                {survey.by ? ` · recorded by ${survey.by.name}` : ''}
                {survey.overwrittenBy ? ` · unknocked by ${survey.overwrittenBy.name}` : ''}
              </>
            ) : setAside ? (
              <>
                · Set aside {fmtDate(survey.overwrittenAt, tz)} when {survey.overwrittenBy ? survey.overwrittenBy.name : 'an admin'} restored
                earlier answers
                {recorded ? ` · ${recorded}` : ''}
              </>
            ) : (
              <>
                · Overwritten {fmtDate(survey.overwrittenAt, tz)}
                {survey.by ? ` · was ${survey.by.name}'s` : ''}
                {survey.overwrittenBy ? ` · replaced by ${survey.overwrittenBy.name}` : ''}
              </>
            )}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant={removedByConversion || removedByUnknock || earlierAnswers || setAside ? 'neutral' : 'danger'}>
            {earlierAnswers ? 'Earlier answers' : removedByConversion || removedByUnknock ? 'Removed' : setAside ? 'Set aside' : 'Overwritten'}
          </Badge>
          {canRestore && !blocked && (
            <button
              onClick={onRestore}
              disabled={busy}
              className="text-xs font-semibold text-brand-accent hover:underline disabled:opacity-50"
            >
              {earlierAnswers ? 'Restore these answers…' : 'Restore this response…'}
            </button>
          )}
          {canRestore && onErase && (
            <button
              onClick={onErase}
              disabled={busy}
              className="text-xs font-semibold text-danger hover:underline disabled:opacity-50"
            >
              Erase…
            </button>
          )}
        </div>
      </div>
      {canRestore && blocked && (
        <p className="mb-2 text-xs text-fg-subtle">{restoreBlockedText(survey.restoreBlockedReason)}</p>
      )}
      <dl className="space-y-1.5 text-sm">
        {survey.answers.map((a) => (
          <div key={a.questionKey} className="flex gap-2">
            <dt className="text-fg-subtle">{a.questionLabel}:</dt>
            <dd className="text-fg-muted">{answerText(a.answer)}</dd>
          </div>
        ))}
      </dl>
      {survey.note && <p className="mt-2 rounded bg-card p-2 text-sm text-fg-muted"><span className="font-medium text-fg">Note:</span> {survey.note}</p>}
      {survey.editedAt && (
        <p className="mt-2 text-xs text-fg-subtle">
          Edited {fmtDate(survey.editedAt, tz)}{survey.editedBy ? ` by ${survey.editedBy.name}` : ''} (before it was overwritten)
        </p>
      )}
    </div>
  );
}

function StaffAccessCard({ voterId, tz }) {
  const q = useQuery({
    queryKey: ['voter-staff-access', voterId],
    queryFn: () => api(`/admin/voters/${voterId}/staff-access`),
    retry: false,
  });
  // Error or still-loading → render nothing. Minimal by design: the card simply appears once the
  // audit data lands, and the profile is never blocked or broken by it.
  if (q.isError || q.isLoading || !q.data) return null;

  const { count, entries } = q.data;
  // Record-level capture is new; say so plainly so an empty history isn't read as "provably never."
  const subNote = (
    <p className="text-xs text-fg-subtle">
      Record-level tracking began July 19, 2026; earlier staff access (if any) was logged per-request only.
    </p>
  );

  return (
    <Section title="Doorline staff access">
      {count === 0 ? (
        <>
          <p className="text-sm text-fg-muted">Never accessed by Doorline staff.</p>
          <div className="mt-2">{subNote}</div>
        </>
      ) : (
        <>
          {subNote}
          <ul className="mt-3 space-y-2 text-sm">
            {entries.map((e, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-x-2 text-fg-muted">
                <span className="text-fg-subtle">{fmtDate(e.at, tz)}</span>
                <span className="font-medium text-fg">{e.staffFirstName || 'Doorline staff'}</span>
                {e.reason && (
                  <span className="max-w-xs truncate text-fg-muted" title={e.reason}>· {e.reason}</span>
                )}
                {e.export && (
                  <span
                    className="rounded-full bg-sunken px-2 py-0.5 text-xs font-medium text-fg-muted"
                    title="This record was included in a data export, not opened individually"
                  >
                    export
                  </span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </Section>
  );
}

// One page, two scopes. ORG mode (/voters/:voterId, org admins only) reads the org profile: the
// person's surveys, notes and campaigns unioned across the org. CAMPAIGN mode
// (/campaigns/:campaignId/voters/:voterId) reads the campaign-nested route, which a team lead's
// grant admits: for a lead the server narrows those unions to THIS campaign's row, and the page is
// read-only — every write below calls an org-admin-only route, so its control is not offered. An
// org admin gets the same org-wide profile there and every control. `cid` picks the mode,
// `canManage` the controls.
export default function VoterDetailPage() {
  const { voterId, campaignId: cid } = useParams();
  const { isOrgAdmin } = useAuth();
  const orgTz = useOrgTimeZone();
  const { state } = useLocation(); // referrer (e.g. { from: 'notes', campaignId }) for a contextual back
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [newNote, setNewNote] = useState('');
  const [err, setErr] = useState('');
  // A refusal lands in the banner at the top, often far above the card pressed: bring it into view
  // (round 6; Door Outcomes does the same).
  const errRef = useRef(null);
  useEffect(() => {
    if (!err) return undefined;
    const frame = requestAnimationFrame(() => errRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
    return () => cancelAnimationFrame(frame);
  }, [err]);

  // Org mode sits behind the orgAdmin RoleGate, so this is only ever false for a lead in campaign mode.
  const canManage = isOrgAdmin;
  // Where this page's links go: the campaign-relative twin of each org path in campaign mode.
  const listPath = cid ? `/campaigns/${cid}/voters` : '/voters';
  const profilePath = (id) => (cid ? `/campaigns/${cid}/voters/${id}` : `/voters/${id}`);

  // The campaign key EXTENDS the org key, so one prefix invalidation on ['admin','voter',voterId]
  // (react-query's partial matching) refreshes both after a write — an admin editing from the
  // campaign tab never leaves the org profile stale, nor the other way round. The household
  // do-not-knock control below invalidates the same prefix.
  const key = cid ? ['admin', 'voter', voterId, { campaignId: cid }] : ['admin', 'voter', voterId];
  const profileQ = useQuery({
    queryKey: key,
    queryFn: () => api(cid ? `/admin/campaigns/${cid}/voters/${voterId}` : `/admin/voters/${voterId}`),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin', 'voter', voterId] });
  const onErr = (e) => setErr(e.message);

  const saveVoter = useMutation({
    mutationFn: (body) => api(`/admin/voters/${voterId}`, { method: 'PATCH', body }),
    onSuccess: () => { setErr(''); invalidate(); },
    onError: onErr,
  });
  // The one write a lead may make. In campaign mode it goes to the campaign-nested route for every
  // role — the URL is the scope, and the server refuses a voter outside it; the org route is
  // admin-only. Every other write below stays on the org routes (admin-only, controls gated).
  const addNote = useMutation({
    mutationFn: (body) =>
      api(cid ? `/admin/campaigns/${cid}/voters/${voterId}/notes` : `/admin/voters/${voterId}/notes`, {
        method: 'POST',
        body: { body },
      }),
    onSuccess: () => { setNewNote(''); invalidate(); },
    onError: onErr,
  });
  const delNote = useMutation({
    mutationFn: (noteId) => api(`/admin/voters/${voterId}/notes/${noteId}`, { method: 'DELETE' }),
    onSuccess: invalidate, onError: onErr,
  });
  // Each press clears the banner first, so the same refusal twice is brought into view twice (round 8).
  // Each survey and earlier-answers card acts on its OWN voter row: the profile lists the person's rows in
  // every campaign of the organization, and one sent to this row's address answered 404 (round 7).
  const editSurvey = useMutation({
    onMutate: () => setErr(''),
    mutationFn: ({ responseId, rowId, body }) => api(`/admin/voters/${rowId || voterId}/surveys/${responseId}`, { method: 'PATCH', body }),
    onSuccess: () => { setErr(''); invalidate(); },
    // A survey changed under an open editor: the card re-seeds and says so itself.
    onError: (e) => { if (e.code !== 'RESPONSE_CHANGED') onErr(e); invalidate(); },
  });
  // A copy gone between the profile's read and the press: said plainly, with no guess at why — the page
  // reloads to show what is kept now (round 6: "Preserved response not found"; round 7: the guess, "an
  // undo put them back", was said of a card that was still on file).
  const goneWords = (act) =>
    act === 'erase'
      ? 'Those earlier answers aren’t on file any more, so there was nothing to erase. The page has reloaded to show what’s kept now.'
      : 'Those earlier answers aren’t on file any more, so there was nothing to restore. The page has reloaded to show what’s kept now.';
  const eraseSurvey = useMutation({
    onMutate: () => setErr(''),
    mutationFn: ({ archiveId, rowId }) => api(`/admin/voters/${rowId || voterId}/surveys/archive/${archiveId}`, { method: 'DELETE' }),
    onSuccess: () => { setErr(''); invalidate(); },
    // A refusal (an undo putting the copy back) or a copy already gone: the card is out of date.
    onError: (e) => { if (e.status === 404) setErr(goneWords('erase')); else onErr(e); invalidate(); },
  });
  const delSurvey = useMutation({
    onMutate: () => setErr(''),
    mutationFn: ({ responseId, rowId }) => api(`/admin/voters/${rowId || voterId}/surveys/${responseId}`, { method: 'DELETE' }),
    onSuccess: invalidate, onError: onErr,
  });
  const restoreSurvey = useMutation({
    onMutate: () => setErr(''),
    mutationFn: ({ archiveId, rowId }) => api(`/admin/voters/${rowId || voterId}/surveys/${archiveId}/restore`, { method: 'POST' }),
    onSuccess: () => { setErr(''); invalidate(); },
    // A refusal means the profile is out of date (the survey changed, or its visit no longer reads
    // Surveyed): reload it so the cards say what is true now.
    onError: (e) => { if (e.status === 404) setErr(goneWords('restore')); else onErr(e); invalidate(); },
  });
  const flagDnc = useMutation({
    mutationFn: (reason) => api(`/admin/voters/${voterId}/dnc`, { method: 'POST', body: { reason } }),
    onSuccess: () => { setErr(''); invalidate(); }, onError: onErr,
  });
  const unflagDnc = useMutation({
    mutationFn: () => api(`/admin/voters/${voterId}/dnc`, { method: 'DELETE' }),
    onSuccess: () => { setErr(''); invalidate(); }, onError: onErr,
  });
  // Door-added rows only — the server refuses everything else (NOT_DOOR_ADDED).
  const deleteVoter = useMutation({
    mutationFn: () => api(`/admin/voters/${voterId}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'voters'] });
      navigate(listPath);
    },
    onError: onErr,
  });

  const fromNotes = state?.from === 'notes' && !!state.campaignId;
  const back = (
    <Link
      to={fromNotes ? `/campaigns/${state.campaignId}/notes` : listPath}
      className="text-sm font-medium text-brand-accent hover:underline"
    >
      {fromNotes ? '‹ Notes' : '‹ Voters'}
    </Link>
  );

  if (profileQ.isLoading) return <div className="p-6 text-sm text-fg-muted">Loading…</div>;
  if (profileQ.error) {
    // Keep the way back on screen. In campaign mode the server answers 404 VOTER_NOT_IN_CAMPAIGN
    // for a voter outside this campaign, for every role (a lead cannot probe other campaigns'
    // ids), and its sentence is the one shown.
    return (
      <div className="max-w-4xl">
        {back}
        <div className="mt-4 text-sm text-danger">Error: {profileQ.error.message}</div>
      </div>
    );
  }

  const p = profileQ.data;
  const v = p.voter;
  const h = p.household;

  return (
    <div className="max-w-4xl">
      {back}
      <div className="mb-6 mt-1 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold text-fg">{v.fullName}</h1>
        {!v.stateVoterId?.startsWith('manual:') && (
          <span className="font-mono text-xs text-fg-subtle">{v.stateVoterId}</span>
        )}
        {v.doorAdded && (
          <span className="rounded-full bg-brand-tint px-2 py-0.5 text-xs font-medium text-brand-tint-fg">
            Added at the door{v.doorAdded.by ? ` by ${v.doorAdded.by.name}` : ''}{v.doorAdded.at ? ` · ${fmtDate(v.doorAdded.at, orgTz, false)}` : ''}
          </span>
        )}
        {v.party && <span className="rounded-full bg-sunken px-2 py-0.5 text-xs text-fg-muted">{v.party}</span>}
        <span className={'rounded-full px-2 py-0.5 text-xs font-medium ' + (v.surveyStatus === 'surveyed' ? 'bg-success-tint text-success' : 'bg-sunken text-fg-muted')}>
          {v.surveyStatus === 'surveyed' ? 'Surveyed' : 'Not surveyed'}
        </span>
        {p.voted?.isVoted && <span className="rounded-full bg-teal-500/15 px-2 py-0.5 text-xs font-medium text-teal-600">✓ Voted</span>}
        {v.doNotContact?.flagged && <span className="rounded-full bg-danger-tint px-2 py-0.5 text-xs font-medium text-danger">Do not contact</span>}
      </div>

      {err && <div ref={errRef} className="mb-4 rounded border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger">{err}</div>}

      <VoterFields
        voter={v}
        person={p.person}
        saving={saveVoter.isPending}
        onSave={(body, done) => saveVoter.mutate(body, { onSuccess: done })}
        canEdit={canManage}
        tz={orgTz}
      />

      <DncSection
        dnc={v.doNotContact}
        busy={flagDnc.isPending || unflagDnc.isPending}
        onFlag={(reason) => flagDnc.mutate(reason)}
        onUnflag={() => { if (window.confirm('Remove the do-not-contact flag from this voter?')) unflagDnc.mutate(); }}
        canEdit={canManage}
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
              {h.doNotKnock && <span className="ml-2 font-semibold text-danger">· do not knock</span>}
            </p>
            <HouseholdDoNotKnockControl household={h} voterId={voterId} />
            {/* The same person's record in each other campaign of this org (sibling rows). In
                campaign mode each link opens THAT campaign's profile; a lead never sees this list
                (the server narrows their profile to this campaign and sends []). */}
            {p.otherCampaigns?.length > 0 && (
              <p className="mt-1 text-fg-muted">
                Also in:{' '}
                {p.otherCampaigns.map((oc, i) => (
                  <span key={oc.voterId}>
                    {i > 0 && ', '}
                    <Link
                      to={cid ? `/campaigns/${oc.campaignId}/voters/${oc.voterId}` : `/voters/${oc.voterId}`}
                      className="text-brand-accent hover:underline"
                    >
                      {oc.name || 'campaign'}
                    </Link>
                    <span className="text-fg-subtle"> ({oc.surveyStatus === 'surveyed' ? 'surveyed' : 'not surveyed'})</span>
                  </span>
                ))}
              </p>
            )}
            {h.members.length > 0 && (
              <div className="mt-3">
                <div className="text-xs uppercase tracking-wide text-fg-subtle">Household members</div>
                <ul className="mt-1 space-y-1">
                  {h.members.map((m) => (
                    <li key={m.id}>
                      <Link to={profilePath(m.id)} className="text-brand-accent hover:underline">{m.fullName}</Link>
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
        {/* Preserved cards render even with ZERO live responses — deleting the only live response
            must not strand its preserved sibling, which is the restore-into-the-void path. */}
        {p.surveys.length === 0 && (p.overwrittenSurveys || []).length === 0 ? (
          <p className="text-sm text-fg-muted">No survey responses.</p>
        ) : (
          <div className="space-y-3">
            {p.surveys.map((s) => (
              <SurveyCard
                key={s.id}
                survey={s}
                busy={editSurvey.isPending || delSurvey.isPending}
                onSave={(body, done, conflict) =>
                  editSurvey.mutate(
                    { responseId: s.id, rowId: s.voterId, body },
                    { onSuccess: done, onError: (e) => { if (e.code === 'RESPONSE_CHANGED') conflict(e); } }
                  )
                }
                onDelete={() => { if (window.confirm('Delete this survey response?')) delSurvey.mutate({ responseId: s.id, rowId: s.voterId }); }}
                canEdit={canManage}
                tz={orgTz}
              />
            ))}
            {(p.overwrittenSurveys || []).map((s) => (
              <OverwrittenSurveyCard
                key={s.id}
                survey={s}
                busy={restoreSurvey.isPending || eraseSurvey.isPending}
                canRestore={canManage}
                onRestore={() => {
                  if (s.overwrittenVia === 'answer_edit') {
                    const admin = s.overwrittenBy?.name || 'an admin';
                    if (
                      window.confirm(
                        `Put back the answers and the note from before ${admin}'s change on ${fmtDate(s.overwrittenAt, orgTz)}? ` +
                          'The current ones are kept the same way, so you can swap back.'
                      )
                    ) {
                      restoreSurvey.mutate({ archiveId: s.id, rowId: s.voterId });
                    }
                    return;
                  }
                  const loser = s.by?.name || 'the earlier canvasser';
                  const when = fmtDate(s.submittedAt, orgTz);
                  if (
                    window.confirm(
                      `Restore ${loser}'s answers from ${when}? This swaps the two responses: ` +
                        `${loser}'s answers become the voter's current response, and the current ` +
                        `answers are preserved the same way. Nothing is deleted — you can swap back.`
                    )
                  ) {
                    restoreSurvey.mutate({ archiveId: s.id, rowId: s.voterId });
                  }
                }}
                onErase={() => {
                  // Erase is for good. When the card belongs to a Door Outcomes change still in
                  // effect, say what erasing it means for that change's undo.
                  const warn =
                    s.overwrittenVia === 'unknock'
                      ? ' If that unknock is undone later, this door comes back as Surveyed without these answers.'
                      : s.overwrittenVia === 'outcome_convert'
                        ? ' If that change is undone later, this door comes back as Surveyed without these answers.'
                        : s.overwrittenVia === 'answer_edit' && s.fromDoorOutcomes
                          ? ' Undo on that Door Outcomes change won’t put this survey back afterwards.'
                          : '';
                  if (window.confirm(`Erase these earlier answers for good? This can’t be undone.${warn}`)) {
                    eraseSurvey.mutate({ archiveId: s.id, rowId: s.voterId });
                  }
                }}
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
                  {canManage && (
                    <button onClick={() => delNote.mutate(n.id)} className="shrink-0 text-xs text-danger hover:underline">Delete</button>
                  )}
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
                  <p className="mt-1 text-xs text-fg-subtle">{n.source === 'survey' ? 'Survey' : actionLabel(n.actionType)} · {n.by ? n.by.name : 'Unknown'} · {fmtDate(n.timestamp, orgTz)}</p>
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
                {/* The canonical label (statusColors.js): the slug with an underscore swapped read "not target". */}
                <span className="font-medium text-fg">{actionLabel(a.actionType)}</span>
                <span className="text-fg-subtle">· {fmtDate(a.timestamp, orgTz)}{a.by ? ` · ${a.by.name}` : ''}</span>
                {a.note && <span className="text-fg-muted">— {a.note}</span>}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* Admin-only (owner ruling 2026-09-30): its route is on the org router, which would 403 a
          lead — so the card is not mounted for them, not merely hidden on error. */}
      {canManage && <StaffAccessCard voterId={voterId} tz={orgTz} />}

      {/* Only door-added (walk-up) rows can be deleted — a mistaken or fraudulent entry typed
          at a door. Imported voters leave via re-import/undo-import or campaign deletion. */}
      {v.doorAdded && canManage && (
        <Section title="Remove this entry">
          <p className="text-sm text-fg-muted">
            This person was added at the door{v.doorAdded.by ? ` by ${v.doorAdded.by.name}` : ''} and
            isn't from a voter file. Deleting them permanently removes their survey answers and
            notes; the door visit itself stays recorded.
          </p>
          <button
            onClick={() => {
              if (
                window.confirm(
                  `Delete ${v.fullName}? Their survey answers and notes are permanently deleted. ` +
                    'The door visit itself stays recorded. This cannot be undone.'
                )
              ) {
                deleteVoter.mutate();
              }
            }}
            disabled={deleteVoter.isPending}
            className="mt-3 rounded-md border border-danger/40 px-4 py-2 text-sm font-semibold text-danger hover:bg-danger-tint disabled:opacity-60"
          >
            {deleteVoter.isPending ? 'Deleting…' : 'Delete this person'}
          </button>
        </Section>
      )}
    </div>
  );
}
