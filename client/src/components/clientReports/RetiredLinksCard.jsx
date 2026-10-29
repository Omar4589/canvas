import { useRef, useState } from 'react';
import { Button, Card } from '../ui/index.js';
import { ConfirmDialog } from './parts.jsx';
import {
  DELETE_LINK_TITLE,
  NEW_ADDRESS_TITLE,
  allReportsLinksOf,
  isWorkingOldLink,
  oldLinkDeleteText,
  oldLinkLine,
  rotateConfirmLines,
  shareUrl,
  shortUrl,
} from './linkState.js';
import { useCopy, useFocusAfter, useLinkAction } from './hooks.js';
import { ChangePasswordPanel, PasswordReveal } from './linkParts.jsx';

// Old links to all your reports (docs/PROPOSAL_CLIENT_REPORT_LINKS.md §C1, §D3, Part 1 §3) — the card
// above a campaign's reports while it has any link that opens ALL of its reports. Each report now has its
// own link (Share makes it); these can't be made any more, and a Heroku setting (RETIRE_ALL_REPORTS_LINKS,
// `allReportsRetired`, contract K1) turns them off in every organization at once.
//
// Before the switch each row says what its link does now — "Candidate · still opens every report · last
// opened Oct 26", "A link made Jul 3 · expired Oct 30", "Board · turned off" — and one that still works
// keeps what the Privacy Policy promises a live link: Change password and New address. Change password is
// never offered to Doorline staff under a support grant (`staffUnderGrant`): such a password could be seen
// by nobody, and the server refuses it. A new password or a new address shows right here, once, with its
// Copy button — an old link's password is never kept, so it can't be shown again later. Every row has
// Delete, which asks first in words that follow the link's state. Once the switch is on, the card says
// they no longer work and Delete is all that's left. None can be turned back on, renewed or extended.
//
// Renders nothing when the campaign has no such link, or while the list isn't loaded (`shares` null).
// `onChanged` reads the links list and History again after a change.
//
// The keyboard never drops to <body> when the button it was on goes (code review V2-1, hooks.js
// useFocusAfter). A Delete takes its row away — the confirm hands the focus back to that row's Delete,
// which is gone — so it goes to the next row's first button, or the one before at the bottom; with the
// card's last link gone the card goes too, and `afterRef` (the page's reports heading) takes it. Change
// password's panel takes its button's place: its first choice takes the keyboard, then Change password
// again when it's cancelled.

const RetiredLinksCard = ({ campaignId, tz, shares, allReportsRetired = false, staffUnderGrant = false, onChanged, afterRef }) => {
  const links = allReportsLinksOf(shares);
  const focusAfter = useFocusAfter();
  const listRef = useRef(null);
  if (!links.length) return null;
  const rowOf = (id) => listRef.current?.querySelector(`[data-old-link="${id}"]`) || null;
  const deleting = (id) => {
    const i = links.findIndex((s) => s.id === id);
    const near = [links[i + 1], links[i - 1]].filter(Boolean).map((s) => s.id);
    focusAfter(() => (rowOf(id) ? undefined : near.map((n) => rowOf(n)?.querySelector('button')).find(Boolean) || afterRef?.current || null));
  };
  return (
    <Card className="p-4">
      <h2 className="text-sm font-semibold text-fg">{allReportsRetired ? 'Old links to all your reports — turned off' : 'Old links to all your reports'}</h2>
      <p className="mt-0.5 text-xs text-fg-muted">
        {allReportsRetired
          ? 'These opened every report of this campaign and no longer work. Each report now has its own link: press Share on a report to send it.'
          : 'Each report now has its own link: press Share on a report to send it. Doorline will turn these old links off.'}
      </p>
      <ul ref={listRef} className="mt-3 divide-y divide-border">
        {links.map((s) => (
          <OldLinkRow
            key={s.id}
            link={s}
            campaignId={campaignId}
            tz={tz}
            allReportsRetired={allReportsRetired}
            staff={staffUnderGrant}
            focusAfter={focusAfter}
            onDeleting={() => deleting(s.id)}
            onChanged={onChanged}
          />
        ))}
      </ul>
    </Card>
  );
};

const OldLinkRow = ({ link, campaignId, tz, allReportsRetired, staff, focusAfter, onDeleting, onChanged }) => {
  const now = Date.now();
  const working = isWorkingOldLink(link, { now, allReportsRetired });
  const { copied, copy } = useCopy();
  const [panel, setPanel] = useState(false);
  const [confirm, setConfirm] = useState(null); // 'rotate' | 'delete' | null
  // What was just set here, shown until the page goes: { password } after Change password, { url }
  // after New address.
  const [fresh, setFresh] = useState(null);
  // New address and Delete are requests of their own, so a refusal shows only in the confirm that sent
  // it; and a confirm or the password panel opens clean — an earlier refusal never greets it (code review
  // CC-2). A request still on its way is left alone: its answer is still to land.
  const rotateM = useLinkAction({ campaignId, linkId: link.id, onChanged });
  const deleteM = useLinkAction({ campaignId, linkId: link.id, onChanged });
  const change = useLinkAction({ campaignId, linkId: link.id, onChanged });
  const rowRef = useRef(null);
  const inRow = (selector) => rowRef.current?.querySelector(selector) || null;
  const opening = () => [rotateM, deleteM, change].forEach((m) => !m.isPending && m.reset());
  const openConfirm = (which) => {
    opening();
    setConfirm(which);
  };
  const openPanel = () => {
    opening();
    setPanel(true);
    focusAfter(() => inRow('input[name="change-password"]') || undefined);
  };
  const closePanel = () => {
    setPanel(false);
    focusAfter(() => inRow('[data-link-action="password"]') || undefined);
  };
  const rotate = () =>
    rotateM.mutate(
      { path: '/rotate' },
      {
        onSuccess: (res) => {
          setConfirm((c) => (c === 'rotate' ? null : c));
          if (res?.share?.token) setFresh((f) => ({ ...f, url: shareUrl(window.location.origin, res.share.token) }));
        },
      }
    );
  const save = (body) =>
    change.mutate(
      { method: 'PATCH', body },
      {
        onSuccess: (res) => {
          setPanel(false);
          setFresh((f) => ({ ...f, password: res?.password || body.password || null }));
        },
      }
    );
  return (
    <li ref={rowRef} className="py-3 first:pt-0 last:pb-0" data-old-link={link.id}>
      <p className="text-sm text-fg">{oldLinkLine(link, { now, tz, allReportsRetired })}</p>
      {fresh?.url && working && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-fg-muted">
          <span className="font-medium">Its new address:</span>
          <code className="min-w-0 truncate rounded border border-border bg-sunken px-2 py-1 text-xs text-fg" title={fresh.url}>
            {shortUrl(fresh.url)}
          </code>
          <Button size="sm" variant="secondary" onClick={() => copy(fresh.url, 'url')}>
            {copied === 'url' ? 'Copied!' : 'Copy link'}
          </Button>
        </div>
      )}
      {fresh?.password && working && (
        <div className="mt-2">
          <PasswordReveal password={fresh.password} copied={copied === 'pw'} onCopy={() => copy(fresh.password, 'pw')} />
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {working && !staff && !panel && (
          <Button size="sm" variant="secondary" data-link-action="password" onClick={openPanel}>
            {link.hasPassword === false ? 'Add a password' : 'Change password'}
          </Button>
        )}
        {working && (
          <Button size="sm" variant="secondary" onClick={() => openConfirm('rotate')}>
            New address
          </Button>
        )}
        <Button size="sm" variant="danger" onClick={() => openConfirm('delete')}>
          Delete
        </Button>
      </div>
      {panel && working && <ChangePasswordPanel warn={false} busy={change.isPending} error={change.error} onCancel={closePanel} onSave={save} />}
      {String(copied || '').endsWith(':failed') && <p className="mt-1 text-xs text-danger-fg">Couldn’t copy — select the text and copy it yourself.</p>}
      {confirm === 'rotate' && (
        <ConfirmDialog title={NEW_ADDRESS_TITLE} confirmLabel="New address" busy={rotateM.isPending} error={rotateM.error} onClose={() => setConfirm(null)} onConfirm={rotate}>
          {rotateConfirmLines(link, { now, tz }).map((line) => (
            <p key={line}>{line}</p>
          ))}
        </ConfirmDialog>
      )}
      {confirm === 'delete' && (
        <ConfirmDialog
          title={DELETE_LINK_TITLE}
          confirmLabel="Delete link"
          danger
          busy={deleteM.isPending}
          error={deleteM.error}
          onClose={() => setConfirm(null)}
          onConfirm={() => {
            onDeleting();
            deleteM.mutate({ method: 'DELETE' });
          }}
        >
          <p>{oldLinkDeleteText(link, { now, allReportsRetired })}</p>
        </ConfirmDialog>
      )}
    </li>
  );
};

export default RetiredLinksCard;
