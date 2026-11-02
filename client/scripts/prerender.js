// Prerender the public marketing pages into dist/.prerendered/ — the last step of `npm run build`,
// after the client build and the SSR build of src/entry-prerender.jsx (into .ssr/). server/src/app.js
// serves each file at its page's clean URL; dist/index.html stays the EMPTY shell every console route
// gets. See docs/MARKETING_SITE.md → "Prerendered pages".
//
// It fails the build on any surprise (a missing marker in the shell, a page that rendered nothing):
// a failed Heroku build leaves the running release untouched, while a page that silently fell back to
// the empty shell would undo the whole point unnoticed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const OUT = path.join(DIST, '.prerendered');

const { PAGES, render, headScript } = await import(pathToFileURL(path.join(ROOT, '.ssr', 'entry-prerender.js')).href);
const manifest = JSON.parse(fs.readFileSync(path.join(DIST, '.vite', 'manifest.json'), 'utf8'));
const shell = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');

// A page's chunk and every chunk it statically imports — what main.jsx's import() of the page will
// ask for — minus the entry, which the shell already loads. Preloaded so they arrive alongside the
// entry instead of after it, and the page hydrates sooner.
const chunkFiles = (key, seen = new Set()) => {
  const chunk = manifest[key];
  if (!chunk || chunk.isEntry || seen.has(key)) return [];
  seen.add(key);
  return [chunk.file, ...(chunk.imports || []).flatMap((k) => chunkFiles(k, seen))];
};

const swap = (html, from, to, what) => {
  if (!html.includes(from)) throw new Error(`prerender: ${what} not found in dist/index.html`);
  return html.replace(from, () => to);
};

// The page's own head: index.html's block between the page-head markers (title → JSON-LD), replaced
// whole. Swapping tag by tag couldn't work — three of those tags span several lines — and a half swap
// that left the homepage's canonical beside a noindex could get the HOMEPAGE dropped from search.
const HEAD_START = '<!-- page-head:start';
const HEAD_END = '<!-- page-head:end -->';
const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const OG_IMAGE = 'https://doorline.app/og-image.png';
const OG_ALT = 'Doorline — Door-to-door canvassing software';
const pageHead = (h) =>
  [
    `<!-- page-head (prerendered) -->`,
    `<title>${esc(h.title)}</title>`,
    `<meta name="description" content="${esc(h.description)}" />`,
    `<link rel="canonical" href="${esc(h.url)}" />`,
    ...(h.robots ? [`<meta name="robots" content="${esc(h.robots)}" />`] : []),
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="Doorline" />`,
    `<meta property="og:title" content="${esc(h.ogTitle || h.title)}" />`,
    `<meta property="og:description" content="${esc(h.ogDescription || h.description)}" />`,
    `<meta property="og:url" content="${esc(h.url)}" />`,
    `<meta property="og:image" content="${OG_IMAGE}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="${esc(OG_ALT)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${esc(h.ogTitle || h.title)}" />`,
    `<meta name="twitter:description" content="${esc(h.ogDescription || h.description)}" />`,
    `<meta name="twitter:image" content="${OG_IMAGE}" />`,
    `<meta name="twitter:image:alt" content="${esc(OG_ALT)}" />`,
  ].join('\n    ');
const headBlock = (html) => {
  const start = html.indexOf(HEAD_START);
  const end = html.indexOf(HEAD_END);
  if (start < 0 || end < start) throw new Error('prerender: the page-head markers are missing from dist/index.html');
  return { start, end: end + HEAD_END.length, block: html.slice(start, end + HEAD_END.length) };
};
const shellHead = headBlock(shell).block;
// What a page's head must say, or the build fails: exactly one canonical, its own; noindex exactly
// when its config asks; and a page with no head of its own keeps the shell's untouched.
const checkHead = (page, html) => {
  const canonicals = html.match(/<link rel="canonical"[^>]*>/g) || [];
  const noindex = /<meta name="robots" content="[^"]*noindex/.test(html);
  if (page.head) {
    if (canonicals.length !== 1 || !canonicals[0].includes(`href="${page.head.url}"`)) {
      throw new Error(`prerender: ${page.path} must carry exactly one canonical, ${page.head.url}`);
    }
    if (noindex !== /noindex/.test(page.head.robots || '')) throw new Error(`prerender: ${page.path} noindex doesn't match its config`);
  } else {
    if (headBlock(html).block !== shellHead) throw new Error(`prerender: ${page.path} changed the shell's head`);
    if (noindex) throw new Error(`prerender: ${page.path} must not be noindex`);
  }
};

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const script = headScript();

for (const [name, page] of Object.entries(PAGES)) {
  const markup = render(name);
  if (!markup.includes('<h1')) throw new Error(`prerender: ${page.path} rendered no <h1>`);
  if (!manifest[page.module]) throw new Error(`prerender: ${page.module} is not in the build manifest`);
  const head = [
    ...chunkFiles(page.module).map((f) => `<link rel="modulepreload" crossorigin href="/${f}">`),
    ...(script ? [`<script>${script}</script>`] : []),
  ];
  let html = shell;
  // `marketing` paints <html> and <body> white from the first byte (index.css) — LandingPage keeps it.
  html = swap(html, '<html lang="en">', '<html lang="en" class="marketing">', 'the <html lang="en"> tag');
  html = swap(html, '<div id="root" class="h-full"></div>', `<div id="root" class="h-full" data-prerendered="${name}">${markup}</div>`, 'the empty #root');
  html = swap(html, '</head>', `${head.map((h) => `  ${h}\n`).join('')}  </head>`, '</head>');
  if (page.head) {
    const { start, end } = headBlock(html);
    html = `${html.slice(0, start)}${pageHead(page.head)}${html.slice(end)}`;
  }
  checkHead(page, html);
  fs.writeFileSync(path.join(OUT, page.file), html);
  console.log(`prerendered ${page.path} → dist/.prerendered/${page.file} (${Math.round(html.length / 1024)} KB)`);
}
