import { Household } from '../../models/Household.js';
import { Voter } from '../../models/Voter.js';
import { DoNotKnockAddress } from '../../models/DoNotKnockAddress.js';
import { recomputeDoNotKnock } from './recomputeDoNotKnock.js';
import { looseAddressKey } from '../../utils/normalizeAddress.js';

const CHUNK = 2000;
// Ceiling on the advisory near-miss scan (see nearMissAddresses). Bounded so one dense ZIP can't
// turn a review-list click into a full-universe scan; the caller surfaces `truncated` rather than
// pretending it saw everything.
const NEAR_MISS_SCAN_CAP = 20000;

// Every Household row for one address across EVERY campaign of the org. This is the fan-out that
// makes an address-level request actually stick: Household is per-campaign
// ({campaignId, normalizedAddress} unique), so a set/clear has to reach all of them at once.
export async function siblingHouseholdIds(organizationId, normalizedAddress) {
  const rows = await Household.find(
    { organizationId, normalizedAddress },
    { _id: 1 }
  ).lean();
  return rows.map((r) => r._id);
}

// Record a standing "never knock this address" request and suppress every sibling door.
//
// IDEMPOTENT AND NON-RESTAMPING: a second set on an already-suppressed address keeps the ORIGINAL
// author, reason and timestamp ($setOnInsert only). Same rule as the DNC flag's re-flag, and for
// the same reason — the record is the provenance of the request, and the first one is the true
// one. Returns { created } so the caller can tell "suppressed it" from "already was".
export async function setDoNotKnock({
  organizationId,
  household,
  reason,
  source,
  byUserId,
  campaignIdAtSet = null,
}) {
  const normalizedAddress = household.normalizedAddress;
  const res = await DoNotKnockAddress.updateOne(
    { organizationId, normalizedAddress },
    {
      $setOnInsert: {
        looseKey: looseAddressKey(household),
        addressLine1: household.addressLine1,
        addressLine2: household.addressLine2 || null,
        city: household.city,
        state: household.state,
        zipCode: household.zipCode,
        reason,
        source,
        byUserId,
        at: new Date(),
        campaignIdAtSet,
      },
    },
    { upsert: true }
  );

  const ids = await siblingHouseholdIds(organizationId, normalizedAddress);
  await recomputeDoNotKnock(ids);
  return { created: res.upsertedCount > 0, doorsAffected: ids.length, normalizedAddress };
}

// Lift the request. The ONLY path that un-suppresses an address — nothing automatic ever does
// (see Household.doNotKnock: this request never auto-reopens on a new resident, unlike fullyDnc).
// Deleting the record is what stops future imports re-applying it, which is why we delete rather
// than tombstone.
export async function clearDoNotKnock({ organizationId, normalizedAddress }) {
  const existing = await DoNotKnockAddress.findOne({ organizationId, normalizedAddress }).lean();
  if (!existing) return { cleared: false, doorsAffected: 0 };
  await DoNotKnockAddress.deleteOne({ _id: existing._id });
  const ids = await siblingHouseholdIds(organizationId, normalizedAddress);
  await recomputeDoNotKnock(ids);
  return { cleared: true, doorsAffected: ids.length, record: existing };
}

// Which of these addresses already carry a standing request? Used by csvImporter to stamp
// doNotKnock into the household upsert's $setOnInsert, so a door imported into a brand-new
// campaign arrives already suppressed instead of being knockable until the next recompute.
export async function suppressedAddressSet(organizationId, normalizedAddresses) {
  const addrs = [...new Set((normalizedAddresses || []).filter(Boolean))];
  const out = new Set();
  if (!addrs.length) return out;
  for (let i = 0; i < addrs.length; i += CHUNK) {
    const rows = await DoNotKnockAddress.find(
      { organizationId, normalizedAddress: { $in: addrs.slice(i, i + CHUNK) } },
      { normalizedAddress: 1 }
    ).lean();
    for (const r of rows) out.add(r.normalizedAddress);
  }
  return out;
}

// Import hook (mirrors reapplyDncLists): after an import lands, make sure every door matching a
// standing request is suppressed. Catches the case $setOnInsert cannot — an address that ALREADY
// existed as a Household row in this campaign, or one re-housed by the import.
//
// Bounded by the number of SUPPRESSED ADDRESSES (small — a human sets these one at a time), never
// by campaign size: we start from the request records and look up their doors, not the other way
// round. Org-scoped; `campaignId` narrows the recompute to the campaign that just imported.
export async function reapplyDoNotKnock(organizationId, campaignId = null) {
  const records = await DoNotKnockAddress.find({ organizationId }, { normalizedAddress: 1 }).lean();
  if (!records.length) return { suppressed: 0, householdIds: [] };

  const addrs = records.map((r) => r.normalizedAddress);
  const ids = [];
  for (let i = 0; i < addrs.length; i += CHUNK) {
    const rows = await Household.find(
      {
        organizationId,
        ...(campaignId ? { campaignId } : {}),
        normalizedAddress: { $in: addrs.slice(i, i + CHUNK) },
        doNotKnock: { $ne: true },
      },
      { _id: 1 }
    ).lean();
    ids.push(...rows.map((r) => r._id));
  }
  if (!ids.length) return { suppressed: 0, householdIds: [] };
  await recomputeDoNotKnock(ids);
  return { suppressed: ids.length, householdIds: ids };
}

// ── Advisory review helpers ─────────────────────────────────────────────────────────────
// Neither of these ever changes suppression state. They exist so the two honest limitations of an
// exact-key, never-auto-reopening design are VISIBLE to an admin instead of silent.

// Limitation 1 — formatting drift. Addresses that look like the same place under the LOOSE key
// but differ under the exact one, so sibling fan-out missed them. Advisory only: we show them and
// an admin decides. Auto-suppressing on the loose key could darken a neighbour's door.
//
// Scoped to the record's ZIP and capped; returns `truncated` when the cap bit, so a partial scan
// never reads as "no near misses".
export async function nearMissAddresses(organizationId, record) {
  const target = record.looseKey || looseAddressKey(record);
  if (!target) return { matches: [], truncated: false };

  const candidates = await Household.find(
    {
      organizationId,
      zipCode: record.zipCode,
      normalizedAddress: { $ne: record.normalizedAddress },
    },
    { normalizedAddress: 1, addressLine1: 1, addressLine2: 1, city: 1, state: 1, zipCode: 1, campaignId: 1 }
  )
    .limit(NEAR_MISS_SCAN_CAP + 1)
    .lean();

  const truncated = candidates.length > NEAR_MISS_SCAN_CAP;
  const seen = new Map();
  for (const h of candidates.slice(0, NEAR_MISS_SCAN_CAP)) {
    if (looseAddressKey(h) !== target) continue;
    if (!seen.has(h.normalizedAddress)) seen.set(h.normalizedAddress, h);
  }
  return { matches: [...seen.values()], truncated };
}

// Limitation 2 — turnover. The request never auto-reopens (by design), so an address whose
// residents have genuinely all moved on stays dark forever unless someone looks. Flag any
// suppressed address that has gained a voter imported AFTER the request was recorded, as a
// re-review prompt. A human decides; nothing reopens on its own.
//
// One bulk pass for a page of records — the review list calls this with its current page only.
export async function newResidentsSince(organizationId, records) {
  const out = new Map(); // normalizedAddress -> count of voters newer than the request
  if (!records?.length) return out;

  const addrs = records.map((r) => r.normalizedAddress);
  const doors = await Household.find(
    { organizationId, normalizedAddress: { $in: addrs } },
    { _id: 1, normalizedAddress: 1 }
  ).lean();
  if (!doors.length) return out;

  const addrByHh = new Map(doors.map((d) => [String(d._id), d.normalizedAddress]));
  const atByAddr = new Map(records.map((r) => [r.normalizedAddress, r.at || r.createdAt]));

  const voters = await Voter.find(
    { householdId: { $in: doors.map((d) => d._id) } },
    { householdId: 1, createdAt: 1 }
  ).lean();

  for (const v of voters) {
    const addr = addrByHh.get(String(v.householdId));
    if (!addr) continue;
    const at = atByAddr.get(addr);
    if (at && v.createdAt && new Date(v.createdAt) > new Date(at)) {
      out.set(addr, (out.get(addr) || 0) + 1);
    }
  }
  return out;
}
