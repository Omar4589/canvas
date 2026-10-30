import { useId, useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from '../../api/client.js';
import { Button, Input, Modal, PhoneInput, Segmented } from '../ui/index.js';
import PasswordInput from '../PasswordInput.jsx';
import CampaignPicks from './CampaignPicks.jsx';
import { tempPasswordProblem } from '../../lib/validators.js';
import { coordinatorChoices } from '../../lib/crewChange.js';
import { waitLine } from '../../lib/addPeople.js';
import {
  orgConfirmKind,
  onCampaignIds,
  historyByCampaign,
  pickCount,
  picksBody,
  submitLabel,
  coordinatorNames,
  orgDoneView,
} from '../../lib/addToCampaigns.js';

// The Users page's Add member (docs/PROPOSAL_ADD_TO_CAMPAIGNS.md §E.2), the phone's AddPersonSheet in the
// web's grammar and the Team page's add-by-email steps at the organization's level:
//   1. the email, looked up first (POST /admin/memberships/resolve) — counted toward the same two hourly
//      limits as a campaign's lookup;
//   2. what it turned out to be: a new person (name, phone, password, a role, and for a canvasser the
//      campaigns to put them on, each with its own crew; for a team lead the campaigns they run), a colleague
//      (campaigns; the ones they're on show checked), or a switched-off account (Switch on, with or without
//      campaigns). Campaigns are optional, and nothing is checked to start (owner rulings 2026-10-30);
//   3. what happened (POST /admin/memberships/by-email), campaign by campaign.
// It replaced an inline form with an "Existing user" checkbox that added the person to the organization
// and, for a canvasser, at most one campaign. An address with an account at another customer looks exactly
// like an unused one (the privacy design); the result says who actually landed.

const EMPTY = { firstName: '', lastName: '', phone: '', password: '' };
const ROLE_OPTIONS = [
  { value: 'canvasser', label: 'Canvasser' },
  { value: 'lead', label: 'Team lead' },
  { value: 'admin', label: 'Admin' },
];

const Line = ({ tone = 'muted', children }) => (
  <p className={`text-sm ${tone === 'muted' ? 'text-fg-muted' : tone === 'warn' ? 'text-warning-fg' : tone === 'danger' ? 'text-danger-fg' : 'text-fg'}`}>{children}</p>
);
const FieldLabel = ({ htmlFor, children }) => (
  <label htmlFor={htmlFor} className="mb-1 block text-xs font-medium text-fg-muted">
    {children}
  </label>
);

const AddPersonDialog = ({
  campaigns = [], // the organization's ACTIVE campaigns
  onClose,
  onAdded, // (result) => void — refresh the page's lists
  onOpenPerson, // (userId) => void — their person panel
}) => {
  const baseId = useId();
  const [email, setEmail] = useState('');
  const [form, setForm] = useState(EMPTY);
  const [role, setRole] = useState('canvasser');
  const [picks, setPicks] = useState({});
  const [managedIds, setManagedIds] = useState([]);
  const [localError, setLocalError] = useState('');
  const cleanEmail = email.trim().toLowerCase();

  const resolveMut = useMutation({
    mutationFn: (address) => api('/admin/memberships/resolve', { method: 'POST', body: { email: address } }),
  });
  const addMut = useMutation({
    mutationFn: (body) => api('/admin/memberships/by-email', { method: 'POST', body }),
    onSuccess: (result) => onAdded?.(result),
  });

  const found = resolveMut.data;
  const done = addMut.data;
  // The address the step describes, and the add sends: the one looked up, never what the box says now.
  const address = found ? resolveMut.variables || cleanEmail : cleanEmail;
  const person = found?.person || null;
  const name = person ? `${person.firstName || ''} ${person.lastName || ''}`.trim() : '';
  const first = person?.firstName || name;
  const kind = orgConfirmKind(found);
  const campaignIds = campaigns.map((c) => String(c._id));
  const locked = useMemo(() => onCampaignIds(found?.campaigns), [found]);
  const histories = useMemo(() => historyByCampaign(found?.campaigns), [found]);
  const coordinators = useMemo(() => coordinatorChoices(found), [found]);
  const exclude = person ? [String(person.userId)] : [];
  // Picks only count for a role that has a campaign list: a canvasser, or anyone already here.
  const sendsPicks = kind !== 'new' || role === 'canvasser';
  const n = sendsPicks ? pickCount(picks) : 0;
  const offeredCount = campaigns.filter((c) => !locked.has(String(c._id))).length;
  const label = submitLabel(kind, { n, role });
  const adding = addMut.isPending;

  const back = () => {
    resolveMut.reset();
    addMut.reset();
    setLocalError('');
    setPicks({});
    setManagedIds([]);
  };
  const lookUp = (e) => {
    e?.preventDefault();
    if (!cleanEmail || resolveMut.isPending) return;
    setLocalError('');
    setPicks({});
    setManagedIds([]);
    addMut.reset();
    resolveMut.mutate(cleanEmail);
  };
  const submit = (e) => {
    e?.preventDefault();
    if (adding) return;
    if (kind === 'new') {
      // The temp password is OPTIONAL. Blank → the server generates a throwaway nobody sees and the new
      // member sets their own via the emailed link. Only a typed one is checked.
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
        role,
        campaigns: role === 'canvasser' ? picksBody(picks, campaignIds) : [],
        ...(role === 'lead' ? { managedCampaignIds: campaignIds.filter((id) => managedIds.includes(id)) } : {}),
      });
      return;
    }
    addMut.mutate({ email: address, campaigns: picksBody(picks, campaignIds) });
  };
  const addAnother = () => {
    back();
    setEmail('');
    setForm(EMPTY);
    setRole('canvasser');
  };

  const backButton = (
    <Button variant="secondary" size="sm" onClick={back} disabled={adding}>
      Back
    </Button>
  );
  const openButton = person?.userId ? (
    <Button variant="secondary" size="sm" onClick={() => onOpenPerson?.(String(person.userId))} disabled={adding}>
      Open {first}
    </Button>
  ) : null;
  const addError = addMut.error && <Line tone="danger">{addMut.error.message}</Line>;
  const picker = (
    <CampaignPicks
      idBase={baseId}
      campaigns={campaigns}
      lockedIds={locked}
      histories={histories}
      coordinators={coordinators}
      exclude={exclude}
      firstName={person?.firstName || form.firstName.trim()}
      picks={picks}
      onChange={setPicks}
      disabled={adding}
    />
  );

  let title;
  let body;
  let footer;
  if (done) {
    const view = orgDoneView(done, { crewNameById: coordinatorNames(found?.coordinators) });
    const landedId = done.user?.id || done.user?._id;
    title = view.title;
    body = (
      <div className="space-y-2">
        {view.lines.map((line, i) => (
          <Line key={i} tone={i === 0 ? 'fg' : 'muted'}>
            {line}
          </Line>
        ))}
      </div>
    );
    footer = (
      <>
        <Button variant="secondary" size="sm" onClick={addAnother}>
          Add another
        </Button>
        {landedId && (
          <Button variant="secondary" size="sm" onClick={() => onOpenPerson?.(String(landedId))}>
            Open {view.first}
          </Button>
        )}
        <Button size="sm" onClick={onClose}>
          Done
        </Button>
      </>
    );
  } else if (!found) {
    const limited = resolveMut.error?.status === 429;
    title = 'Add member';
    body = (
      <form id={`${baseId}-lookup`} onSubmit={lookUp} className="space-y-3">
        <Line>Start with their email address. If they already work with you, we’ll show you who it is.</Line>
        <div>
          <FieldLabel htmlFor={`${baseId}-email`}>Email</FieldLabel>
          {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
          <Input id={`${baseId}-email`} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus disabled={resolveMut.isPending} />
        </div>
        {limited ? (
          <div role="alert" className="rounded-md border border-warning/30 bg-warning-tint px-3 py-2 text-sm text-warning-fg">
            {waitLine(resolveMut.error.data?.retryAfterSeconds)}
          </div>
        ) : (
          resolveMut.error && <Line tone="danger">{resolveMut.error.message}</Line>
        )}
      </form>
    );
    footer = (
      <>
        <Button variant="secondary" size="sm" onClick={onClose}>
          Cancel
        </Button>
        {/* A submit for the form above, so the browser checks the address before any lookup. */}
        <Button type="submit" form={`${baseId}-lookup`} size="sm" loading={resolveMut.isPending} disabled={!cleanEmail}>
          Continue
        </Button>
      </>
    );
  } else if (kind === 'new') {
    // 'outside' — nobody in this organization uses that address. Deliberately the same step whether the
    // address is unused or belongs to another customer's account.
    const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
    title = 'New person';
    body = (
      <form id={`${baseId}-new`} onSubmit={submit} className="space-y-3">
        <Line>
          No one in your organization uses <span className="font-medium text-fg">{address}</span>.
        </Line>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <FieldLabel htmlFor={`${baseId}-first`}>First name</FieldLabel>
            <Input id={`${baseId}-first`} value={form.firstName} onChange={set('firstName')} required />
          </div>
          <div>
            <FieldLabel htmlFor={`${baseId}-last`}>Last name</FieldLabel>
            <Input id={`${baseId}-last`} value={form.lastName} onChange={set('lastName')} required />
          </div>
        </div>
        <div>
          <FieldLabel htmlFor={`${baseId}-phone`}>
            Phone <span className="text-fg-subtle">(optional)</span>
          </FieldLabel>
          <PhoneInput id={`${baseId}-phone`} value={form.phone} onChange={set('phone')} />
        </div>
        <div>
          <FieldLabel>
            Temporary password <span className="text-fg-subtle">(optional)</span>
          </FieldLabel>
          <PasswordInput value={form.password} onChange={set('password')} autoComplete="new-password" placeholder="Leave blank to email an invite" />
          <p className="mt-1 text-xs text-fg-subtle">
            Leave blank to let them set their own password via the emailed invite (recommended). Type one only if they can’t receive email.
          </p>
        </div>
        <div>
          <FieldLabel>Role</FieldLabel>
          <Segmented options={ROLE_OPTIONS} value={role} onChange={setRole} size="sm" />
        </div>
        {role === 'canvasser' ? (
          <div className="space-y-2">
            <FieldLabel>
              Campaigns <span className="text-fg-subtle">(optional)</span>
            </FieldLabel>
            {picker}
            {campaigns.length > 0 && <p className="text-xs text-fg-subtle">Leave them all unchecked to add {form.firstName.trim() || 'them'} to your organization only.</p>}
          </div>
        ) : role === 'lead' ? (
          <div className="rounded-md border border-border bg-sunken p-3">
            <FieldLabel>Campaigns they run</FieldLabel>
            <p className="text-xs text-fg-muted">A team lead can run only the campaigns checked.</p>
            <div className="mt-2 max-h-44 space-y-1 overflow-auto rounded border border-border-strong bg-card p-2">
              {campaigns.length === 0 && <p className="px-1 py-2 text-xs text-fg-muted">No active campaigns yet.</p>}
              {campaigns.map((c) => {
                const id = String(c._id);
                return (
                  <label key={id} className="flex cursor-pointer items-center gap-2 px-1 py-0.5 text-sm text-fg">
                    <input
                      type="checkbox"
                      checked={managedIds.includes(id)}
                      onChange={(e) => setManagedIds((ids) => (e.target.checked ? [...new Set([...ids, id])] : ids.filter((x) => x !== id)))}
                    />
                    <span className="truncate">{c.name}</span>
                  </label>
                );
              })}
            </div>
            {managedIds.length === 0 && <p className="mt-2 text-xs text-warning-fg">No campaigns checked — this lead won’t be able to manage anything yet.</p>}
          </div>
        ) : (
          <Line>Admins see and run every campaign.</Line>
        )}
        {localError && <Line tone="danger">{localError}</Line>}
        {addError}
      </form>
    );
    footer = (
      <>
        {backButton}
        <Button type="submit" form={`${baseId}-new`} size="sm" loading={adding}>
          {label}
        </Button>
      </>
    );
  } else if (kind === 'colleague') {
    title = `Add ${name || 'them'} to campaigns?`;
    body = (
      <div className="space-y-3">
        <Line tone="fg">
          <span className="font-medium">{name}</span> is already in your organization
          {person.role !== 'canvasser' ? ` (${person.role === 'lead' ? 'a team lead' : 'an admin'})` : ''}.
        </Line>
        {picker}
        {campaigns.length > 0 && offeredCount === 0 && <Line>{first} is already on every active campaign.</Line>}
        <Line>Adding them doesn’t change their role.</Line>
        {addError}
      </div>
    );
    footer = (
      <>
        {backButton}
        {openButton}
        <Button size="sm" loading={adding} disabled={n === 0} onClick={submit}>
          {label}
        </Button>
      </>
    );
  } else if (kind === 'switched-off') {
    title = 'Account switched off';
    body = (
      <div className="space-y-3">
        <Line tone="fg">
          <span className="font-medium">{name}</span> is in your organization, but their account is switched off.
        </Line>
        <Line>Switching it back on restores their access to every campaign they were on.</Line>
        {picker}
        {addError}
      </div>
    );
    footer = (
      <>
        {backButton}
        {openButton}
        <Button size="sm" loading={adding} onClick={submit}>
          {label}
        </Button>
      </>
    );
  } else {
    // An answer this build doesn't know.
    title = 'Something went wrong';
    body = <Line>Go back and try that email again.</Line>;
    footer = backButton;
  }

  return (
    <Modal size="lg" title={title} onClose={onClose} closable={!adding} footer={footer}>
      {body}
    </Modal>
  );
};

export default AddPersonDialog;
