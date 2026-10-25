import mongoose from 'mongoose';

// One run of client reports: the whole campaign, one walk list, a TEAM (one or more crews the
// operator picked — owner ruling 10-24: one team name can cover several crews), or a team on one
// walk list. Every report carries its seriesId and a frozen scope.label; the client's tabs group by
// the series' opaque key and show its CURRENT label (docs/PROPOSAL_CLIENT_REPORTS_UPGRADE.md §F4,
// as amended by §O4). Found or created through ensureSeries (services/reports/clientReportSeries.js).
//
// Every tenant id is DECLARED: strictQuery strips undeclared filter keys, so a cascade delete on an
// undeclared organizationId would match — and wipe — every organization's series.
const clientReportSeriesSchema = new mongoose.Schema(
  {
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', required: true, index: true },
    kind: { type: String, enum: ['campaign', 'walk_list', 'team', 'team_walk_list'], required: true },
    // What the client reads (1-60 characters, operator-typed for teams; a walk list's frozen name,
    // " (2)" added when two share one). A team on one walk list stores NO label of its own: its name
    // is derived when read ("Volunteer team · North"), so renaming the team carries over.
    label: { type: String, default: null },
    // The label lowercased and trimmed — what the label index is unique on. The campaign series
    // has a fixed one ('whole campaign'), so no team can be named like it.
    labelKey: { type: String, default: null },
    effortId: { type: mongoose.Schema.Types.ObjectId, ref: 'Effort', default: null },
    // A team on one walk list reads its crews, its name and its ended state from this parent team.
    teamSeriesId: { type: mongoose.Schema.Types.ObjectId, ref: 'ClientReportSeries', default: null },
    // Team series: the coordinators whose crews it covers now, and those kept after they stopped
    // running a crew here ("Keep her past doors in Paid team"). The team's numbers cover both.
    coordinatorIds: { type: [mongoose.Schema.Types.ObjectId], default: [] },
    pastCoordinatorIds: { type: [mongoose.Schema.Types.ObjectId], default: [] },
    // coordinatorIds ∪ pastCoordinatorIds, stored, because the crew index below is on it: a crew
    // can't be in two active teams, current or past (§O4).
    crewKeys: { type: [mongoose.Schema.Types.ObjectId], default: [] },
    endedAt: { type: Date, default: null },
    endedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

// The five partial-unique indexes, EXACTLY as §O4 states them. Index definitions are final at first
// deploy: once these collections hold data, a changed partial filter makes the boot-time
// syncIndexes drop and rebuild a unique index on a live collection (§O9). Duplicate-key errors map
// by index NAME to 409s (clientReportSeries.js), so the names are fixed here too.
//   1. One active series per label among the kinds that have their own (a team on a walk list
//      derives its name and is unique by its parent and walk list instead).
clientReportSeriesSchema.index(
  { campaignId: 1, labelKey: 1 },
  {
    unique: true,
    name: 'series_label_unique',
    partialFilterExpression: { endedAt: null, kind: { $in: ['campaign', 'walk_list', 'team'] } },
  }
);
//   2. One active whole-campaign series per campaign.
clientReportSeriesSchema.index(
  { campaignId: 1, kind: 1 },
  { unique: true, name: 'series_campaign_unique', partialFilterExpression: { endedAt: null, kind: 'campaign' } }
);
//   3. One active series per walk list.
clientReportSeriesSchema.index(
  { campaignId: 1, effortId: 1 },
  { unique: true, name: 'series_walk_list_unique', partialFilterExpression: { endedAt: null, kind: 'walk_list' } }
);
//   4. A crew belongs to at most one active team, current or past (multikey). Teams whose crews are
//      all gone (empty crewKeys) are outside the filter, so two such teams coexist.
clientReportSeriesSchema.index(
  { campaignId: 1, crewKeys: 1 },
  {
    unique: true,
    name: 'series_crew_unique',
    partialFilterExpression: { endedAt: null, kind: 'team', 'crewKeys.0': { $exists: true } },
  }
);
//   5. One active series per team per walk list.
clientReportSeriesSchema.index(
  { campaignId: 1, teamSeriesId: 1, effortId: 1 },
  {
    unique: true,
    name: 'series_team_walk_list_unique',
    partialFilterExpression: { endedAt: null, kind: 'team_walk_list' },
  }
);

export const ClientReportSeries = mongoose.model('ClientReportSeries', clientReportSeriesSchema);
