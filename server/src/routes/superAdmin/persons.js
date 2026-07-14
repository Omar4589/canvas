import { Router } from 'express';
import mongoose from 'mongoose';
import { Person } from '../../models/Person.js';
import { Voter } from '../../models/Voter.js';
import { Organization } from '../../models/Organization.js';
import { PersonMergeCandidate } from '../../models/PersonMergeCandidate.js';
import { PersonEditProposal } from '../../models/PersonEditProposal.js';
import { requireAuth, requireBreakGlass } from '../../middleware/auth.js';
import { buildPersonOversight, serializePerson, PERSON_IDENTITY_FIELDS } from '../../services/person/personOversight.js';
import { mergePersons, splitPerson } from '../../services/person/mergePersons.js';
import { propagateIdentity } from '../../services/person/propagateIdentity.js';
import { followMerged } from '../../services/person/resolvePerson.js';
import { requirePersonOrgGrant, recordAccess } from '../../services/access/supportAccess.js';

const router = Router();

// The platform identity console. Two gates, because it reaches customer voter PII from OUTSIDE the
// /admin routers (so orgContext + the accessLog middleware never see it — that gap was a live hole:
// any `support`-tier staffer could name-search and read every customer's identities, addresses and
// DOBs across the whole platform, with no grant and no audit row).
//
//   1. requireBreakGlass — the least-privileged `support` tier cannot reach this console AT ALL.
//   2. Per request, requirePersonOrgGrant(...) — reading or editing a specific person requires a live
//      support grant for THAT person's organization, and writes an AccessLog row. Same grant, same
//      audit, same "who looked at my data" answer as the /admin path. The cross-organization free-text
//      name directory is gone: you browse one customer's people at a time, having entered that customer.
router.use(requireAuth, requireBreakGlass);

// Record a break-glass read/write of a specific customer's identity record. Reuses the same AccessLog
// the /admin path writes, so "who at Doorline touched my data?" has one answer across both surfaces.
function logPersonAccess(req, { organizationId, grantId, resource, route }) {
  recordAccess({
    actorUserId: req.user._id,
    organizationId,
    grantId,
    method: req.method,
    route,
    resource: resource || 'person',
  });
}

const oid = (v) => new mongoose.Types.ObjectId(String(v));
const clamp = (n, lo, hi) => Math.min(Math.max(n, lo), hi);
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const eq = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const brief = (p) => ({
  id: String(p._id),
  fullName: p.fullName || `${p.firstName || ''} ${p.lastName || ''}`.trim() || null,
  firstName: p.firstName || null,
  lastName: p.lastName || null,
  uidKeys: (p.uidKeys || []).map((k) => ({ uidSource: k.uidSource, uid: k.uid })),
  svidKeys: (p.svidKeys || []).map((k) => ({ registeredState: k.registeredState, stateVoterId: k.stateVoterId })),
});

// ── GET /super-admin/persons?organizationId=… — one customer's identity directory ──
// Scoped to a single organization and gated by a live support grant for it. There is deliberately NO
// cross-organization search: the old version filtered only `{ mergedInto: null }`, so a name query
// returned matching people across every customer on the platform, unlogged. You now browse one
// customer's people, having entered that customer under a reasoned, time-boxed, audited grant.
router.get('/', async (req, res, next) => {
  try {
    const orgIdParam = req.query.organizationId;
    if (!orgIdParam || !mongoose.isValidObjectId(orgIdParam)) {
      return res.status(400).json({
        error: 'organizationId is required — the identity directory is scoped to one organization.',
      });
    }
    const grant = await requirePersonOrgGrant(req, res, orgIdParam);
    if (!grant) return;

    const limit = clamp(parseInt(req.query.limit, 10) || 25, 1, 100);
    const skip = Math.max(parseInt(req.query.skip, 10) || 0, 0);
    const q = (req.query.q || '').toString().trim();

    const filter = { mergedInto: null, organizationId: oid(orgIdParam) };
    if (q) {
      const rx = new RegExp(escapeRegex(q), 'i');
      filter.$or = [
        { firstName: rx }, { lastName: rx }, { fullName: rx },
        { 'uidKeys.uid': q }, { 'svidKeys.stateVoterId': q },
      ];
    }
    if (req.query.needsReview === 'true') {
      const [cands, props] = await Promise.all([
        PersonMergeCandidate.find({ status: 'open' }, 'personIdA personIdB').lean(),
        PersonEditProposal.find({ status: 'pending' }, 'personId').lean(),
      ]);
      const ids = new Set();
      for (const c of cands) { ids.add(String(c.personIdA)); if (c.personIdB) ids.add(String(c.personIdB)); }
      for (const p of props) ids.add(String(p.personId));
      filter._id = { $in: [...ids].map(oid) };
    }

    const [total, persons] = await Promise.all([
      Person.countDocuments(filter),
      Person.find(filter).sort({ lastName: 1, firstName: 1 }).skip(skip).limit(limit).lean(),
    ]);

    const ids = persons.map((p) => p._id);
    const [voterAgg, openC, pendP, ownerOrgs] = await Promise.all([
      Voter.aggregate([
        { $match: { personId: { $in: ids } } },
        { $group: { _id: '$personId', voters: { $sum: 1 }, orgs: { $addToSet: '$organizationId' } } },
      ]),
      PersonMergeCandidate.find({ status: 'open', $or: [{ personIdA: { $in: ids } }, { personIdB: { $in: ids } }] }, 'personIdA personIdB').lean(),
      PersonEditProposal.find({ status: 'pending', personId: { $in: ids } }, 'personId').lean(),
      Organization.find({ _id: { $in: [...new Set(persons.map((p) => p.identityOwnerOrgId).filter(Boolean).map(String))].map(oid) } }, 'name').lean(),
    ]);
    const counts = new Map(voterAgg.map((a) => [String(a._id), { voterCount: a.voters, orgCount: a.orgs.length }]));
    const hasCand = new Set();
    for (const c of openC) { hasCand.add(String(c.personIdA)); if (c.personIdB) hasCand.add(String(c.personIdB)); }
    const hasProp = new Set(pendP.map((p) => String(p.personId)));
    const ownerName = new Map(ownerOrgs.map((o) => [String(o._id), o.name]));

    logPersonAccess(req, { organizationId: oid(orgIdParam), grantId: grant._id, resource: 'person-directory', route: 'GET /super-admin/persons' });
    res.json({
      total, limit, skip,
      persons: persons.map((p) => ({
        ...brief(p),
        party: p.party || null,
        orgCount: counts.get(String(p._id))?.orgCount || 0,
        voterCount: counts.get(String(p._id))?.voterCount || 0,
        ownerOrgId: p.identityOwnerOrgId ? String(p.identityOwnerOrgId) : null,
        ownerOrgName: p.identityOwnerOrgId ? ownerName.get(String(p.identityOwnerOrgId)) || null : null,
        ownerProvisional: !!p.ownerProvisional,
        lockedFields: p.lockedFields || [],
        hasOpenCandidate: hasCand.has(String(p._id)),
        hasPendingProposal: hasProp.has(String(p._id)),
      })),
    });
  } catch (err) { next(err); }
});

// ── GET /super-admin/persons/candidates — open merge candidates ──
router.get('/candidates', async (req, res, next) => {
  try {
    const cands = await PersonMergeCandidate.find({ status: 'open' }).sort({ createdAt: -1 }).limit(200).lean();
    const pids = [...new Set(cands.flatMap((c) => [c.personIdA, c.personIdB].filter(Boolean)).map(String))];
    const persons = pids.length
      ? await Person.find({ _id: { $in: pids.map(oid) } }, 'firstName lastName fullName uidKeys svidKeys').lean()
      : [];
    const pm = new Map(persons.map((p) => [String(p._id), brief(p)]));
    res.json({
      candidates: cands.map((c) => ({
        id: String(c._id),
        reason: c.reason,
        status: c.status,
        sampleUid: c.sampleUid || null,
        sampleSvid: c.sampleSvid || null,
        sampleState: c.sampleState || null,
        createdAt: c.createdAt,
        personA: pm.get(String(c.personIdA)) || null,
        personB: c.personIdB ? pm.get(String(c.personIdB)) || null : null,
      })),
    });
  } catch (err) { next(err); }
});

// ── POST /super-admin/persons/candidates/:candidateId/dismiss ──
router.post('/candidates/:candidateId/dismiss', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.candidateId)) return res.status(400).json({ error: 'Invalid candidateId' });
    const c = await PersonMergeCandidate.findById(req.params.candidateId);
    if (!c) return res.status(404).json({ error: 'Candidate not found' });
    c.status = 'dismissed';
    c.resolvedBy = req.user._id;
    c.resolvedAt = new Date();
    await c.save();
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── GET /super-admin/persons/edit-proposals — pending identity proposals ──
router.get('/edit-proposals', async (req, res, next) => {
  try {
    const props = await PersonEditProposal.find({ status: 'pending' }).sort({ createdAt: -1 }).limit(200).lean();
    const pids = [...new Set(props.map((p) => String(p.personId)))];
    const orgIds = [...new Set(props.map((p) => String(p.orgId)))];
    const [persons, orgs] = await Promise.all([
      pids.length ? Person.find({ _id: { $in: pids.map(oid) } }, 'firstName lastName fullName').lean() : [],
      orgIds.length ? Organization.find({ _id: { $in: orgIds.map(oid) } }, 'name').lean() : [],
    ]);
    const pm = new Map(persons.map((p) => [String(p._id), brief(p)]));
    const om = new Map(orgs.map((o) => [String(o._id), o.name]));
    res.json({
      proposals: props.map((p) => ({
        id: String(p._id),
        personId: String(p.personId),
        person: pm.get(String(p.personId)) || null,
        orgId: String(p.orgId),
        orgName: om.get(String(p.orgId)) || null,
        source: p.source,
        fields: p.fields || {},
        canonicalSnapshot: p.canonicalSnapshot || {},
        baseIdentityVersion: p.baseIdentityVersion,
        createdAt: p.createdAt,
      })),
    });
  } catch (err) { next(err); }
});

// ── POST /super-admin/persons/edit-proposals/:proposalId/approve ──
router.post('/edit-proposals/:proposalId/approve', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.proposalId)) return res.status(400).json({ error: 'Invalid proposalId' });
    const prop = await PersonEditProposal.findById(req.params.proposalId);
    if (!prop) return res.status(404).json({ error: 'Proposal not found' });
    if (prop.status !== 'pending') return res.status(409).json({ error: `Proposal already ${prop.status}` });

    const person = await followMerged(await Person.findById(prop.personId));
    if (!person) return res.status(404).json({ error: 'Person not found' });
    const grant = await requirePersonOrgGrant(req, res, person.organizationId);
    if (!grant) return;
    logPersonAccess(req, { organizationId: person.organizationId, grantId: grant._id, resource: 'person-edit', route: 'POST /super-admin/persons/edit-proposals/:proposalId/approve' });

    // A super-admin lock pins a field — a proposal can't override it until it's unlocked.
    const lockedHit = Object.keys(prop.fields || {}).filter((f) => (person.lockedFields || []).includes(f));
    if (lockedHit.length) return res.status(409).json({ error: `Field(s) locked — unlock first: ${lockedHit.join(', ')}`, locked: lockedHit });

    // Field-level drift check: only the proposed fields matter (an unrelated edit must not
    // block). If a proposed field's canonical value moved since filing → superseded.
    const drifted = Object.keys(prop.fields || {}).filter((f) => !eq(person[f] ?? null, prop.canonicalSnapshot?.[f] ?? null));
    if (drifted.length) {
      await PersonEditProposal.updateOne({ _id: prop._id, status: 'pending' }, { $set: { status: 'superseded', resolvedBy: req.user._id, resolvedAt: new Date() } });
      return res.status(409).json({ error: 'Canonical identity changed since this proposal was filed', drifted });
    }

    // Atomically claim the proposal so concurrent approve/reject can't double-apply.
    const claimed = await PersonEditProposal.findOneAndUpdate(
      { _id: prop._id, status: 'pending' },
      { $set: { status: 'approved', resolvedBy: req.user._id, resolvedAt: new Date() } },
      { new: true }
    );
    if (!claimed) return res.status(409).json({ error: 'Proposal already resolved' });

    // Apply as a super-admin canonical edit (orgId null — consistent with the direct
    // canonical PATCH; the proposing org is recorded on the proposal itself).
    await propagateIdentity(person._id, prop.fields || {}, { orgId: null, source: 'super_admin', userId: req.user._id });
    res.json({ ok: true, person: serializePerson(await Person.findById(person._id)) });
  } catch (err) { next(err); }
});

// ── POST /super-admin/persons/edit-proposals/:proposalId/reject ──
router.post('/edit-proposals/:proposalId/reject', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.proposalId)) return res.status(400).json({ error: 'Invalid proposalId' });
    const claimed = await PersonEditProposal.findOneAndUpdate(
      { _id: req.params.proposalId, status: 'pending' },
      { $set: { status: 'rejected', resolvedBy: req.user._id, resolvedAt: new Date() } },
      { new: true }
    );
    if (!claimed) {
      const exists = await PersonEditProposal.exists({ _id: req.params.proposalId });
      return res.status(exists ? 409 : 404).json({ error: exists ? 'Proposal already resolved' : 'Proposal not found' });
    }
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── GET /super-admin/persons/:personId — full oversight view ──
// Requires a support grant for this person's organization (returns SUPPORT_ACCESS_REQUIRED → the web
// client's grant modal), and writes an AccessLog row. This is the route that returns the person's DOB,
// phone, party and HOME ADDRESSES — the exact PII the console used to hand out with no grant and no log.
router.get('/:personId', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.personId)) return res.status(400).json({ error: 'Invalid personId' });
    const person = await followMerged(await Person.findById(req.params.personId));
    if (!person) return res.status(404).json({ error: 'Person not found' });
    const grant = await requirePersonOrgGrant(req, res, person.organizationId);
    if (!grant) return;
    const view = await buildPersonOversight(person._id);
    if (!view) return res.status(404).json({ error: 'Person not found' });
    logPersonAccess(req, { organizationId: person.organizationId, grantId: grant._id, route: 'GET /super-admin/persons/:personId' });
    res.json(view);
  } catch (err) { next(err); }
});

// ── PATCH /super-admin/persons/:personId — canonical identity edit (propagates) ──
// Break-glass (router) + a support grant for the person's org: this rewrites a voter's canonical
// identity in a customer's database, so it is both authorized and audited.
router.patch('/:personId', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.personId)) return res.status(400).json({ error: 'Invalid personId' });
    const person = await followMerged(await Person.findById(req.params.personId));
    if (!person) return res.status(404).json({ error: 'Person not found' });
    const grant = await requirePersonOrgGrant(req, res, person.organizationId);
    if (!grant) return;
    logPersonAccess(req, { organizationId: person.organizationId, grantId: grant._id, resource: 'person-edit', route: 'PATCH /super-admin/persons/:personId' });

    const fields = {};
    for (const f of PERSON_IDENTITY_FIELDS) {
      if (f === 'fullName') continue; // derived below
      if (req.body[f] !== undefined) fields[f] = req.body[f] === '' ? null : req.body[f];
    }
    if (fields.dateOfBirth !== undefined && fields.dateOfBirth !== null) fields.dateOfBirth = new Date(fields.dateOfBirth);
    if (req.body.fullName !== undefined) fields.fullName = req.body.fullName === '' ? null : req.body.fullName;
    else if (fields.firstName !== undefined || fields.lastName !== undefined) {
      fields.fullName = `${fields.firstName ?? person.firstName ?? ''} ${fields.lastName ?? person.lastName ?? ''}`.trim() || null;
    }
    if (!Object.keys(fields).length) return res.status(400).json({ error: 'No editable identity fields provided' });

    await propagateIdentity(person._id, fields, { orgId: null, source: 'super_admin', userId: req.user._id });
    res.json({ ok: true, person: serializePerson(await Person.findById(person._id)) });
  } catch (err) { next(err); }
});

// ── PATCH /super-admin/persons/:personId/owner — assign/clear canonical owner ──
// Link-guarded: an org can only own a person it has a linked Voter for.
router.patch('/:personId/owner', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.personId)) return res.status(400).json({ error: 'Invalid personId' });
    const person = await followMerged(await Person.findById(req.params.personId));
    if (!person) return res.status(404).json({ error: 'Person not found' });
    const grant = await requirePersonOrgGrant(req, res, person.organizationId);
    if (!grant) return;
    logPersonAccess(req, { organizationId: person.organizationId, grantId: grant._id, resource: 'person-edit', route: 'PATCH /super-admin/persons/:personId/owner' });

    const orgId = req.body.orgId || null;
    if (orgId) {
      if (!mongoose.isValidObjectId(orgId)) return res.status(400).json({ error: 'Invalid orgId' });
      const linked = await Voter.exists({ personId: person._id, organizationId: oid(orgId) });
      if (!linked) return res.status(400).json({ error: 'That organization has no voter linked to this person' });
      await Person.updateOne({ _id: person._id }, { $set: { identityOwnerOrgId: oid(orgId), ownerProvisional: false } });
    } else {
      await Person.updateOne({ _id: person._id }, { $set: { identityOwnerOrgId: null, ownerProvisional: false } });
    }
    res.json({ ok: true, person: serializePerson(await Person.findById(person._id)) });
  } catch (err) { next(err); }
});

// ── PATCH /super-admin/persons/:personId/lock — pin fields against propagation ──
router.patch('/:personId/lock', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.personId)) return res.status(400).json({ error: 'Invalid personId' });
    const person = await Person.findById(req.params.personId);
    if (!person) return res.status(404).json({ error: 'Person not found' });
    const grant = await requirePersonOrgGrant(req, res, person.organizationId);
    if (!grant) return;
    logPersonAccess(req, { organizationId: person.organizationId, grantId: grant._id, resource: 'person-edit', route: 'PATCH /super-admin/persons/:personId/lock' });
    const requested = Array.isArray(req.body.lockedFields) ? req.body.lockedFields : [];
    const invalid = requested.filter((f) => !PERSON_IDENTITY_FIELDS.includes(f));
    if (invalid.length) return res.status(400).json({ error: `Not lockable identity fields: ${invalid.join(', ')}` });
    await Person.updateOne({ _id: person._id }, { $set: { lockedFields: [...new Set(requested)] } });
    res.json({ ok: true, person: serializePerson(await Person.findById(person._id)) });
  } catch (err) { next(err); }
});

// ── POST /super-admin/persons/:personId/merge — merge a victim INTO this person ──
router.post('/:personId/merge', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.personId)) return res.status(400).json({ error: 'Invalid personId' });
    const survivor = await followMerged(await Person.findById(req.params.personId));
    if (!survivor) return res.status(404).json({ error: 'Person not found' });
    const grant = await requirePersonOrgGrant(req, res, survivor.organizationId);
    if (!grant) return;
    logPersonAccess(req, { organizationId: survivor.organizationId, grantId: grant._id, resource: 'person-merge', route: 'POST /super-admin/persons/:personId/merge' });
    const { victimId, fieldDecisions } = req.body || {};
    if (!mongoose.isValidObjectId(victimId)) return res.status(400).json({ error: 'victimId is required' });
    await mergePersons({ survivorId: survivor._id, victimId, fieldDecisions: fieldDecisions || [], byUserId: req.user._id });
    const view = await buildPersonOversight(survivor._id);
    res.json(view);
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
    next(err);
  }
});

// ── POST /super-admin/persons/:personId/split — reverse a prior merge ──
router.post('/:personId/split', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.personId)) return res.status(400).json({ error: 'Invalid personId' });
    const person = await followMerged(await Person.findById(req.params.personId));
    if (!person) return res.status(404).json({ error: 'Person not found' });
    const grant = await requirePersonOrgGrant(req, res, person.organizationId);
    if (!grant) return;
    logPersonAccess(req, { organizationId: person.organizationId, grantId: grant._id, resource: 'person-split', route: 'POST /super-admin/persons/:personId/split' });
    const { mergeLogId } = req.body || {};
    if (!mongoose.isValidObjectId(mergeLogId)) return res.status(400).json({ error: 'mergeLogId is required' });
    const result = await splitPerson({ mergeLogId, byUserId: req.user._id });
    const view = await buildPersonOversight(result.survivorId);
    res.json({ ...view, split: result });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
    next(err);
  }
});

export default router;
