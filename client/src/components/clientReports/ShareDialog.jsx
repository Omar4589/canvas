import { useEffect, useRef, useState } from 'react';
import { useIsFetching, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client.js';
import { Badge, Button, Modal, Select } from '../ui/index.js';
import { ErrorBanner } from './parts.jsx';
import { copyMessageFor } from './copyMessage.js';
import { formatDayOf, formatPeriod } from './reportDates.js';
import {
  DEFAULT_EXPIRY_DAYS,
  DELETE_LINK_TEXT,
  DELETE_LINK_TITLE,
  NEW_ADDRESS_TITLE,
  PASSWORD_MIN,
  alsoChangeLine,
  beforeSendText,
  createErrorText,
  extraLinkLine,
  extraLinksOf,
  failureLine,
  fewerChangedLine,
  hasWorkingAllReportsLink,
  isExpired,
  isLocked,
  linkBadges,
  lockAdvice,
  primaryLinkOf,
  rotateConfirmLines,
  sameAsSourceOf,
  shareUrl,
  shortUrl,
} from './linkState.js';
import { LINK_MOVED_CODES, putShareRow, sharesKey, useCopy, useFocusAfter, useLinkAction, useLinkPassword } from './hooks.js';
import { ChangePasswordPanel, ExpiryOptions, ExtendPanel, InlineConfirm, PasswordChoice, PasswordReveal, RenewPanel } from './linkParts.jsx';

// Share (docs/PROPOSAL_CLIENT_REPORT_LINKS.md §D1, Part 1 §1–§2) — the report's link manager, on every
// published report's row and in the builder. Every report has ONE link of its own (§C2): Share makes it,
// then always shows that same link — its address, its password, its state — and the message to paste
// into an email or text, which never carries the password.
//
//   Share “Oct 19 – Oct 25 · Whole campaign”                        (no link yet)
//     Make this report’s link
//     Password  (•) Same as your last link (Whole campaign · Oct 12 – Oct 18)
//               ( ) Make one up for me
//               ( ) Type my own  [____________]   12 or more characters
//     Expires   [90 days — until Jan 25 ▾]
//     [Create link]
//
//   Share “Oct 19 – Oct 25 · Whole campaign”                        (has its link)
//     Link      doorline.app/r/7kQ…                       [Copy link]
//     Password  ••••••••••••  [Show]   [Change password]
//     ● Active · Expires Jan 25 · Last opened Oct 26     [Extend] [New address] [Delete link]
//     Message (no password in it)
//
// Same as … copies the newest password Doorline kept — this tab's, picked for you; another tab's,
// offered but not picked, since that tab may go to someone else (linkState.js sameAsSourceOf). Doorline
// staff under a support grant (`staffUnderGrant`, contract K1) never type a password and never see one:
// the server leaves a made-up one out of its answer to them. A password made up or typed here, or a
// changed one, shows in plain text with Copy password until Done; after that, Show fetches it
// (hooks.js useLinkPassword) into this dialog's state — never a react-query cache entry — and it goes
// when Share closes. The message's ending follows what Share just did (copyMessage.js).
//
// No Turn off: Take down does that job for one report. A link already turned off (from before) shows
// Turn on. A report that got two links before one link per report lists the extra one under the main
// one, with Delete — without that line it would be on no screen and couldn't be revoked.
//
// `report` is a message report (copyMessage.js messageReportOf) with campaignType, status and
// takenDownAt; `shares` the campaign's links list — null until it has loaded, when Share says so and
// offers nothing yet (code review LINK-3); `linksError` its failure, if it failed — Try again reads it
// again, and so does opening Share after a failure (VER-2); `allReportsRetired` the switch (K1);
// `onLinksChanged` reads the list (and History) again after a change made here; `onReportChanged` reads
// the report itself again — its row, or the builder's report — when Create finds it taken down or deleted
// somewhere else (code review V2-2).
//
// The keyboard never drops to <body> when the button it was on goes with its own press (code review V2-1,
// N1): each such press names what takes it next — the button that stays in its place, the form that
// takes a deleted link's place, or the dialog itself when nothing is left to press (hooks.js
// useFocusAfter).

const fieldLabel = 'text-xs font-medium text-fg-muted';
const address = 'min-w-0 flex-1 truncate rounded border border-border bg-sunken px-2 py-1 text-xs text-fg-muted';
const TONE = { muted: 'text-fg-muted', warning: 'text-warning-fg', danger: 'text-danger-fg' };
const badgeTone = (variant) => (variant === 'danger' ? TONE.danger : variant === 'warning' ? TONE.warning : TONE.muted);

const ShareDialog = ({ report, shares, allReportsRetired = false, staffUnderGrant = false, linksError = null, campaignId, tz, onClose, onLinksChanged, onReportChanged }) => {
  const reportId = report?.id ? String(report.id) : '';
  const origin = window.location.origin;
  const qc = useQueryClient();
  const { copied, copy } = useCopy();
  // What this Share just did, and to which link: { linkId, ending, reveal, password, offered, changed,
  // someoneElse }. It decides the message's ending ('new', 'changed', else 'sent') and whether the
  // password shows in plain text — only for that link, so another link that becomes the report's main
  // one (its main one deleted) reads as opened again later.
  const [did, setDid] = useState(null);
  // A link being made, or a password being changed: Share stays open until the answer — with the
  // password in it — has landed.
  const [busy, setBusy] = useState(false);
  // Create refused because the report itself is gone — deleted somewhere else (REPORT_NOT_FOUND, code
  // review V2-2): Share says so and offers nothing more, never Create link on a report that isn't there.
  const [gone, setGone] = useState(false);
  // The keyboard's next stop when a part of Share leaves the screen with the press that was on it — the
  // make-link form once Create lands, a link once it's deleted (hooks.js useFocusAfter; a link's own
  // controls hand it on inside LinkManager). Looked up in what's drawn; the dialog itself (the Overlay's
  // panel, which can take focus) when nothing is left to press.
  const focusAfter = useFocusAfter();
  const bodyRef = useRef(null);
  const inShare = (selector) => bodyRef.current?.querySelector(selector) || null;
  const dialogPanel = () => bodyRef.current?.closest('[role="dialog"]') || null;

  // The links list isn't here yet: nothing is known about the report's link. It failed to load: Try
  // again reads it again — and so does opening Share after a failure, since the page's own query has
  // given up by then (VER-2). The read is the page's list's; nothing of this dialog's to stop.
  const loading = shares == null;
  const linksFetching = useIsFetching({ queryKey: sharesKey(campaignId) }) > 0;
  const retryLinks = () => qc.refetchQueries({ queryKey: sharesKey(campaignId) });
  useEffect(() => {
    if (shares == null && linksError) retryLinks();
    // Once, as Share opens: Try again covers the rest.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const now = Date.now();
  const link = loading ? null : primaryLinkOf(shares, reportId, now);
  const extras = loading ? [] : extraLinksOf(shares, reportId, now);
  const takenDown = !!report?.takenDownAt;
  const mine = link && did?.linkId === link.id ? did : null;
  // A taken-down report's message can't be copied until it is back up: its link only says "taken down".
  // Nor can one whose link the client can't open (code review CC-1): turned off, expired or locked, the
  // message would send them to a dead end — one line says what to do first instead.
  const hold = link && !takenDown ? beforeSendText(link, now) : null;
  const message = link && !takenDown && !hold && !gone ? copyMessageFor({ report, link, origin, ending: mine?.ending || 'sent' }) : '';
  const scopeLabel = report?.scope?.seriesLabel || report?.scope?.label || 'Whole campaign';
  const failed = String(copied || '').endsWith(':failed');
  const changed = () => onLinksChanged?.();

  // After Create, Copy link takes the keyboard as the new link appears — Same as …, the link someone made
  // a moment ago, or one whose password Doorline staff never see (code review CC-6). It waits for the link
  // to be drawn, not for the moment its part mounts, so it holds whichever lands first: the list's answer
  // or this dialog's own `did` (N1). A password on screen has Copy password take it instead, as it
  // appears (linkParts.jsx PasswordReveal). Create refused for the report itself — taken down, or gone —
  // leaves nothing to press: the dialog takes it (V2-2).
  const afterCreate = () => focusAfter(() => inShare('[data-link-action="copy"]') || dialogPanel());
  // After Delete link, once the link has left the screen: the first choice of the make-link form in its
  // place — or the dialog itself on a taken-down report (no form yet) or when another link took its place.
  const afterDelete = (id) =>
    focusAfter(() => (inShare(`[data-link-id="${id}"]`) ? undefined : inShare('input[name="share-password"]:not([disabled])') || dialogPanel()));
  // After an extra link's Delete, once it's gone: the next one's Delete — the one before, at the bottom —
  // else the dialog itself.
  const afterExtraDelete = (id) => {
    const i = extras.findIndex((s) => s.id === id);
    const near = [extras[i + 1], extras[i - 1]].filter(Boolean).map((s) => s.id);
    focusAfter(() =>
      inShare(`[data-extra-link="${id}"]`) ? undefined : near.map((n) => inShare(`[data-extra-link="${n}"]`)?.querySelector('button')).find(Boolean) || dialogPanel()
    );
  };
  // Create refused because the report itself changed a moment ago (code review V2-2). Taken down: the
  // report is read again, and Share then shows it taken down — its row offering Put back up. Deleted:
  // Share says so, and the links list is read again too, since its links went with it.
  const reportMoved = (err) => {
    if (err?.code === 'REPORT_NOT_FOUND') {
      setGone(true);
      changed();
    }
    onReportChanged?.();
  };

  return (
    <Modal
      size="lg"
      title={`Share “${formatPeriod(report.weekStart, report.weekEnd)} · ${scopeLabel}”`}
      subtitle="Paste the message into your own email or text. It never includes the password."
      onClose={busy ? undefined : onClose}
      closable={!busy}
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            Done
          </Button>
          <Button disabled={!message} onClick={() => copy(message, 'msg')}>
            {copied === 'msg' ? 'Copied!' : 'Copy message'}
          </Button>
        </>
      }
    >
      <div ref={bodyRef} className="space-y-4 text-sm">
        {loading ? (
          <div>
            <div className={fieldLabel}>Link</div>
            {linksError && !linksFetching ? (
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
            )}
          </div>
        ) : gone ? (
          <p className="rounded-md border border-warning/30 bg-warning-tint px-3 py-2 text-xs text-warning-fg">This report was deleted — there’s nothing to share.</p>
        ) : (
          <>
            {takenDown && (
              <p className="rounded-md border border-warning/30 bg-warning-tint px-3 py-2 text-xs text-warning-fg">
                {link ? 'This report is taken down — its link shows “taken down” until you put it back up.' : 'This report is taken down. Put it back up, then make its link.'}
              </p>
            )}
            {mine?.someoneElse && (
              <p role="status" className="text-xs text-fg-muted">
                Someone made this report’s link a moment ago — here it is. Its password is the one they chose.
              </p>
            )}
            {link ? (
              <LinkManager
                key={link.id}
                link={link}
                did={mine}
                campaignId={campaignId}
                tz={tz}
                staff={staffUnderGrant}
                oldLinkWorks={hasWorkingAllReportsLink(shares, allReportsRetired)}
                copy={copy}
                copied={copied}
                onDid={setDid}
                onBusy={setBusy}
                onDeleting={() => afterDelete(link.id)}
                onChanged={changed}
              />
            ) : (
              !takenDown && (
                <MakeLinkForm
                  campaignId={campaignId}
                  report={report}
                  reportId={reportId}
                  shares={shares}
                  staff={staffUnderGrant}
                  tz={tz}
                  onDid={setDid}
                  onBusy={setBusy}
                  onCreating={afterCreate}
                  onReportMoved={reportMoved}
                  onChanged={changed}
                />
              )
            )}
            {extras.length > 0 && (
              <ul className="space-y-2 border-t border-border pt-3">
                {extras.map((s) => (
                  <ExtraLink
                    key={s.id}
                    link={s}
                    campaignId={campaignId}
                    tz={tz}
                    focusAfter={focusAfter}
                    onDeleting={() => afterExtraDelete(s.id)}
                    onChanged={changed}
                  />
                ))}
              </ul>
            )}
            {message ? (
              <div>
                <div className={fieldLabel}>Message (no password in it)</div>
                <textarea
                  readOnly
                  value={message}
                  rows={5}
                  onFocus={(e) => e.target.select()}
                  aria-label="Message"
                  className="mt-1 w-full rounded-lg border border-border bg-sunken px-3 py-2 text-sm text-fg"
                />
              </div>
            ) : (
              hold && <p className="text-xs text-warning-fg">{hold}</p>
            )}
          </>
        )}
        {failed && <p className="text-xs text-danger-fg">Couldn’t copy — select the text and copy it yourself.</p>}
      </div>
    </Modal>
  );
};

// ── No link yet: make it (§C3) ─────────────────────────────────────────────────────────────────────

const MakeLinkForm = ({ campaignId, report, reportId, shares, staff, tz, onDid, onBusy, onCreating, onReportMoved, onChanged }) => {
  const qc = useQueryClient();
  const source = sameAsSourceOf(shares, report);
  // Same as … is picked when it's this tab's; another tab's is offered, never picked. `sameId` is the link
  // it was picked for (code review CC-3): the list read again can put another link in its place — another
  // tab's, once the first was deleted elsewhere — and Same as … stays picked only while it still copies
  // that same link.
  const [choice, setChoice] = useState(() => (source?.sameTab ? 'same' : 'generate'));
  const [sameId, setSameId] = useState(() => (source?.sameTab ? source.link.id : null));
  const pick = (key) => {
    setChoice(key);
    if (key === 'same') setSameId(source?.link.id ?? null);
  };
  const [typed, setTyped] = useState('');
  const [touched, setTouched] = useState(false);
  const [days, setDays] = useState(DEFAULT_EXPIRY_DAYS);
  const create = useMutation({
    mutationFn: (body) => api('/admin/client-reports/shares', { method: 'POST', body }),
    // The answer carries a made-up password: gone from react-query's cache once Share closes.
    gcTime: 0,
    onMutate: () => onBusy(true),
    onSettled: () => onBusy(false),
    onSuccess: (res, body) => {
      if (!res?.share) return;
      putShareRow(qc, campaignId, res.share);
      // Same as …: the client has the password already. Made up or typed: shown now, sent separately.
      onDid(
        body.passwordFrom
          ? { linkId: res.share.id, ending: 'sent' }
          : { linkId: res.share.id, ending: 'new', reveal: true, password: res.generatedPassword || body.password || null }
      );
      onChanged();
    },
    onError: (err) => {
      // Someone made this report's link a moment ago: here it is, with the password they chose.
      if (err?.code === 'REPORT_HAS_LINK' && err.data?.share) {
        putShareRow(qc, campaignId, err.data.share);
        onDid({ linkId: err.data.share.id, ending: 'sent', someoneElse: true });
        onChanged();
      } else if (createErrorText(err)) {
        // Same as …'s password can't be copied any more: nothing stays picked — the operator chooses
        // another way, as the banner asks, even once the list read again offers another link (CC-3) —
        // and that list says which passwords still can be copied.
        setChoice(null);
        onChanged();
      } else if (LINK_MOVED_CODES.has(err?.code)) {
        // The report's link changed a moment ago (SHARE_CHANGED: two Creates at once): the list read
        // again shows it (code review CC-4).
        onChanged();
      } else if (err?.code === 'REPORT_NOT_SHOWN' || err?.code === 'REPORT_NOT_FOUND') {
        // The report itself changed a moment ago — taken down, or deleted, somewhere else (code review
        // V2-2): Share reads it again rather than keep offering Create link on a report that can't have
        // one.
        onReportMoved(err);
      }
    },
  });
  // Same as … refused: that link stays offered but can't be picked again, and the operator chooses
  // another way. (The list read again may offer a different one, which can be.)
  const copyGone = !!createErrorText(create.error) && create.variables?.passwordFrom === source?.link.id;
  // Same as … still copies the link it was picked for; if the source is now another link — or none —
  // the rule for a source nobody picked stands: Make one up for me (§D1).
  const sameHolds = !!source && source.link.id === sameId && !copyGone;
  const picked = choice === 'same' ? (sameHolds ? 'same' : 'generate') : choice === 'own' && staff ? null : choice;
  const options = [
    ...(source ? [{ key: 'same', label: source.label, disabled: copyGone }] : []),
    { key: 'generate', label: 'Make one up for me' },
    ...(staff ? [] : [{ key: 'own', label: 'Type my own' }]),
  ];
  const submit = (e) => {
    e.preventDefault();
    setTouched(true);
    if (!picked || (picked === 'own' && typed.trim().length < PASSWORD_MIN)) return;
    onCreating();
    create.mutate({
      campaignId,
      reportId,
      expiresInDays: days,
      ...(picked === 'same' ? { passwordFrom: source.link.id } : picked === 'own' ? { password: typed.trim() } : {}),
    });
  };
  const shownError = create.error && !(create.error.code === 'REPORT_HAS_LINK' && create.error.data?.share) ? create.error : null;
  return (
    <form className="space-y-3" onSubmit={submit}>
      <h3 className="text-sm font-semibold text-fg">Make this report’s link</h3>
      <fieldset>
        <legend className={fieldLabel}>Password</legend>
        <div className="mt-1.5">
          <PasswordChoice name="share-password" options={options} value={picked} onChange={pick} typed={typed} onType={setTyped} touched={touched} />
        </div>
        {staff && <p className="mt-1.5 text-xs text-fg-muted">Doorline staff can’t type a link password — make one up or use Same as …</p>}
      </fieldset>
      <label className="block">
        <span className={fieldLabel}>Expires</span>
        <Select value={days} onChange={(e) => setDays(Number(e.target.value))} className="mt-1 w-full">
          <ExpiryOptions tz={tz} />
        </Select>
      </label>
      {shownError &&
        (createErrorText(shownError) ? <ErrorBanner>{createErrorText(shownError)}</ErrorBanner> : <ErrorBanner title="Couldn’t create the link." error={shownError} />)}
      <Button type="submit" loading={create.isPending} disabled={!picked}>
        Create link
      </Button>
    </form>
  );
};

// ── Its link: the address, the password, the state (§D1) ──────────────────────────────────────────

const LinkManager = ({ link, did, campaignId, tz, staff, oldLinkWorks, copy, copied, onDid, onBusy, onDeleting, onChanged }) => {
  const now = Date.now();
  const url = shareUrl(window.location.origin, link.token);
  const [panel, setPanel] = useState(null); // 'password' | 'extend' | 'renew' | null
  const [confirm, setConfirm] = useState(null); // 'rotate' | 'delete' | null
  const { shown, show, hide } = useLinkPassword({ onChanged });
  // Where the keyboard goes when the button it was on goes with its own press (hooks.js useFocusAfter,
  // code review V2-1): to the button that stays in its place — Copy link once Turn on or Unlock now
  // lands; Extend once Renew lands, or once an Extend date closes its panel; New address or Delete link
  // once its confirm closes; Copy password, or Change password, once Show's answer replaces Show; the
  // panel's first choice when Change password opens it, and Change password again when it's cancelled;
  // Extend or Renew when its panel is closed. (Delete link's own next stop is Share's: this part goes
  // with the link.) Each control is found by its data-link-action.
  const focusAfter = useFocusAfter();
  const rootRef = useRef(null);
  const control = (name) => rootRef.current?.querySelector(`[data-link-action="${name}"]`) || null;
  const focusOn = (name) => focusAfter(() => control(name) || undefined);
  // Turn on, Unlock now, Extend and Renew, whose refusals read under the buttons. New address and Delete
  // link are requests of their own, so a refusal shows only in the confirm that sent it (code review
  // CC-2).
  const act = useLinkAction({ campaignId, linkId: link.id, onChanged });
  const rotateM = useLinkAction({ campaignId, linkId: link.id, onChanged });
  const deleteM = useLinkAction({ campaignId, linkId: link.id, onChanged });
  // A password change holds Share open until its answer (with the new password) lands.
  const change = useLinkAction({ campaignId, linkId: link.id, onChanged, onBusy });
  // A confirm or a panel opens clean: an earlier refusal never greets it (CC-2). A request still on its
  // way is left alone — its answer (a new password, say) is still to land.
  const opening = () => [act, rotateM, deleteM, change].forEach((m) => !m.isPending && m.reset());
  const openPanel = (which) => {
    opening();
    setPanel(which);
    // Change password's panel takes its button's place: the keyboard goes to the panel's first choice.
    if (which === 'password') focusAfter(() => rootRef.current?.querySelector('input[name="change-password"]') || undefined);
  };
  const openConfirm = (which) => {
    opening();
    setConfirm(which);
  };
  // An expired link is only ever renewed (ADMINUX-8): Renew gives it a new address and a new year,
  // while New address keeps the expiry — its address would be dead on arrival — and Unlock would clear a
  // lock on a link nobody can open.
  const expired = isExpired(link, now);
  const locked = !expired && isLocked(link, now);
  const badges = linkBadges(link, { now, tz });
  const failures = failureLine(link.failures, tz);
  const advice = lockAdvice(link, now);
  const fewer = did?.ending === 'changed' ? fewerChangedLine(did.offered, did.changed) : null;
  // The password made up, typed or changed here — or, for staff, who are never sent one, who can see it.
  const reveal = did?.reveal && (did.password || staff) ? did : null;
  // Why the password can't be shown: the row says so (an old link Doorline kept no copy of, or staff),
  // or Show's answer did.
  const hidden = link.passwordViewable === false ? link.passwordHiddenReason || 'unavailable' : shown?.status === 'unavailable' || shown?.status === 'staff' ? shown.status : null;
  // Each closes only its own panel or confirm: a Change password opened meanwhile stays open. `next`
  // names the button that takes the keyboard once the one pressed has gone with its success.
  const run = (vars, next) => {
    focusOn(next);
    act.mutate(vars, { onSuccess: () => setPanel((p) => (p === 'extend' || p === 'renew' ? null : p)) });
  };
  const closeConfirm = (which) => () => setConfirm((c) => (c === which ? null : c));
  const closePanel = (back) => () => {
    setPanel(null);
    focusOn(back);
  };
  const cancelConfirm = (back) => () => {
    setConfirm(null);
    focusOn(back);
  };
  const savePassword = (body, { alsoChanged }) => {
    // The count the "Also change it" line offered: the answer's `changed` is held against it, since two
    // changes at once can split the links without either seeing a skip.
    const offered = alsoChanged ? Number(link.samePasswordCount) || 0 : 0;
    // The panel goes with its answer: the new password's Copy password takes the keyboard as it appears;
    // Doorline staff, who are never sent one, get Copy link, as after Create (CC-6).
    focusOn('copy');
    change.mutate(
      { method: 'PATCH', body: { ...body, ...(alsoChanged ? { alsoChanged: true } : {}) } },
      {
        onSuccess: (res) => {
          hide();
          setPanel((p) => (p === 'password' ? null : p));
          onDid({
            linkId: link.id,
            ending: 'changed',
            reveal: true,
            password: res?.password || body.password || null,
            offered,
            changed: alsoChanged ? (res?.changed ?? null) : null,
          });
        },
      }
    );
  };

  return (
    <div ref={rootRef} className="space-y-4" data-link-id={link.id}>
      <div>
        <div className={fieldLabel}>Link</div>
        <div className="mt-1.5 flex items-center gap-2">
          <code className={address} title={url}>
            {shortUrl(url)}
          </code>
          <Button size="sm" variant="secondary" data-link-action="copy" onClick={() => copy(url, 'url')}>
            {copied === 'url' ? 'Copied!' : 'Copy link'}
          </Button>
        </div>
      </div>

      <div>
        <div className={fieldLabel}>Password</div>
        <div className="mt-1.5 space-y-2">
          {reveal ? (
            <PasswordReveal password={reveal.password} copied={copied === 'pw'} onCopy={() => copy(reveal.password, 'pw')} />
          ) : hidden ? (
            <p className="text-xs text-fg-muted">
              {hidden === 'staff'
                ? 'Doorline staff can’t view link passwords.'
                : 'This link’s password can’t be shown. To have one you can see, change it — then send your client the new password.'}
            </p>
          ) : shown?.status === 'shown' ? (
            // Copy password copies what's on screen, at the click — never after a request, which Safari
            // refuses to let write the clipboard.
            <div className="flex flex-wrap items-center gap-2">
              <code className="rounded border border-border bg-sunken px-2 py-1 text-sm font-medium text-fg">{shown.password}</code>
              <Button size="sm" variant="secondary" data-link-action="copy-password" onClick={() => copy(shown.password, 'pw')}>
                {copied === 'pw' ? 'Copied!' : 'Copy password'}
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <code aria-hidden="true" className="rounded border border-border bg-sunken px-2 py-1 text-sm text-fg-muted">
                ••••••••••••
              </code>
              <Button
                size="sm"
                variant="secondary"
                loading={shown?.status === 'loading'}
                onClick={() => {
                  show(link.id);
                  focusAfter(() => control('copy-password') || control('password'));
                }}
              >
                {shown?.status === 'loading' ? 'Showing…' : shown?.status === 'failed' ? 'Try again' : 'Show'}
              </Button>
              {shown?.status === 'failed' && (
                <span role="alert" className="text-xs text-danger-fg">
                  Couldn’t show the password.
                </span>
              )}
            </div>
          )}
          {fewer && <p className="text-xs text-warning-fg">{fewer}</p>}
          {panel === 'password' ? (
            <ChangePasswordPanel
              staff={staff}
              also={alsoChangeLine(link)}
              oldLink={oldLinkWorks}
              busy={change.isPending}
              error={change.error}
              onCancel={closePanel('password')}
              onSave={savePassword}
            />
          ) : (
            <Button size="sm" variant="secondary" data-link-action="password" onClick={() => openPanel('password')}>
              Change password
            </Button>
          )}
        </div>
      </div>

      <div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-muted">
          {badges.map((b) => (
            <Badge key={b.key} variant={b.variant} dot>
              {b.label}
            </Badge>
          ))}
          {link.expiresAt && (
            <span>
              · {expired ? 'Expired' : 'Expires'} {formatDayOf(link.expiresAt, tz)}
            </span>
          )}
          <span>· {link.lastAccessedAt ? `Last opened ${formatDayOf(link.lastAccessedAt, tz)}` : 'Not opened yet'}</span>
        </div>
        {/* What each badge means, in a sentence; then the wrong passwords, muted, whenever there are any —
            on a locked or expired link too (WALK-2); then what a lock says to do. */}
        <div className="mt-1.5 space-y-1 text-xs">
          {badges
            .filter((b) => b.detail)
            .map((b) => (
              <p key={b.key} className={badgeTone(b.variant)}>
                {b.detail}
              </p>
            ))}
          {failures && <p className="text-fg-muted">{failures}.</p>}
          {advice && <p className={TONE[advice.tone]}>{advice.text}</p>}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {!link.isActive && (
            <Button
              size="sm"
              loading={act.isPending && act.variables?.body?.isActive === true}
              onClick={() => run({ method: 'PATCH', body: { isActive: true } }, 'copy')}
            >
              Turn on
            </Button>
          )}
          {expired ? (
            <Button
              size="sm"
              variant={link.isActive ? 'primary' : 'secondary'}
              data-link-action="renew"
              onClick={() => (panel === 'renew' ? setPanel(null) : openPanel('renew'))}
            >
              Renew
            </Button>
          ) : (
            <Button size="sm" variant="secondary" data-link-action="extend" onClick={() => (panel === 'extend' ? setPanel(null) : openPanel('extend'))}>
              Extend
            </Button>
          )}
          {locked && (
            <Button size="sm" variant="secondary" loading={act.isPending && act.variables?.path === '/unlock'} onClick={() => run({ path: '/unlock' }, 'copy')}>
              Unlock now
            </Button>
          )}
          {!expired && (
            <Button size="sm" variant={locked || link.rotateAdvice ? 'primary' : 'secondary'} data-link-action="rotate" onClick={() => openConfirm('rotate')}>
              New address
            </Button>
          )}
          <Button size="sm" variant="danger" data-link-action="delete" onClick={() => openConfirm('delete')}>
            Delete link
          </Button>
        </div>
        {act.error && !confirm && (
          <div className="mt-2">
            <ErrorBanner error={act.error} />
          </div>
        )}
        {panel === 'extend' && (
          <ExtendPanel
            share={link}
            tz={tz}
            busy={act.isPending}
            onCancel={closePanel('extend')}
            onPick={(days) => run({ path: '/extend', body: { expiresInDays: days } }, 'extend')}
          />
        )}
        {panel === 'renew' && (
          <RenewPanel
            share={link}
            tz={tz}
            busy={act.isPending}
            onCancel={closePanel('renew')}
            onRenew={(days) => run({ path: '/renew', body: { expiresInDays: days } }, 'extend')}
          />
        )}
        {/* Each confirm says what the server does (linkState.js words them, from the share routes). */}
        {confirm === 'rotate' && (
          <InlineConfirm
            title={NEW_ADDRESS_TITLE}
            confirmLabel="New address"
            busy={rotateM.isPending}
            error={rotateM.error}
            onCancel={cancelConfirm('rotate')}
            onConfirm={() => {
              focusOn('rotate');
              rotateM.mutate({ path: '/rotate' }, { onSuccess: closeConfirm('rotate') });
            }}
          >
            {rotateConfirmLines(link, { now, tz }).map((line) => (
              <p key={line}>{line}</p>
            ))}
          </InlineConfirm>
        )}
        {confirm === 'delete' && (
          <InlineConfirm
            title={DELETE_LINK_TITLE}
            confirmLabel="Delete link"
            danger
            busy={deleteM.isPending}
            error={deleteM.error}
            onCancel={cancelConfirm('delete')}
            onConfirm={() => {
              onDeleting();
              deleteM.mutate({ method: 'DELETE' }, { onSuccess: closeConfirm('delete') });
            }}
          >
            <p>{DELETE_LINK_TEXT}</p>
          </InlineConfirm>
        )}
      </div>
    </div>
  );
};

// ── A second link, from before one link per report (§C2): "Also opens this report: Board · made Oct 25" ──

// `focusAfter` is Share's (hooks.js useFocusAfter): Cancel hands the keyboard back to this link's Delete,
// and `onDeleting` names where it goes once a Delete takes this line away.
const ExtraLink = ({ link, campaignId, tz, focusAfter, onDeleting, onChanged }) => {
  const [confirm, setConfirm] = useState(false);
  const act = useLinkAction({ campaignId, linkId: link.id, onChanged });
  const rowRef = useRef(null);
  // Its confirm opens clean: a Delete refused before, then cancelled, isn't shown in it again (CC-2).
  const ask = () => {
    if (!act.isPending) act.reset();
    setConfirm(true);
  };
  const cancel = () => {
    setConfirm(false);
    focusAfter(() => rowRef.current?.querySelector('button') || null);
  };
  return (
    <li ref={rowRef} className="text-xs text-fg-muted" data-extra-link={link.id}>
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        <span>{extraLinkLine(link, tz)}</span>
        <span aria-hidden="true">·</span>
        <button type="button" className="font-semibold text-danger-fg underline-offset-2 hover:underline" onClick={ask}>
          Delete
        </button>
      </div>
      {confirm && (
        <InlineConfirm
          title={DELETE_LINK_TITLE}
          confirmLabel="Delete link"
          danger
          busy={act.isPending}
          error={act.error}
          onCancel={cancel}
          onConfirm={() => {
            onDeleting();
            act.mutate({ method: 'DELETE' });
          }}
        >
          <p>{DELETE_LINK_TEXT}</p>
        </InlineConfirm>
      )}
    </li>
  );
};

export default ShareDialog;
