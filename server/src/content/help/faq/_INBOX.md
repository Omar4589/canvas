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
- "Where's the walk-list filter? The help mentions one but my map / dashboard / audit doesn't have it." → it only appears once the campaign has **2+ walk lists** (single-list campaigns hide it everywhere — map, dashboard, timeline, audit, mobile pills); each surface's article now mentions the filter, but none states the 2+ rule as the headline — candidate FAQ if it recurs
- "I deleted a duplicate survey on my phone — my Surveys number dropped but Survey doors didn't. Is that a bug?" → no, by design: deleting a response moves the survey count only, and the knock/door record survives (that's why the confirm says so); METRICS.md §Surveys + pages/page-duplicate-surveys
- "Where do I download the app? / Do I still have to be added as a tester?" → both stores went public 2026-07-28; answered in guides/canvasser-install-app.md + getting-started/canvasser-first-day.md step 1 + faq/why-cant-i-see-my-other-org.md. 2026-07-29: there is now a **public, no-login** page at doorline.app/app carrying both store badges + the "you need an account from your campaign first" warning — that's the link to give anyone who can't reach the Help Center (it's login-walled) or lost their invite email.
- "Why did the app ask me if I want to replace another canvasser's survey?" → a teammate already surveyed that voter this round; usually a book mix-up — check with your lead. Answered in guides/canvasser-door-survey.md
- "A canvasser re-surveyed a voter someone else already did — where did the first answers go?" → preserved, not lost: listed under **Same round · overwritten** on the Duplicate Surveys page, restorable by an admin — pages/page-duplicate-surveys.md
- "Why didn't the app warn before replacing a survey?" → the confirm needs a fresh sync; offline / a stale cache fails open **by design**, and the replaced answers are preserved server-side either way — guides/canvasser-door-survey.md + pages/page-duplicate-surveys.md

## Triaged (answered — safe to delete)

- "I uploaded a second voter file — now what?" → add-a-second-voter-file.md
- "I forgot my password" → reset-my-password.md
