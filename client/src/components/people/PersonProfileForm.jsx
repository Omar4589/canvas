import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { Button, Input, PhoneInput } from '../ui/index.js';
import { firstNameOf } from '../../lib/personAccess.js';

// Profile in the person panel: name, email and phone (PATCH /admin/memberships/:id/user, for an org
// admin or, for canvassers on their campaigns, a team lead).
//
// The login email is shared across every org the person belongs to, so for someone in more than one
// it can only be changed by them or Doorline: the field is locked where the page knows (the org list
// says isMultiOrg), and the server's MULTI_ORG_EMAIL_LOCKED is explained where it doesn't (a lead's
// Team page). Typing here is an unsaved edit until Save — the flag clears at the submit itself, not
// when the refreshed list comes back.

const FIELDS = ['firstName', 'lastName', 'email', 'phone'];
const LOCKED_LINE =
  'They also work with another organization, so only they (or Doorline) can change their login email. Name and phone still save.';

const Field = ({ label, htmlFor, children, className = '' }) => (
  <div className={className}>
    <label htmlFor={htmlFor} className="block text-xs font-medium text-fg-muted">
      {label}
    </label>
    <div className="mt-1">{children}</div>
  </div>
);

const PersonProfileForm = ({ person, viewer, scope, report, markDirty }) => {
  const qc = useQueryClient();
  const { isSuperAdmin } = useAuth();
  const userId = person.userId;
  const first = firstNameOf(person);
  const isSelf = viewer.userId === userId;
  const emailLocked = !!person.isMultiOrg && !isSuperAdmin && !isSelf;
  const campaignId = scope.kind === 'campaign' ? String(scope.campaignId) : null;

  const stored = { firstName: person.firstName || '', lastName: person.lastName || '', email: person.email || '', phone: person.phone || '' };
  const [form, setForm] = useState(stored);
  // What the last Save sent, so the form reads clean from the moment it is submitted.
  const [sent, setSent] = useState(null);
  const [error, setError] = useState(null);
  // When the stored record changes (a save landed, as the server stored it; another admin's edit), every
  // field this form hasn't been edited in takes the new value, so a later save can't send a stale one
  // back; a field edited here keeps the edit.
  const [prev, setPrev] = useState(stored);
  if (FIELDS.some((k) => prev[k] !== stored[k])) {
    setPrev(stored);
    setForm((f) =>
      Object.fromEntries(FIELDS.map((k) => [k, f[k] === prev[k] || (sent && f[k] === sent[k]) ? stored[k] : f[k]]))
    );
    setSent(null);
  }
  const base = sent || stored;
  const dirty = FIELDS.some((k) => (k === 'email' && emailLocked ? false : form[k] !== base[k]));

  useEffect(() => {
    markDirty('profile', dirty);
    return () => markDirty('profile', false);
  }, [dirty, markDirty]);

  const save = useMutation({
    mutationKey: ['person', userId, 'profile'],
    mutationFn: (body) => api(`/admin/memberships/${userId}/user`, { method: 'PATCH', body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['memberships'] });
      if (campaignId) {
        qc.invalidateQueries({ queryKey: ['admin', 'campaign-assignments', campaignId] });
        qc.invalidateQueries({ queryKey: ['admin', 'campaign-crew', campaignId] });
      }
    },
  });

  const onSubmit = (e) => {
    e.preventDefault();
    if (!dirty || save.isPending) return;
    const body = {};
    if (form.firstName !== stored.firstName) body.firstName = form.firstName.trim();
    if (form.lastName !== stored.lastName) body.lastName = form.lastName.trim();
    if (!emailLocked && form.email !== stored.email) body.email = form.email.trim().toLowerCase();
    if (form.phone !== stored.phone) body.phone = form.phone.trim();
    setError(null);
    setSent(form);
    save.mutate(body, {
      onSuccess: () => report('success', `Profile saved for ${first}.`),
      onError: (err) => {
        setSent(null);
        setError(err.data?.code === 'MULTI_ORG_EMAIL_LOCKED' ? LOCKED_LINE : err.message);
      },
    });
  };
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const idFor = (k) => `person-${userId}-${k}`;

  return (
    <form onSubmit={onSubmit} className="border-b border-border px-6 py-5">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-fg-muted">Profile</h3>
      <div className="grid grid-cols-2 gap-3">
        <Field label="First name" htmlFor={idFor('first')}>
          <Input id={idFor('first')} value={form.firstName} onChange={set('firstName')} required />
        </Field>
        <Field label="Last name" htmlFor={idFor('last')}>
          <Input id={idFor('last')} value={form.lastName} onChange={set('lastName')} required />
        </Field>
      </div>
      <Field label="Email" htmlFor={idFor('email')} className="mt-3">
        <Input id={idFor('email')} type="email" value={form.email} onChange={set('email')} required disabled={emailLocked} />
        {emailLocked && (
          <p className="mt-1 text-xs italic text-fg-muted">
            This user belongs to multiple organizations; their login email can only be changed by the user or a
            super-admin.
          </p>
        )}
      </Field>
      <Field label="Phone" htmlFor={idFor('phone')} className="mt-3">
        <PhoneInput id={idFor('phone')} value={form.phone} onChange={set('phone')} />
      </Field>
      {error && <p className="mt-2 text-sm text-danger-fg">{error}</p>}
      <div className="mt-4 flex items-center justify-end gap-2">
        {dirty && (
          <Button
            variant="ghost"
            size="sm"
            disabled={save.isPending}
            onClick={() => {
              setForm(stored);
              setSent(null);
              setError(null);
            }}
          >
            Discard
          </Button>
        )}
        <Button type="submit" disabled={!dirty} loading={save.isPending}>
          {save.isPending ? 'Saving…' : 'Save profile'}
        </Button>
      </div>
    </form>
  );
};

export default PersonProfileForm;
