import { CanvassActivity } from '../../models/CanvassActivity.js';
import { KNOCK_ACTIONS } from './aggregations.js';
import { zonedDayStr } from '../../utils/timezone.js';

/**
 * Where an all-time report starts (Latest progress, docs/PROPOSAL_CLIENT_REPORTS_SIMPLIFY.md §N): the
 * day of the campaign's first knock in its zone, today when nobody has knocked yet, and never after the
 * report's last day. The running total has no start anyway (buildReportSnapshot's cumulative window);
 * this only makes the report's dates say where its numbers begin ("Sep 14 – Oct 28"), and its period
 * equal its running total, so it has nothing new to show. One read: the earliest knock, on the
 * { campaignId, timestamp } index.
 */
export const allTimeStartOf = async ({ campaignId, tz, weekEnd, today }) => {
  const first = await CanvassActivity.findOne({ campaignId, actionType: { $in: KNOCK_ACTIONS } }, { timestamp: 1 })
    .sort({ timestamp: 1 })
    .lean();
  const day = (first?.timestamp && zonedDayStr(new Date(first.timestamp), tz)) || today;
  return day < weekEnd ? day : weekEnd;
};
