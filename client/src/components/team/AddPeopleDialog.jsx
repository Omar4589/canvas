import { useId, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../../api/client.js';
import { Button, Input, Modal, PhoneInput, Segmented, Select } from '../ui/index.js';
import PasswordInput from '../PasswordInput.jsx';
import Pager from '../Pager.jsx';
import CrewSelect from './CrewSelect.jsx';
import { RunProgress, RunSummary } from './RunReport.jsx';
import { tempPasswordProblem } from '../../lib/validators.js';
import { coordinatorChoices, bulkAffectedIds, joinClassify, teamName } from '../../lib/crewChange.js';
import {
  fromOrgLines,
  fromOrgSummary,
  historyLine,
  joinLine,
  joinMoves,
  movedReport,
  prePick,
  typedIgnoredLine,
  waitLine,
} from '../../lib/addPeople.js';
import { previewThenRun, runPreviewed } from '../../lib/runInChunks.js';
import { SELECT_MAX, toggleId } from '../../lib/teamSelection.js';
import { clampPage, pageOf } from '../../lib/rosterView.js';
import { useChunkRun } from '../../lib/useChunkRun.js';
import { teamLabelsLine, useAffectedTeams } from '../../lib/useAffectedTeams.js';

// Add people to a campaign (docs/PROPOSAL_PEOPLE_PAGES.md §E.6), one window with two ways in:
//
// By email (everyone). Start with the address; the server says who it belongs to HERE (POST
// .../crew/resolve) and the step confirms that — a new account, a colleague in the organization, or
// (for org admins) a switched-off account — each with a Crew choice. Someone who worked this campaign
// before sees how many doors they have here and on which teams, the crew those doors count for is
// picked for them when its coordinator can still run one, and under the choice it says how many doors
// move and which client-report teams change. An address with an account at another customer looks
// exactly like an unused one (that's the privacy design); the Done step says who actually landed, and
// what of theirs moved. The lookups count against two hourly limits; a 429 says how long to wait.
//
// From your organization (org admins). Tick active members who aren't on the campaign, up to 500,
// pick one crew, see what their earlier doors here will do (one Move to crew… preview, which models
// joining for people not on the roster), then POST .../assignments 25 at a time. Someone another admin
// added meanwhile is skipped and never re-crewed.

const EMPTY = { firstName: '', lastName: '', phone: '', password: '' };
const PAGE = 25;
const nameOfMember = (m) => `${m.user.firstName || ''} ${m.user.lastName || ''}`.trim() || m.user.email;

// The coordinators an add's doors move between, for the client-report line (lib/crewChange.js's rule).
const joinAffectedIds = (history, pick, personId) => {
  const moves = joinMoves(history, pick);
  const anyNone = !pick || moves.sources.some((s) => !s.coordinatorId);
  return [...new Set([...moves.sources.map((s) => s.coordinatorId), pick || null, anyNone ? personId : null].filter(Boolean).map(String))].sort();
};

const Line = ({ tone = 'muted', children }) => (
  <p className={`text-sm ${tone === 'muted' ? 'text-fg-muted' : tone === 'warn' ? 'text-warning-fg' : tone === 'danger' ? 'text-danger-fg' : 'text-fg'}`}>{children}</p>
);

const Note = ({ children }) => (
  <div className="rounded-md border border-warning/30 bg-warning-tint px-3 py-2 text-xs text-warning-fg">{children}</div>
);

// ── By email ─────────────────────────────────────────────────────────────────────────────────────
//
// byEmailView is the steps as a pure function of where the add has got to (`v`), so each step renders
// from a fixture (addPeopleRender.smoke.test.js); useByEmail holds the state, the requests and the
// handlers it calls (`on`).
export const byEmailView = (v, on) => {
  const { baseId, campaignName, isOrgAdmin, choices, email, cleanEmail, address, form, found, done, pick, pickName, reportsLine } = v;
  const person = found?.person || null;
  const name = person ? `${person.firstName || ''} ${person.lastName || ''}`.trim() : '';
  const first = person?.firstName || name;
  const history = found?.history || null;

  const backButton = (
    <Button variant="secondary" size="sm" onClick={on.back} disabled={v.adding}>
      Back
    </Button>
  );
  const addError = v.addError && <Line tone="danger">{v.addError.message}</Line>;
  const crewField = (
    <div>
      <label htmlFor={`${baseId}-crew`} className="mb-1 block text-xs font-medium text-fg-muted">
        Crew
      </label>
      <CrewSelect id={`${baseId}-crew`} coordinators={choices} value={pick} onChange={on.setCrew} disabled={v.adding} />
    </div>
  );
  // What the pick does to a returning person's doors, and which client-report teams that changes.
  const line = joinLine(history, pick, pickName);
  const pickConsequence = line ? (
    <div className="space-y-1">
      <Line tone="fg">{line}</Line>
      {reportsLine && <p className="text-xs text-fg">{reportsLine}</p>}
    </div>
  ) : null;

  // ── Done ──
  if (done) {
    const landed = `${done.user?.firstName || ''} ${done.user?.lastName || ''}`.trim() || address;
    const landedFirst = done.user?.firstName || landed;
    const already = done.outcome === 'on-campaign';
    const moved = already ? null : movedReport(landedFirst, done.restamp, pickName);
    const openLink = (
      <button type="button" className="font-medium text-brand-accent hover:underline" onClick={() => on.openPerson(String(done.user?.id || done.user?._id))}>
        Open {landedFirst}
      </button>
    );
    return {
      title: already ? 'Already here' : 'Added',
      body: (
        <div className="space-y-3">
          {already ? (
            <Line tone="fg">
              <span className="font-medium">{landed}</span> is already on this campaign, so nothing changed. {openLink}
            </Line>
          ) : done.outcome === 'in-org-inactive' && found?.onCampaign ? (
            <Line tone="fg">
              <span className="font-medium">{landed}</span>’s account is back on. Their crew here stays as it was.
            </Line>
          ) : (
            <Line tone="fg">
              <span className="font-medium">{landed}</span> is on {campaignName}.
            </Line>
          )}
          {done.attached && (
            // The typed name was discarded in favour of a real person the operator had not met. Say so plainly.
            <Note>
              {typedIgnoredLine(landedFirst)} They keep their own password. If that isn’t who you meant, remove them from
              the campaign and check the address.
            </Note>
          )}
          {/* The lookup found nobody, but by the add someone in the organization had the address (added
              meanwhile): they joined as themselves, and the name typed for a new account wasn't used. */}
          {found?.outcome === 'outside' && !done.attached && !already && done.outcome !== 'created' && (
            <Note>{typedIgnoredLine(landedFirst)}</Note>
          )}
          {done.outcome === 'created' && <Line>They’ve been emailed a link to set their own password.</Line>}
          {moved && (
            <Line tone="fg">
              {moved} {openLink} to change their crew; it shows the count first.
            </Line>
          )}
        </div>
      ),
      footer: (
        <>
          <Button variant="secondary" size="sm" onClick={on.addAnother}>
            Add another
          </Button>
          <Button size="sm" onClick={on.close}>
            Done
          </Button>
        </>
      ),
    };
  }

  // ── Step 1: who is this? ──
  if (!found) {
    const limited = v.resolveError?.status === 429;
    return {
      title: `Add someone to ${campaignName}`,
      body: (
        <form id={`${baseId}-lookup`} onSubmit={on.lookUp} className="space-y-3">
          <Line>Start with their email address. If they already have an account we’ll add that person; if not, you’ll create one.</Line>
          <div>
            <label htmlFor={`${baseId}-email`} className="mb-1 block text-xs font-medium text-fg-muted">
              Email
            </label>
            {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
            {/* Locked while the lookup is out: what the next step says and what the add sends both belong to
                the address that was looked up. */}
            <Input id={`${baseId}-email`} type="email" value={email} onChange={(e) => on.setEmail(e.target.value)} required autoFocus disabled={v.resolving} />
          </div>
          {limited ? (
            <div role="alert" className="rounded-md border border-warning/30 bg-warning-tint px-3 py-2 text-sm text-warning-fg">
              {waitLine(v.resolveError.data?.retryAfterSeconds)}
            </div>
          ) : (
            v.resolveError && v.resolveError.name !== 'AbortError' && <Line tone="danger">{v.resolveError.message}</Line>
          )}
        </form>
      ),
      footer: (
        <>
          <Button variant="secondary" size="sm" onClick={on.close}>
            Cancel
          </Button>
          {/* A submit for the form above, so the browser checks the address before any lookup. */}
          <Button type="submit" form={`${baseId}-lookup`} size="sm" loading={v.resolving} disabled={!cleanEmail}>
            Continue
          </Button>
        </>
      ),
    };
  }

  const historyNote = historyLine(first, history) ? <Line tone="fg">{historyLine(first, history)}</Line> : null;

  // ── Step 2: confirm what the address turned out to be ──
  if (found.outcome === 'on-campaign') {
    return {
      title: 'Already here',
      body: (
        <div className="space-y-3">
          <Line tone="fg">
            <span className="font-medium">{name}</span> is already on this campaign.
          </Line>
          <Line>Their crew is changed from their panel, where it shows how many doors move first.</Line>
        </div>
      ),
      footer: (
        <>
          {backButton}
          <Button size="sm" onClick={() => on.openPerson(String(person.userId))}>
            Open {first}
          </Button>
        </>
      ),
    };
  }

  if (found.outcome === 'in-org-inactive') {
    // A lead is told to ask an org admin; an admin switches them on — and, for someone already on this
    // campaign, nothing else: their crew stays as it is, so there is no Crew choice.
    const onCampaign = !!found.onCampaign;
    return {
      title: 'Account switched off',
      body: (
        <div className="space-y-3">
          <Line tone="fg">
            <span className="font-medium">{name}</span> is in your organization
            {onCampaign ? ' and on this campaign' : ''}, but their account is switched off.
          </Line>
          <Line>
            {isOrgAdmin
              ? 'Switching it back on restores their access to every campaign they were on, not just this one.'
              : 'Switching an account back on affects every campaign in the organization, so an org admin has to do it.'}
          </Line>
          {isOrgAdmin && !onCampaign && (
            <>
              {historyNote}
              {crewField}
              {pickConsequence}
            </>
          )}
          {addError}
        </div>
      ),
      footer: (
        <>
          {backButton}
          {isOrgAdmin ? (
            <Button size="sm" loading={v.adding} onClick={onCampaign ? on.switchOn : on.submitNamed}>
              {onCampaign ? 'Switch on' : 'Switch on & add'}
            </Button>
          ) : (
            <Button size="sm" onClick={on.close}>
              Close
            </Button>
          )}
        </>
      ),
    };
  }

  if (found.outcome === 'in-org') {
    return {
      title: `Add them to ${campaignName}?`,
      body: (
        <div className="space-y-3">
          <Line tone="fg">
            <span className="font-medium">{name}</span> is already in your organization
            {person.role !== 'canvasser' ? ` (${person.role === 'lead' ? 'a team lead' : 'an admin'})` : ''}.
          </Line>
          {historyNote}
          {crewField}
          {pickConsequence || <Line>Their doors from here on count toward {pick ? teamName(pickName) : 'no team'}.</Line>}
          {addError}
        </div>
      ),
      footer: (
        <>
          {backButton}
          <Button size="sm" loading={v.adding} onClick={on.submitNamed}>
            Add to campaign
          </Button>
        </>
      ),
    };
  }

  // 'outside' — nobody in this organization uses that address. Deliberately the same answer whether the
  // address is unused or belongs to another customer's account.
  const set = (k) => (e) => on.setForm((f) => ({ ...f, [k]: e.target.value }));
  return {
    title: 'New canvasser',
    body: (
      <form id={`${baseId}-new`} onSubmit={on.submitNew} className="space-y-3">
        <Line>
          No one in your organization uses <span className="font-medium text-fg">{address}</span>. Create their account and
          put them on this campaign.
        </Line>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor={`${baseId}-first`} className="mb-1 block text-xs font-medium text-fg-muted">
              First name
            </label>
            <Input id={`${baseId}-first`} value={form.firstName} onChange={set('firstName')} required />
          </div>
          <div>
            <label htmlFor={`${baseId}-last`} className="mb-1 block text-xs font-medium text-fg-muted">
              Last name
            </label>
            <Input id={`${baseId}-last`} value={form.lastName} onChange={set('lastName')} required />
          </div>
        </div>
        <div>
          <label htmlFor={`${baseId}-phone`} className="mb-1 block text-xs font-medium text-fg-muted">
            Phone <span className="text-fg-subtle">(optional)</span>
          </label>
          <PhoneInput id={`${baseId}-phone`} value={form.phone} onChange={set('phone')} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-fg-muted">
            Temporary password <span className="text-fg-subtle">(optional)</span>
          </label>
          <PasswordInput value={form.password} onChange={set('password')} autoComplete="new-password" placeholder="Leave blank to email an invite" />
          <p className="mt-1 text-xs text-fg-subtle">
            Leave blank to let them set their own password via the emailed invite (recommended). Type one only if they can’t
            receive email.
          </p>
        </div>
        {crewField}
        {v.localError && <Line tone="danger">{v.localError}</Line>}
        {addError}
      </form>
    ),
    footer: (
      <>
        {backButton}
        <Button type="submit" form={`${baseId}-new`} size="sm" loading={v.adding}>
          Create &amp; add
        </Button>
      </>
    ),
  };
};

const useByEmail = ({ campaignId, campaignName, isOrgAdmin, coordinators, onOpenPerson, onAdded, onClose }) => {
  const baseId = useId();
  const [email, setEmail] = useState('');
  const [form, setForm] = useState(EMPTY);
  const [crew, setCrew] = useState(null);
  const [localError, setLocalError] = useState('');
  const cleanEmail = email.trim().toLowerCase();

  const resolveMut = useMutation({
    mutationFn: ({ address, signal }) => api(`/admin/campaigns/${campaignId}/crew/resolve`, { method: 'POST', body: { email: address }, signal }),
  });
  const addMut = useMutation({
    mutationFn: (body) => api(`/admin/campaigns/${campaignId}/crew`, { method: 'POST', body }),
    onSuccess: () => onAdded?.(),
  });

  const found = resolveMut.data;
  const done = addMut.data;
  // The address the step describes, and every add sends: the one looked up, never what the box says now.
  const address = found ? resolveMut.variables?.address || cleanEmail : cleanEmail;
  const person = found?.person || null;
  const history = found?.history || null;
  const choices = coordinators.filter((c) => c.id !== person?.userId);
  const pick = crew ?? prePick(history, choices.map((c) => c.id));
  const pickName = pick ? coordinators.find((c) => c.id === pick)?.name || null : null;
  const affectedQ = useAffectedTeams(campaignId, joinAffectedIds(history, pick, person?.userId), joinMoves(history, pick).sources.length > 0 && !done);

  const back = () => {
    resolveMut.reset();
    addMut.reset();
    setLocalError('');
    setCrew(null);
  };
  const on = {
    setEmail,
    setForm,
    setCrew,
    back,
    close: onClose,
    openPerson: onOpenPerson,
    lookUp: (e) => {
      e?.preventDefault();
      if (!cleanEmail) return;
      setLocalError('');
      setCrew(null);
      addMut.reset();
      resolveMut.mutate({ address: cleanEmail });
    },
    addAnother: () => {
      back();
      setEmail('');
      setForm(EMPTY);
    },
    submitNew: (e) => {
      e?.preventDefault();
      // The temp password is OPTIONAL. Blank → the server generates a throwaway nobody sees and the new
      // canvasser sets their own via the emailed link. Only a typed one is checked.
      if (form.password !== '') {
        const problem = tempPasswordProblem(form.password);
        if (problem) {
          setLocalError(problem);
          return;
        }
      }
      setLocalError('');
      addMut.mutate({
        email: address,
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        phone: form.phone.trim() || undefined,
        password: form.password,
        coordinatorId: pick || null,
      });
    },
    submitNamed: () => addMut.mutate({ email: address, coordinatorId: pick || null }),
    // Switch on, for someone already on this campaign: their crew stays as it is.
    switchOn: () => addMut.mutate({ email: address }),
  };

  const view = byEmailView(
    {
      baseId,
      campaignName,
      isOrgAdmin,
      choices,
      email,
      cleanEmail,
      address,
      form,
      found,
      done,
      pick,
      pickName,
      reportsLine: teamLabelsLine(affectedQ),
      resolving: resolveMut.isPending,
      resolveError: resolveMut.error,
      adding: addMut.isPending,
      addError: addMut.error,
      localError,
    },
    on
  );
  // Nothing closes while the add is out: the Done step is where it says who actually landed and what moved.
  return { ...view, closable: !addMut.isPending, started: !!found || resolveMut.isPending || !!resolveMut.error };
};

// ── From your organization ───────────────────────────────────────────────────────────────────────
const useFromOrg = ({ campaignId, campaignName, isOrgAdmin, coordinators, rosterIds, onAdded, onClose }) => {
  const baseId = useId();
  const membersQ = useQuery({
    queryKey: ['memberships'],
    queryFn: ({ signal }) => api('/admin/memberships', { signal }),
    enabled: isOrgAdmin,
  });
  const [q, setQ] = useState('');
  const [role, setRole] = useState('all');
  const [page, setPage] = useState(1);
  const [ticked, setTicked] = useState(() => new Set());
  const [crew, setCrew] = useState('');
  // Each Check is its own preview, of the people ticked at that moment.
  const [check, setCheck] = useState(null);
  const [answers, setAnswers] = useState([]);
  const [stopping, setStopping] = useState(false);
  const runner = useChunkRun({ onFinally: () => onAdded?.() });

  const candidates = useMemo(() => {
    const words = q.toLowerCase().trim().split(/\s+/).filter(Boolean);
    return (membersQ.data?.members || [])
      .filter((m) => m.isActive && m.user.isActive && !m.user.isDeleted && !rosterIds.has(String(m.user.id)))
      .filter((m) => role === 'all' || m.role === role)
      .filter((m) => {
        const hay = `${m.user.firstName || ''} ${m.user.lastName || ''} ${m.user.email || ''}`.toLowerCase();
        return words.every((w) => hay.includes(w));
      })
      .sort((a, b) => nameOfMember(a).localeCompare(nameOfMember(b)));
  }, [membersQ.data, rosterIds, q, role]);
  const shownPage = clampPage(page, candidates.length, PAGE);
  const rows = pageOf(candidates, shownPage, PAGE);
  const byId = useMemo(() => new Map((membersQ.data?.members || []).map((m) => [String(m.user.id), m])), [membersQ.data]);
  const nameOf = (id) => (byId.get(String(id)) ? nameOfMember(byId.get(String(id))) : 'Someone');
  const tickedIds = [...ticked];
  const crewName = crew ? coordinators.find((c) => c.id === crew)?.name || null : null;

  const previewQ = useQuery({
    queryKey: ['admin', 'crew-bulk-preview', campaignId, baseId, 'join', check?.n ?? 0],
    queryFn: ({ signal }) =>
      // intent 'join': someone put on the campaign since the list loaded reads already-on-campaign and stays
      // out of the totals, as the add leaves them be.
      api(`/admin/campaigns/${campaignId}/crew/coordinator-bulk/preview`, {
        method: 'POST',
        body: { userIds: check.ids, coordinatorId: check.crew || null, intent: 'join' },
        signal,
      }),
    enabled: !!check,
    retry: false,
    gcTime: 0,
  });
  const preview = previewQ.data;
  const doors = preview?.totals?.doors || 0;
  const affectedQ = useAffectedTeams(campaignId, preview ? bulkAffectedIds(preview, new Set(coordinators.map((c) => c.id))) : [], doors > 0);

  // POST …/assignments, 25 a request. Who the preview left alone — on the campaign by now, deleted,
  // switched off, no longer a member — is never sent: one of them would make the route refuse the whole
  // request. 'error' means not added; 'unfinished' means added, earlier doors not finished (Finish it).
  const write = (fetchSignal) => async (people) => {
    const chunk = people.map((p) => String(p.userId));
    const res = await api(`/admin/campaigns/${campaignId}/assignments`, {
      method: 'POST',
      body: { userIds: chunk, coordinatorId: check?.crew || null },
      signal: fetchSignal,
    });
    setAnswers((a) => [...a, res]);
    const skip = new Map((res?.crew?.skipped || []).map((s) => [String(s.userId), s]));
    return chunk.map((id) => {
      const s = skip.get(id);
      if (s?.reason === 'already-on-campaign') return { id, outcome: 'skipped', reason: 'already on this campaign' };
      if (s?.reason === 'error') return { id, outcome: 'failed', reason: 'they weren’t added — try again' };
      return { id, outcome: 'done' };
    });
  };
  const opts = (exec) => ({ write: write(exec.fetchSignal), classify: joinClassify, size: 25, concurrency: 1, signal: exec.signal, onProgress: exec.onProgress });
  const add = () => {
    setStopping(false);
    runner.run(check.ids, (exec) => runPreviewed(preview, check.ids, opts(exec)));
  };
  // Retry failed and Continue check those people again first: someone switched off or deleted since
  // the last check is then left out instead of failing their whole request again.
  const again = (ids) => {
    setStopping(false);
    runner.run(ids, (exec) =>
      previewThenRun(ids, {
        preview: (userIds) =>
          api(`/admin/campaigns/${campaignId}/crew/coordinator-bulk/preview`, {
            method: 'POST',
            body: { userIds, coordinatorId: check?.crew || null, intent: 'join' },
            signal: exec.fetchSignal,
          }),
        ...opts(exec),
      })
    );
  };

  const started = !!check || runner.running || !!runner.summary;

  if (runner.running || runner.summary) {
    // Who was added, left alone or failed is the run's own summary (a Retry replaces a failure); what
    // their earlier doors did comes from the answers.
    const s = fromOrgSummary(answers);
    const lines = runner.summary
      ? fromOrgLines({ ...s, added: runner.summary.done.length, already: 0, failed: 0 }, check?.crew ? crewName : null)
      : [];
    return {
      started,
      closable: !runner.running,
      title: 'Add people from your organization',
      body: runner.running ? (
        <RunProgress
          progress={runner.progress}
          verb="Adding"
          stopping={stopping}
          onStop={() => {
            setStopping(true);
            runner.stop();
          }}
        />
      ) : (
        <RunSummary
          summary={runner.summary}
          nameOf={nameOf}
          doneLine={() => lines.join(' ')}
          onRetry={() => again(runner.summary.failed.map((f) => f.id))}
          onContinue={() => again(runner.summary.notStarted)}
        />
      ),
      footer: runner.running ? null : (
        <Button size="sm" onClick={onClose}>
          Done
        </Button>
      ),
    };
  }

  if (check) {
    const returning = (preview?.people || []).filter((p) => !joinClassify(p) && (p.doors || 0) > 0).length;
    const skipped = (preview?.people || []).filter((p) => joinClassify(p));
    const joining = check.ids.length - skipped.length;
    const reports = doors > 0 ? teamLabelsLine(affectedQ) : null;
    return {
      started,
      title: `Add ${check.ids.length.toLocaleString()} ${check.ids.length === 1 ? 'person' : 'people'} to ${campaignName}?`,
      body: previewQ.isLoading ? (
        <Line>Checking what their earlier doors here will do…</Line>
      ) : previewQ.isError ? (
        <Line tone="danger">Couldn’t check them: {previewQ.error.message}</Line>
      ) : (
        <div className="space-y-2 rounded-md border border-brand-600 bg-brand-tint px-4 py-3 text-sm">
          <p className="text-fg">
            Crew: <strong>{check.crew ? crewName : 'No crew'}</strong>.
          </p>
          {doors > 0 ? (
            <p className="text-fg">
              {returning.toLocaleString()} of them worked here before: their <strong>{doors.toLocaleString()}</strong> earlier{' '}
              {doors === 1 ? 'door' : 'doors'} will count for {check.crew ? teamName(crewName) : 'No team'}.
            </p>
          ) : (
            <p className="text-fg">None of them has earlier doors here.</p>
          )}
          {reports && <p className="text-xs text-fg">{reports}</p>}
          {skipped.length > 0 && (
            <p className="text-xs text-fg-muted">
              {skipped.length.toLocaleString()} won’t be added:{' '}
              {skipped
                .slice(0, 5)
                .map((p) => `${p.name || nameOf(p.userId)} (${joinClassify(p).skip})`)
                .join(', ')}
              {skipped.length > 5 ? ` and ${(skipped.length - 5).toLocaleString()} more` : ''}.
            </p>
          )}
        </div>
      ),
      footer: (
        <>
          <Button variant="secondary" size="sm" onClick={() => setCheck(null)}>
            Back
          </Button>
          <Button size="sm" disabled={!preview || previewQ.isFetching || joining < 1} onClick={add}>
            Add {joining.toLocaleString()} {joining === 1 ? 'person' : 'people'}
          </Button>
        </>
      ),
    };
  }

  const toggle = (id) => setTicked((t) => toggleId(t, id));
  const allShown = rows.length > 0 && rows.every((m) => ticked.has(String(m.user.id)));
  return {
    started,
    title: 'Add people to this campaign',
    body: (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-[200px] flex-1">
            <Input
              type="search"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
              placeholder="Search your organization…"
              aria-label="Search your organization"
            />
          </div>
          <Select
            value={role}
            onChange={(e) => {
              setRole(e.target.value);
              setPage(1);
            }}
            aria-label="Role"
          >
            <option value="all">Everyone</option>
            <option value="canvasser">Canvassers</option>
            <option value="lead">Team leads</option>
            <option value="admin">Admins</option>
          </Select>
        </div>
        {membersQ.isLoading ? (
          <Line>Loading…</Line>
        ) : !candidates.length ? (
          <div className="rounded border border-dashed border-border bg-sunken px-4 py-6 text-center text-sm text-fg-muted">
            {q.trim() || role !== 'all' ? 'No matches.' : 'Everyone active in your organization is already on this campaign.'}
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3 text-xs text-fg-muted">
              <span>
                {ticked.size.toLocaleString()} ticked · {candidates.length.toLocaleString()} not on this campaign
              </span>
              {ticked.size < Math.min(SELECT_MAX, candidates.length) && (
                <button
                  type="button"
                  className="font-medium text-brand-accent hover:underline"
                  onClick={() => setTicked(new Set(candidates.slice(0, SELECT_MAX).map((m) => String(m.user.id))))}
                >
                  Select all {candidates.length.toLocaleString()} that match{candidates.length > SELECT_MAX ? ` (up to ${SELECT_MAX})` : ''}
                </button>
              )}
              {ticked.size > 0 && (
                <button type="button" className="hover:underline" onClick={() => setTicked(new Set())}>
                  Clear
                </button>
              )}
            </div>
            <ul className="divide-y divide-border overflow-hidden rounded-md border border-border">
              <li className="flex items-center gap-3 bg-sunken px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-fg-muted">
                <input
                  type="checkbox"
                  checked={allShown}
                  aria-label="Tick everyone on this page"
                  onChange={() =>
                    setTicked((t) => {
                      const next = new Set(t);
                      for (const m of rows) {
                        const id = String(m.user.id);
                        if (allShown) next.delete(id);
                        else if (next.size < SELECT_MAX) next.add(id);
                      }
                      return next;
                    })
                  }
                  className="h-4 w-4 rounded border-border-strong text-brand-accent"
                />
                <span>Member</span>
              </li>
              {rows.map((m) => {
                const id = String(m.user.id);
                return (
                  <li key={id}>
                    <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-sunken">
                      <input type="checkbox" checked={ticked.has(id)} onChange={() => toggle(id)} className="h-4 w-4 rounded border-border-strong text-brand-accent" />
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-fg">
                          {nameOfMember(m)}
                          {m.role !== 'canvasser' && (
                            <span className="ml-2 rounded bg-sunken px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-fg-muted">
                              {m.role === 'lead' ? 'lead' : 'admin'}
                            </span>
                          )}
                        </span>
                        <span className="block truncate text-xs text-fg-muted">{m.user.email}</span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
            {candidates.length > PAGE && (
              <Pager skip={(shownPage - 1) * PAGE} limit={PAGE} total={candidates.length} onChange={(skip) => setPage(Math.floor(skip / PAGE) + 1)} />
            )}
          </>
        )}
        {ticked.size > 0 && (
          <div>
            <label htmlFor={`${baseId}-crew`} className="mb-1 block text-xs font-medium text-fg-muted">
              Crew for all of them
            </label>
            <CrewSelect id={`${baseId}-crew`} coordinators={coordinators} value={crew} onChange={setCrew} exclude={tickedIds} />
          </div>
        )}
      </div>
    ),
    footer: (
      <>
        <Button variant="secondary" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button
          size="sm"
          disabled={!ticked.size}
          onClick={() => setCheck((c) => ({ n: (c?.n || 0) + 1, ids: tickedIds, crew: crew && !ticked.has(crew) ? crew : '' }))}
        >
          Continue with {ticked.size.toLocaleString()}
        </Button>
      </>
    ),
  };
};

const AddPeopleDialog = ({ campaign, isOrgAdmin, rosterIds, startTab = 'email', onOpenPerson, onAdded, onClose }) => {
  const campaignId = String(campaign._id);
  const campaignName = campaign.name || 'this campaign';
  const crewQ = useQuery({
    queryKey: ['admin', 'campaign-crew', campaignId],
    queryFn: ({ signal }) => api(`/admin/campaigns/${campaignId}/crew`, { signal }),
  });
  const coordinators = useMemo(() => coordinatorChoices(crewQ.data), [crewQ.data]);
  const roster = rosterIds || new Set();
  const [tab, setTab] = useState(isOrgAdmin && startTab === 'org' ? 'org' : 'email');
  const shared = { campaignId, campaignName, isOrgAdmin, coordinators, onAdded, onClose };
  const email = useByEmail({ ...shared, onOpenPerson });
  const org = useFromOrg({ ...shared, rosterIds: roster });
  const active = tab === 'org' ? org : email;
  // Hidden once the steps start, and for a team lead (who adds by email only).
  const showTabs = isOrgAdmin && !email.started && !org.started;
  return (
    <Modal size={tab === 'org' ? '2xl' : 'md'} title={active.title} onClose={onClose} closable={active.closable !== false} footer={active.footer}>
      {showTabs && (
        <Segmented
          className="mb-4"
          size="sm"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'email', label: 'By email' },
            { value: 'org', label: 'From your organization' },
          ]}
        />
      )}
      {active.body}
    </Modal>
  );
};

export default AddPeopleDialog;
