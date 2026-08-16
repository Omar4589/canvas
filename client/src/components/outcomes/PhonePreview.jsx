import { STATUS_COLORS } from '../../lib/statusColors.js';

// A miniature of the canvasser door screen, rendered live against the toggle state so an admin
// sees exactly which buttons their canvassers will have. Colors come from STATUS_COLORS, which
// the mirror tests keep in lockstep with mobile/lib/theme.js — so the preview cannot drift from
// the real app's palette. Purely decorative (the checkboxes are the controls): aria-hidden.
//
// Button set + order mirror mobile/app/(app)/household/[id].jsx: survey campaigns show
// Not home / Wrong address / Refused then the two signage outcomes; lit-drop shows Lit dropped
// then the signage pair. `always` marks the buttons no toggle can remove.

const BUTTONS = {
  survey: [
    { key: 'not_home', label: 'Not home', always: true },
    { key: 'wrong_address', label: 'Wrong address' },
    { key: 'refused', label: 'Refused' },
    { key: 'no_soliciting', label: 'No soliciting' },
    { key: 'restricted', label: 'Restricted access' },
  ],
  lit_drop: [
    { key: 'lit_dropped', label: 'Lit dropped', always: true },
    { key: 'no_soliciting', label: 'No soliciting' },
    { key: 'restricted', label: 'Restricted access' },
  ],
};

const PhonePreview = ({ campaignType, disabledOutcomes }) => {
  const kind = campaignType === 'lit_drop' ? 'lit_drop' : 'survey';
  const off = new Set(disabledOutcomes || []);

  return (
    <div aria-hidden className="select-none">
      <div className="w-[248px] rounded-[2.4rem] bg-fg p-2 shadow-raised">
        <div className="overflow-hidden rounded-[1.9rem] bg-surface">
          {/* Status bar */}
          <div className="flex items-center justify-between px-5 pb-1 pt-2.5 text-[9px] font-semibold text-fg">
            <span>9:41</span>
            <span className="flex items-end gap-[2.5px]">
              <span className="h-[4px] w-[3px] rounded-sm bg-fg" />
              <span className="h-[6px] w-[3px] rounded-sm bg-fg" />
              <span className="h-[8px] w-[3px] rounded-sm bg-fg" />
              <span className="ml-1.5 inline-block h-[9px] w-[17px] rounded-[3px] border border-border-strong p-[1.5px]">
                <span className="block h-full w-3/4 rounded-[1px] bg-fg" />
              </span>
            </span>
          </div>

          {/* Door header — matches the door screen: address, last visit, status pill */}
          <div className="px-4 pt-1.5">
            <div className="text-[8px] font-semibold text-brand-accent">‹ Map</div>
            <div className="mt-1 text-[13px] font-bold leading-tight text-fg">128 Maple St</div>
            <div className="mt-1 flex items-center gap-1.5 text-[8.5px] text-fg-muted">
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: STATUS_COLORS.unknocked }}
              />
              Unknocked · not yet visited
            </div>
          </div>

          {/* Voter card — survey campaigns lead with the people at the door */}
          {kind === 'survey' && (
            <div className="mx-4 mt-2.5 rounded-lg border border-border bg-card px-3 py-2 shadow-card">
              <div className="text-[10px] font-semibold text-fg">Alex Rivera</div>
              <div className="mt-0.5 text-[8px] text-fg-muted">Democratic · 34 yrs · Female</div>
            </div>
          )}

          {/* Note field mock */}
          <div className="mx-4 mt-2 rounded-lg border border-border bg-card px-3 py-1.5 text-[8.5px] text-fg-subtle">
            Add a note…
          </div>

          {/* The outcome buttons — the part the toggles change. A toggled-off button collapses
              out with a transition so the flip reads as the phone updating. */}
          <div className="px-4 pb-3 pt-1">
            {BUTTONS[kind].map((b) => {
              const hidden = !b.always && off.has(b.key);
              return (
                <div
                  key={b.key}
                  className={[
                    'overflow-hidden transition-all duration-300 ease-out',
                    hidden ? 'mt-0 max-h-0 opacity-0' : 'mt-1.5 max-h-9 opacity-100',
                  ].join(' ')}
                >
                  <div
                    className="rounded-lg py-[7px] text-center text-[10px] font-bold text-white"
                    style={{ backgroundColor: STATUS_COLORS[b.key] }}
                  >
                    {b.label}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Home indicator */}
          <div className="pb-2">
            <div className="mx-auto h-1 w-24 rounded-full bg-border-strong" />
          </div>
        </div>
      </div>
      <div className="mt-2 text-center text-xs text-fg-muted">Live preview — the door screen your canvassers see</div>
    </div>
  );
};

export default PhonePreview;
