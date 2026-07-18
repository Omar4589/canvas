import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as templates from '../src/services/mail/templates.js';
import { sendMail, mailEnabled } from '../src/services/mail/mailer.js';

// Render every transactional email template with realistic sample data into a single
// self-contained HTML page you can open in a browser — a dev tool for eyeballing the
// templates without wiring up a real inbox.
//
//   node scripts/renderEmailPreviews.js                 # write scripts/email-previews.html
//   node scripts/renderEmailPreviews.js --send you@x.io # also loop each example through sendMail()
//
// Zero external dependencies (node builtins only). Importing the templates + mailer must NOT
// require a DB connection — the mailer is dormant by default and touches no models — so this
// script runs standalone with no mongod. --send works in dormant mode too: with RESEND_API_KEY /
// MAIL_FROM unset, sendMail() logs the intent and stashes it on the in-memory outbox instead of
// hitting the network.
//
// SAFETY NOTE on the preview page: an email body is HTML, and org/campaign/person names are
// customer-typed. The templates already esc() every interpolated value into their HTML. This
// script then escapes a SECOND time on the way into the page: the rendered email goes inside an
// <iframe srcdoc="…"> (escaped for the attribute), the subject + plain-text go through the same
// entity escaper before landing in page text. The browser decodes the srcdoc attribute exactly
// once, which un-does our second pass and leaves the templates' single-escaped HTML — so a hostile
// name like `<script>` shows as visible text in the frame and never executes. The last example
// proves it end-to-end.

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log('Usage: node scripts/renderEmailPreviews.js [--send you@example.com]');
  process.exit(0);
}

// --send you@example.com  (also accepts --send=you@example.com)
let sendTo = null;
const sendIdx = args.findIndex((a) => a === '--send' || a.startsWith('--send='));
if (sendIdx !== -1) {
  const a = args[sendIdx];
  sendTo = a.includes('=') ? a.slice(a.indexOf('=') + 1) : args[sendIdx + 1];
  if (!sendTo || sendTo.startsWith('-')) {
    console.error('--send requires an email address, e.g. --send you@example.com');
    process.exit(1);
  }
}

// ---- entity escape (page context AND the srcdoc attribute; both need the full 5-char pass) ----
const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ESC_MAP[c]);
}

// ---- realistic sample data ----
// 32 random bytes → 43-char base64url token, the shape of a real reset/set-password token.
const token = () => randomBytes(32).toString('base64url');
const resetUrl = `https://doorline.app/reset-password/${token()}`;
const setPasswordUrl = `https://doorline.app/set-password/${token()}`;
const provisionUrl = `https://doorline.app/set-password/${token()}`;

const DAY = 86_400_000;
const in7 = new Date(Date.now() + 7 * DAY); // support grants are short-lived
const in30 = new Date(Date.now() + 30 * DAY); // deletion warnings ~a month out

const ORG = 'Riverbend Campaign Co.';
const CAMPAIGN = 'District 7 Fall Canvass';

// The hostile input: tags must render as visible text, `&` must survive, and the CR/LF must not
// break anything. Rendered through addedToOrg so the org name lands in the subject, the heading,
// and the body all at once.
const HOSTILE_ORG = '<script>alert(1)</script> & Sons\r\n';

// Each example: a label + a one-line note about what it demonstrates, plus the rendered template.
const examples = [
  {
    name: 'passwordReset',
    note: 'Forgot-password link. Expires in 1 hour, single use.',
    ...templates.passwordReset({ firstName: 'Maria', resetUrl }),
  },
  {
    name: 'inviteSetPassword — with campaign',
    note: 'New user invited to an org AND a campaign in one go.',
    ...templates.inviteSetPassword({ firstName: 'James', orgName: ORG, campaignName: CAMPAIGN, setPasswordUrl }),
  },
  {
    name: 'inviteSetPassword — org only',
    note: 'Same invite, no campaign — the campaign line is omitted.',
    ...templates.inviteSetPassword({ firstName: 'James', orgName: ORG, setPasswordUrl }),
  },
  {
    name: 'addedToOrg — with campaign',
    note: 'Existing Doorline user gains access to another org + a campaign.',
    ...templates.addedToOrg({ firstName: 'Priya', orgName: ORG, campaignName: CAMPAIGN }),
  },
  {
    name: 'addedToOrg — org only',
    note: 'Same, org access only — no campaign line.',
    ...templates.addedToOrg({ firstName: 'Priya', orgName: ORG }),
  },
  {
    name: 'addedToCampaign',
    note: 'Existing member added to a campaign within their org.',
    ...templates.addedToCampaign({ firstName: 'Diego', orgName: ORG, campaignName: 'Re-elect Sofia Ramirez' }),
  },
  {
    name: 'provisioningWelcome',
    note: 'First admin of a freshly provisioned org.',
    ...templates.provisioningWelcome({ firstName: 'Sarah', orgName: 'Harbor City Voter Project', setPasswordUrl: provisionUrl }),
  },
  {
    name: 'supportGrantNotice',
    note: 'Customer notice that Doorline support was granted temporary access.',
    ...templates.supportGrantNotice({
      orgName: ORG,
      staffFirstName: 'Tariq',
      reason: 'Investigating a reported sync issue with imported walk lists.',
      expiresAt: in7,
    }),
  },
  {
    name: 'windDownWarning',
    note: 'Subscription canceled — data deletion scheduled unless reactivated.',
    ...templates.windDownWarning({ orgName: ORG, deleteOnDate: in30 }),
  },
  {
    name: 'dormancyWarning',
    note: 'Long-inactive org — data deletion scheduled, auto-canceled on activity.',
    ...templates.dormancyWarning({ orgName: ORG, deleteOnDate: in30 }),
  },
  {
    name: 'HOSTILE INPUT — addedToOrg',
    note: 'orgName = `<script>alert(1)</script> & Sons\\r\\n`. The tags MUST show as text, never run.',
    ...templates.addedToOrg({ firstName: 'Marcus', orgName: HOSTILE_ORG, campaignName: 'Ward 5 & 6 Push' }),
  },
];

// ---- build the preview page ----
function section(ex, i) {
  const id = `ex-${i + 1}`;
  // A tiny reset in the frame so the email's own gray page-bg fills edge-to-edge (kills the
  // default 8px body margin). The email html is a fragment; the browser wraps it in a document.
  const frameDoc = `<meta charset="utf-8"><style>html,body{margin:0;padding:0}</style>${ex.html}`;
  return `
    <section id="${id}">
      <h2>${i + 1}. ${escHtml(ex.name)}</h2>
      <p class="note">${escHtml(ex.note)}</p>
      <p class="subject"><span class="label">Subject</span> ${escHtml(ex.subject)}</p>
      <iframe title="${escHtml(ex.name)}" loading="lazy" srcdoc="${escHtml(frameDoc)}"></iframe>
      <details>
        <summary>Plain-text version</summary>
        <pre>${escHtml(ex.text)}</pre>
      </details>
      <p class="back"><a href="#top">↑ back to top</a></p>
    </section>`;
}

const index = examples
  .map((ex, i) => `<li><a href="#ex-${i + 1}">${escHtml(ex.name)}</a></li>`)
  .join('\n        ');

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Doorline email previews</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 32px 24px 64px;
    font: 15px/1.5 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    color: #1f2937; background: #f3f4f6;
  }
  .wrap { max-width: 720px; margin: 0 auto; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .meta { color: #6b7280; font-size: 13px; margin: 0 0 24px; }
  nav { background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px 16px; margin: 0 0 32px; }
  nav ol { margin: 0; padding-left: 20px; }
  nav li { margin: 2px 0; }
  nav a, .back a { color: #b91c1c; text-decoration: none; }
  nav a:hover, .back a:hover { text-decoration: underline; }
  section { margin: 0 0 40px; padding: 0 0 8px; border-bottom: 1px solid #e5e7eb; }
  h2 { font-size: 16px; margin: 0 0 4px; }
  .note { color: #6b7280; font-size: 13px; margin: 0 0 10px; }
  .subject { font-size: 13px; margin: 0 0 12px; word-break: break-word; }
  .subject .label {
    display: inline-block; font-size: 11px; text-transform: uppercase; letter-spacing: .04em;
    color: #6b7280; border: 1px solid #e5e7eb; border-radius: 4px; padding: 1px 6px; margin-right: 6px;
  }
  iframe { width: 620px; max-width: 100%; height: 700px; border: 1px solid #d1d5db; border-radius: 6px; background: #fff; display: block; }
  details { margin: 10px 0 0; }
  summary { cursor: pointer; color: #6b7280; font-size: 13px; }
  pre {
    margin: 8px 0 0; padding: 12px; overflow-x: auto;
    background: #fff; border: 1px solid #e5e7eb; border-radius: 6px;
    font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: #374151;
    white-space: pre-wrap; word-break: break-word;
  }
  .back { font-size: 12px; margin: 12px 0 0; }
</style>
</head>
<body>
<div class="wrap">
  <a id="top"></a>
  <h1>Doorline transactional email previews</h1>
  <p class="meta">Generated ${escHtml(new Date().toISOString())} · ${examples.length} examples · dev tool (not a product surface)</p>
  <nav>
    <strong>Index</strong>
    <ol>
        ${index}
    </ol>
  </nav>
${examples.map(section).join('\n')}
</div>
</body>
</html>
`;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.join(__dirname, 'email-previews.html');
fs.writeFileSync(outPath, page, 'utf8');

console.log(`Wrote ${examples.length} email previews → ${outPath}`);
console.log(`Open it in your browser:  open "${outPath}"`);

// ---- optional: run the same examples through the real mailer ----
async function send() {
  console.log('');
  if (mailEnabled()) {
    console.log(`--send: mail is ENABLED — real Resend sends will be attempted → ${sendTo}`);
  } else {
    console.log(`--send: mail is DORMANT (no RESEND_API_KEY/MAIL_FROM) — each send is logged and stashed on the in-memory outbox, no network → ${sendTo}`);
  }
  for (const ex of examples) {
    const res = await sendMail({ to: sendTo, subject: ex.subject, html: ex.html, text: ex.text, kind: 'preview' });
    const status = res.sent ? 'SENT' : res.disabled ? 'dormant' : 'not-sent';
    const err = res.error ? `  (${res.error})` : '';
    console.log(`  [${status}] ${ex.name} :: ${ex.subject}${err}`);
  }
}

async function main() {
  if (sendTo) await send();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
