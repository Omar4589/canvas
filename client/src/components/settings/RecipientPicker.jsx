import { useId, useState } from 'react';
import { Button, Input } from '../ui/index.js';
import { MAX_RECIPIENTS, atLimit, chosenRows, matches, roleLine } from '../../lib/recipientPicker.js';

// "Who gets the email" on the Settings page's Automatic pause card (docs/PROPOSAL_PEOPLE_PAGES.md §C).
// It used to be one checkbox per admin and team lead, which grows with the organization; now it shows
// only the people chosen, each with Remove, and a search to add one more. The rules (what a row says,
// what the search finds, the 25-person limit, what a Save sends) are lib/recipientPicker.js.
//
// Someone picked who is no longer an admin or team lead still shows by name, with "Not emailed: no
// longer an admin or team lead"; a billing admin's Save drops them. Read-only for anyone else: the rows
// show without Remove, and there is no search.
//
// The search is a combobox: type part of a name, ↑/↓ to move, Enter to pick, Escape to close the list.
// The list sits right under the box (not a pop-over), so it never lands off-screen.
const RecipientPicker = ({ s, draft, setDraft }) => {
  const canEdit = !!s.canEdit;
  const rows = chosenRows(s, draft.alertUserIds);
  const full = atLimit(s, draft.alertUserIds);
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const found = matches(s, draft.alertUserIds, text);
  const baseId = useId();
  const inputId = `${baseId}-search`;
  const listId = `${baseId}-list`;
  const optionId = (userId) => `${baseId}-opt-${userId}`;
  const showList = canEdit && !full && open && !!text.trim();

  const add = (userId) => {
    setDraft((d) => ({ ...d, alertUserIds: [...d.alertUserIds, userId] }));
    setText('');
    setActive(0);
  };
  const remove = (userId) =>
    setDraft((d) => ({ ...d, alertUserIds: d.alertUserIds.filter((x) => String(x) !== String(userId)) }));
  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (!found.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (i + 1) % found.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (i - 1 + found.length) % found.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      // Only a match on screen: after Escape closed the list, Enter adds nobody.
      if (showList) add(found[Math.min(active, found.length - 1)].userId);
    }
  };

  return (
    <div className="mt-4">
      <p className="text-sm font-medium text-fg">Who gets the email</p>
      <p className="text-xs text-fg-muted">
        It names no one and lists no addresses; the details are on the Audit page. A team lead only gets it for
        campaigns they manage — and a team lead may be your client.
      </p>

      <label className="mt-3 flex items-start gap-2 text-sm text-fg">
        <input
          type="checkbox"
          disabled={!canEdit}
          checked={draft.billingAdmins}
          onChange={(e) => setDraft((d) => ({ ...d, billingAdmins: e.target.checked }))}
          className="mt-0.5 h-4 w-4 rounded border-border-strong text-brand-accent"
        />
        <span>
          Billing admins (always)
          <span className="block text-xs text-fg-muted">Everyone with billing access, including anyone given it later</span>
        </span>
      </label>

      <div className="mt-4">
        <p className="text-sm font-medium text-fg">Also email</p>
        {rows.length ? (
          <ul className="mt-1.5 max-w-xl divide-y divide-border rounded-md border border-border">
            {rows.map((r) => (
              <li key={r.userId} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <span className="min-w-0">
                  <span className="text-fg">{r.name}</span>
                  <span className={`ml-2 text-xs ${r.eligible ? 'text-fg-muted' : 'text-warning-fg'}`}>{r.line}</span>
                </span>
                {canEdit && (
                  <Button variant="ghost" size="sm" onClick={() => remove(r.userId)} aria-label={`Remove ${r.name}`}>
                    Remove
                  </Button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-xs text-fg-muted">No one else.</p>
        )}
      </div>

      {canEdit && (
        <div className="relative mt-3 max-w-md">
          <label htmlFor={inputId} className="block text-xs font-medium text-fg-muted">
            Add a person
          </label>
          <Input
            id={inputId}
            role="combobox"
            aria-expanded={showList}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={showList && found[active] ? optionId(found[active].userId) : undefined}
            autoComplete="off"
            value={text}
            disabled={full}
            placeholder={full ? `The limit is ${MAX_RECIPIENTS} people` : 'Type part of a name…'}
            onChange={(e) => {
              setText(e.target.value);
              setActive(0);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onKeyDown={onKeyDown}
            className="mt-1"
          />
          {showList && (
            <ul
              id={listId}
              role="listbox"
              className="absolute left-0 right-0 z-10 mt-1 max-h-64 overflow-auto rounded-md border border-border bg-card shadow-popover"
            >
              {found.length ? (
                found.map((p, i) => (
                  <li
                    key={p.userId}
                    id={optionId(p.userId)}
                    role="option"
                    aria-selected={i === active}
                    // mousedown, so the box doesn't blur (and close the list) before the pick lands
                    onMouseDown={(e) => {
                      e.preventDefault();
                      add(p.userId);
                    }}
                    onMouseEnter={() => setActive(i)}
                    className={`cursor-pointer px-3 py-2 text-sm ${i === active ? 'bg-sunken' : ''}`}
                  >
                    <span className="text-fg">{p.name}</span>
                    <span className="ml-2 text-xs text-fg-muted">{roleLine(p)}</span>
                  </li>
                ))
              ) : (
                <li className="px-3 py-2 text-sm text-fg-muted">No org admin or team lead matches “{text.trim()}”.</li>
              )}
            </ul>
          )}
          {full && (
            <p className="mt-1 text-xs text-fg-muted">
              That’s the limit of {MAX_RECIPIENTS} people. Remove someone to add another.
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default RecipientPicker;
