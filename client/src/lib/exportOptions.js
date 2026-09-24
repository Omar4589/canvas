// Remembered Export Center options, per campaign, per browser. Modelled on
// lib/packet/packetSettings.js — same key shape, same never-throw contract.
//
// SCOPE, deliberately narrow: only the choices the owner asked to be remembered live here. A
// remembered option means two admins can queue "the same" export and get different files, which is
// why the choice is still frozen onto every ExportJob.params row and shown in the history's Scope
// column — the memory is a convenience, the history is the record.
//
// NOT remembered: perVoterRows (it multiplies rows), includeVoterDetail and includeSurveyNote (each
// widens what leaves the building, and each should be a fresh decision).
export const DEFAULT_EXPORT_OPTIONS = Object.freeze({
  // Survey answers on a Canvassing activity export. Remembered because it is the one option people
  // want every time once they want it at all — the whole reason it exists is not needing a second
  // export to read what somebody said.
  includeSurveyAnswers: false,
});

const KEY = (campaignId) => `exportOptions:${campaignId}`;

export const loadExportOptions = (campaignId) => {
  if (!campaignId) return { ...DEFAULT_EXPORT_OPTIONS };
  try {
    const raw = localStorage.getItem(KEY(campaignId));
    if (!raw) return { ...DEFAULT_EXPORT_OPTIONS };
    // Merge onto the defaults so an option added later is never `undefined` at render time.
    return { ...DEFAULT_EXPORT_OPTIONS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_EXPORT_OPTIONS };
  }
};

// Called only after a queue SUCCEEDS — "remembered once you've used it", so an abandoned dialog
// remembers nothing, and unticking then queueing is remembered as off.
export const saveExportOptions = (campaignId, options) => {
  if (!campaignId) return;
  try {
    localStorage.setItem(KEY(campaignId), JSON.stringify({ ...DEFAULT_EXPORT_OPTIONS, ...options }));
  } catch {
    // A full or blocked localStorage must never stop someone exporting.
  }
};
