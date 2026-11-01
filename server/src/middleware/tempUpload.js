import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The Voter Import's upload storage: multer's diskStorage, plus the one thing diskStorage leaves behind.
// When the browser goes away in the middle of an upload (a closed tab, a dropped connection, Node's request
// timeout), multer removes only the files it has finished receiving, so diskStorage's half-written file
// stayed in the temp dir, its write stream open, until the dyno restarted: part of a voter file, which the
// privacy record (v5 2026-08-04, "transient voter-file copies on dyno ephemeral disk") says is deleted on a
// client abort too. Busboy fails the file stream with an error when the request goes away; that's when this
// closes the stream and deletes the file. A file cut off at the size limit is finished, not failed, and
// multer removes it through _removeFile as before.
export const makeTempUploadStorage = ({ destination = os.tmpdir() } = {}) => ({
  _handleFile(req, file, cb) {
    const filename = crypto.randomBytes(16).toString('hex');
    const filePath = path.join(destination, filename);
    const out = fs.createWriteStream(filePath);
    let settled = false;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      out.destroy();
      fs.unlink(filePath, () => cb(err));
    };
    file.stream.once('error', fail);
    out.once('error', fail);
    out.once('finish', () => {
      if (settled) return;
      settled = true;
      cb(null, { destination, filename, path: filePath, size: out.bytesWritten });
    });
    file.stream.pipe(out);
  },
  _removeFile(req, file, cb) {
    const filePath = file.path;
    delete file.destination;
    delete file.filename;
    delete file.path;
    fs.unlink(filePath, cb);
  },
});

export const tempUploadStorage = makeTempUploadStorage();
