import InfoHint from './InfoHint';
import { FLAG_LEGEND, FLAG_LEGEND_FOOTER, REASON_BY_KEY } from '../lib/flags';

// The flag-type legend behind a small (i) — shared by the admin audit header and the
// admin map's flag sheet so both surfaces explain the same five flags one way. Copy
// lives in lib/flags.js (FLAG_LEGEND, mirrored from the web client); weak-GPS sub-kinds
// fold into bullet lines because InfoHint's items are flat label+text pairs.
const LEGEND_ITEMS = [
  ...FLAG_LEGEND.map((l) => ({
    label: REASON_BY_KEY[l.key].label,
    text: l.kinds ? `${l.text}\n${l.kinds.map((k) => `• ${k.label} — ${k.text}`).join('\n')}` : l.text,
  })),
  { label: 'Severity & counts', text: FLAG_LEGEND_FOOTER },
];

export default function FlagLegendHint() {
  return <InfoHint title="Flag types" items={LEGEND_ITEMS} />;
}
