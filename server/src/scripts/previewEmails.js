#!/usr/bin/env node
// Render every transactional email to HTML you can open in a browser — WITHOUT SENDING ANYTHING.
//
//   npm run mail:preview          → writes .preview-emails/ and prints the index path
//   npm run mail:preview -- --open  → also opens it (macOS)
//
// No database, no RESEND_API_KEY, no network. It imports services/mail/templates.js directly and
// writes what the mailer WOULD have handed to Resend, so what you see here is byte-for-byte what
// gets sent. Both the HTML and the plain-text alternative, per template.
//
// Why this exists: the only other ways to see an email were to send one (and read it in the Resend
// dashboard, whose preview pane blocks remote images, so the logo always looks broken there) or to
// read the template source and imagine it. Neither tells you whether the real thing renders.
//
// LOGO CHECK: the brand row loads `${WEB_ORIGIN}/apple-touch-icon.png` over the network. Point
// WEB_ORIGIN at whatever origin you want to verify —
//   WEB_ORIGIN=http://localhost:5173 npm run mail:preview   (checks your local dev asset)
//   npm run mail:preview                                    (defaults to https://doorline.app)
// — and the preview page reports whether that URL actually resolves, since a 404 there is exactly
// the bug that makes a broken-image icon show up in everyone's inbox.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import * as t from '../services/mail/templates.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, '../../.preview-emails');
const ORIGIN = process.env.WEB_ORIGIN || 'https://doorline.app';
const LOGO_URL = `${ORIGIN}/apple-touch-icon.png`;

// One realistic call per template. Values are deliberately awkward — a name with an apostrophe, an
// org with an ampersand — so the escaping is visible rather than assumed.
const IN_72_HOURS = 'https://doorline.app/reset-password/OhwRnKCXZ_sTeB7QqeU8UIhD6NVOVWFVprMAqH1EBPY';
const SAMPLES = [
  ['passwordReset', 'Password reset', () => t.passwordReset({
    firstName: 'Stephen', resetUrl: IN_72_HOURS,
  })],
  // Role pairs. A canvasser works in the mobile app and gets install links; an admin or lead works
  // in the web console and must NOT. Both variants render here so the branch is eyeballable — the
  // admin ones pass `role` explicitly rather than relying on undefined, so a regression that
  // inverted the test would be visible rather than silently passing.
  ['inviteSetPassword_canvasser', 'Invite — canvasser (app)', () => t.inviteSetPassword({
    firstName: 'Stephen', orgName: 'Fox Bryant LLC',
    campaignName: 'Florida - HD54 Randy Maggard', setPasswordUrl: IN_72_HOURS, role: 'canvasser',
  })],
  ['inviteSetPassword', 'Invite — admin (console)', () => t.inviteSetPassword({
    firstName: 'Stephen', orgName: 'Fox Bryant LLC',
    campaignName: 'Florida - HD54 Randy Maggard', setPasswordUrl: IN_72_HOURS, role: 'admin',
  })],
  ['inviteSetPassword_noCampaign', 'Invite — no campaign', () => t.inviteSetPassword({
    firstName: "O'Brien", orgName: 'Smith & Sons Consulting', setPasswordUrl: IN_72_HOURS, role: 'admin',
  })],
  ['addedToOrg_canvasser', 'Added to an org — canvasser (app)', () => t.addedToOrg({
    firstName: 'Stephen', orgName: 'Fox Bryant LLC', campaignName: 'Florida - HD54 Randy Maggard',
    role: 'canvasser',
  })],
  ['addedToOrg', 'Added to an org — admin (console)', () => t.addedToOrg({
    firstName: 'Stephen', orgName: 'Fox Bryant LLC', campaignName: 'Florida - HD54 Randy Maggard',
    role: 'admin',
  })],
  ['addedToCampaign_canvasser', 'Added to a campaign — canvasser (app)', () => t.addedToCampaign({
    firstName: 'Stephen', orgName: 'Fox Bryant LLC', campaignName: 'Florida - HD54 Randy Maggard',
    role: 'canvasser',
  })],
  ['addedToCampaign', 'Added to a campaign — lead (console)', () => t.addedToCampaign({
    firstName: 'Stephen', orgName: 'Fox Bryant LLC', campaignName: 'Florida - HD54 Randy Maggard',
    role: 'lead',
  })],
  ['provisioningWelcome', 'New client welcome', () => t.provisioningWelcome({
    firstName: 'Stephen', orgName: 'Fox Bryant LLC', setPasswordUrl: IN_72_HOURS,
  })],
  ['supportGrantNotice', 'Support access granted', () => t.supportGrantNotice({
    orgName: 'Fox Bryant LLC', staffFirstName: 'Omar',
    reason: 'Investigating a reported import mismatch',
    expiresAt: new Date(Date.now() + 3 * 86400000),
  })],
  ['windDownWarning', 'Wind-down deletion warning', () => t.windDownWarning({
    orgName: 'Fox Bryant LLC', deleteOnDate: new Date(Date.now() + 14 * 86400000),
  })],
  ['dormancyWarning', 'Dormancy deletion warning', () => t.dormancyWarning({
    orgName: 'Fox Bryant LLC', deleteOnDate: new Date(Date.now() + 30 * 86400000),
  })],
  // The only template addressed to US. Awkward values on purpose, like the rest: an apostrophe in
  // the name, an ampersand in the org, and a multi-line message — the newline→<br /> conversion in
  // the HTML half is the bit worth actually looking at.
  ['demoRequest', 'Demo request (inbound, to us)', () => t.demoRequest({
    name: "Dana O'Neill",
    email: 'dana@bryant-fox.org',
    organization: 'Bryant & Fox Strategies',
    teamSize: '20–50 canvassers',
    message: 'We run three state races this cycle.\nCan you walk us through turf cutting?',
  })],
];

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

async function checkLogo() {
  try {
    const res = await fetch(LOGO_URL, { method: 'GET' });
    const bytes = (await res.arrayBuffer()).byteLength;
    const type = res.headers.get('content-type') || '';
    const ok = res.ok && type.startsWith('image/');
    return { ok, detail: `HTTP ${res.status} · ${type || 'no content-type'} · ${bytes} bytes` };
  } catch (err) {
    return { ok: false, detail: `request failed — ${err.message}` };
  }
}

const rendered = [];
for (const [slug, label, make] of SAMPLES) {
  const { subject, html, text } = make();
  rendered.push({ slug, label, subject, html, text });
}

fs.rmSync(OUT_DIR, { recursive: true, force: true });
fs.mkdirSync(OUT_DIR, { recursive: true });
for (const r of rendered) {
  fs.writeFileSync(path.join(OUT_DIR, `${r.slug}.html`), r.html);
  fs.writeFileSync(path.join(OUT_DIR, `${r.slug}.txt`), r.text);
}

const logo = await checkLogo();

// The index: every email rendered inline in its own iframe, so one scroll shows the whole set and
// the logo either loads or visibly doesn't.
const index = `<!doctype html>
<html><head><meta charset="utf-8"><title>Doorline email previews</title>
<style>
  body { margin:0; padding:24px; background:#f4f5f7; font:14px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; color:#1c1c1e; }
  h1 { font-size:20px; margin:0 0 4px; }
  .sub { color:#6b7280; margin:0 0 20px; }
  .banner { border-radius:8px; padding:12px 14px; margin:0 0 20px; font-size:13px; }
  .ok { background:#dcfce7; border:1px solid #86efac; color:#14532d; }
  .bad { background:#fee2e2; border:1px solid #fca5a5; color:#7f1d1d; }
  .card { background:#fff; border:1px solid #e5e7eb; border-radius:12px; margin:0 0 20px; overflow:hidden; }
  .hd { padding:12px 16px; border-bottom:1px solid #e5e7eb; display:flex; gap:12px; align-items:baseline; flex-wrap:wrap; }
  .hd b { font-size:15px; }
  .subj { color:#6b7280; font-size:13px; }
  .links { margin-left:auto; font-size:12px; }
  .links a { color:#c62828; margin-left:10px; }
  iframe { width:100%; border:0; display:block; background:#fff; }
</style></head><body>
<h1>Doorline email previews</h1>
<p class="sub">Rendered from <code>services/mail/templates.js</code>. Nothing was sent. Logo origin: <code>${esc(ORIGIN)}</code></p>
<div class="banner ${logo.ok ? 'ok' : 'bad'}">
  <b>${logo.ok ? '✓ Logo resolves' : '✗ LOGO IS BROKEN'}</b> — <code>${esc(LOGO_URL)}</code><br>${esc(logo.detail)}
  ${logo.ok ? '' : '<br><br>Every email will show a broken-image icon until this URL returns a real image. Check that <code>client/public/apple-touch-icon.png</code> is deployed at that origin, and that <code>WEB_ORIGIN</code> is set correctly on the server.'}
</div>
${rendered.map((r) => `
<div class="card">
  <div class="hd">
    <b>${esc(r.label)}</b>
    <span class="subj">${esc(r.subject)}</span>
    <span class="links"><a href="${r.slug}.html" target="_blank">HTML</a><a href="${r.slug}.txt" target="_blank">Plain text</a></span>
  </div>
  <iframe src="${r.slug}.html" onload="this.style.height=(this.contentDocument.body.scrollHeight+24)+'px'"></iframe>
</div>`).join('')}
</body></html>`;

const indexPath = path.join(OUT_DIR, 'index.html');
fs.writeFileSync(indexPath, index);

console.log(`\n${rendered.length} templates rendered → ${indexPath}`);
console.log(logo.ok ? `Logo OK: ${LOGO_URL} (${logo.detail})` : `LOGO BROKEN: ${LOGO_URL} — ${logo.detail}`);
console.log(`\n  open ${indexPath}\n`);

if (process.argv.includes('--open')) execFile('open', [indexPath]);
