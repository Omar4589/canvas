import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client.js';
import { Button } from '../ui/index.js';
import { ROLE_LABEL, firstNameOf } from '../../lib/personAccess.js';

// Role in this org, in the person panel (org admins only): the role and, for a team lead, the
// campaigns they manage (their CampaignManager grants), saved together through PATCH
// /admin/memberships/:id. Nobody changes their own role.

const ROLES = ['canvasser', 'lead', 'admin'];

const PersonRoleSection = ({ person, access, report, markDirty }) => {
  const qc = useQueryClient();
  const m = person.membership;
  const userId = person.userId;
  const first = firstNameOf(person);
  const [role, setRole] = useState(m.role || 'canvasser');
  const [managed, setManaged] = useState(m.managedCampaignIds || []);
  // What the last Save sent, so the section reads clean from the moment it is saved, not only once the
  // org list comes back; the stored values take over again when they change.
  const [sent, setSent] = useState(null);
  const storedKey = `${m.role || 'canvasser'}|${(m.managedCampaignIds || []).join(',')}`;
  const [seenKey, setSeenKey] = useState(storedKey);
  if (storedKey !== seenKey) {
    setSeenKey(storedKey);
    setSent(null);
  }
  const storedRole = sent ? sent.role : m.role || 'canvasser';
  const storedManaged = sent ? sent.managed : m.managedCampaignIds || [];

  // Campaigns to grant when the role is team lead (the same list the Users page reads).
  const campaignsQ = useQuery({
    queryKey: ['admin', 'campaigns'],
    queryFn: ({ signal }) => api('/admin/campaigns', { signal }),
    enabled: access.canEditRole,
  });
  const campaigns = campaignsQ.data?.campaigns || [];

  const managedDirty =
    role === 'lead' && (managed.length !== storedManaged.length || managed.some((id) => !storedManaged.includes(id)));
  const dirty = role !== storedRole || managedDirty;
  useEffect(() => {
    markDirty('role', dirty);
    return () => markDirty('role', false);
  }, [dirty, markDirty]);

  const save = useMutation({
    mutationKey: ['person', userId, 'role'],
    mutationFn: (body) => api(`/admin/memberships/${userId}`, { method: 'PATCH', body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['memberships'] });
      qc.invalidateQueries({ queryKey: ['admin', 'campaign-assignments'] });
      qc.invalidateQueries({ queryKey: ['admin', 'campaign-crew'] });
    },
  });
  const onSave = () => {
    if (!dirty) return;
    // managedCampaignIds only matters for a lead; the server clears grants for any other role.
    setSent({ role, managed: role === 'lead' ? managed : [] });
    save.mutate(role === 'lead' ? { role: 'lead', managedCampaignIds: managed } : { role }, {
      onSuccess: () => report('success', `Role updated for ${first}.`),
      onError: (err) => {
        setSent(null);
        report('danger', `Couldn’t change ${first}’s role: ${err.message}`);
      },
    });
  };
  const toggleCampaign = (id, checked) =>
    setManaged((ids) => (checked ? [...new Set([...ids, id])] : ids.filter((x) => x !== id)));

  return (
    <div className="border-b border-border px-6 py-5">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-fg-muted">Role in this org</h3>
      {access.isSelf ? (
        <div className="rounded-md border border-border bg-sunken px-3 py-2 text-sm italic text-fg-muted">
          You can&apos;t change your own role. Ask another admin.
        </div>
      ) : !access.canEditRole ? (
        <p className="text-sm text-fg">{ROLE_LABEL[storedRole] || 'Canvasser'}</p>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="flex flex-1 gap-2">
              {ROLES.map((r) => (
                <label
                  key={r}
                  className={`flex flex-1 cursor-pointer items-center justify-center rounded-md border px-3 py-2 text-sm ${
                    role === r ? 'border-brand-600 bg-brand-tint font-semibold text-brand-accent' : 'border-border-strong text-fg-muted hover:bg-sunken'
                  }`}
                >
                  <input type="radio" name={`role-${userId}`} value={r} checked={role === r} onChange={() => setRole(r)} className="sr-only" />
                  {ROLE_LABEL[r]}
                </label>
              ))}
            </div>
            <Button size="md" onClick={onSave} disabled={!dirty} loading={save.isPending}>
              {save.isPending ? 'Saving…' : 'Save role'}
            </Button>
          </div>

          {role === 'lead' && (
            <div className="rounded-md border border-border bg-sunken p-3">
              <div className="mb-1 text-xs font-medium text-fg">Campaigns this lead manages</div>
              <p className="mb-2 text-xs text-fg-muted">A team lead can fully run the campaigns you check here — and only those.</p>
              <div className="max-h-44 space-y-1 overflow-auto rounded border border-border-strong bg-card p-2">
                {campaigns.length === 0 && <p className="px-1 py-2 text-xs text-fg-muted">No campaigns yet.</p>}
                {campaigns.map((c) => {
                  const id = String(c._id);
                  return (
                    <label key={id} className="flex cursor-pointer items-center gap-2 px-1 py-0.5 text-sm text-fg">
                      <input type="checkbox" checked={managed.includes(id)} onChange={(e) => toggleCampaign(id, e.target.checked)} />
                      <span className="truncate">
                        {c.name}
                        {c.isActive === false ? ' · Archived' : ''}
                      </span>
                    </label>
                  );
                })}
              </div>
              <p className="mt-2 text-xs text-fg-muted">
                Click <strong>Save role</strong> to apply.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default PersonRoleSection;
