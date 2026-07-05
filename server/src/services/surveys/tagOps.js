// Org-level tag library operations (Phase 3.1). A tag's display name is stored as a
// STRING in exactly THREE homes — survey palettes (SurveyTemplate.tags), survey option
// tags (SurveyTemplate.questions[].options[].tag), and saved-search filters
// (SavedSearch.filter.answerTagFilters[].tag) — so rename/merge/delete are a bounded bulk
// rewrite over those three. The Tag collection is the managed picklist; the reporting
// rollup (answerAgg.answerTagClause / tags.tagOptionMap) reads option.tag unchanged.
import { SurveyTemplate } from '../../models/SurveyTemplate.js';
import { SavedSearch } from '../../models/SavedSearch.js';
import { Tag } from '../../models/Tag.js';
import { normalizeTag } from './tags.js';

// Rewrite every occurrence whose normalized key === fromKey to `toDisplay`, across all
// three homes for the org. Survey palettes are de-duped case-insensitively after the
// rewrite (so a merge collapses A+B in a survey that used both). Returns counts touched.
export async function rewriteTag(orgId, fromKey, toDisplay) {
  let surveys = 0;
  let options = 0;
  let savedSearches = 0;

  const templates = await SurveyTemplate.find({ organizationId: orgId });
  for (const t of templates) {
    let changed = false;
    for (const q of t.questions || []) {
      for (const o of q.options || []) {
        if (o.tag && normalizeTag(o.tag) === fromKey) {
          o.tag = toDisplay;
          options += 1;
          changed = true;
        }
      }
    }
    if (Array.isArray(t.tags) && t.tags.length) {
      const seen = new Set();
      const next = [];
      for (const tag of t.tags) {
        const display = normalizeTag(tag) === fromKey ? toDisplay : tag;
        const nk = normalizeTag(display);
        if (!nk || seen.has(nk)) continue;
        seen.add(nk);
        next.push(display);
      }
      if (next.length !== t.tags.length || next.some((v, i) => v !== t.tags[i])) {
        t.tags = next;
        changed = true;
      }
    }
    if (changed) {
      surveys += 1;
      await t.save();
    }
  }

  const walklists = await SavedSearch.find({ organizationId: orgId });
  for (const w of walklists) {
    const tfs = (w.filter && w.filter.answerTagFilters) || [];
    let changed = false;
    for (const tf of tfs) {
      if (tf.tag && normalizeTag(tf.tag) === fromKey) {
        tf.tag = toDisplay;
        changed = true;
      }
    }
    if (changed) {
      w.markModified('filter');
      savedSearches += 1;
      await w.save();
    }
  }

  return { surveys, options, savedSearches };
}

export async function renameTag(orgId, tag, newName) {
  const display = String(newName).trim();
  const counts = await rewriteTag(orgId, tag.normalizedName, display);
  tag.name = display;
  tag.normalizedName = normalizeTag(display);
  await tag.save();
  return counts;
}

// Merge `sourceTag` INTO `targetTag`: rewrite all source occurrences to the target's
// display, then delete the source Tag doc.
export async function mergeTags(orgId, sourceTag, targetTag) {
  const counts = await rewriteTag(orgId, sourceTag.normalizedName, targetTag.name);
  await sourceTag.deleteOne();
  return counts;
}

// Delete a tag: null its option.tag, drop it from palettes + saved-search filters, then
// delete the Tag doc. Returns the usage that was cleared.
export async function deleteTag(orgId, tag) {
  const key = tag.normalizedName;
  let surveys = 0;
  let options = 0;
  let savedSearches = 0;

  const templates = await SurveyTemplate.find({ organizationId: orgId });
  for (const t of templates) {
    let changed = false;
    for (const q of t.questions || []) {
      for (const o of q.options || []) {
        if (o.tag && normalizeTag(o.tag) === key) {
          o.tag = null;
          options += 1;
          changed = true;
        }
      }
    }
    if (Array.isArray(t.tags) && t.tags.some((x) => normalizeTag(x) === key)) {
      t.tags = t.tags.filter((x) => normalizeTag(x) !== key);
      changed = true;
    }
    if (changed) {
      surveys += 1;
      await t.save();
    }
  }

  const walklists = await SavedSearch.find({ organizationId: orgId });
  for (const w of walklists) {
    const tfs = (w.filter && w.filter.answerTagFilters) || [];
    const next = tfs.filter((tf) => normalizeTag(tf.tag) !== key);
    if (next.length !== tfs.length) {
      w.filter.answerTagFilters = next;
      w.markModified('filter');
      savedSearches += 1;
      await w.save();
    }
  }

  await tag.deleteOne();
  return { surveys, options, savedSearches };
}

// Per-tag usage across the org: Map<normalizedKey, { surveys, options, savedSearches }>.
export async function tagUsage(orgId) {
  const usage = new Map();
  const bump = (key, field) => {
    if (!usage.has(key)) usage.set(key, { surveys: 0, options: 0, savedSearches: 0 });
    usage.get(key)[field] += 1;
  };
  const templates = await SurveyTemplate.find({ organizationId: orgId }, 'questions tags').lean();
  for (const t of templates) {
    const surveyKeys = new Set();
    for (const q of t.questions || []) {
      for (const o of q.options || []) {
        const k = normalizeTag(o.tag);
        if (k) {
          bump(k, 'options');
          surveyKeys.add(k);
        }
      }
    }
    for (const k of surveyKeys) bump(k, 'surveys');
  }
  const walklists = await SavedSearch.find({ organizationId: orgId }, 'filter.answerTagFilters').lean();
  for (const w of walklists) {
    for (const tf of (w.filter && w.filter.answerTagFilters) || []) {
      const k = normalizeTag(tf.tag);
      if (k) bump(k, 'savedSearches');
    }
  }
  return usage;
}

// Upsert org Tag docs for the given display names (idempotent; the unique index keeps it
// dedup-safe). Called on survey save so the library stays complete for API/legacy writes.
export async function ensureTags(orgId, names, createdBy = null) {
  for (const name of new Set((names || []).map((n) => String(n || '').trim()).filter(Boolean))) {
    const normalizedName = normalizeTag(name);
    if (!normalizedName) continue;
    await Tag.updateOne(
      { organizationId: orgId, normalizedName },
      { $setOnInsert: { organizationId: orgId, name, normalizedName, createdBy } },
      { upsert: true }
    );
  }
}
