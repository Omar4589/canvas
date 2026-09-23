import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Card, DataTable, EmptyState, Segmented } from '../ui/index.js';
import { formatDate } from '../../lib/dates.js';

// The roster, as account METADATA — the same tier as the All Users list, readable without a
// support grant and without writing an AccessLog row. Switching INTO the org stays the
// (correctly grant-gated) path to voter content.
//
// Read-only on purpose: membership is managed on the org's own Users page, by its own admins.
export default function MembersTab({ members = [] }) {
  const [filter, setFilter] = useState('active');
  const shown = members.filter((m) => (filter === 'all' ? true : filter === 'active' ? m.isActive : !m.isActive));

  if (!members.length) {
    return (
      <Card>
        <EmptyState title="No members" hint="Nobody has been seated in this organization yet." />
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <Segmented
        size="sm"
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'active', label: `Active (${members.filter((m) => m.isActive).length})` },
          { value: 'deactivated', label: `Deactivated (${members.filter((m) => !m.isActive).length})` },
          { value: 'all', label: `All (${members.length})` },
        ]}
      />

      <DataTable
        head={
          <>
            <th className="px-3 py-2.5">Name</th>
            <th className="px-3 py-2.5">Email</th>
            <th className="px-3 py-2.5">Role</th>
            <th className="px-3 py-2.5">Membership</th>
            <th className="px-3 py-2.5">Joined</th>
          </>
        }
      >
        {shown.map((m) => (
          <tr key={m.userId} className={m.isActive ? '' : 'opacity-60'}>
            <td className="px-3 py-2.5">
              <Link
                to={`/super-admin/users/${m.userId}`}
                className="font-medium text-fg underline decoration-dotted underline-offset-2 hover:text-brand-accent"
              >
                {m.name || '—'}
              </Link>
              <span className="ml-1.5 inline-flex gap-1">
                {m.accountDeleted && <Badge variant="neutral">deleted</Badge>}
                {!m.accountActive && !m.accountDeleted && <span className="text-xs text-fg-subtle">(account inactive)</span>}
                {m.billingAccess && <Badge variant="info">billing</Badge>}
              </span>
            </td>
            <td className="px-3 py-2.5 text-fg-muted">{m.email}</td>
            <td className="px-3 py-2.5 text-fg-muted">
              {m.role}
              {m.coordinator && <span className="text-fg-subtle"> · coord: {m.coordinator}</span>}
            </td>
            <td className="px-3 py-2.5">
              {/* success-fg, not success: the tint background needs the DEEP foreground token for
                  small text to clear WCAG contrast. */}
              {m.isActive ? <Badge variant="success" dot>active</Badge> : <Badge variant="neutral">deactivated</Badge>}
            </td>
            <td className="whitespace-nowrap px-3 py-2.5 text-fg-muted">{formatDate(m.joinedAt)}</td>
          </tr>
        ))}
        {shown.length === 0 && (
          <tr>
            <td colSpan={5} className="px-3 py-8 text-center text-sm text-fg-muted">No members match that filter.</td>
          </tr>
        )}
      </DataTable>

      <p className="text-xs text-fg-subtle">
        Membership is managed on the organization&apos;s own Users page. Reading this roster writes no audit row.
      </p>
    </div>
  );
}
