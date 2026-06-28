// Survey tags (Phase 3). A tag is a label applied to answer options ACROSS questions,
// so reports + walk lists can roll up everyone who picked ANY option carrying that tag.
// Matching/grouping/dedup are CASE-INSENSITIVE: the canonical key is trim()+toLowerCase(),
// while the survey's `tags` palette and each option's `tag` preserve a display casing.
// See docs/SURVEYS.md.

export function normalizeTag(s) {
  return String(s == null ? '' : s).trim().toLowerCase();
}

// Build a map of normalizedTag -> { display, members: [{ questionKey, optionId, text }] }
// from a survey template. RETIRED options are included — their historical answers still
// count toward the tag. The display casing is the first one encountered for that key.
export function tagOptionMap(template) {
  const map = new Map();
  for (const q of template?.questions || []) {
    for (const o of q.options || []) {
      const key = normalizeTag(o.tag);
      if (!key) continue;
      let entry = map.get(key);
      if (!entry) {
        entry = { display: String(o.tag).trim(), members: [] };
        map.set(key, entry);
      }
      entry.members.push({ questionKey: q.key, optionId: o.id, text: o.text });
    }
  }
  return map;
}

// The distinct display tags actually applied to a template's options, sorted. (The
// survey's `tags` palette may list more than are currently used; reporting keys off
// what's actually on options.)
export function paletteTags(template) {
  return [...tagOptionMap(template).values()]
    .map((e) => e.display)
    .sort((a, b) => a.localeCompare(b));
}

// Canonicalize a survey's tag palette + each option's tag for saving: dedup the palette
// case-insensitively (first casing wins as the display form) and rewrite every option.tag
// to the palette's canonical casing. Returns { tags, questions } (questions cloned shallowly
// with canonicalized option tags). Tags only ever present on choice options survive.
export function canonicalizeTags(questions, declaredTags = []) {
  const display = new Map(); // normalized -> display casing
  const register = (raw) => {
    const key = normalizeTag(raw);
    if (!key) return null;
    if (!display.has(key)) display.set(key, String(raw).trim());
    return display.get(key);
  };
  for (const t of declaredTags || []) register(t);
  const nextQuestions = (questions || []).map((q) => ({
    ...q,
    options: (q.options || []).map((o) => {
      const canon = register(o.tag);
      return canon ? { ...o, tag: canon } : { ...o, tag: null };
    }),
  }));
  return { tags: [...display.values()], questions: nextQuestions };
}
