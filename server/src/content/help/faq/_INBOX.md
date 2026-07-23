# FAQ inbox — questions to turn into help content

Drop raw questions here as they come up (from users, support, or your own testing). This
file is **not served** (the `_` prefix keeps the loader from publishing it). Periodically
triage each item into a real FAQ entry in this folder (or a guide), then delete it here.

Format: one question per line, optionally with a note on where the answer lives.

## Incoming

- (add questions here)
- "Why is a door flagged 'far from house' when the canvasser just corrected an earlier entry?" → covered in guides/audit.md (corrections show as low severity with a *Replaced …* context line)
- "Why can't I move a pin anymore? The 'Fix pin location' button is gone." → canvassers no longer can — it's a lead/admin data change now; guides/canvasser-map.md + CANVASSER_APP.md
- "A door was flagged far-from-house, I moved the pin to the right place, and the flag is still there — why?" → it drops to LOW, it doesn't vanish (and lows still count in the Far KPI until reviewed); guides/audit.md
- "The app says location is required — why won't it record my door?" → answered in faq/why-location-required.md
- "Does canvassing still work with no signal / location off?" → signal yes, location no — guides/canvasser-offline.md + faq/why-location-required.md
- "What does the 'Mock location' flag on the Audit page mean?" → covered in guides/audit.md (fake-GPS app detected by the phone; always high severity; silent to the canvasser)
- "Does reviewing or dismissing a flag remove that door from client reports?" → no — a review is a recorded decision only; covered in guides/audit.md + guides/client-reports.md (mock flags warn at publish time)

## Triaged (answered — safe to delete)

- "I uploaded a second voter file — now what?" → add-a-second-voter-file.md
- "I forgot my password" → reset-my-password.md
