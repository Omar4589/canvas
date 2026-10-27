// "Who gets the email" on the Settings page (docs/PROPOSAL_PEOPLE_PAGES.md §C): the people a billing
// admin added, a search to add one more, and what a Save sends. Pure, so the rules are tested
// directly (recipientPicker.test.js); components/settings/RecipientPicker.jsx lays them out.
//
// The settings answer (GET /admin/pace-pauses/settings):
//   alertUserIds  every stored pick
//   chosen        [{ userId, name, role, eligible }], one per stored pick, named even when they are no
//                 longer an admin or team lead (eligible: false) — a server before this one sends none
//   eligible      [{ userId, name, role, billingAdmin }], everyone who can be picked

export const MAX_RECIPIENTS = 25;
export const MAX_MATCHES = 8;
export const STALE_LINE = 'Not emailed: no longer an admin or team lead';

const ROLE = { admin: 'Org admin', lead: 'Team lead' };

export const roleLine = (p) => `${ROLE[p.role] || p.role || 'Member'}${p.billingAdmin ? ' · billing admin' : ''}`;

const eligibleById = (s) => new Map((s?.eligible || []).map((p) => [String(p.userId), p]));

// The rows under "Also email", in the order they were picked. A pick who can still be emailed reads
// their role; one who can't reads STALE_LINE. Someone just added comes from `eligible`.
export const chosenRows = (s, ids) => {
  const pickable = eligibleById(s);
  const stored = new Map((s?.chosen || []).map((c) => [String(c.userId), c]));
  return ids.map((raw) => {
    const id = String(raw);
    const live = pickable.get(id);
    if (live) return { userId: id, name: live.name, eligible: true, line: roleLine(live) };
    const c = stored.get(id);
    return { userId: id, name: c?.name || 'Unknown user', eligible: false, line: STALE_LINE };
  });
};

// How many picks a Save keeps — the limit counts these.
export const keptCount = (s, ids) => {
  const pickable = eligibleById(s);
  return ids.filter((id) => pickable.has(String(id))).length;
};

export const atLimit = (s, ids) => keptCount(s, ids) >= MAX_RECIPIENTS;

// The search: pickable people not already chosen whose name has every typed word, at most 8.
export const matches = (s, ids, text, max = MAX_MATCHES) => {
  const words = String(text || '').toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const taken = new Set(ids.map(String));
  return (s?.eligible || [])
    .filter((p) => !taken.has(String(p.userId)))
    .filter((p) => {
      const name = String(p.name || '').toLowerCase();
      return words.every((w) => name.includes(w));
    })
    .slice(0, max);
};

// Save sends only picks who can be emailed, which is what drops a stale one (before, a stale pick made
// every Save fail, even turning the switch off).
export const saveIds = (s, ids) => {
  const pickable = eligibleById(s);
  return [...new Set(ids.map(String))].filter((id) => pickable.has(id));
};

// Whether the draft differs from what is stored.
export const settingsChanged = (s, draft) =>
  draft.enabled !== s.enabled ||
  draft.billingAdmins !== s.billingAdmins ||
  [...draft.alertUserIds].map(String).sort().join() !== [...s.alertUserIds].map(String).sort().join();
