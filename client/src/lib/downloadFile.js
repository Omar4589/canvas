import { getToken, getActiveOrgId } from '../api/client.js';

// THE file-saving module for the web client. Every "put a file on the user's disk" path goes
// through `saveBlob` at the bottom of it — the anchor dance was hand-rolled in ten places, and
// six of those copies clicked a DETACHED <a>, which Chrome tolerates and Firefox does not.
//
// Pick the entry point by what you already hold:
//   downloadFile(path, {fallbackName})  — the server has the bytes (authed fetch, attachment)
//   saveCsvRows(rows, name)             — you have a 2-D array of cells
//   saveTextFile(text, name, mime)      — you have exact bytes that must not be reformatted
//   saveBlob(blob, name)                — you already built a Blob (a ZIP, a rendered PDF)
//
// NOT a member: components/packet/PaperPreview.jsx also calls URL.createObjectURL, deliberately.
// Its URL feeds an on-screen <iframe> and has its own lifecycle (revoke-on-replace, revoke-on-
// unmount) so a slow render can't paint over a newer one. It is a preview, not a download —
// routing it through here would try to save the preview to disk.

/**
 * The one place an object URL becomes a saved file. Attaching to the document before
 * clicking is load-bearing, not ceremony: a detached anchor's click() is ignored by
 * Firefox.
 */
export const saveBlob = (blob, fileName) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

/** Save bytes a caller has already composed — no reformatting, no re-quoting. */
export const saveTextFile = (text, fileName, mime = 'text/csv;charset=utf-8') =>
  saveBlob(new Blob([text], { type: mime }), fileName);

/**
 * Rows of cells → CSV text. Every cell is quoted and its own quotes doubled, which is the
 * cheapest correct answer for cells that may contain commas, quotes or newlines.
 *
 * `?? ''` matters: one of the two copies this replaces used a bare `String(c)`, so an empty
 * cell in the BILLING STATEMENT csv rendered as the literal text "null".
 */
export const csvRowsToText = (rows) =>
  rows
    .map((r) => r.map((c) => `"${String(c ?? '').replaceAll('"', '""')}"`).join(','))
    .join('\n');

/** Build a CSV from rows of cells and save it. */
export const saveCsvRows = (rows, fileName) => saveTextFile(csvRowsToText(rows), fileName);

/**
 * The server's chosen filename, out of a Content-Disposition header — plain `filename="x"`
 * or RFC 5987 `filename*=UTF-8''x`. Falls back when the header is missing or nameless, so a
 * download always lands with a sensible name rather than "download".
 */
export const filenameFromDisposition = (header, fallback) => {
  const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(header || '');
  if (!m) return fallback;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    // A literal '%' in the filename is not valid percent-encoding — keep the raw name
    // rather than throwing a URIError out of a download.
    return m[1];
  }
};

/**
 * Authenticated attachment download — the api() helper is JSON-only (it consumes every body
 * as text), so attachments need a raw fetch with the auth headers attached by hand.
 *
 * `path` is API-relative and must NOT start with /api — this prepends it.
 *
 * Throws Error(`Download failed: ${status}`) — callers own the busy/error UI. When the
 * server answers with JSON (a 409/410 with an error message), that message is thrown
 * instead so the user sees "This export has expired…" rather than a bare status code.
 * Returns the resolved filename.
 */
export const downloadFile = async (path, { fallbackName = 'download.csv' } = {}) => {
  const headers = {};
  const token = getToken();
  const orgId = getActiveOrgId();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (orgId) headers['X-Org-Id'] = orgId;
  const res = await fetch(`/api${path}`, { headers });
  if (!res.ok) {
    let message = `Download failed: ${res.status}`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      // non-JSON error body — keep the status message
    }
    throw new Error(message);
  }
  const blob = await res.blob();
  const fileName = filenameFromDisposition(res.headers.get('Content-Disposition'), fallbackName);
  saveBlob(blob, fileName);
  return fileName;
};
