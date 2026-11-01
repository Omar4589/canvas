import multer from 'multer';

// The file upload for the three Voter-ID list routes — early voting (routes/admin/voted.js), do not
// contact (dnc.js) and walk list from CSV (walklists.js), preview and apply alike.
//
// WHY 50 MB. The file is held in memory on the web dyno that serves everyone in the field — and,
// while multer joins its pieces, briefly twice. Reading it is cheap since 2026-10-31: a CSV is read
// in pieces keeping only the Voter ID column (services/import/parseVoterIdList.js), where reading it
// whole — every column of every row — took the 1 GB dyno over its quota with a 45 MB early-voting file.
// Measured end to end on the preview route (docs/PERFORMANCE.md, "Voter-ID list uploads"): a 45 MB
// file now peaks about 100 MB above the idle server, was about 610. A bigger cap would cost twice the
// file at that moment, per upload, so it waits for the org-wide upload plan, where statewide files go.
//
// EXCEL TOO. The same 50 MB covers an .xlsx (docs/PROPOSAL_ID_LIST_EXCEL.md). Its reader keeps only the
// columns it needs, in memory; what it bounds instead is what's INSIDE the file — the unpacked tab,
// rows, any one tag — in services/import/readIdColumn.js (ID_LIST_XLSX_LIMITS).
//
// WHY THE WRAPPER. Multer's own refusal is a bare "File too large" that the error handler answers as
// a 500, naming neither the limit nor the fix. This 413 says both, with the code the voter import's
// refusal already uses (routes/admin/imports.js). The web pages check the size the moment a file is
// picked and show the same sentence (client/src/lib/idListPreview.js), because multer drains the
// whole request before it answers: a 149 MB file was uploaded in full just to be refused.
export const ID_LIST_MAX_BYTES = 50 * 1024 * 1024;

export const ID_LIST_TOO_LARGE =
  'This file is over the 50 MB limit. Only the Voter ID column is used, so save a copy with just that column and upload it.';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: ID_LIST_MAX_BYTES } });

export const uploadIdList = (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err?.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: ID_LIST_TOO_LARGE, code: 'file-too-large' });
    }
    next(err);
  });
};
