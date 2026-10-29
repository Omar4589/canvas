import { useId, useState } from 'react';
import { Button, Select } from '../ui/index.js';
import PasswordInput from '../PasswordInput.jsx';
import { formatDateInTz } from '../../lib/datetime.js';
import { DEFAULT_EXPIRY_DAYS, EXPIRY_CHOICES, PASSWORD_MIN, extendChoices, renewText } from './linkState.js';
import { errorText } from './parts.jsx';

// The pieces a link's controls are built from (docs/PROPOSAL_CLIENT_REPORT_LINKS.md §D1), shared by Share
// (ShareDialog.jsx) and the old-links card (RetiredLinksCard.jsx): the password choice and the warning a
// typed password carries, the password shown right after it's made or changed, Change password, Extend
// and Renew (first written for the links panel, which is gone), and the confirm that sits in place inside
// Share — a dialog over Share's dialog would close both on Escape. The words they print about a link's
// state come from linkState.js.

const DAY_MS = 24 * 60 * 60 * 1000;
const untilLabel = (days, tz) => formatDateInTz(new Date(Date.now() + days * DAY_MS), tz);
const box = 'mt-0.5 h-4 w-4 shrink-0 accent-brand-accent';

/** A typed password is kept so it can be shown again — to everyone who manages the campaign (§C3). */
export const VISIBLE_LATER = 'Everyone who manages this campaign can see this password later. Don’t use one you use anywhere else.';

/** The Expires choices: "90 days — until Jan 25, 2027". */
export const ExpiryOptions = ({ tz }) =>
  EXPIRY_CHOICES.map((d) => (
    <option key={d} value={d}>
      {d} days — until {untilLabel(d, tz)}
    </option>
  ));

/**
 * The password radios (§D1): `options` [{ key, label, disabled? }] — 'same' (Same as …), 'generate' (Make
 * one up for me), 'own' (Type my own, with its box under it). Type my own checks its 12 characters as you
 * type — the hint turns to a warning while what's typed is short — and says so in the danger tone once a
 * submit found it short (`touched`). `warn` adds the line that everyone managing the campaign can see it
 * later (not on an old link to all your reports: its password is never kept). The box is named by its
 * radio's words, Type my own, and described by the lines under it — the hint, then the warning — so a
 * screen reader says what it's for and what to type (code review CC-5).
 */
export const PasswordChoice = ({ name, options, value, onChange, typed, onType, touched = false, warn = true }) => {
  const short = typed.trim().length < PASSWORD_MIN;
  // Ids for the box's name and description: unique, since the old-links card can show several of these.
  const id = useId();
  return (
    <div role="radiogroup" aria-label="Password" className="space-y-1.5">
      {options.map((o) => (
        <div key={o.key}>
          <label className={`flex items-start gap-2 ${o.disabled ? 'text-fg-subtle' : 'text-fg'}`}>
            <input type="radio" name={name} className={box} checked={value === o.key} disabled={!!o.disabled} onChange={() => onChange(o.key)} />
            <span id={o.key === 'own' ? `${id}-own` : undefined}>{o.label}</span>
          </label>
          {o.key === 'own' && value === 'own' && (
            <div className="ml-6 mt-1.5 space-y-1">
              <PasswordInput
                value={typed}
                onChange={(e) => onType(e.target.value)}
                autoComplete="new-password"
                aria-labelledby={`${id}-own`}
                aria-describedby={warn ? `${id}-hint ${id}-warn` : `${id}-hint`}
              />
              <p id={`${id}-hint`} className={`text-xs ${touched && short ? 'text-danger-fg' : typed && short ? 'text-warning-fg' : 'text-fg-muted'}`}>
                {touched && short ? `Use at least ${PASSWORD_MIN} characters.` : `${PASSWORD_MIN} or more characters`}
              </p>
              {warn && (
                <p id={`${id}-warn`} className="text-xs text-warning-fg">
                  {VISIBLE_LATER}
                </p>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

/**
 * The password just made up, typed or changed (§D1): "Its password: k7Hq9mXrW2pZ" with Copy password, so
 * it's never unseen — even where Doorline can't keep a copy. Doorline staff under a support grant are
 * never sent one (`password` null): they read who can see it instead. The Copy password button takes the
 * keyboard as it appears (the old links panel's FRESH-4).
 */
export const PasswordReveal = ({ password, copied = false, onCopy }) =>
  password ? (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-md border border-warning/30 bg-warning-tint px-3 py-2.5 text-xs text-warning-fg">
      <span className="font-medium">Its password:</span>
      <code className="rounded border border-border bg-card px-2 py-0.5 text-sm font-medium text-fg">{password}</code>
      <Button size="sm" variant="secondary" autoFocus onClick={onCopy}>
        {copied ? 'Copied!' : 'Copy password'}
      </Button>
    </div>
  ) : (
    <p className="text-xs text-fg-muted">Doorline staff can’t view link passwords — the campaign’s admins and leads can see it in Share.</p>
  );

/**
 * Change password (§C3, §D1): Make one up for me, or Type my own — never for Doorline staff under a
 * support grant (`staff`). In Share it also offers to change the same password on the campaign's other
 * links (`also`: alsoChangeLine's words, ticked), warns that a typed one can be seen later (`warn`), and,
 * while an old link to all your reports still works, says that link keeps its own (`oldLink`). The
 * old-links card offers none of those: such a link's password is never kept, shown or shared.
 * `onSave(body, { alsoChanged })` — body { password } or { generatePassword: true }.
 */
export const ChangePasswordPanel = ({ staff = false, also = null, warn = true, oldLink = false, busy = false, error = null, onCancel, onSave }) => {
  const [choice, setChoice] = useState('generate');
  const [typed, setTyped] = useState('');
  const [touched, setTouched] = useState(false);
  const [alsoOn, setAlsoOn] = useState(true);
  const own = choice === 'own' && !staff;
  const submit = (e) => {
    e.preventDefault();
    setTouched(true);
    if (own && typed.trim().length < PASSWORD_MIN) return;
    onSave(own ? { password: typed.trim() } : { generatePassword: true }, { alsoChanged: !!also && alsoOn });
  };
  return (
    <form className="mt-2 space-y-2.5 rounded-md border border-border bg-sunken/60 p-3" onSubmit={submit}>
      <PasswordChoice
        name="change-password"
        options={[{ key: 'generate', label: 'Make one up for me' }, ...(staff ? [] : [{ key: 'own', label: 'Type my own' }])]}
        value={own ? 'own' : 'generate'}
        onChange={setChoice}
        typed={typed}
        onType={setTyped}
        touched={touched}
        warn={warn}
      />
      {also && (
        <label className="flex items-start gap-2 text-xs text-fg">
          <input type="checkbox" className={box} checked={alsoOn} onChange={(e) => setAlsoOn(e.target.checked)} />
          <span>{also}</span>
        </label>
      )}
      <p className="text-xs text-fg-muted">Changing it signs out anyone using the old one — send your client the new password.</p>
      {oldLink && (
        <p className="text-xs text-fg-muted">
          Your old link to all your reports keeps its own password — if that leaked too, change it or delete it under Old links to all your reports.
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-danger-fg">
          {errorText(error)}
        </p>
      )}
      <div className="flex gap-2">
        <Button size="sm" type="submit" loading={busy}>
          Change password
        </Button>
        <Button size="sm" variant="secondary" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
};

// Extend shows the resulting date and offers only later ones, up to a year from when the link was made
// (§G7). It never shortens a link.
export const ExtendPanel = ({ share, tz, busy, onCancel, onPick }) => {
  const choices = extendChoices(share);
  return (
    <div className="mt-2 space-y-2 rounded-md border border-border bg-sunken/60 p-3">
      {choices.length === 0 ? (
        <p className="text-xs text-fg-muted">
          This link already lasts as long as it can — a year from when it was made. When it expires, Renew gives it a new address and a new year.
        </p>
      ) : (
        <>
          <p className="text-xs text-fg-muted">Make it last until:</p>
          <div className="flex flex-wrap gap-1.5">
            {choices.map((c) => (
              <Button key={c.days} size="sm" variant="secondary" disabled={busy} onClick={() => onPick(c.days)}>
                {formatDateInTz(c.until, tz)}
                {c.capped ? ' (a year from when it was made)' : ` (${c.days} days)`}
              </Button>
            ))}
          </div>
        </>
      )}
      <Button size="sm" variant="ghost" onClick={onCancel}>
        Close
      </Button>
    </div>
  );
};

// Renew (expired links only): a new address and a new year; the password kept (renewText).
export const RenewPanel = ({ share, tz, busy, onCancel, onRenew }) => {
  const [days, setDays] = useState(DEFAULT_EXPIRY_DAYS);
  return (
    <div className="mt-2 space-y-2 rounded-md border border-border bg-sunken/60 p-3">
      <p className="text-xs text-fg-muted">{renewText(share)}</p>
      <label className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
        Lasts
        <Select value={days} onChange={(e) => setDays(Number(e.target.value))} className="py-1 text-xs">
          <ExpiryOptions tz={tz} />
        </Select>
      </label>
      <div className="flex gap-2">
        <Button size="sm" loading={busy} onClick={() => onRenew(days)}>
          Renew link
        </Button>
        <Button size="sm" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
};

/** A confirm that sits in place (inside Share): what happens, then the buttons that do it or don't. */
export const InlineConfirm = ({ title, children, confirmLabel, danger = false, busy = false, error = null, onConfirm, onCancel }) => (
  <div role="group" aria-label={title} className="mt-2 space-y-2 rounded-md border border-border bg-sunken/60 p-3">
    <p className="text-sm font-semibold text-fg">{title}</p>
    <div className="space-y-1.5 text-xs text-fg-muted">{children}</div>
    {error && (
      <p role="alert" className="text-xs text-danger-fg">
        {errorText(error)}
      </p>
    )}
    <div className="flex gap-2">
      <Button size="sm" variant={danger ? 'danger' : 'primary'} loading={busy} onClick={onConfirm}>
        {confirmLabel}
      </Button>
      <Button size="sm" variant="secondary" disabled={busy} onClick={onCancel}>
        Cancel
      </Button>
    </div>
  </div>
);
