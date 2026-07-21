// The confirmation an admin (or a team lead) sees before a coordinator change commits.
//
// Changing someone's coordinator re-stamps their whole knock history onto the new team, so a
// number the admin may already have quoted can move. Both assignment surfaces — the org Users
// modal and the campaign crew panel — render THIS component, so a lead and an admin never see
// different wording for the same act.
//
// The headline unit is DOORS (distinct household+pass), because that is what every by-team figure
// counts. `activities`/`surveys` are raw ledger rows and are shown only as detail — quoting the row
// count next to the word "doors" would make the team row move by less than the confirmation
// promised, and the feature would read as broken.
export default function CoordinatorConfirm({
  preview,
  isLoading,
  error,
  subjectName,
  busy,
  onCancel,
  onConfirm,
}) {
  const fromName = preview?.from?.name || null;
  const toName = preview?.to?.name || null;
  const doors = preview?.doors || 0;
  const surveys = preview?.surveys || 0;

  return (
    <div className="mt-3 rounded-md border border-brand-600 bg-brand-tint px-4 py-3">
      {isLoading ? (
        <p className="text-sm text-fg-muted">Checking what would move…</p>
      ) : error ? (
        <p className="text-sm text-fg">Couldn’t check what would move. {error.message}</p>
      ) : (
        <>
          <p className="text-sm text-fg">
            {doors > 0 ? (
              <>
                Move <strong>{doors.toLocaleString()}</strong> door
                {doors === 1 ? '' : 's'}
                {surveys > 0 ? (
                  <>
                    {' '}
                    and <strong>{surveys.toLocaleString()}</strong> survey
                    {surveys === 1 ? '' : 's'}
                  </>
                ) : null}{' '}
                {fromName ? (
                  <>
                    from <strong>{fromName}</strong>’s team
                  </>
                ) : (
                  <>from “No team”</>
                )}{' '}
                {toName ? (
                  <>
                    to <strong>{toName}</strong>’s team?
                  </>
                ) : (
                  <>to “No team”?</>
                )}
              </>
            ) : (
              <>
                {subjectName} has no past doors to move.{' '}
                {toName ? (
                  <>
                    New work will count toward <strong>{toName}</strong>’s team.
                  </>
                ) : (
                  <>New work will count toward no team.</>
                )}
              </>
            )}
          </p>

          {doors > 0 ? (
            <p className="mt-1.5 text-xs text-fg-muted">
              This changes both teams’ totals, for every campaign and all time. It does not change
              campaign totals, coverage, or your bill. You can move them back by setting the
              coordinator back.
            </p>
          ) : null}

          {preview?.subjectRunsCrew ? (
            <p className="mt-1.5 text-xs text-fg">
              <strong>{subjectName}</strong> runs a crew. Their <em>own</em> doors move
              {toName ? (
                <>
                  {' '}
                  onto <strong>{toName}</strong>’s team
                </>
              ) : null}
              ; their crew’s doors stay with them.
            </p>
          ) : null}

          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={onConfirm}
              disabled={busy}
              className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 disabled:opacity-50"
            >
              {busy ? 'Moving…' : doors > 0 ? 'Move them' : 'Save'}
            </button>
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="rounded-md border border-border-strong bg-card px-3 py-1.5 text-sm font-medium text-fg transition-colors hover:bg-surface disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  );
}
