import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDb } from '../config/db.js';
import { Organization } from '../models/Organization.js';
import { Campaign } from '../models/Campaign.js';
import { Voter } from '../models/Voter.js';
import { Person } from '../models/Person.js';
import { VotedPendingId } from '../models/VotedPendingId.js';
import { DncPendingId } from '../models/DncPendingId.js';
import { canonicalVoterId } from '../utils/voterIdKey.js';

// Is the same voter stored under two spellings of one ID? READ-ONLY — this script never writes.
//
//   npm run audit:voter-id-spellings                    # every organization
//   npm run audit:voter-id-spellings -- --org <slug>    # one organization
//   npm run audit:voter-id-spellings -- --json          # machine-readable, samples capped by --samples N (10)
//
// WHY. Some states write voter IDs a fixed width with zeros in front (Georgia: 08719967), and Excel
// strips those zeros the moment a file is opened and saved. Every ID comparison in the app is an
// exact string match, so a list that lost its zeros matches nobody, and a voter file that lost them
// imports every voter a SECOND time. The fix is deferred until after the 2026-11-03 election
// (docs/PROPOSAL_VOTER_ID_KEYS.md); this is what tells us, from data rather than guesswork, whether
// any of it has already happened and which campaigns are exposed. Everything that plan builds later
// starts from this output.
//
// What it reports, per organization:
//   1. Exposure per campaign — how many IDs are numeric, how wide they are, what share starts with a
//      zero, and whether one campaign holds MIXED widths (the tell that some rows already lost zeros).
//   2. The same person stored under two spellings across campaigns — and, of those, groups where the
//      name or birth date differs (CHECK: it may be two people) or the campaigns are in different
//      states (STOP: two states can issue the same digits; never merge across states).
//   3. The same person twice inside one campaign — the doubled-import signature.
//   4. Person-directory entries that would collide once zeros are ignored — the precondition any
//      stored-key migration must clear first.
//   5. Parked early-vote and do-not-contact IDs that match a voter ONLY after ignoring zeros — how
//      much the problem is already biting: lists that were uploaded stripped and are waiting.
//
// The rule for "same ID" is utils/voterIdKey.js (digits lose leading zeros; anything with a letter
// is exact; all-zero is no ID). CANON_EXPR below is its aggregation twin and must agree with it —
// test/auditVoterIdSpellings.int.test.js seeds both shapes and checks they meet.

const args = process.argv.slice(2);
const flagValue = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? null : args[i + 1] ?? null;
};
const ORG_SLUG = flagValue('--org');
const JSON_OUT = args.includes('--json');
const SAMPLES = Math.max(1, Number(flagValue('--samples')) || 10);

// The comparable form of `$stateVoterId`, computed inside MongoDB: null for blank or all-zero,
// digits stripped of leading zeros, anything else untouched. Mirrors canonicalVoterId exactly.
const CANON_EXPR = {
  $let: {
    vars: { s: { $trim: { input: { $ifNull: ['$stateVoterId', ''] } } } },
    in: {
      $cond: [
        { $regexMatch: { input: '$$s', regex: '^[0-9]+$' } },
        {
          $let: {
            vars: { t: { $ltrim: { input: '$$s', chars: '0' } } },
            in: { $cond: [{ $eq: ['$$t', ''] }, null, '$$t'] },
          },
        },
        { $cond: [{ $eq: ['$$s', ''] }, null, '$$s'] },
      ],
    },
  },
};

const n = (x) => Number(x || 0).toLocaleString();
const pct = (part, whole) => (whole ? `${Math.round((part / whole) * 100)}%` : '—');

// ── 1. Exposure per campaign ─────────────────────────────────────────────────────────────────
// One pass over the voters: (numeric?, all-zero?, starts-with-0?, width) per row, counted per
// campaign. Folded in JS into a width histogram; two numeric widths in one campaign is the tell.
async function exposure(scope) {
  const rows = await Voter.aggregate(
    [
      { $match: scope },
      { $project: { organizationId: 1, campaignId: 1, s: { $trim: { input: { $ifNull: ['$stateVoterId', ''] } } } } },
      {
        $project: {
          organizationId: 1,
          campaignId: 1,
          numeric: { $regexMatch: { input: '$s', regex: '^[0-9]+$' } },
          allZero: { $regexMatch: { input: '$s', regex: '^0+$' } },
          zero: { $eq: [{ $substrCP: ['$s', 0, 1] }, '0'] },
          width: { $strLenCP: '$s' },
        },
      },
      {
        $group: {
          _id: { org: '$organizationId', campaign: '$campaignId', numeric: '$numeric', allZero: '$allZero', zero: '$zero', width: '$width' },
          count: { $sum: 1 },
        },
      },
    ],
    { allowDiskUse: true }
  );
  const byCampaign = new Map();
  for (const r of rows) {
    const k = String(r._id.campaign);
    let c = byCampaign.get(k);
    if (!c) {
      c = { campaignId: k, organizationId: String(r._id.org), voters: 0, numeric: 0, startsWithZero: 0, letters: 0, allZero: 0, widths: {} };
      byCampaign.set(k, c);
    }
    c.voters += r.count;
    if (r._id.allZero) {
      c.allZero += r.count;
    } else if (r._id.numeric) {
      c.numeric += r.count;
      if (r._id.zero) c.startsWithZero += r.count;
      c.widths[r._id.width] = (c.widths[r._id.width] || 0) + r.count;
    } else {
      c.letters += r.count;
    }
  }
  for (const c of byCampaign.values()) classify(c);
  return byCampaign;
}

// How a campaign's IDs are spelled — and therefore how a list from ANOTHER source could spell them
// differently. Measured on production 2026-09-30: Nebraska, Connecticut and Kentucky files number
// voters without padding (a smooth spread of 3–7 digit IDs, none starting with 0), which is not
// damage; Florida and Texas files are one width with no zeros; Indiana and Ohio IDs carry letters.
//   padded   — IDs start with 0: a fixed-width numbering. A list that lost its zeros fails.
//   mixed    — IDs start with 0 AND some rows are shorter: rows that already lost their zeros (a
//              doubled-import tell), or two sources with different padding. The one real finding.
//   unpadded — several widths, no leading zeros: plain sequential numbers. A list that PADS them
//              (the state's own file, say) fails.
//   uniform  — one width, no leading zeros: nothing to strip and nothing to add. Safe.
//   none     — no numeric IDs at all: letter-bearing formats are exact and immune to Excel. Safe.
//   empty    — no voters yet.
function classify(c) {
  const widths = Object.keys(c.widths).map(Number);
  c.widestNumeric = widths.length ? Math.max(...widths) : 0;
  c.mixedWidths = widths.length > 1;
  c.shorterRows = widths.filter((w) => w < c.widestNumeric).reduce((s, w) => s + c.widths[w], 0);
  if (!c.voters) c.padding = 'empty';
  else if (!c.numeric) c.padding = 'none';
  else if (c.startsWithZero) c.padding = c.mixedWidths ? 'mixed' : 'padded';
  else c.padding = c.mixedWidths ? 'unpadded' : 'uniform';
  c.exposed = c.padding === 'padded' || c.padding === 'mixed' || c.padding === 'unpadded';
  return c;
}

const PADDING_NOTE = {
  padded: 'exposed: IDs are padded with zeros — a list that lost them would not match',
  mixed: (c) => `CHECK: IDs are padded, but ${n(c.shorterRows)} row(s) are shorter — they may have lost their zeros`,
  unpadded: 'exposed: IDs are numbered without padding — a list that pads them (the state\'s own file, say) would not match',
  uniform: 'safe: one width, no leading zeros — a spelling cannot differ',
  none: 'safe: IDs carry letters — a spelling cannot differ',
  empty: 'no voters yet',
};
const paddingNote = (c) => (typeof PADDING_NOTE[c.padding] === 'function' ? PADDING_NOTE[c.padding](c) : PADDING_NOTE[c.padding]);

// ── 2. One person, two spellings (across the organization) ────────────────────────────────────
async function mixedSpellings(scope) {
  return Voter.aggregate(
    [
      { $match: scope },
      {
        $project: {
          organizationId: 1,
          campaignId: 1,
          stateVoterId: 1,
          canon: CANON_EXPR,
          name: { $concat: [{ $toLower: { $ifNull: ['$lastName', ''] } }, ', ', { $toLower: { $ifNull: ['$firstName', ''] } }] },
          dob: '$dateOfBirth',
        },
      },
      { $match: { canon: { $ne: null } } },
      {
        $group: {
          _id: { org: '$organizationId', canon: '$canon' },
          rows: { $sum: 1 },
          spellings: { $addToSet: '$stateVoterId' },
          campaigns: { $addToSet: '$campaignId' },
          names: { $addToSet: '$name' },
          dobs: { $addToSet: '$dob' },
        },
      },
      { $match: { $expr: { $gt: [{ $size: '$spellings' }, 1] } } },
      { $sort: { rows: -1, '_id.canon': 1 } },
    ],
    { allowDiskUse: true }
  );
}

// ── 3. One person twice inside one campaign ───────────────────────────────────────────────────
// The unique index forbids the same STRING twice per campaign, so two rows here always means two
// spellings — a re-import that lost (or gained) zeros.
async function inCampaignTwins(scope) {
  return Voter.aggregate(
    [
      { $match: scope },
      { $project: { organizationId: 1, campaignId: 1, stateVoterId: 1, canon: CANON_EXPR } },
      { $match: { canon: { $ne: null } } },
      {
        $group: {
          _id: { org: '$organizationId', campaign: '$campaignId', canon: '$canon' },
          rows: { $sum: 1 },
          spellings: { $addToSet: '$stateVoterId' },
        },
      },
      { $match: { rows: { $gt: 1 } } },
      { $sort: { '_id.campaign': 1, '_id.canon': 1 } },
    ],
    { allowDiskUse: true }
  );
}

// ── 4. Person-directory keys that would collide ───────────────────────────────────────────────
// Person keys are (state, id) and unique per organization on the raw string. Two entries whose
// ids differ only by zeros are one human split in two — and the pair a stored-key migration would
// have to merge before its index could build.
async function personClashes(scope) {
  return Person.aggregate(
    [
      { $match: { ...scope, mergedInto: null } },
      { $unwind: '$svidKeys' },
      { $project: { organizationId: 1, state: '$svidKeys.registeredState', stateVoterId: '$svidKeys.stateVoterId' } },
      { $project: { organizationId: 1, state: 1, stateVoterId: 1, canon: CANON_EXPR } },
      { $match: { canon: { $ne: null } } },
      {
        $group: {
          _id: { org: '$organizationId', state: '$state', canon: '$canon' },
          persons: { $addToSet: '$_id' },
          spellings: { $addToSet: '$stateVoterId' },
        },
      },
      { $match: { $expr: { $or: [{ $gt: [{ $size: '$persons' }, 1] }, { $gt: [{ $size: '$spellings' }, 1] }] } } },
    ],
    { allowDiskUse: true }
  );
}

// ── 5. Parked IDs that would match only by zeros ──────────────────────────────────────────────
// A voted-list or do-not-contact upload parks every ID it could not match, to be honored when that
// voter is imported later. A parked ID whose voter IS here under the other spelling is a list that
// was uploaded stripped: the request is waiting on a zero. Early-vote parkings are per campaign;
// do-not-contact parkings are org-wide, like the flag.
async function parked(Model, scope, campaignScoped) {
  const pendings = await Model.find(scope, { organizationId: 1, campaignId: 1, stateVoterId: 1 }).lean();
  const out = new Map(); // orgId -> { parked, byZeros, exact, unmatched, samples }
  const byOrg = new Map();
  for (const p of pendings) {
    const k = String(p.organizationId);
    if (!byOrg.has(k)) byOrg.set(k, []);
    byOrg.get(k).push(p);
  }
  for (const [orgId, list] of byOrg) {
    const canons = [...new Set(list.map((p) => canonicalVoterId(p.stateVoterId)).filter(Boolean))];
    // canon -> [{ campaign, spellings }] for every voter in the org sharing a parked canon.
    const hits = new Map();
    for (let i = 0; i < canons.length; i += 5000) {
      const chunk = canons.slice(i, i + 5000);
      const rows = await Voter.aggregate(
        [
          { $match: { organizationId: new mongoose.Types.ObjectId(orgId) } },
          { $project: { campaignId: 1, stateVoterId: 1, canon: CANON_EXPR } },
          { $match: { canon: { $in: chunk } } },
          { $group: { _id: { campaign: '$campaignId', canon: '$canon' }, spellings: { $addToSet: '$stateVoterId' } } },
        ],
        { allowDiskUse: true }
      );
      for (const r of rows) {
        if (!hits.has(r._id.canon)) hits.set(r._id.canon, []);
        hits.get(r._id.canon).push({ campaign: String(r._id.campaign), spellings: r.spellings });
      }
    }
    const stat = { parked: list.length, byZeros: 0, exact: 0, unmatched: 0, samples: [], byCampaign: {} };
    for (const p of list) {
      const canon = canonicalVoterId(p.stateVoterId);
      const candidates = (canon && hits.get(canon)) || [];
      const inScope = campaignScoped ? candidates.filter((h) => h.campaign === String(p.campaignId)) : candidates;
      // Early-vote parkings belong to a campaign; a per-campaign tally says WHICH lists are waiting.
      const bucket = campaignScoped ? (stat.byCampaign[String(p.campaignId)] ||= { parked: 0, byZeros: 0, exact: 0, unmatched: 0 }) : null;
      if (bucket) bucket.parked += 1;
      if (!inScope.length) {
        stat.unmatched += 1;
        if (bucket) bucket.unmatched += 1;
      } else if (inScope.some((h) => h.spellings.includes(String(p.stateVoterId).trim()))) {
        stat.exact += 1; // the voter is here under this very spelling — should already have graduated
        if (bucket) bucket.exact += 1;
      } else {
        stat.byZeros += 1;
        if (bucket) bucket.byZeros += 1;
        if (stat.samples.length < SAMPLES) {
          stat.samples.push({
            parked: p.stateVoterId,
            campaignId: p.campaignId ? String(p.campaignId) : null,
            matches: inScope.map((h) => ({ campaignId: h.campaign, spellings: h.spellings })),
          });
        }
      }
    }
    out.set(orgId, stat);
  }
  return out;
}

async function main() {
  await connectDb(process.env.MONGODB_URI);

  let orgFilter = {};
  if (ORG_SLUG) {
    const org = await Organization.findOne({ slug: String(ORG_SLUG).toLowerCase().trim() }, { _id: 1 }).lean();
    if (!org) {
      console.error(`No organization with slug '${ORG_SLUG}'.`);
      await mongoose.disconnect();
      process.exit(1);
    }
    orgFilter = { organizationId: org._id };
  }

  const [orgs, campaigns] = await Promise.all([
    Organization.find(ORG_SLUG ? { _id: orgFilter.organizationId } : {}, { name: 1, slug: 1 }).lean(),
    Campaign.find(orgFilter, { name: 1, state: 1, organizationId: 1, isActive: 1, 'deletion.requestedAt': 1 }).lean(),
  ]);
  const campaignById = new Map(campaigns.map((c) => [String(c._id), c]));
  const campaignLabel = (id) => {
    const c = campaignById.get(String(id));
    if (!c) return `${id} (campaign no longer exists)`;
    const flags = c.deletion?.requestedAt ? ' · deleting' : c.isActive === false ? ' · archived' : '';
    return `${c.name} (${c.state}${flags})`;
  };
  const campaignState = (id) => campaignById.get(String(id))?.state || null;

  const [expo, mixed, twins, clashes, parkedVoted, parkedDnc] = await Promise.all([
    exposure(orgFilter),
    mixedSpellings(orgFilter),
    inCampaignTwins(orgFilter),
    personClashes(orgFilter),
    parked(VotedPendingId, orgFilter, true),
    parked(DncPendingId, orgFilter, false),
  ]);
  // A campaign with no voters yet has no rows to fold, so it would vanish from the table — and the
  // campaign you are about to import into is exactly the one you want to see listed.
  for (const c of campaigns) {
    if (!expo.has(String(c._id))) {
      expo.set(String(c._id), classify({ campaignId: String(c._id), organizationId: String(c.organizationId), voters: 0, numeric: 0, startsWithZero: 0, letters: 0, allZero: 0, widths: {} }));
    }
  }

  const report = { generatedAt: new Date().toISOString(), scope: ORG_SLUG || 'all organizations', organizations: [] };
  for (const org of orgs) {
    const oid = String(org._id);
    const orgCampaigns = [...expo.values()].filter((c) => c.organizationId === oid);
    const orgMixed = mixed.filter((g) => String(g._id.org) === oid);
    const orgTwins = twins.filter((g) => String(g._id.org) === oid);
    const orgClashes = clashes.filter((g) => String(g._id.org) === oid);

    const mixedRows = orgMixed.map((g) => {
      const states = [...new Set(g.campaigns.map(campaignState).filter(Boolean))];
      const dobs = g.dobs.filter(Boolean).map((d) => new Date(d).toISOString().slice(0, 10));
      return {
        canon: g._id.canon,
        spellings: g.spellings,
        rows: g.rows,
        campaigns: g.campaigns.map(String),
        names: g.names,
        differentPerson: g.names.length > 1 || new Set(dobs).size > 1,
        crossState: states.length > 1,
        states,
      };
    });
    const twinRows = orgTwins.map((g) => ({ campaignId: String(g._id.campaign), canon: g._id.canon, spellings: g.spellings, rows: g.rows }));
    const clashRows = orgClashes.map((g) => ({ state: g._id.state, canon: g._id.canon, persons: g.persons.map(String), spellings: g.spellings }));

    report.organizations.push({
      id: oid,
      name: org.name,
      slug: org.slug,
      campaigns: orgCampaigns
        .map((c) => ({ ...c, name: campaignById.get(c.campaignId)?.name || null, state: campaignState(c.campaignId) }))
        .sort((a, b) => (a.name || '').localeCompare(b.name || '')),
      mixedSpellings: {
        count: mixedRows.length,
        differentPerson: mixedRows.filter((r) => r.differentPerson).length,
        crossState: mixedRows.filter((r) => r.crossState).length,
        samples: mixedRows.slice(0, SAMPLES),
      },
      inCampaignTwins: { count: twinRows.length, samples: twinRows.slice(0, SAMPLES) },
      personClashes: { count: clashRows.length, samples: clashRows.slice(0, SAMPLES) },
      parked: {
        voted: parkedVoted.get(oid) || { parked: 0, byZeros: 0, exact: 0, unmatched: 0, samples: [] },
        dnc: parkedDnc.get(oid) || { parked: 0, byZeros: 0, exact: 0, unmatched: 0, samples: [] },
      },
    });
  }

  if (JSON_OUT) {
    console.log(JSON.stringify(report, null, 2));
    await mongoose.disconnect();
    return;
  }

  // ── Human report ───────────────────────────────────────────────────────────────────────────
  console.log(`Voter ID spellings — ${report.scope} — ${report.generatedAt.slice(0, 19).replace('T', ' ')} UTC`);
  console.log('Read-only. Nothing was changed.\n');
  let anyFinding = false;
  for (const o of report.organizations) {
    const voters = o.campaigns.reduce((s, c) => s + c.voters, 0);
    console.log(`== ${o.name} (${o.slug}) — ${n(o.campaigns.length)} campaign(s), ${n(voters)} voter row(s)\n`);

    console.log('  Exposure per campaign (could a list from another source spell these IDs differently?):');
    if (!o.campaigns.length) console.log('    (no campaigns)');
    for (const c of o.campaigns) {
      const widths = Object.entries(c.widths)
        .sort((a, b) => Number(a[0]) - Number(b[0]))
        .map(([w, k]) => `${w}: ${n(k)}`)
        .join(' · ');
      console.log(`    ${campaignLabel(c.campaignId)}`);
      if (c.padding === 'empty') {
        console.log(`      ${paddingNote(c)}`);
        continue;
      }
      console.log(
        `      ${n(c.voters)} voters · numeric ${pct(c.numeric, c.voters)} · start with 0: ${pct(c.startsWithZero, c.numeric)} · widths ${widths || '—'}` +
          `${c.letters ? ` · letters ${n(c.letters)}` : ''}${c.allZero ? ` · ALL-ZERO IDS ${n(c.allZero)}` : ''}`
      );
      console.log(`      ${paddingNote(c)}`);
    }

    console.log(`\n  Same person stored under two spellings (across campaigns): ${n(o.mixedSpellings.count)}`);
    for (const r of o.mixedSpellings.samples) {
      const tag = r.crossState ? '  STOP: campaigns in different states' : r.differentPerson ? '  CHECK: name or birth date differs' : '';
      console.log(`    ${r.spellings.join(' / ')} — ${r.campaigns.map(campaignLabel).join(', ')} — ${r.names.join(' | ')}${tag}`);
    }
    if (o.mixedSpellings.count > o.mixedSpellings.samples.length) console.log(`    … ${n(o.mixedSpellings.count - o.mixedSpellings.samples.length)} more`);
    if (o.mixedSpellings.count) {
      console.log(`    of which name/birth date differs (CHECK): ${n(o.mixedSpellings.differentPerson)} · in different states (STOP): ${n(o.mixedSpellings.crossState)}`);
    }

    console.log(`\n  Same person twice inside one campaign: ${n(o.inCampaignTwins.count)}`);
    for (const r of o.inCampaignTwins.samples) console.log(`    ${campaignLabel(r.campaignId)} — ${r.spellings.join(' / ')} (${r.rows} rows)`);
    if (o.inCampaignTwins.count > o.inCampaignTwins.samples.length) console.log(`    … ${n(o.inCampaignTwins.count - o.inCampaignTwins.samples.length)} more`);

    console.log(`\n  Person-directory entries that would collide once zeros are ignored: ${n(o.personClashes.count)}`);
    for (const r of o.personClashes.samples) console.log(`    ${r.state} ${r.spellings.join(' / ')} — ${r.persons.length} entries`);

    const pv = o.parked.voted;
    const pd = o.parked.dnc;
    console.log(`\n  Parked early-vote IDs matching a voter only after ignoring zeros: ${n(pv.byZeros)} of ${n(pv.parked)} parked` + (pv.exact ? ` (${n(pv.exact)} match exactly and should have graduated — check)` : ''));
    const parkedByCampaign = Object.entries(pv.byCampaign || {});
    if (parkedByCampaign.length) {
      console.log(`    parked by campaign: ${parkedByCampaign.map(([id, b]) => `${campaignLabel(id)}: ${n(b.parked)}${b.byZeros ? ` (${n(b.byZeros)} by zeros)` : ''}`).join(' · ')}`);
    }
    for (const s of pv.samples) console.log(`    ${s.parked} → ${s.matches.map((m) => m.spellings.join('/')).join(', ')} in ${campaignLabel(s.campaignId)}`);
    console.log(`  Parked do-not-contact IDs matching a voter only after ignoring zeros: ${n(pd.byZeros)} of ${n(pd.parked)} parked` + (pd.exact ? ` (${n(pd.exact)} match exactly and should have graduated — check)` : ''));
    for (const s of pd.samples) console.log(`    ${s.parked} → ${s.matches.map((m) => `${m.spellings.join('/')} in ${campaignLabel(m.campaignId)}`).join(', ')}`);

    const findings = o.mixedSpellings.count + o.inCampaignTwins.count + o.personClashes.count + pv.byZeros + pd.byZeros + o.campaigns.filter((c) => c.padding === 'mixed' || c.allZero).length;
    if (findings) anyFinding = true;
    console.log('');
  }

  const exposed = report.organizations.flatMap((o) => o.campaigns).filter((c) => c.exposed);
  console.log(
    anyFinding
      ? 'FINDINGS above. Nothing was changed; docs/PROPOSAL_VOTER_ID_KEYS.md says what each one means and what to do.'
      : 'Clean: no voter is stored under two spellings, no campaign holds the same person twice, no parked ID is\n' +
          'waiting on a zero.'
  );
  console.log(
    exposed.length
      ? `${n(exposed.length)} campaign(s) marked exposed above: a list or a re-sent file from a source that pads the IDs\n` +
          'differently would not match them today. Nothing to repair — that is what the matching fix is for.'
      : 'No campaign is exposed: every ID is one width with no leading zeros, or carries letters.'
  );
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
