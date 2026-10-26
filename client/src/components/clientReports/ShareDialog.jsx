import { useEffect, useMemo, useRef, useState } from 'react';
import { useIsFetching, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client.js';
import { Button, Modal, Select } from '../ui/index.js';
import { formatDateInTz } from '../../lib/datetime.js';
import { ErrorBanner } from './parts.jsx';
import { copyMessageFor } from './copyMessage.js';
import { formatPeriod } from './reportDates.js';
import { DEFAULT_EXPIRY_DAYS, EXPIRY_CHOICES, linkName, linksFor, noUsableLinkReason, reportUrl, shortUrl, usableLinks } from './linkState.js';
import { sharesKey, useCopy } from './hooks.js';

// Share (docs/PROPOSAL_CLIENT_REPORTS_SIMPLIFY.md §D "Admin UI", contract K9) — replaces Copy message,
// on every shown report's row and in the builder. It gives the copy-ready message (never with a
// password in it) and the link it uses, picked from the links that can open THIS report (linksFor):
//
//   Link     (•) Candidate — opens all your reports      doorline.app/r/7kQ…  [Copy link]
//            ( ) Board — opens only this report
//            [Make a link]
//   Message (no password in it)
//
// Make a link is always there (a donor's link next to an existing all-reports link) and is the main
// action, with All your reports picked, when no link opens the report. A link made here has its
// password generated and shown ONCE, right here, with Copy password — every link made in this Share,
// each with its own password, until Done (code review round 2, FRESH-7); an existing link's password
// can't be shown (it is stored hashed). The message's ending follows the link (copyMessage.js).
//
// `report` is a message report (copyMessage.js messageReportOf, with campaignType); `shares` the
// campaign's links list — null until it has loaded, when the dialog says so and offers nothing yet
// (code review LINK-3: pressed early, an empty list made Make a link the main action, and a second
// all-reports link and password with it); `linksError` the list's failure, if it failed — Try again
// reads the list again, and so does opening Share after a failure (VER-2); `onLinksChanged` re-reads it
// (and History) after a link is made. `isAdmin` is part of the contract but changes nothing: leads
// manage their campaigns' links as admins do.

const DAY_MS = 24 * 60 * 60 * 1000;
const untilLabel = (days, tz) => formatDateInTz(new Date(Date.now() + days * DAY_MS), tz);
const box = 'mt-0.5 h-4 w-4 shrink-0 accent-brand-accent';

// The two kinds of link (Part 1 §3), All your reports first: the usual choice.
const KINDS = [
  { key: 'all', title: 'All your reports', aside: '(the usual choice)', text: 'one link and one password; next week’s report shows up on it too.', placeholder: 'e.g. Candidate' },
  {
    key: 'one',
    title: 'Just this report',
    text: 'for someone who should see only this one (a donor, a board member). It has its own password, and next week’s report won’t be on it.',
    placeholder: 'e.g. Board',
  },
];

const ShareDialog = ({ report, shares, linksError = null, campaignId, tz, onClose, onLinksChanged }) => {
  const reportId = report?.id ? String(report.id) : '';
  const origin = window.location.origin;
  const qc = useQueryClient();
  const { copied, copy } = useCopy();
  const [made, setMade] = useState([]); // [{ share, password }] — every link made here, oldest first
  const [linkId, setLinkId] = useState(null);
  const [makeOpen, setMakeOpen] = useState(false);
  const [kind, setKind] = useState('all');
  const [label, setLabel] = useState('');
  const [days, setDays] = useState(DEFAULT_EXPIRY_DAYS);
  // Where the keyboard goes when what it was on goes (code review round 2, FRESH-4): Make a link → the
  // panel's first choice; Create link → the new password's Copy password. Focus only, nothing to stop.
  const [focusTo, setFocusTo] = useState(null); // { at: 'make' | 'password' }
  const makeRef = useRef(null);
  const passwordsRef = useRef(null);
  useEffect(() => {
    if (!focusTo) return;
    const buttons = focusTo.at === 'password' ? passwordsRef.current?.querySelectorAll('button') : null;
    const el = focusTo.at === 'make' ? makeRef.current?.querySelector('input[type="radio"]') : buttons?.[buttons.length - 1];
    el?.focus();
  }, [focusTo]);

  // The links list isn't here yet: nothing is known about which link opens the report. It failed to
  // load: Try again reads it again — and so does opening Share after a failure, since the page's own
  // query has given up by then (VER-2). The read is the page's list's; nothing of this dialog's to stop.
  const loading = shares == null;
  const linksFetching = useIsFetching({ queryKey: sharesKey(campaignId) }) > 0;
  const retryLinks = () => qc.refetchQueries({ queryKey: sharesKey(campaignId) });
  useEffect(() => {
    if (shares == null && linksError) retryLinks();
    // Once, as Share opens: Try again covers the rest.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // The links made here count at once, before the list is read again.
  const all = useMemo(() => {
    const list = shares || [];
    const fresh = made.map((m) => m.share).filter((s) => !list.some((x) => x.id === s.id));
    return fresh.length ? [...fresh.reverse(), ...list] : list;
  }, [shares, made]);
  const mine = linksFor(all, reportId);
  const usable = usableLinks(mine);
  const links = [...usable.filter((s) => s.reportId == null), ...usable.filter((s) => s.reportId != null)];
  const link = links.find((s) => s.id === linkId) || links[0] || null;
  // No link opens it: making one is the main action (the panel is open, All your reports picked) —
  // once the list says so.
  const showMake = !loading && (makeOpen || !link);
  // Why none of the links meant for it can be opened (expired, locked, disabled) — the fix is in the
  // links panel. No such link at all: the panel below says enough.
  const blocked = !link && mine.length ? noUsableLinkReason(mine) : null;

  const create = useMutation({
    mutationFn: (body) => api('/admin/client-reports/shares', { method: 'POST', body }),
    onSuccess: (res) => {
      setMade((xs) => [...xs, { share: res.share, password: res.generatedPassword || null }]);
      setLinkId(res.share.id);
      setMakeOpen(false);
      setLabel('');
      setKind('all');
      setFocusTo({ at: 'password' });
      onLinksChanged?.();
    },
  });
  const makeLink = () =>
    create.mutate({
      campaignId,
      label: label.trim() || undefined,
      expiresInDays: days,
      ...(kind === 'one' ? { reportId } : {}),
    });

  const justMade = !!link && made.some((m) => m.share.id === link.id);
  const passwords = made.filter((m) => m.password);
  const message = link ? copyMessageFor({ report, link, origin, justMade }) : '';
  const url = link ? reportUrl(origin, link.token, reportId) : '';
  const scopeLabel = report?.scope?.seriesLabel || report?.scope?.label || 'Whole campaign';
  const failed = String(copied || '').endsWith(':failed');

  return (
    <Modal
      size="lg"
      title={`Share “${formatPeriod(report.weekStart, report.weekEnd)} · ${scopeLabel}”`}
      subtitle="Paste the message into your own email or text. It never includes the password — send that separately."
      onClose={create.isPending ? undefined : onClose}
      closable={!create.isPending}
      footer={
        <>
          <Button variant="secondary" disabled={create.isPending} onClick={onClose}>
            Done
          </Button>
          <Button disabled={!link} onClick={() => copy(message, 'msg')}>
            {copied === 'msg' ? 'Copied!' : 'Copy message'}
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        <div>
          <div className="text-xs font-medium text-fg-muted">Link</div>
          {loading &&
            (linksError && !linksFetching ? (
              <div className="mt-1.5 space-y-2">
                <ErrorBanner title="Couldn’t load the links." error={linksError} />
                <Button size="sm" variant="secondary" onClick={retryLinks}>
                  Try again
                </Button>
              </div>
            ) : (
              <p className="mt-1.5 text-fg-muted" role="status">
                Loading links…
              </p>
            ))}
          {links.length > 1 && (
            <div role="radiogroup" aria-label="Link" className="mt-1.5 space-y-1.5">
              {links.map((s) => (
                <label key={s.id} className="flex items-start gap-2 text-fg">
                  <input type="radio" name="share-link" className={box} checked={s.id === link.id} onChange={() => setLinkId(s.id)} />
                  <span>{linkName(s, { thisReportId: reportId })}</span>
                </label>
              ))}
            </div>
          )}
          {links.length === 1 && <p className="mt-1.5 text-fg">{linkName(link, { thisReportId: reportId })}</p>}
          {link && (
            <div className="mt-2 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded border border-border bg-sunken px-2 py-1 text-xs text-fg-muted" title={url}>
                {shortUrl(url)}
              </code>
              <Button size="sm" variant="secondary" onClick={() => copy(url, 'url')}>
                {copied === 'url' ? 'Copied!' : 'Copy link'}
              </Button>
            </div>
          )}
          {blocked && <p className="mt-1.5 text-xs text-warning-fg">{blocked.text}</p>}
          {passwords.length > 0 && (
            // Each link made in this Share keeps its password on screen until Done (FRESH-7).
            <div ref={passwordsRef} className="mt-3 space-y-2">
              {passwords.map((m) => (
                <p key={m.share.id} className="flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-md border border-warning/30 bg-warning-tint px-3 py-2.5 text-xs text-warning-fg">
                  <span className="font-medium">Password for {m.share.label || 'this link'}:</span>
                  <code className="rounded border border-border bg-card px-2 py-0.5 text-sm font-medium text-fg">{m.password}</code>
                  <Button size="sm" variant="secondary" onClick={() => copy(m.password, `pw:${m.share.id}`)}>
                    {copied === `pw:${m.share.id}` ? 'Copied!' : 'Copy password'}
                  </Button>
                  <span>— shown once. Send it separately from the message. Lost it? Change password on the link.</span>
                </p>
              ))}
            </div>
          )}
          {link && !showMake && (
            <Button
              size="sm"
              variant="secondary"
              className="mt-3"
              onClick={() => {
                setMakeOpen(true);
                setFocusTo({ at: 'make' });
              }}
            >
              Make a link
            </Button>
          )}
        </div>

        {showMake && (
          <fieldset ref={makeRef} className="space-y-3 rounded-md border border-border bg-sunken/60 p-3">
            <legend className="px-1 text-xs font-medium text-fg-muted">Make a link</legend>
            <div role="radiogroup" aria-label="What the link opens" className="space-y-2">
              {KINDS.map((k) => (
                <label key={k.key} className="flex items-start gap-2">
                  <input type="radio" name="share-kind" className={box} checked={kind === k.key} onChange={() => setKind(k.key)} />
                  <span className="text-fg-muted">
                    <span className="font-semibold text-fg">{k.title}</span>
                    {k.aside && <span className="italic"> {k.aside}</span>} — {k.text}
                  </span>
                </label>
              ))}
            </div>
            <label className="block">
              <span className="text-xs font-medium text-fg-muted">Label (only you see it)</span>
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                maxLength={120}
                placeholder={KINDS.find((k) => k.key === kind).placeholder}
                className="mt-1 w-full rounded-lg border border-border-strong bg-card px-3 py-2 text-sm text-fg focus:border-brand-accent focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-fg-muted">Expires</span>
              <Select value={days} onChange={(e) => setDays(Number(e.target.value))} className="mt-1 w-full">
                {EXPIRY_CHOICES.map((d) => (
                  <option key={d} value={d}>
                    {d} days — until {untilLabel(d, tz)}
                  </option>
                ))}
              </Select>
              <span className="mt-1 block text-xs text-fg-muted">A password is shown once, right after the link is made — copy it then.</span>
            </label>
            {create.error && <ErrorBanner title="Couldn’t create the link." error={create.error} />}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant={link ? 'secondary' : 'primary'} loading={create.isPending} onClick={makeLink}>
                Create link
              </Button>
              {link && (
                <Button size="sm" variant="ghost" disabled={create.isPending} onClick={() => setMakeOpen(false)}>
                  Cancel
                </Button>
              )}
            </div>
          </fieldset>
        )}

        {link && (
          <div>
            <div className="text-xs font-medium text-fg-muted">Message (no password in it)</div>
            <textarea
              readOnly
              value={message}
              rows={5}
              onFocus={(e) => e.target.select()}
              aria-label="Message"
              className="mt-1 w-full rounded-lg border border-border bg-sunken px-3 py-2 text-sm text-fg"
            />
          </div>
        )}
        {failed && <p className="text-xs text-danger-fg">Couldn’t copy — select the text and copy it yourself.</p>}
      </div>
    </Modal>
  );
};

export default ShareDialog;
