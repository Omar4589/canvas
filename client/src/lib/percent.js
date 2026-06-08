// Round a set of counts into percentages that sum to EXACTLY 100 (to `decimals` places), using the
// largest-remainder (Hamilton) method: floor each share to the granularity, then hand the leftover
// increments to the options with the largest fractional remainders. This avoids the "independent
// rounding" artifact where bars can read 99.9–100.1%. Returns an array aligned to `counts`
// (total 0 → all 0; float error in a would-be-exact value is absorbed by the remainder pass).
export function percentsTo100(counts, decimals = 1) {
  const nums = counts.map((c) => (Number.isFinite(c) && c > 0 ? c : 0));
  const total = nums.reduce((s, c) => s + c, 0);
  if (total <= 0) return nums.map(() => 0);

  const scale = Math.pow(10, decimals); // tenths for decimals = 1
  const target = 100 * scale; // total integer "units" to distribute (e.g. 1000 tenths)
  const raw = nums.map((c) => (c / total) * target);
  const floors = raw.map((r) => Math.floor(r));

  let remaining = target - floors.reduce((s, f) => s + f, 0); // integer leftover units
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);

  const units = floors.slice();
  for (let k = 0; k < order.length && remaining > 0; k++, remaining--) units[order[k].i] += 1;

  return units.map((u) => u / scale);
}
