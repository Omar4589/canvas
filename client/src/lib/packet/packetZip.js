// The plan for a per-packet download: which files a multi-packet run becomes, and what each
// one is named. Pure — the page renders the PDFs and zips; this decides the shape, so the
// naming rules stay testable without jsPDF.
//
// One file per packet, exactly one packet per file. A field director hands each volunteer a
// file (or a printout of one), so the unit of download matches the unit of custody — the same
// reasoning as the manifest sheet. The combined single PDF remains what a one-packet run
// downloads; only runs of several packets become a ZIP.

import { packetFilename } from './packetPdf.js';

const singleBookPayload = (payload, book) => ({
  ...payload,
  books: [book],
  totals: {
    books: 1,
    doors: book.doorCount || (book.doors || []).length,
    voters: book.voterCount || 0,
    omitted: book.omitted?.total || 0,
  },
});

// entries: [{ name, payload }] — one per packet, names deduped; a run may legitimately hold
// two books named the same (two rounds' "Book 3" can't meet in one run, but user-renamed
// books can collide), and two identical names in a ZIP silently overwrite on extract.
export const packetZipPlan = (payload, settings) => {
  const seen = new Map();
  const entries = (payload.books || []).map((book) => {
    const single = singleBookPayload(payload, book);
    let name = packetFilename(single, settings);
    const n = (seen.get(name) || 0) + 1;
    seen.set(name, n);
    if (n > 1) name = name.replace(/\.pdf$/, `-${n}.pdf`);
    return { name, payload: single };
  });
  return {
    entries,
    zipName: packetFilename(payload, settings).replace(/\.pdf$/, '.zip'),
  };
};
