---
slug: fixed-fbtime-shift-not-updating
title: I fixed a shift in FbTime — when does Doorline update?
audience: admin
kind: faq
order: 63
sourceDoc: FBTIME_INTEGRATION.md
summary: How quickly a timesheet correction in FbTime reaches doors-per-hour, and the Refresh hours button for when you don't want to wait.
tags: fbtime, hours, doors per hour, refresh, sync, timesheet, edit, clock in, not updating
---

It updates on its own — the only question is when. Doorline re-checks FbTime on a schedule:

- **Shifts from the last 7 days** — re-checked about **every 15 minutes**. Fix a recent clock-in
  and the corrected doors-per-hour is there the next time you load the report, within a quarter
  hour at most.
- **Older shifts** (up to the last few months) — re-checked **overnight**. A correction to a
  weeks-old timesheet shows up by the next morning.

Every kind of correction comes across: an edited clock-in or clock-out, a shift someone finally
closed, even an entry that was deleted outright.

**Don't want to wait for the overnight pass?** Press **Refresh hours** in the connection bar at
the top of the Integrations
page. It re-pulls the last few months from FbTime on the spot — usually done in seconds — and
tells you when the numbers are in. It can be pressed once a minute.

Two things worth knowing:

- Doors-per-hour is computed fresh every time a report loads — there's no stale saved number to
  clear. The only thing that can lag is Doorline's copy of the hours, and that's what the
  schedule (or the button) refreshes.
- If a report page was already open, reload it (or tab back to it) after the refresh to see the
  new number.

See [Measured hours from FbTime](fbtime-hours) for how the integration works, and
[Why does doors-per-hour say "estimated"?](why-does-doors-per-hour-say-estimated) for what the
markers beside the number mean.
