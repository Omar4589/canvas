import { isMonthStr } from './months.js';

// The org page's URL contract, in one place because six other surfaces link INTO it.
//
// Tab state used to live in component state, which was defensible when the billing panel was
// rendered inline against a selection on another page. Once the org page IS the org, the tab and
// the month someone is looking at are part of the address: reloading, sharing a link, or pressing
// Back should all land where you were.

export const ORG_TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'campaigns', label: 'Campaigns' },
  { key: 'statements', label: 'Statements' },
  { key: 'members', label: 'Members' },
  { key: 'account', label: 'Account' },
];

export const ORG_TAB_KEYS = ORG_TABS.map((t) => t.key);

// An unknown tab falls back to overview rather than rendering nothing; a malformed month is
// ignored rather than passed to a fetch that would 400.
export const parseOrgPage = (searchParams) => {
  const tab = searchParams?.get?.('tab');
  const month = searchParams?.get?.('month');
  return {
    tab: ORG_TAB_KEYS.includes(tab) ? tab : 'overview',
    month: isMonthStr(month) ? month : null,
  };
};

export const orgPagePath = (orgId, { tab, month } = {}) => {
  const params = new URLSearchParams();
  if (tab && tab !== 'overview') params.set('tab', tab);
  if (month && isMonthStr(month)) params.set('month', month);
  const qs = params.toString();
  return `/organizations/${orgId}${qs ? `?${qs}` : ''}`;
};
