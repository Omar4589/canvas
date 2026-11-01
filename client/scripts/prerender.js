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
  fs.writeFileSync(path.join(OUT, page.file), html);
  console.log(`prerendered ${page.path} → dist/.prerendered/${page.file} (${Math.round(html.length / 1024)} KB)`);
}
