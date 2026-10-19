import mongoose from 'mongoose';
import { z } from 'zod';
import { isoDateSchema } from '../../utils/validators.js';
import { CONVERTIBLE_SOURCES } from './reclassifyOutcomes.js';

// The Door Outcomes page's wire SCOPE — the filter the entries table shows and every write
// re-resolves (services/canvass/entryScope.js). One schema for every router that takes it: the
// outcome routes (routes/admin/campaigns.js) and answer edits (routes/admin/answerEdits.js), so a
// scope one accepts the other can't refuse, and neither can drift from the table.
//
// Date bounds are `dateFrom`/`dateTo`, NOT from/to — those two already name the OUTCOMES being
// converted, and one body carries both.
export const objectIdish = z.string().refine((v) => mongoose.isValidObjectId(v), 'Invalid id');
export const entryScopeSchema = z.object({
  // CONVERTIBLE_SOURCES, not RECLASSIFIABLE_OUTCOMES: the same scope object drives the entries
  // TABLE, which lists surveyed rows so they can be handed to the survey-conversion routes below.
  // The plain reclassify path stays safe without a second schema — buildEntryFilter intersects
  // these against its own RECLASSIFIABLE_OUTCOMES default, so asking it for surveyed rows resolves
  // to an empty selection (a 400) rather than to a bare flip.
  outcomes: z.array(z.enum(CONVERTIBLE_SOURCES)).optional(),
  userId: objectIdish.optional(),
  effortId: objectIdish.optional(),
  passId: objectIdish.optional(),
  // isoDateSchema, not a bare string: these are civil 'YYYY-MM-DD' days resolved in the
  // campaign's timezone, and an unparseable one used to reach Mongoose as an Invalid Date and
  // surface as a 500. A malformed filter must refuse, never silently become "no filter" — that
  // shows MORE rows than the filter claims, and under "Select all N" writes them.
  dateFrom: isoDateSchema.optional(),
  dateTo: isoDateSchema.optional(),
  // The survey-answer filter. Wire shape B — the AnswerFilters.jsx / SavedSearch shape — so the
  // picker component and answerFilterClause consume it untranslated. surveyTemplateId scopes the
  // match to the RESPONSE's template (slugs are unique only within one survey); required-with-
  // answers is enforced in resolveEntryScope, not here, so the refusal carries a real code.
  surveyTemplateId: objectIdish.optional(),
  answerFilters: z
    .array(
      z.object({
        questionKey: z.string().min(1),
        values: z.array(z.string()).max(200).default([]),
        texts: z.array(z.string()).max(200).optional(),
      })
    )
    .max(25)
    .optional(),
  answerTagFilters: z.array(z.object({ tag: z.string().min(1) })).max(25).optional(),
  // Address search — resolved to door ids inside resolveEntryScope (it NARROWS, so it must ride
  // the scope every write re-resolves, never be a table-only nicety).
  search: z.string().trim().min(1).max(120).optional(),
});
