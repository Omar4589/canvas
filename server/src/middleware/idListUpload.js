import multer from 'multer';

// The file upload for the three Voter-ID list routes — early voting (routes/admin/voted.js), do not
// contact (dnc.js) and walk list from CSV (walklists.js), preview and apply alike.
//
// WHY 50 MB. These routes hold the file in memory and parse every column of every row on the web
// dyno (services/import/parseVoterIdList.js), although only the Voter ID column is used. Measured
// 2026-10-27 on a state absentee file with 85 columns: 50 MB of it peaked near 860 MB, the whole
// 149 MB file near 2.3 GB — on the 1 GB web dyno that serves everyone in the field. The cap stays.
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
