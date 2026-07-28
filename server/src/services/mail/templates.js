// Transactional email templates. Each returns { subject, html, text }: `html` for rich clients,
// `text` a complete standalone plain-text alternative (readable on its own, no HTML dependency).
//
// Everything a template needs is INLINED. Email clients strip <style> and <head>, so the layout is
// table-based and every rule is an inline style. The brand row is the real logomark PNG (served
// from the public site — SVG is stripped by Gmail, data: URIs too) PLUS the styled TEXT
// "Doorline" beside it: clients that block remote images by default still show the text, so the
// brand never disappears. The PNG has a white background, which is why the brand row lives INSIDE
// the white card. Light theme only — the brand's red on near-white.
//
// esc() is applied to EVERY interpolated customer-typed value in the HTML (names, org names, campaign
// names, reasons). Those strings originate from user input; an email body is HTML, so an un-escaped
// name is an injection into the customer's inbox. The plain-text alternative and the Subject are NOT
// HTML — they carry the raw value; the mailer strips control chars from the Subject on the way out.

import { installLinks } from '../../config/storeLinks.js';

// Brand tokens (mirror the web design tokens; hard-coded here because email has no stylesheet).
const ACCENT = '#DC2626';
const PAGE_BG = '#F9FAFB';
const CARD_BG = '#FFFFFF';
const TEXT = '#111827';
const MUTED = '#6B7280';
const BORDER = '#E5E7EB';
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ESC_MAP[c]);
}

// "August 15, 2026" — long-form en-US. Accepts a Date or an ISO/parseable string. UTC so the rendered
// day is deterministic regardless of the server's local zone.
function longDate(d) {
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt.getTime())) return '';
  return dt.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

// ---- small HTML builders (keep every template consistent without repeating inline styles) ----

function heading(html) {
  return `<h1 style="margin:0 0 16px;font-family:${FONT};font-size:20px;line-height:28px;font-weight:700;color:${TEXT};">${html}</h1>`;
}
function para(html) {
  return `<p style="margin:0 0 16px;font-family:${FONT};font-size:15px;line-height:23px;color:${TEXT};">${html}</p>`;
}
function muted(html) {
  return `<p style="margin:0 0 8px;font-family:${FONT};font-size:13px;line-height:20px;color:${MUTED};">${html}</p>`;
}

// Bulletproof-ish button: a padded anchor styled inline (accent background, white text). Clients that
// strip anchor styling still get the raw URL printed beneath, so the link is never lost.
function button(label, url) {
  const safeUrl = esc(url);
  return `
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 20px;">
        <tr>
          <td align="center" bgcolor="${ACCENT}" style="border-radius:8px;">
            <a href="${safeUrl}" style="display:inline-block;padding:12px 28px;font-family:${FONT};font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">${esc(label)}</a>
          </td>
        </tr>
      </table>
      <p style="margin:0 0 4px;font-family:${FONT};font-size:13px;line-height:20px;color:${MUTED};">Or paste this link into your browser:</p>
      <p style="margin:0 0 16px;font-family:${FONT};font-size:13px;line-height:20px;word-break:break-all;"><a href="${safeUrl}" style="color:${ACCENT};">${safeUrl}</a></p>`;
}

// "Doorline is a phone app" — the install block for a CANVASSER, whose work happens entirely in
// the mobile app while the set-password link in this very email opens a browser.
//
// Deliberately NOT two more button() calls: that helper prints an "Or paste this link into your
// browser:" echo under each one, and a second accent-filled button would compete with the
// email's real CTA ("Set your password"). Bordered links instead — present, clearly secondary.
function appLinks() {
  const { ios, android } = installLinks();
  const link = (label, url) =>
    `<a href="${esc(url)}" style="display:inline-block;margin:0 8px 8px 0;padding:9px 16px;font-family:${FONT};font-size:14px;font-weight:600;color:${TEXT};text-decoration:none;border:1px solid ${BORDER};border-radius:8px;">${esc(label)}</a>`;
  return (
    para('<strong>Doorline is a phone app</strong> — that’s where you knock doors. The web dashboard is only for admins and team leads.') +
    `      <p style="margin:0 0 8px;">${link('Get it for iPhone', ios)}${link('Get it for Android', android)}</p>\n` +
    muted('Free on the App Store and Google Play — if a link doesn’t open, search for “Doorline” in your phone’s app store.')
  );
}

// The plain-text half of appLinks(). Returns lines to spread into a template's `text` array,
// matching the existing `...(campaignName ? [...] : [])` idiom. URLs are RAW here — only the HTML
// side escapes them (same split as button()), which matters the moment a Play URL carries `&`.
function appLinksText() {
  const { ios, android } = installLinks();
  return [
    '',
    'Doorline is a phone app — that’s where you knock doors. The web dashboard is only for admins and team leads.',
    '',
    `iPhone:  ${ios}`,
    `Android: ${android}`,
    '',
    'Free on the App Store and Google Play — if a link doesn’t open, search for “Doorline” in your phone’s app store.',
  ];
}

// Does this recipient work in the app rather than the console? Explicit equality, NOT
// `!isConsoleRole(role)`: that helper is client-side only, and an un-updated call site passing
// `undefined` must render exactly today's email. Fails safe — an admin is never told to install
// a field app.
function isFieldRole(role) {
  return role === 'canvasser';
}

// The logomark PNG, served from the public site (client/public/apple-touch-icon.png — the
// red door-pin on white). 180×180 source shown at 36×36 = crisp on retina. Prod origin by
// default so an email rendered anywhere points at the real asset.
function logoUrl() {
  return `${process.env.WEB_ORIGIN || 'https://doorline.app'}/apple-touch-icon.png`;
}

// Shared shell: page-bg table → centered white card (brand row + body) → muted footer. The
// brand row = logomark <img> + TEXT wordmark side by side; alt is empty on purpose (the text
// beside it IS the accessible name — an alt would read "Doorline Doorline" in screen readers
// and render doubled when images are blocked).
function layout(bodyHtml) {
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PAGE_BG};margin:0;padding:24px 0;">
  <tr>
    <td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
        <tr><td style="background:${CARD_BG};border:1px solid ${BORDER};border-radius:12px;padding:28px 32px 32px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;">
            <tr>
              <td style="vertical-align:middle;padding-right:8px;">
                <img src="${logoUrl()}" width="36" height="36" alt="" style="display:block;border:0;" />
              </td>
              <td style="vertical-align:middle;">
                <span style="font-family:${FONT};font-size:22px;font-weight:700;color:${ACCENT};letter-spacing:-0.5px;">Doorline</span>
              </td>
            </tr>
          </table>
${bodyHtml}
        </td></tr>
        <tr><td style="padding:16px 8px;font-family:${FONT};font-size:12px;line-height:18px;color:${MUTED};">
          Doorline — canvassing for campaigns. You received this because your email is associated with a Doorline account.
        </td></tr>
      </table>
    </td>
  </tr>
</table>`.trim();
}

// "Hi Sam," / "Hi," — firstName is customer-typed, so escape it.
function greeting(firstName) {
  return firstName ? `Hi ${esc(firstName)},` : 'Hi,';
}

// ---- templates (exact set) ----

export function passwordReset({ firstName, resetUrl }) {
  const subject = 'Reset your Doorline password';
  const html = layout(
    heading('Reset your password') +
    para(`${greeting(firstName)} we received a request to reset your Doorline password.`) +
    button('Reset password', resetUrl) +
    para('This link expires in 1 hour and can only be used once.') +
    muted("If you didn't request this, you can ignore this email — your password is unchanged.")
  );
  const text = [
    `${firstName ? `Hi ${firstName},` : 'Hi,'} we received a request to reset your Doorline password.`,
    '',
    'Reset it here (this link expires in 1 hour and can only be used once):',
    resetUrl,
    '',
    "If you didn't request this, you can ignore this email — your password is unchanged.",
    '',
    '— Doorline',
  ].join('\n');
  return { subject, html, text };
}

// `role` decides whether the recipient is pointed at the app or the console. Omitting it renders
// the console version — see isFieldRole().
export function inviteSetPassword({ firstName, orgName, campaignName, setPasswordUrl, role }) {
  const subject = `Set your password for ${orgName} on Doorline`;
  const field = isFieldRole(role);
  const campaignLineHtml = campaignName
    ? para(`You've also been added to the <strong>${esc(campaignName)}</strong> campaign.`)
    : '';
  const html = layout(
    heading(`You've been added to ${esc(orgName)}`) +
    para(`${greeting(firstName)} you've been added to <strong>${esc(orgName)}</strong> on Doorline.`) +
    campaignLineHtml +
    para('Set your password to get started. This link is valid for 72 hours.') +
    button('Set your password', setPasswordUrl) +
    // After the CTA, never before it: setting the password is step one for everyone, and it's
    // the same link whichever device they finish on.
    (field ? appLinks() : '') +
    muted('For your security, this email never contains a password — you choose your own at the link above.')
  );
  const text = [
    `${firstName ? `Hi ${firstName},` : 'Hi,'} you've been added to ${orgName} on Doorline.`,
    ...(campaignName ? [`You've also been added to the ${campaignName} campaign.`] : []),
    '',
    'Set your password to get started (this link is valid for 72 hours):',
    setPasswordUrl,
    ...(field ? appLinksText() : []),
    '',
    'For your security, this email never contains a password — you choose your own at the link above.',
    '',
    '— Doorline',
  ].join('\n');
  return { subject, html, text };
}

export function addedToOrg({ firstName, orgName, campaignName, role }) {
  const subject = `You've been added to ${orgName} on Doorline`;
  const field = isFieldRole(role);
  const campaignLineHtml = campaignName
    ? para(`You've also been added to the <strong>${esc(campaignName)}</strong> campaign.`)
    : '';
  const html = layout(
    heading(`You've been added to ${esc(orgName)}`) +
    para(`${greeting(firstName)} your Doorline account now has access to <strong>${esc(orgName)}</strong>.`) +
    campaignLineHtml +
    // "switch into it" is a CONSOLE concept (the org picker) and means nothing to a canvasser,
    // who has no console to switch inside.
    (field
      ? para('Sign in with your existing email and password — no new credentials needed.') + appLinks()
      : para('Sign in to Doorline with your existing email and password, then switch into it — no new credentials needed.'))
  );
  const text = [
    `${firstName ? `Hi ${firstName},` : 'Hi,'} your Doorline account now has access to ${orgName}.`,
    ...(campaignName ? [`You've also been added to the ${campaignName} campaign.`] : []),
    '',
    field
      ? 'Sign in with your existing email and password — no new credentials needed.'
      : 'Sign in to Doorline with your existing email and password, then switch into it — no new credentials needed.',
    ...(field ? appLinksText() : []),
    '',
    '— Doorline',
  ].join('\n');
  return { subject, html, text };
}

export function addedToCampaign({ firstName, orgName, campaignName, role }) {
  const subject = `You've been added to ${campaignName}`;
  const field = isFieldRole(role);
  // "start canvassing" was the most wrong-footed line in the whole set: it named the action and
  // then pointed nowhere — a canvasser cannot canvass from the web console at all.
  const signIn = field
    ? 'Sign in with your existing email and password to start canvassing.'
    : 'Sign in to Doorline with your existing email and password.';
  const html = layout(
    heading(`You've been added to ${esc(campaignName)}`) +
    para(`${greeting(firstName)} you've been added to the <strong>${esc(campaignName)}</strong> campaign in <strong>${esc(orgName)}</strong> on Doorline.`) +
    para(signIn) +
    (field ? appLinks() : '')
  );
  const text = [
    `${firstName ? `Hi ${firstName},` : 'Hi,'} you've been added to the ${campaignName} campaign in ${orgName} on Doorline.`,
    '',
    signIn,
    ...(field ? appLinksText() : []),
    '',
    '— Doorline',
  ].join('\n');
  return { subject, html, text };
}

export function provisioningWelcome({ firstName, orgName, setPasswordUrl }) {
  const subject = 'Welcome to Doorline';
  const html = layout(
    heading('Welcome to Doorline') +
    para(`${greeting(firstName)} welcome to Doorline. We've created <strong>${esc(orgName)}</strong> for you.`) +
    para('Set your password to sign in and get started. This link is valid for 72 hours.') +
    button('Set your password', setPasswordUrl) +
    muted('For your security, this email never contains a password — you choose your own at the link above.')
  );
  const text = [
    `${firstName ? `Hi ${firstName},` : 'Hi,'} welcome to Doorline. We've created ${orgName} for you.`,
    '',
    'Set your password to sign in and get started (this link is valid for 72 hours):',
    setPasswordUrl,
    '',
    'For your security, this email never contains a password — you choose your own at the link above.',
    '',
    '— Doorline',
  ].join('\n');
  return { subject, html, text };
}

export function supportGrantNotice({ orgName, staffFirstName, reason, expiresAt }) {
  const subject = `Support access granted for ${orgName}`;
  const when = longDate(expiresAt);
  const html = layout(
    heading('Temporary support access granted') +
    para(`A Doorline support staff member, <strong>${esc(staffFirstName)}</strong>, was granted temporary access to your organization's data (<strong>${esc(orgName)}</strong>).`) +
    para(`Reason: ${esc(reason)}`) +
    para(`This access expires on ${esc(when)}.`) +
    muted('Every access to your data is logged and reviewable on request.')
  );
  const text = [
    `A Doorline support staff member, ${staffFirstName}, was granted temporary access to your organization's data (${orgName}).`,
    '',
    `Reason: ${reason}`,
    `This access expires on ${when}.`,
    '',
    'Every access to your data is logged and reviewable on request.',
    '',
    '— Doorline',
  ].join('\n');
  return { subject, html, text };
}

export function windDownWarning({ orgName, deleteOnDate }) {
  const subject = `Action needed: ${orgName} data will be deleted`;
  const when = longDate(deleteOnDate);
  const html = layout(
    heading('Your subscription was canceled') +
    para(`The Doorline subscription for <strong>${esc(orgName)}</strong> has been canceled.`) +
    para(`Your organization's data is scheduled to be <strong>permanently deleted on ${esc(when)}</strong> unless the subscription is reactivated.`) +
    para('Until then, you can still sign in and <strong>export your data</strong> — walk lists, reports, and CSV downloads all work in read-only mode.') +
    para('To keep your data, reactivate your subscription — sign in to Doorline, or reply to this email and we can help.')
  );
  const text = [
    `The Doorline subscription for ${orgName} has been canceled.`,
    '',
    `Your organization's data is scheduled to be permanently deleted on ${when} unless the subscription is reactivated.`,
    '',
    'Until then, you can still sign in and export your data — walk lists, reports, and CSV downloads all work in read-only mode.',
    '',
    'To keep your data, reactivate your subscription — sign in to Doorline, or reply to this email and we can help.',
    '',
    '— Doorline',
  ].join('\n');
  return { subject, html, text };
}

export function dormancyWarning({ orgName, deleteOnDate }) {
  const subject = `Action needed: ${orgName} data will be deleted`;
  const when = longDate(deleteOnDate);
  const html = layout(
    heading('Your organization has been inactive') +
    para(`We haven't seen any activity in <strong>${esc(orgName)}</strong> on Doorline for a long time.`) +
    para(`Its data is scheduled to be <strong>permanently deleted on ${esc(when)}</strong>.`) +
    para('The deletion is canceled automatically — any recorded canvassing activity, or simply reactivating your use of the account, stops it. You do not need to reply.')
  );
  const text = [
    `We haven't seen any activity in ${orgName} on Doorline for a long time.`,
    '',
    `Its data is scheduled to be permanently deleted on ${when}.`,
    '',
    'The deletion is canceled automatically — any recorded canvassing activity, or simply reactivating your use of the account, stops it. You do not need to reply.',
    '',
    '— Doorline',
  ].join('\n');
  return { subject, html, text };
}
