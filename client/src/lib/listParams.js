// A list page's state in the address — its filters, sort, page and the open person
// (docs/PROPOSAL_PEOPLE_PAGES.md §D.3). Pure, so the rules are tested directly (listParams.test.js);
// lib/useListParams.js is the hook the Team and Users pages read it through.
//
// Written by REPLACE, never push: a filter is a view of the page, not a place you went, so Back
// leaves the page. A write that would change nothing is skipped (the deskParams precedent in
// OrganizationsPage.jsx). Keys the page doesn't own, like the Users page's ?return=, pass through.

// The page's keys, each falling back to its default.
export const readParams = (searchParams, defaults) =>
  Object.fromEntries(Object.entries(defaults).map(([k, d]) => [k, searchParams.get(k) ?? d]));

// The address after `patch`: every current key kept, the patched ones set, and a key left out when it
// is empty or at its default — so the address only ever says what differs from how the page opens.
export const nextParams = (searchParams, patch, defaults) => {
  const out = new URLSearchParams(searchParams);
  for (const [k, v] of Object.entries(patch)) {
    const s = v == null ? '' : String(v);
    if (s === '' || (Object.hasOwn(defaults, k) && s === String(defaults[k]))) out.delete(k);
    else out.set(k, s);
  }
  return out;
};

// Same keys and values, in any order.
export const sameParams = (a, b) => {
  const flat = (p) => [...new URLSearchParams(p).entries()].map(([k, v]) => `${k}=${v}`).sort().join('&');
  return flat(a) === flat(b);
};
