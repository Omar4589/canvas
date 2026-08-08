import { LAYOUTS } from '../../lib/packet/packetSettings.js';
import { MIN_DOORS_PER_PACKET } from '../../lib/packet/splitBooks.js';
import { Button, Input, Select } from '../ui/index.js';

const Toggle = ({ id, label, hint, checked, onChange, disabled }) => (
  <label
    htmlFor={id}
    className={`flex items-start justify-between gap-3 py-2.5 border-b border-border last:border-0 ${
      disabled ? 'opacity-50' : 'cursor-pointer'
    }`}
  >
    <span className="min-w-0">
      <span className="block text-sm text-fg">{label}</span>
      {hint && <span className="block text-xs text-fg-muted mt-0.5">{hint}</span>}
    </span>
    <input
      id={id}
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={(e) => onChange(e.target.checked)}
      className="mt-0.5 h-4 w-4 shrink-0 accent-brand-accent"
    />
  </label>
);

export default function DesignPanel({
  settings, onChange, hasSurvey, unprintable, pages, doorCount, packetCount = 1, hasPick, busy, onDownload,
}) {
  const set = (patch) => onChange({ ...settings, ...patch });
  const sheets = pages && settings.duplex ? Math.ceil(pages / 2) : 0;

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex-1 min-h-0 overflow-y-auto pr-1">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-fg-muted mb-2">Layout</h3>
        <div className="space-y-1.5 mb-5">
          {LAYOUTS.map((l) => {
            const disabled = l.needsSurvey && !hasSurvey;
            const on = settings.layout === l.id && !disabled;
            return (
              <button
                key={l.id}
                type="button"
                disabled={disabled}
                onClick={() => set({ layout: l.id })}
                aria-pressed={on}
                className={`w-full text-left px-3 py-2.5 rounded-md border transition-colors ${
                  on ? 'border-brand-accent bg-brand-tint' : 'border-border bg-card hover:bg-sunken'
                } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <span className="block text-sm font-medium text-fg">{l.label}</span>
                <span className="block text-xs text-fg-muted mt-0.5">
                  {disabled ? 'This campaign has no survey set up.' : l.hint}
                </span>
              </button>
            );
          })}
        </div>

        <h3 className="text-xs font-semibold uppercase tracking-wider text-fg-muted mb-1">The page</h3>
        <div>
          <label htmlFor="noteLines" className="flex items-center justify-between gap-3 py-2.5 border-b border-border">
            <span className="text-sm text-fg">Lines to write on</span>
            <Select
              id="noteLines"
              value={String(settings.noteLines)}
              onChange={(e) => set({ noteLines: Number(e.target.value) })}
              className="w-20"
            >
              {[0, 1, 2, 3, 4, 5, 6].map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </Select>
          </label>
          {/* Values 1-9 read as off too (splitBooks ignores them) — clamping while someone
              is mid-typing "35" would yank the field out from under them. */}
          <label htmlFor="doorsPerPacket" className="flex items-start justify-between gap-3 py-2.5 border-b border-border">
            <span className="min-w-0">
              <span className="block text-sm text-fg">Doors per packet</span>
              <span className="block text-xs text-fg-muted mt-0.5">
                Splits big books into packets of about this many doors — one per volunteer.
                Blank prints whole books.
              </span>
            </span>
            {/* Width lives on a wrapper: ui/Input hard-codes w-full, which beats a caller's
                w-20 in the compiled stylesheet order, so the input fills a fixed box instead. */}
            <span className="block w-20 shrink-0">
              <Input
                id="doorsPerPacket"
                type="number"
                min={MIN_DOORS_PER_PACKET}
                max={500}
                step={5}
                placeholder="—"
                value={settings.doorsPerPacket || ''}
                onChange={(e) => {
                  const n = Math.floor(Number(e.target.value));
                  set({ doorsPerPacket: Number.isFinite(n) && n > 0 ? n : 0 });
                }}
              />
            </span>
          </label>
          <Toggle
            id="showOutcome" label="What happened boxes"
            hint="Not home, refused, wrong address…"
            checked={settings.showOutcome} onChange={(v) => set({ showOutcome: v })}
          />
          <Toggle
            id="showPriorStatus" label="Last round's result"
            hint="Shows on doors already visited this round."
            checked={settings.showPriorStatus} onChange={(v) => set({ showPriorStatus: v })}
          />
          <Toggle
            id="showScriptPage" label="What to say"
            hint="Opens the first door page — your opening, closing and option scripts, once."
            checked={settings.showScriptPage} onChange={(v) => set({ showScriptPage: v })}
            disabled={settings.layout !== 'survey' || !hasSurvey}
          />
          <Toggle
            id="showCoverMap" label="Map on the cover"
            hint="The book on a map with the walk drawn over it."
            checked={settings.showCoverMap} onChange={(v) => set({ showCoverMap: v })}
          />
          <Toggle
            id="duplex" label="Printing double-sided"
            hint="Starts every packet on a fresh sheet so two books never share one."
            checked={settings.duplex} onChange={(v) => set({ duplex: v })}
          />
          <Toggle
            id="showManifest" label="Hand-out sheet"
            hint="One line per packet, with room to sign them out."
            checked={settings.showManifest} onChange={(v) => set({ showManifest: v })}
          />
          <Toggle
            id="excludeApartments" label="Skip apartments"
            hint="Drops units in multi-unit buildings — locked lobbies eat a shift."
            checked={settings.excludeApartments} onChange={(v) => set({ excludeApartments: v })}
          />
          <Toggle
            id="includePhone" label="Phone numbers"
            hint="Phone numbers on paper can't be recalled."
            checked={settings.includePhone} onChange={(v) => set({ includePhone: v })}
          />
        </div>

        {unprintable?.count > 0 && (
          <p className="mt-4 text-xs bg-warning-tint text-fg rounded-md px-3 py-2 border-l-2 border-warning">
            {unprintable.count} name{unprintable.count === 1 ? '' : 's'} contain characters that can&apos;t
            print. They&apos;ll appear simplified.
          </p>
        )}
      </div>

      <div className="pt-4 border-t border-border mt-4">
        {/* Nothing picked yet means no numbers to show — a bare "0 doors" reads as an error. */}
        {hasPick && (
          <div className="flex items-baseline justify-between text-sm mb-2">
            <span className="text-fg-muted tabular-nums">{doorCount.toLocaleString()} doors</span>
            <span className="font-medium text-fg tabular-nums">
              {pages ? `${pages} pages${sheets ? ` · ${sheets} sheets` : ''}` : 'building…'}
            </span>
          </div>
        )}
        <Button className="w-full" onClick={onDownload} disabled={busy || !pages}>
          {busy ? 'Building…' : hasPick ? 'Download packets' : 'Pick a book to print'}
        </Button>
        {hasPick && packetCount > 1 && (
          <p className="mt-1.5 text-[11px] text-fg-muted text-center">
            Downloads a folder (ZIP) — one PDF per packet, plus the hand-out sheet.
          </p>
        )}
      </div>
    </div>
  );
}
