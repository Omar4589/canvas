// Which server endpoints can a shipped mobile bundle break on?
//
// The trap this exists for: "I only touched /admin routes, not mobile routes." The mobile app has a
// whole admin section (books, turf, timeline, audit, users, flags, reports) and it calls ~56
// /admin/* endpoints. Editing one of those is a mobile-facing change even though nothing under
// server/src/routes/mobile/ moved.
//
// Why that matters: phones run whatever JS they last received. Remove a field or tighten a
// required param and they get cryptic 4xx instead of the clean "Update required" wall — which is
// what CLIENT_API_VERSION / MIN_CLIENT_API_VERSION exist to give them (see CLAUDE.md).
//
// This is a REVIEW PROMPT, not a proof. It resolves each route file to its real mount prefix by
// parsing routes/index.js, so it will not miss a file whose own paths are all params (the reason
// tail-matching failed here first: admin/memberships.js defines `/:userId`, and the entire
// `/admin/memberships` prefix lives in the mount, not the file). What it still cannot see is a
// response-SHAPE change — only that a file mobile depends on moved. Read the diff yourself; this
// tells you which files deserve that read.
//
//   npm run audit:mobile-api             # what mobile calls, and which of your uncommitted changes touch it
//   npm run audit:mobile-api -- main     # ...against a git ref instead
//   npm run audit:mobile-api -- --list   # just print the surface

import { execFileSync } from 'child_process';
import { readdirSync, readFileSync, statSync } from 'fs';
import path from 'path';

const args = process.argv.slice(2);
const listOnly = args.includes('--list');
const ref = args.find((a) => !a.startsWith('--'));

const walk = (dir, out = []) => {
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e.startsWith('.')) continue;
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(js|jsx|mjs)$/.test(e)) out.push(p);
  }
  return out;
};

// Every path the mobile bundle asks for. `api('/x')` is the one client; downloadCsv() is the other.
const mobileCalls = () => {
  const found = new Map();
  for (const f of walk('mobile')) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/(?:api|downloadCsv)\(\s*[`'"]([^`'"]+)/g)) {
      const p = m[1].replace(/\$\{[^}]*\}/g, ':x').split('?')[0].replace(/\/+$/, '');
      if (!p.startsWith('/')) continue;
      if (!found.has(p)) found.set(p, new Set());
      found.get(p).add(path.relative('mobile', f));
    }
  }
  return found;
};

// Resolve each route FILE to the URL prefix it is mounted at, by reading routes/index.js. The
// prefix never appears in the route file itself, so guessing it from the filename would be wrong
// for every router mounted somewhere other than its own name.
const mountPrefixes = () => {
  const src = readFileSync('server/src/routes/index.js', 'utf8');
  const byIdent = new Map();
  for (const m of src.matchAll(/import\s+(\w+)\s+from\s+'\.\/([^']+)'/g)) {
    byIdent.set(m[1], path.posix.join('server/src/routes', m[2]));
  }
  const byFile = new Map();
  for (const m of src.matchAll(/router\.use\(\s*'([^']+)'\s*,\s*([^),\s]+)/g)) {
    const file = byIdent.get(m[2]);
    if (!file) continue;
    if (!byFile.has(file)) byFile.set(file, []);
    byFile.get(file).push(m[1].replace(/:[A-Za-z0-9_]+/g, ':x'));
  }
  return byFile;
};

const changedRouteFiles = () => {
  const cmd = ref ? ['diff', '--name-only', `${ref}...HEAD`] : ['status', '--porcelain'];
  const out = execFileSync('git', cmd, { encoding: 'utf8' });
  const files = ref
    ? out.split('\n')
    : out.split('\n').map((l) => l.slice(3));
  return files.filter((f) => /^server\/src\/(routes|services)\/.*\.js$/.test(f.trim())).map((f) => f.trim());
};

const calls = mobileCalls();
const adminPaths = [...calls.keys()].filter((p) => p.startsWith('/admin')).sort();
const otherPaths = [...calls.keys()].filter((p) => !p.startsWith('/admin')).sort();

console.log(`\nMobile calls ${calls.size} endpoints — ${adminPaths.length} of them under /admin/*.\n`);

if (listOnly) {
  for (const p of [...adminPaths, ...otherPaths]) {
    console.log(`  ${p}\n      ${[...calls.get(p)].sort().join(', ')}`);
  }
  process.exit(0);
}

const changed = changedRouteFiles();
if (!changed.length) {
  console.log('No server route/service files changed — nothing to check.\n');
  process.exit(0);
}

const mounts = mountPrefixes();
const allPaths = [...calls.keys()];

let flagged = 0;
const unresolved = [];
for (const file of changed) {
  const prefixes = mounts.get(file);
  if (!prefixes) {
    // A service, or a router mounted somewhere this script can't see. Can't clear it — say so.
    unresolved.push(file);
    continue;
  }
  const matches = allPaths.filter((p) => prefixes.some((pre) => p === pre || p.startsWith(pre + '/')));
  if (matches.size === 0 && !matches.length) continue;
  flagged++;
  console.log(`⚠️  ${file}`);
  console.log(`    mounted at ${prefixes.join(', ')} — mobile calls ${matches.length} endpoint(s) there:`);
  for (const p of matches.sort()) console.log(`      ${p}`);
  console.log('');
}

if (unresolved.length) {
  console.log('❓ Could not resolve a mount for these — check them by hand:');
  for (const f of unresolved) console.log(`      ${f}`);
  console.log('');
}

if (!flagged && !unresolved.length) {
  console.log(`Checked ${changed.length} changed server file(s). None define an endpoint mobile calls.\n`);
} else if (flagged) {
  console.log(
    'Read those diffs. ADDING a field, endpoint, or optional param is always safe.\n' +
      'REMOVING a field, renaming a route, or making a param required is not — that needs\n' +
      'CLIENT_API_VERSION + MIN_CLIENT_API_VERSION bumped together (CLAUDE.md), and the new\n' +
      'bundle shipped BEFORE the server floor rises.\n'
  );
}
