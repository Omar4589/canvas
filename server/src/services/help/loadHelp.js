// Loads the Help Center content library: markdown files under server/src/content/help/,
// each with a small frontmatter header, parsed into the block model (markdownBlocks.js)
// and cached in memory. The files ship with the server (which runs from source — no build
// step), so a server deploy is enough to update BOTH the web console and the installed
// mobile app; no OTA/app release is needed to fix help copy. Precedent for reading bundled
// content at runtime: utils/seedDemoOrg.js.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { markdownToBlocks } from './markdownBlocks.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTENT_DIR = path.resolve(__dirname, '../../content/help');

// Which content audiences each role may see. A lead is a campaign-scoped admin, so they
// see lead + canvasser + all content but NOT org-admin-only topics (billing, user mgmt,
// creating campaigns) which are tagged `admin`. An admin sees everything a lead does plus
// admin. Super sees all incl. platform (`super`).
const AUDIENCE_FOR_ROLE = {
  super: ['all', 'canvasser', 'lead', 'admin', 'super'],
  admin: ['all', 'canvasser', 'lead', 'admin'],
  lead: ['all', 'canvasser', 'lead'],
  canvasser: ['all', 'canvasser'],
};

export function audiencesForRole(role) {
  return AUDIENCE_FOR_ROLE[role] || ['all'];
}

// `--- key: value ---` frontmatter, then the markdown body. Deliberately tiny (no YAML
// dep): one `key: value` per line; `tags` is comma-split, `order` is numeric.
function parseFrontmatter(raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: raw };
  const meta = {};
  for (const line of m[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return { meta, body: m[2] };
}

function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out; // content dir absent (e.g. before authoring) → empty library, not a crash
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full));
    // `_`-prefixed files (e.g. faq/_INBOX.md) are authoring scratch, never served.
    else if (e.name.endsWith('.md') && !e.name.startsWith('_')) out.push(full);
  }
  return out;
}

function loadArticle(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const { meta, body } = parseFrontmatter(raw);
  const folder = path.relative(CONTENT_DIR, file).split(path.sep)[0];
  const kind = meta.kind || folder || 'guide';
  const slug = meta.slug || path.basename(file, '.md');
  return {
    slug,
    title: meta.title || slug,
    audience: (meta.audience || 'all').toLowerCase(),
    kind,
    order: meta.order != null && meta.order !== '' ? Number(meta.order) : 999,
    sourceDoc: meta.sourceDoc || null,
    summary: meta.summary || '',
    tags: meta.tags ? meta.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
    question: meta.question || (kind === 'faq' ? meta.title || null : null),
    blocks: markdownToBlocks(body),
  };
}

let CACHE = null;

function library() {
  if (CACHE) return CACHE;
  const articles = walk(CONTENT_DIR).map(loadArticle);
  articles.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
  CACHE = articles;
  return CACHE;
}

// Test/dev hook — force a re-read (production reads once at first request and caches).
export function reloadHelp() {
  CACHE = null;
  return library();
}

const meta = ({ blocks, ...rest }) => rest; // strip bodies for the index

export function helpIndexForRole(role) {
  const allowed = new Set(audiencesForRole(role));
  return library().filter((a) => allowed.has(a.audience) && a.kind !== 'faq').map(meta);
}

export function helpFaqForRole(role) {
  const allowed = new Set(audiencesForRole(role));
  // FAQ answers are short → return full articles (with blocks) so the client shows them
  // inline without a second round-trip.
  return library().filter((a) => allowed.has(a.audience) && a.kind === 'faq');
}

export function helpArticle(slug, role) {
  const allowed = new Set(audiencesForRole(role));
  const a = library().find((x) => x.slug === slug);
  if (!a || !allowed.has(a.audience)) return null;
  return a;
}
