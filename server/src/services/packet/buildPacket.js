import { Household } from '../../models/Household.js';
import { Voter } from '../../models/Voter.js';
import { Turf } from '../../models/Turf.js';
import { Pass } from '../../models/Pass.js';
import { Effort } from '../../models/Effort.js';
import { SavedSearch } from '../../models/SavedSearch.js';
import { SurveyTemplate } from '../../models/SurveyTemplate.js';
import { VotedVoter } from '../../models/VotedVoter.js';
import { KNOCKABLE_DOOR_FILTER } from '../canvass/knockableDoorFilter.js';
import { getPassStatusMap } from '../passes/passStatus.js';
import { computeWalkOrder } from '../turf/walkOrder.js';

// Assembles the data a PRINTED walk packet needs. Print-only by design: nothing here
// writes, and nothing a volunteer marks on the paper ever comes back (docs/WALK_PACKETS.md).
//
// Three rules this file exists to hold in one place:
//   1. WALK ORDER is Turf.householdIds' own order. A `$in` does NOT preserve argument order,
//      so the rows are re-sorted through a rank map. (routes/admin/turfs.js:1071 drops the
//      sequence exactly this way — that bug is why the re-sort is spelled out below.)
//   2. Do-not-contact is joined LIVE, per voter, at generation time — never trusted from a
//      book's frozen householdIds or a SavedSearch's frozen voterIds. The published policy
//      promises exclusion from "future canvassing lists", and a packet is a canvassing list.
//      A door survives when only SOME of its residents are flagged; the flagged person does not.
//   3. dateOfBirth NEVER leaves this service. Callers get a derived integer age, the same
//      trade routes/admin/walklists.js:254 and routes/mobile/bootstrap.js:38 already make.

export const PACKET_DOOR_CAP = 1200;

// Why a door was held back. Aggregate only — a per-door marker would out the household
// to whoever holds the paper, which services/export/exportScope.js:14 forbids for the
// same reason. `restricted` is deliberately absent: it is a door OUTCOME, not a
// suppression, so restricted doors print.
const omissionReason = (h) => {
  if (h.isActive === false) return 'inactive';
  if (h.fullyDnc === true) return 'doNotContact';
  if (h.fullyVoted === true) return 'alreadyVoted';
  if (h.excludedFromTurf === true) return 'excluded';
  return 'other';
};

const ageOf = (dob) => {
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age -= 1;
  return age >= 0 && age < 130 ? age : null;
};

// "1418 N ORCHARD AVE" -> "N ORCHARD AVE". Purely for the cover's orientation list, so a
// volunteer can answer "am I in the right neighborhood?" without a map. Text only — it
// works for manual-mode books with no boundary and for walk lists with no geometry at all.
const streetOf = (line1) =>
  String(line1 || '')
    .trim()
    .replace(/^\d+[A-Za-z]?\s+/, '')
    .replace(/\s+#.*$/, '')
    .trim() || '(no street)';

const streetSummary = (doors) => {
  const counts = new Map();
  for (const d of doors) {
    const s = streetOf(d.addressLine1);
    counts.set(s, (counts.get(s) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
};

// Retired questions and options stay in reports but must never reach the field — the same
// cut client/src/components/SurveyPreview.jsx makes on screen. visibleIf survives verbatim:
// routes/admin/surveys.js:157 guarantees every rule points at a STRICTLY EARLIER non-retired
// question, so a printed form can be one top-to-bottom column with skip instructions.
const toPrintableSurvey = (tpl) => {
  if (!tpl) return null;
  const questions = (tpl.questions || [])
    .filter((q) => !q.retired)
    .sort((a, b) => (a.order || 0) - (b.order || 0))
    .map((q) => ({
      key: q.key,
      label: q.label,
      type: q.type,
      required: !!q.required,
      otherOption: !!q.otherOption,
      refusalOption: !!q.refusalOption,
      visibleIf: q.visibleIf || null,
      options: (q.options || [])
        .filter((o) => !o.retired)
        .sort((a, b) => (a.order || 0) - (b.order || 0))
        .map((o) => ({ id: o.id, text: o.text, script: o.script || null })),
    }));
  return {
    id: String(tpl._id),
    name: tpl.name,
    intro: tpl.intro || '',
    closing: tpl.closing || '',
    questions,
  };
};

// Which survey a book asks. Per-effort override first, then the campaign's. Resolved per
// book because two books can sit on passes belonging to different efforts.
const surveyResolver = (campaign) => {
  const cache = new Map(); // templateId -> printable survey (or null)
  return async (pass) => {
    if (campaign.type === 'lit_drop') return null;
    let templateId = null;
    if (pass?.effortId) {
      const effort = await Effort.findById(pass.effortId, { surveyTemplateId: 1 }).lean();
      templateId = effort?.surveyTemplateId || null;
    }
    if (!templateId) templateId = campaign.surveyTemplateId || null;
    if (!templateId) return null;
    const key = String(templateId);
    if (cache.has(key)) return cache.get(key);
    const tpl = await SurveyTemplate.findOne({
      _id: templateId,
      organizationId: campaign.organizationId,
    }).lean();
    const printable = toPrintableSurvey(tpl);
    cache.set(key, printable);
    return printable;
  };
};

// Doors + residents for one ordered id list, with every suppression rule applied.
// `orderedIds` IS the walk sequence; the returned doors keep it.
const loadDoors = async (orderedIds, { includePhone }) => {
  if (!orderedIds.length) return { doors: [], omitted: { total: 0, reasons: {} } };

  const printable = await Household.find(
    { _id: { $in: orderedIds }, ...KNOCKABLE_DOOR_FILTER },
    { addressLine1: 1, addressLine2: 1, city: 1, state: 1, zipCode: 1, location: 1 }
  ).lean();

  // KNOCKABLE_DOOR_FILTER decides who prints; this second read only EXPLAINS the gap, so the
  // predicate is never re-implemented in JS where it could drift from the shared constant.
  const keptIds = new Set(printable.map((h) => String(h._id)));
  const omittedIds = orderedIds.filter((id) => !keptIds.has(String(id)));
  const reasons = {};
  if (omittedIds.length) {
    const rows = await Household.find(
      { _id: { $in: omittedIds } },
      { isActive: 1, fullyVoted: 1, fullyDnc: 1, excludedFromTurf: 1 }
    ).lean();
    for (const h of rows) {
      const r = omissionReason(h);
      reasons[r] = (reasons[r] || 0) + 1;
    }
    // Ids in the book that no longer resolve to a household at all.
    const seen = rows.length;
    if (omittedIds.length > seen) reasons.missing = omittedIds.length - seen;
  }

  const fields = ['householdId', 'firstName', 'lastName', 'fullName', 'party', 'gender', 'dateOfBirth'];
  if (includePhone) fields.push('phone');
  const voters = await Voter.find(
    // Live, per-voter. A three-resident door with one flagged person still prints — minus
    // that person, and with no marker where they were.
    { householdId: { $in: [...keptIds] }, 'doNotContact.flagged': { $ne: true } },
    fields.join(' ')
  ).lean();

  const votedRows = voters.length
    ? await VotedVoter.find({ voterId: { $in: voters.map((v) => v._id) } }, { voterId: 1 }).lean()
    : [];
  const votedSet = new Set(votedRows.map((r) => String(r.voterId)));

  const byHousehold = new Map();
  for (const v of voters) {
    const k = String(v.householdId);
    let arr = byHousehold.get(k);
    if (!arr) { arr = []; byHousehold.set(k, arr); }
    arr.push({
      id: String(v._id),
      lastName: v.lastName || '',
      firstName: v.firstName || '',
      name: v.fullName || [v.firstName, v.lastName].filter(Boolean).join(' '),
      party: v.party || null,
      gender: v.gender || null,
      // Derived here so a raw dateOfBirth cannot reach a caller, a wire, or a sheet of paper.
      age: ageOf(v.dateOfBirth),
      phone: includePhone ? v.phone || null : null,
      voted: votedSet.has(String(v._id)),
    });
  }
  for (const arr of byHousehold.values()) {
    arr.sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName));
  }

  const byId = new Map(printable.map((h) => [String(h._id), h]));
  const doors = [];
  for (const id of orderedIds) {
    const h = byId.get(String(id));
    if (!h) continue; // suppressed or gone — counted in `omitted`, never marked on the page
    doors.push({
      id: String(h._id),
      seq: doors.length + 1,
      addressLine1: h.addressLine1 || '',
      addressLine2: h.addressLine2 || null,
      city: h.city || '',
      state: h.state || '',
      zipCode: h.zipCode || '',
      // Coordinates feed the walk-order sort and nothing else. They are never printed.
      voters: byHousehold.get(String(h._id)) || [],
      status: 'unknocked',
      lastActionAt: null,
    });
  }
  return { doors, omitted: { total: omittedIds.length, reasons } };
};

// R2-B07 — the code plate stamped on every sheet, the cover, and the manifest. Derived
// from data we already hold (round number + the book's position in this selection), so it
// needs no allocator, no uniqueness constraint, and no new collection to live in.
const packetCode = (roundNumber, index) =>
  `R${roundNumber || 1}-B${String(index + 1).padStart(2, '0')}`;

// ── books ────────────────────────────────────────────────────────────────────
const buildFromBooks = async (campaign, turfIds, opts) => {
  const turfs = await Turf.find(
    { _id: { $in: turfIds }, campaignId: campaign._id },
    { name: 1, passId: 1, householdIds: 1 }
  ).lean();
  if (!turfs.length) return { books: [], notFound: turfIds.map(String) };

  // Preserve the caller's book order rather than Mongo's.
  const rank = new Map(turfIds.map((id, i) => [String(id), i]));
  turfs.sort((a, b) => (rank.get(String(a._id)) ?? 0) - (rank.get(String(b._id)) ?? 0));

  const passIds = [...new Set(turfs.map((t) => String(t.passId)).filter(Boolean))];
  const passes = await Pass.find(
    { _id: { $in: passIds } },
    { name: 1, roundNumber: 1, effortId: 1 }
  ).lean();
  const passById = new Map(passes.map((p) => [String(p._id), p]));

  // The book's colour is its position within its OWN PASS in creation order — the same rule
  // GET /sources and TurfsPage use. It must be computed over every sibling in the pass, not
  // over the selection, or printing two books out of twelve gives them colours 0 and 1 and
  // the paper stripe contradicts both the picker and the Turf Cutting map.
  const siblings = await Turf.find(
    { passId: { $in: passIds }, status: { $ne: 'archived' } },
    { passId: 1 }
  )
    .sort({ createdAt: 1 })
    .lean();
  const perPass = new Map();
  const colorIndexByTurf = new Map();
  for (const s of siblings) {
    const k = String(s.passId);
    const n = perPass.get(k) || 0;
    colorIndexByTurf.set(String(s._id), n % 12);
    perPass.set(k, n + 1);
  }

  const resolveSurvey = surveyResolver(campaign);
  const books = [];
  for (const [i, turf] of turfs.entries()) {
    // THE ORDER FIX. turf.householdIds IS the walk sequence (services/turf/walkOrder.js
    // computed it at cut time and it is persisted here). loadDoors re-sorts the `$in`
    // result back onto this list, so the paper walks the route the book was cut for.
    const orderedIds = (turf.householdIds || []).map(String);
    const pass = passById.get(String(turf.passId)) || null;
    const { doors, omitted } = await loadDoors(orderedIds, opts);

    // Prior-round door status, per round — not the campaign-sticky Household.status, which
    // would report a door "surveyed" because a DIFFERENT round surveyed it.
    if (pass && doors.length) {
      const statusMap = await getPassStatusMap(turf.passId, doors.map((d) => d.id), campaign.type);
      for (const d of doors) {
        const s = statusMap.get(d.id);
        if (s) { d.status = s.status; d.lastActionAt = s.lastActionAt || null; }
      }
    }

    books.push({
      id: String(turf._id),
      name: turf.name,
      code: packetCode(pass?.roundNumber, i),
      colorIndex: colorIndexByTurf.get(String(turf._id)) ?? i % 12,
      passId: pass ? String(pass._id) : null,
      passName: pass?.name || null,
      roundNumber: pass?.roundNumber || null,
      doorCount: doors.length,
      voterCount: doors.reduce((n, d) => n + d.voters.length, 0),
      streets: streetSummary(doors),
      omitted,
      orderProvenance: 'book',
      survey: await resolveSurvey(pass),
      doors,
    });
  }
  return { books, notFound: turfIds.filter((id) => !turfs.some((t) => String(t._id) === String(id))).map(String) };
};

// ── walk list ────────────────────────────────────────────────────────────────
const buildFromWalkList = async (campaign, walkListId, opts) => {
  const list = await SavedSearch.findOne(
    { _id: walkListId, campaignId: campaign._id },
    { name: 1, householdIds: 1 }
  ).lean();
  if (!list) return { books: [], notFound: [String(walkListId)] };

  // A SavedSearch has no persisted order — it is a SET of doors, not a route. So the walk
  // sequence is computed here, for this printout only, and is not written back. Co-located
  // units (stacked apartments sharing one geocode) can therefore land in a different order
  // on a re-print; the UI says so rather than pretending otherwise.
  const ids = (list.householdIds || []).map(String);
  const geo = ids.length
    ? await Household.find({ _id: { $in: ids }, ...KNOCKABLE_DOOR_FILTER }, { location: 1 }).lean()
    : [];
  const orderedIds = computeWalkOrder(geo, { optimize: true }).map(String);
  // Suppressed doors never made it into `geo`, so re-append nothing — but keep any id the
  // filter dropped in the omission count by handing loadDoors the ORIGINAL list, ordered.
  const orderRank = new Map(orderedIds.map((id, i) => [id, i]));
  const fullOrdered = [...ids].sort(
    (a, b) => (orderRank.get(a) ?? Number.MAX_SAFE_INTEGER) - (orderRank.get(b) ?? Number.MAX_SAFE_INTEGER)
  );

  const { doors, omitted } = await loadDoors(fullOrdered, opts);
  const resolveSurvey = surveyResolver(campaign);
  return {
    books: [
      {
        id: String(list._id),
        name: list.name,
        code: packetCode(1, 0),
        colorIndex: 0,
        passId: null,
        passName: null,
        roundNumber: null,
        doorCount: doors.length,
        voterCount: doors.reduce((n, d) => n + d.voters.length, 0),
        streets: streetSummary(doors),
        omitted,
        orderProvenance: 'computed',
        survey: await resolveSurvey(null),
        doors,
      },
    ],
    notFound: [],
  };
};

// source: { kind: 'books', turfIds: [] } | { kind: 'walklist', walkListId }
export const buildPacket = async (campaign, orgName, source, { includePhone = false } = {}) => {
  const opts = { includePhone };
  const { books, notFound } =
    source.kind === 'walklist'
      ? await buildFromWalkList(campaign, source.walkListId, opts)
      : await buildFromBooks(campaign, source.turfIds || [], opts);

  const totalDoors = books.reduce((n, b) => n + b.doorCount, 0);
  const warnings = [];
  if (notFound.length) warnings.push(`${notFound.length} selected item(s) no longer exist.`);
  if (source.kind === 'walklist') {
    warnings.push('Walk order for a saved search is computed for this printout and is not stored.');
  }

  return {
    campaign: { id: String(campaign._id), name: campaign.name, type: campaign.type },
    organization: { name: orgName || '' },
    generatedAt: new Date().toISOString(),
    books,
    totals: {
      books: books.length,
      doors: totalDoors,
      voters: books.reduce((n, b) => n + b.voterCount, 0),
      omitted: books.reduce((n, b) => n + b.omitted.total, 0),
    },
    warnings,
  };
};

// Cheap pre-flight for the cap, so an over-cap selection is refused BEFORE the expensive
// voter join. Counts the same knockable set the packet would print.
export const countPacketDoors = async (campaign, source) => {
  let ids = [];
  if (source.kind === 'walklist') {
    const list = await SavedSearch.findOne(
      { _id: source.walkListId, campaignId: campaign._id },
      { householdIds: 1 }
    ).lean();
    ids = (list?.householdIds || []).map(String);
  } else {
    const turfs = await Turf.find(
      { _id: { $in: source.turfIds || [] }, campaignId: campaign._id },
      { householdIds: 1 }
    ).lean();
    ids = turfs.flatMap((t) => (t.householdIds || []).map(String));
  }
  if (!ids.length) return 0;
  return Household.countDocuments({ _id: { $in: ids }, ...KNOCKABLE_DOOR_FILTER });
};
