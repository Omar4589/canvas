import { OTHER_OPTION_ID } from './otherOption.js';

// One stored answer rendered for a human — the drill-in list, its CSV, the Door Outcomes
// entries table, and any other per-response readout. Shared so no two surfaces can disagree
// about what an answer "says". (Lifted from routes/admin/reports.js when the Door Outcomes
// table started rendering answers — a route importing from a sibling route was the alternative.)
//
// The capture flow embeds an "Other: ___" write-in INTO the answer snapshot as one of its
// entries, so a raw cell reads "potholes" — indistinguishable from a canonical option someone
// happened to name "potholes". Label just that entry, leaving a multi-select's other picks alone.
export function formatAnswerCell(a) {
  const parts = Array.isArray(a.answer) ? a.answer : a.answer != null ? [a.answer] : [];
  if ((a.optionIds || []).includes(OTHER_OPTION_ID)) {
    const typed = a.otherText || '';
    if (!typed) return parts.join('; ') || 'Other';
    const labeled = parts.map((p) => (p === typed ? `Other — ${typed}` : p));
    if (!parts.includes(typed)) labeled.push(`Other — ${typed}`);
    return labeled.join('; ');
  }
  // Legacy belt-and-braces: only append otherText when it isn't already in the snapshot.
  const base = parts.join('; ');
  return a.otherText && !parts.includes(a.otherText) ? `${base} — ${a.otherText}` : base;
}
