import { useMemo, useState } from 'react';
import { Badge, Input, Modal, IconSearch } from '../ui/index.js';

const CAP = 50;

/**
 * Pick the other half of a pairing.
 *
 * Replaces the old per-row <select>, which rendered the WHOLE org roster as
 * <option>s once per unlinked row — N × M nodes, unsearchable, and showing bare
 * names, so two people called Maria Gonzalez were indistinguishable. This is
 * mounted ONCE and driven by a target; each candidate carries the OTHER side's
 * context (campaigns for a member, recent project for an FbTime person), which is
 * exactly what tells those two Marias apart.
 */
export default function LinkPickerModal({ target, candidates, pending, error, onPick, onClose }) {
  const [term, setTerm] = useState('');
  const [active, setActive] = useState(0);

  const filtered = useMemo(() => {
    const q = term.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter((c) =>
      `${c.primary} ${c.secondary || ''} ${c.context || ''}`.toLowerCase().includes(q)
    );
  }, [candidates, term]);

  const shown = filtered.slice(0, CAP);
  const side = target?.side;
  const subject =
    side === 'doorline'
      ? target?.row?.fbtimeName || 'this FbTime person'
      : target?.row?.name || 'this person';

  const move = (delta) => {
    if (!shown.length) return;
    setActive((i) => (i + delta + shown.length) % shown.length);
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      move(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      move(-1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActive(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setActive(Math.max(0, shown.length - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const pick = shown[active];
      if (pick && !pending) onPick(pick.id);
    }
  };

  return (
    <Modal
      size="lg"
      title={
        side === 'doorline'
          ? `Link ${subject} to a Doorline person`
          : `Link ${subject} to an FbTime person`
      }
      subtitle="Their hours start counting as soon as they're linked."
      onClose={pending ? undefined : onClose}
    >
      <Input
        type="search"
        autoFocus
        role="combobox"
        aria-expanded="true"
        aria-controls="link-picker-list"
        aria-autocomplete="list"
        aria-activedescendant={shown[active] ? `link-opt-${shown[active].id}` : undefined}
        leadingIcon={<IconSearch size={16} />}
        placeholder="Search name or email…"
        value={term}
        onChange={(e) => {
          setTerm(e.target.value);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
      />

      <p aria-live="polite" className="sr-only">
        {filtered.length} people match
      </p>

      {shown.length === 0 ? (
        <p className="px-1 py-8 text-center text-sm text-fg-muted">
          {candidates.length === 0
            ? 'Everyone on the other side is already linked.'
            : `No one matches “${term}”.`}
        </p>
      ) : (
        <ul
          id="link-picker-list"
          role="listbox"
          aria-label={side === 'doorline' ? 'Doorline people' : 'FbTime people'}
          className="mt-3 divide-y divide-border overflow-hidden rounded-md border border-border"
        >
          {shown.map((c, i) => (
            <li key={c.id} role="none">
              <button
                type="button"
                id={`link-opt-${c.id}`}
                role="option"
                aria-selected={i === active}
                disabled={pending}
                onMouseEnter={() => setActive(i)}
                onClick={() => onPick(c.id)}
                className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors disabled:opacity-50 ${
                  i === active ? 'bg-sunken' : 'hover:bg-sunken'
                }`}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-fg">{c.primary}</span>
                  <span className="block truncate text-xs text-fg-muted">
                    {c.secondary || 'No email'}
                    {c.context ? ` · ${c.context}` : ''}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  {!c.active && <Badge variant="neutral">Inactive</Badge>}
                  {c.badge && <Badge variant="info">{c.badge}</Badge>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {filtered.length > CAP && (
        <p className="mt-2 text-center text-xs text-fg-subtle">
          +{filtered.length - CAP} more — keep typing to narrow the list.
        </p>
      )}

      {/* A LINK_TAKEN 409 keeps the dialog open on purpose: the fix is picking
          somebody else, and that list is right here. */}
      {error && <p className="mt-3 text-xs text-danger">{error.message}</p>}
    </Modal>
  );
}
