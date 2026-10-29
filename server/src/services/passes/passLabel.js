// "Pass 3 · GOTV", or "Pass 3" when the name only repeats the number (an auto-named pass). The
// server's words for a pass in refusals and History rows; the clients use walkListOptions.js.
export const passLabel = (pass) => {
  const n = pass?.roundNumber;
  const base = n == null ? 'Pass' : `Pass ${n}`;
  const name = String(pass?.name || '').trim();
  return name && name !== base ? `${base} · ${name}` : base;
};
