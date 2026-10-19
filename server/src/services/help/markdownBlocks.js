// Parse a controlled Markdown subset into a small, JSON-serializable BLOCK model that
// the web + mobile Help Centers render with themed components — so neither client needs
// a Markdown dependency and the mobile bundle gains no native module. Content is
// first-party (authored by us from docs/ Part 1), so there is no untrusted-HTML surface.
//
// Block types:
//   { type:'heading', level:2|3, spans }
//   { type:'paragraph', spans }
//   { type:'list', ordered:boolean, items:[spans, spans, …] }
//   { type:'callout', variant:'tip'|'warning'|'note', spans }
//   { type:'code', text }
// A `span` is inline text: { text, bold?, italic?, code?, href? } (flags compose).

// Inline parser — scans left→right, splitting on the nearest of `code`, [link](href),
// **bold**, *italic*/_italic_. Recurses into the marked-up slice so flags nest (a bold
// link, italic inside bold, …). Unmatched markers fall through as literal text.
function parseInline(text) {
  const spans = [];
  let buf = '';
  const flush = () => {
    if (buf) spans.push({ text: buf });
    buf = '';
  };
  let i = 0;
  while (i < text.length) {
    const ch = text[i];

    if (ch === '`') {
      const end = text.indexOf('`', i + 1);
      if (end > i) {
        flush();
        spans.push({ text: text.slice(i + 1, end), code: true });
        i = end + 1;
        continue;
      }
    }

    if (ch === '[') {
      const close = text.indexOf(']', i + 1);
      if (close > i && text[close + 1] === '(') {
        const paren = text.indexOf(')', close + 2);
        if (paren > close) {
          flush();
          const href = text.slice(close + 2, paren);
          for (const s of parseInline(text.slice(i + 1, close))) spans.push({ ...s, href });
          i = paren + 1;
          continue;
        }
      }
    }

    if (ch === '*' && text[i + 1] === '*') {
      const end = text.indexOf('**', i + 2);
      if (end > i) {
        flush();
        for (const s of parseInline(text.slice(i + 2, end))) spans.push({ ...s, bold: true });
        i = end + 2;
        continue;
      }
    }

    if (ch === '*' || ch === '_') {
      const end = text.indexOf(ch, i + 1);
      if (end > i + 1) {
        flush();
        for (const s of parseInline(text.slice(i + 1, end))) spans.push({ ...s, italic: true });
        i = end + 1;
        continue;
      }
    }

    buf += ch;
    i += 1;
  }
  flush();
  return spans.length ? spans : [{ text: '' }];
}

const HEADING = /^(#{1,6})\s+(.*)$/;
const UL = /^\s*[-*]\s+/;
const OL = /^\s*\d+\.\s+/;

export function markdownToBlocks(md) {
  const lines = String(md || '').replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i += 1;
      continue;
    }

    // Fenced code
    if (line.trim().startsWith('```')) {
      const code = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        code.push(lines[i]);
        i += 1;
      }
      i += 1; // closing fence
      blocks.push({ type: 'code', text: code.join('\n') });
      continue;
    }

    // Heading (clamped to h2/h3 — the article title is rendered separately)
    const h = line.match(HEADING);
    if (h) {
      const level = Math.min(3, Math.max(2, h[1].length));
      blocks.push({ type: 'heading', level, spans: parseInline(h[2].trim()) });
      i += 1;
      continue;
    }

    // Blockquote → callout (variant sniffed from a leading Tip/Warning marker)
    if (line.trimStart().startsWith('>')) {
      const quote = [];
      while (i < lines.length && lines[i].trimStart().startsWith('>')) {
        quote.push(lines[i].replace(/^\s*>\s?/, ''));
        i += 1;
      }
      const text = quote.join(' ').trim();
      let variant = 'note';
      if (/^\**\s*(tip|pro tip)/i.test(text)) variant = 'tip';
      else if (/^\**\s*(warning|caution|heads[- ]up)/i.test(text) || text.includes('⚠')) variant = 'warning';
      blocks.push({ type: 'callout', variant, spans: parseInline(text) });
      continue;
    }

    // List (unordered or ordered) — flat only. A wrapped item — an INDENTED line under it that
    // starts no block of its own — continues that item, as in Markdown; without this the second
    // line of a long bullet rendered as a stray paragraph after the list. An unindented line
    // still ends the list (no lazy continuation), so a paragraph written straight after a list
    // keeps reading as one.
    const isUL = UL.test(line);
    const isOL = OL.test(line);
    if (isUL || isOL) {
      const ordered = isOL;
      const re = ordered ? OL : UL;
      const texts = [];
      while (i < lines.length) {
        const l = lines[i];
        if ((ordered ? OL : UL).test(l) && !(ordered ? UL : OL).test(l)) {
          texts.push(l.replace(re, '').trim());
          i += 1;
          continue;
        }
        const continues =
          /^\s+\S/.test(l) && !UL.test(l) && !OL.test(l) && !l.trimStart().startsWith('>') && !l.trim().startsWith('```');
        if (!continues) break;
        texts[texts.length - 1] += ` ${l.trim()}`;
        i += 1;
      }
      blocks.push({ type: 'list', ordered, items: texts.map(parseInline) });
      continue;
    }

    // Paragraph — gather consecutive plain lines
    const para = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !HEADING.test(lines[i]) &&
      !lines[i].trimStart().startsWith('>') &&
      !UL.test(lines[i]) &&
      !OL.test(lines[i]) &&
      !lines[i].trim().startsWith('```')
    ) {
      para.push(lines[i].trim());
      i += 1;
    }
    blocks.push({ type: 'paragraph', spans: parseInline(para.join(' ')) });
  }

  return blocks;
}
