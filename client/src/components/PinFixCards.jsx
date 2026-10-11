import { googleMapsUrl, cardCountLine } from '../lib/pinFixes.js';

// Pin Fixes' "Fix together" block (docs/PROPOSAL_PIN_FIXES_AT_SCALE_BUILD.md S10.2): one card per cause from
// buildGroups (lib/pinFixes.js) — its sentence, its busiest streets, its actions — then the condo complexes
// as one row each, then the collapsed Set aside list. Presentational: the page owns every request, the
// selection and the modes; this only renders and calls back.
//
//   cards        buildGroups().cards           complexRows  buildGroups().complexRows
//   setAside     the payload's set-aside rows   selection    the page's { key, source }
//   lookupGroup  the card kind a lookup is running for (null when none) — one lookup at a time
//   busy         a set-aside / bring-back / vouch is in flight
//   onAction(card, actionId)  lookup | place | setAside | check | show
//   onSelectComplex(row) · onVouchSpot(row) · onSpread(row) · onBringBack(row)
const ACTION_LABELS = {
  lookup: 'Look up by address',
  place: 'Place along the street',
  setAside: 'Set aside…',
  check: 'Start checking',
};

const btnPrimary =
  'rounded-md bg-brand-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-60';
const btnSecondary =
  'rounded-md border border-border-strong px-2.5 py-1 text-xs font-medium text-fg-muted hover:bg-sunken disabled:opacity-60';

const PinFixCards = ({
  cards = [],
  complexRows = [],
  setAside = [],
  selection = null,
  lookupGroup = null,
  busy = false,
  mapReady = false,
  onAction,
  onSelectComplex,
  onVouchSpot,
  onSpread,
  onBringBack,
}) => {
  if (!cards.length && !setAside.length) return null;
  return (
    <div className="border-b border-border px-4 py-3">
      {cards.length > 0 && (
        <div className="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Fix together</div>
      )}
      <div className="mt-2 space-y-2.5">
        {cards.map((card) => (
          <div key={card.kind} className="rounded-lg border border-border bg-card p-3">
            <div className="flex items-baseline justify-between gap-2">
              <div className="text-sm font-semibold text-fg">{card.title}</div>
              <div className="shrink-0 text-[11px] text-fg-muted">{cardCountLine(card)}</div>
            </div>
            <p className="mt-1 text-xs text-fg-muted">{card.blurb}</p>
            {card.streets?.length > 0 && (
              <p className="mt-1 truncate text-[11px] text-fg-subtle">
                {card.streets.map((s) => `${s.street} (${s.count.toLocaleString()})`).join(' · ')}
              </p>
            )}
            {card.kind === 'complexes' ? (
              <div className="mt-2 divide-y divide-border rounded border border-border">
                {complexRows.map((row) => {
                  const selected = selection?.key === row.rowKey;
                  return (
                    <div key={row.rowKey} className={selected ? 'bg-brand-tint/60' : undefined}>
                      <button
                        type="button"
                        onClick={() => onSelectComplex?.(row)}
                        className="block w-full px-2.5 py-1.5 text-left hover:bg-sunken"
                      >
                        <div className="truncate text-xs font-medium text-fg">{row.label}</div>
                      </button>
                      {selected && selection.source === 'list' && (
                        <div className="flex flex-wrap gap-2 px-2.5 pb-2">
                          <button type="button" onClick={() => onVouchSpot?.(row)} disabled={busy} className={btnPrimary}>
                            Looks right — it&apos;s a complex
                          </button>
                          <button
                            type="button"
                            onClick={() => onSpread?.(row)}
                            disabled={busy || !mapReady}
                            className={btnSecondary}
                          >
                            Spread on the map
                          </button>
                          {row.door && (
                            <a href={googleMapsUrl(row.door)} target="_blank" rel="noopener noreferrer" className={btnSecondary}>
                              Google Maps ↗
                            </a>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {card.actions.map((id, i) => {
                  const running = id === 'lookup' && lookupGroup === card.kind;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => onAction?.(card, id)}
                      disabled={
                        busy || (id === 'lookup' && !!lookupGroup) || ((id === 'place' || id === 'check') && !mapReady)
                      }
                      className={i === 0 ? btnPrimary : btnSecondary}
                    >
                      {running ? 'Looking up…' : ACTION_LABELS[id]}
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => onAction?.(card, 'show')}
                  className="ml-auto text-[11px] font-medium text-brand-accent hover:underline"
                >
                  Show homes ▾
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
      {setAside.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-medium text-fg-muted">
            Set aside ({setAside.length.toLocaleString()})
          </summary>
          <p className="mt-1 text-[11px] text-fg-subtle">
            Out of this list and every book cut until brought back. Moving or confirming a pin brings it back too.
          </p>
          <div className="mt-1.5 divide-y divide-border rounded border border-border">
            {setAside.map((h) => (
              <div key={h.id} className="flex items-center justify-between gap-2 px-2.5 py-1.5">
                <div className="min-w-0">
                  <div className="truncate text-xs font-medium text-fg">
                    {h.addressLine2 ? `${h.addressLine1} ${h.addressLine2}` : h.addressLine1}
                  </div>
                  <div className="truncate text-[11px] text-fg-subtle">
                    {h.city}, {h.state} {h.zipCode}
                  </div>
                </div>
                <button type="button" onClick={() => onBringBack?.(h)} disabled={busy} className={btnSecondary}>
                  Bring back
                </button>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
};

export default PinFixCards;
