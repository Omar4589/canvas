// Money formatting, in a plain .js module on purpose.
//
// It used to live in billingStatus.jsx beside the pills. That is fine for a component, but the
// pure invoicing libs need it too, and `node --test` cannot load a .jsx file — so importing it
// from there would have made every one of those libs untestable without a bundler. Splitting the
// one function out keeps the test runner able to reach the logic that decides what a customer is
// told they owe. billingStatus.jsx re-exports it, so no existing import changes.

// Cents → '$300' / '$312.50'. Null is an EM DASH, not '$0': "we don't know yet" and "nothing" are
// different answers on a billing surface, and a $0 shown where a figure is still loading is the
// kind of wrong number nobody double-checks.
export function fmtUsd(cents) {
  if (cents == null) return '—';
  const dollars = cents / 100;
  return dollars % 1 === 0 ? `$${dollars.toLocaleString()}` : `$${dollars.toFixed(2)}`;
}
