import { useState } from 'react';
import { Badge, Button, EmptyState, Modal, IconCheck, IconSwap } from '../ui/index.js';

/**
 * Review the email matches before they are written.
 *
 * The server has computed these since day one and the page threw them away, so
 * "Auto-match by email" wrote blind. Same matches, same endpoint — the difference
 * is that a human sees each pair first, which matters because a link is a
 * payroll-adjacent fact.
 */
export default function SuggestionsModal({ pairs, skippedConflicts, busy, progress, results, onApply, onClose }) {
  const [checked, setChecked] = useState(() => new Set(pairs.map((p) => p.key)));

  const toggle = (key) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const allOn = checked.size === pairs.length && pairs.length > 0;
  const selected = pairs.filter((p) => checked.has(p.key));
  const done = results && !busy;
  const failed = results?.failed || [];

  if (done && failed.length === 0) {
    return (
      <Modal size="lg" title="Suggested matches" onClose={onClose}>
        <EmptyState
          icon={<IconCheck size={22} />}
          title={`${results.ok.length} ${results.ok.length === 1 ? 'person' : 'people'} linked`}
          hint="Their hours will appear on reports at the next sync."
          action={<Button onClick={onClose}>Done</Button>}
        />
      </Modal>
    );
  }

  return (
    <Modal
      size="2xl"
      title="Review suggested matches"
      subtitle="Same email address in both systems. Untick anyone who looks wrong."
      onClose={busy ? undefined : onClose}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs text-fg-muted">
            {busy
              ? `Linking… ${progress?.done || 0} of ${progress?.total || selected.length}`
              : failed.length
                ? `${results.ok.length} linked · ${failed.length} failed`
                : skippedConflicts > 0
                  ? `${skippedConflicts} conflicting suggestion${skippedConflicts === 1 ? '' : 's'} skipped`
                  : ''}
          </span>
          <div className="flex gap-2">
            <Button variant="secondary" disabled={busy} onClick={onClose}>
              {done ? 'Done' : 'Cancel'}
            </Button>
            <Button
              disabled={busy || selected.length === 0}
              onClick={() => onApply(selected, { all: allOn })}
            >
              {failed.length ? `Retry ${selected.length}` : `Link ${selected.length} people`}
            </Button>
          </div>
        </div>
      }
    >
      <label className="mb-2 flex items-center gap-2 text-sm text-fg">
        <input
          type="checkbox"
          className="h-3.5 w-3.5 rounded border-border-strong text-brand-accent focus-visible:ring-ring"
          checked={allOn}
          disabled={busy}
          onChange={() => setChecked(allOn ? new Set() : new Set(pairs.map((p) => p.key)))}
        />
        Select all ({pairs.length})
      </label>

      <ul className="divide-y divide-border overflow-hidden rounded-md border border-border">
        {pairs.map((p) => {
          const fail = failed.find((f) => f.key === p.key);
          const ok = results?.ok?.includes(p.key);
          return (
            <li key={p.key} className="flex items-start gap-3 px-3 py-2.5">
              <input
                type="checkbox"
                aria-label={`Link ${p.userName} to ${p.fbtimeName || 'this FbTime person'}`}
                className="mt-1 h-3.5 w-3.5 shrink-0 rounded border-border-strong text-brand-accent focus-visible:ring-ring"
                checked={checked.has(p.key)}
                disabled={busy || ok}
                onChange={() => toggle(p.key)}
              />
              <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-fg">{p.userName}</div>
                  <div className="truncate text-xs text-fg-muted">
                    {p.userEmail}
                    {p.campaigns.length ? ` · ${p.campaigns.map((c) => c.name).join(', ')}` : ''}
                  </div>
                </div>
                <IconSwap size={16} className="hidden shrink-0 text-fg-subtle sm:block" />
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-fg">
                    {p.fbtimeName || 'Unnamed FbTime person'}
                  </div>
                  <div className="truncate text-xs text-fg-muted">
                    {p.fbtimeEmail}
                    {p.fbtimeProjects?.length
                      ? ` · ${p.fbtimeProjects.map((x) => x.name).join(', ')}`
                      : ''}
                  </div>
                </div>
              </div>
              <span className="shrink-0">
                {ok && <Badge variant="success">Linked</Badge>}
                {fail && <Badge variant="danger">{fail.message}</Badge>}
              </span>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}
