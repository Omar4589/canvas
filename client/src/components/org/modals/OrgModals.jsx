import { useState } from 'react';
import { Button, Input, Modal } from '../../ui/index.js';
import { fmtUsd } from '../../../lib/billingStatus.jsx';

// Rename, deactivate and delete — shared by the desk and the org page so the same destructive act
// never gets two different warnings depending on where it was clicked.

const errText = (err) => err?.message || 'Something went wrong.';

export function RenameOrgModal({ org, onClose, onSave, pending, error }) {
  const [name, setName] = useState(org?.name || '');
  const [slug, setSlug] = useState(org?.slug || '');
  const slugChanged = slug.trim().toLowerCase() !== (org?.slug || '');

  return (
    <Modal
      size="lg"
      onClose={onClose}
      title="Rename organization"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={pending}
            disabled={!name.trim() || !slug.trim()}
            onClick={() => onSave({ name: name.trim(), slug: slug.trim().toLowerCase() })}
          >
            Save name & slug
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="block text-xs font-semibold text-fg-muted" htmlFor="org-name">Name</label>
            <Input id="org-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div>
            <label className="block text-xs font-semibold text-fg-muted" htmlFor="org-slug">Slug</label>
            <Input id="org-slug" className="font-mono" value={slug} onChange={(e) => setSlug(e.target.value)} />
          </div>
        </div>
        {slugChanged && (
          <div className="rounded-md border border-warning/30 bg-warning-tint px-3 py-2 text-sm text-warning-fg">
            The slug is the org&apos;s identity across the platform — the org switcher, provisioning and the demo seed
            lock all reference it. Change it only if you mean to; anything pointing at the old slug stops matching.
          </div>
        )}
        {error && <div className="rounded-md border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger-fg">{errText(error)}</div>}
      </div>
    </Modal>
  );
}

export function DeactivateOrgModal({ org, onClose, onConfirm, pending, error }) {
  return (
    <Modal
      size="md"
      onClose={onClose}
      title={`Deactivate ${org?.name}?`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="danger" loading={pending} onClick={onConfirm}>Deactivate</Button>
        </>
      }
    >
      <p className="text-sm text-fg-muted">
        Its members can no longer sign in to this organization. Billing state, statements and invoices are untouched —
        an unpaid balance stays owed and stays visible on the desk. You can reactivate at any time.
      </p>
      {error && <div className="mt-3 rounded-md border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger-fg">{errText(error)}</div>}
    </Modal>
  );
}

// The typed-slug confirmation. Also warns when the org owes money, because deleting it destroys
// the statements that prove what is owed (services/platform/deleteOrganization.js sweeps Statement
// with everything else).
export function DeleteOrgModal({ org, retry = false, outstanding, onClose, onConfirm, pending, error }) {
  const [typed, setTyped] = useState('');
  const matches = typed.trim().toLowerCase() === (org?.slug || '');

  return (
    <Modal
      size="lg"
      onClose={onClose}
      title={retry ? `Retry deleting ${org?.name}?` : `Permanently delete ${org?.name}?`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="danger"
            loading={pending}
            disabled={!matches}
            onClick={() => onConfirm({ confirmSlug: typed.trim().toLowerCase() })}
          >
            {retry ? 'Retry delete' : 'Delete forever'}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        {retry ? (
          <p className="text-danger-fg">
            A previous attempt stopped partway, so this organization is <strong>already partly destroyed</strong> and
            stays locked to everyone until a retry finishes it. Retrying resumes the same removal.
          </p>
        ) : (
          <p className="text-danger-fg">
            This hard-deletes the org and <strong>everything in it</strong> — campaigns, doors, voters, canvass history,
            surveys, books, imports, reports and share links. It cannot be undone. User accounts survive (people in
            other orgs keep that access; this org&apos;s memberships are removed).
          </p>
        )}

        {outstanding?.count > 0 && (
          <div className="rounded-md border border-warning/30 bg-warning-tint px-3 py-2 text-warning-fg">
            <span className="font-semibold">
              {outstanding.count} unpaid invoice{outstanding.count === 1 ? '' : 's'} totalling {fmtUsd(outstanding.totalCents)}.
            </span>{' '}
            Statements are deleted with the organization, so the record of what is owed goes with it. Settle or record
            the balance outside the app first.
          </div>
        )}

        <p className="text-fg-muted">
          Removal runs in the background and can take several minutes for a large organization; the org is locked to
          everyone the moment you confirm.
        </p>

        <div>
          <label className="block text-xs font-semibold text-fg-muted" htmlFor="confirm-slug">
            Type <span className="font-mono font-semibold text-fg">{org?.slug}</span> to confirm
          </label>
          <Input
            id="confirm-slug"
            className="font-mono"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={org?.slug}
            autoFocus
          />
        </div>
        {error && <div className="rounded-md border border-danger/30 bg-danger-tint px-3 py-2 text-danger-fg">{errText(error)}</div>}
      </div>
    </Modal>
  );
}

// Suspending or cancelling is a decision with a consequence the customer feels immediately; it
// gets a dialog that names the consequence rather than a dropdown and a Save button.
export function StatusChangeModal({ org, to, reason, onReason, onClose, onConfirm, pending, error, windDownDays = 60 }) {
  const copy = {
    suspended: {
      title: `Suspend ${org?.name}?`,
      body: 'The account becomes READ-ONLY: admins can see everything they built, but recording, imports and cuts stop, and public share links stop resolving. Nothing is deleted.',
    },
    canceled: {
      title: `Cancel ${org?.name}?`,
      body: `The account becomes read-only and the wind-down starts: exports keep working, and the data is deleted ${windDownDays} days from now. The banner shows the customer that date.`,
    },
  }[to] || { title: `Change ${org?.name} to ${to}?`, body: '' };

  return (
    <Modal
      size="md"
      onClose={onClose}
      title={copy.title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="danger" loading={pending} disabled={!reason.trim()} onClick={onConfirm}>
            {to === 'canceled' ? 'Cancel account' : 'Suspend'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-fg-muted">{copy.body}</p>
        <div>
          <label className="block text-xs font-semibold text-fg-muted" htmlFor="status-reason">Reason (required)</label>
          <Input
            id="status-reason"
            value={reason}
            onChange={(e) => onReason(e.target.value)}
            placeholder="Kept in the billing history"
            autoFocus
          />
        </div>
        {error && <div className="rounded-md border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger-fg">{errText(error)}</div>}
      </div>
    </Modal>
  );
}
