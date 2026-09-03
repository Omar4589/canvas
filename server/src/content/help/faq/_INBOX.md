# FAQ inbox — questions to turn into help content

Drop raw questions here as they come up (from users, support, or your own testing). This
file is **not served** (the `_` prefix keeps the loader from publishing it). Periodically
triage each item into a real FAQ entry in this folder (or a guide), then delete it here.

Format: one question per line, optionally with a note on where the answer lives.

## Incoming

- (add questions here)
- ~~"I'm invoicing a client for July and August but the Billing page only shows September."~~ → DONE 2026-09-02: triaged into faq/can-i-see-previous-months.md + the new pages/page-billing.md + guides/billing.md "Looking back at previous months". The page now carries a 12/24-month history; on the staff side the org's Billing panel has a History tab that issues several months under one invoice number.
- "Why doesn't the map's count match the Turf Cutting page / my walk list?" → they count different things: the map's "N match · of M in campaign" is campaign-wide (M includes excluded + do-not-knock doors, broken out in the ⓘ), Today narrows "match" to doors touched today, and Turf Cutting counts one walk list's cut. Covered in pages/page-map.md + guides/maps.md "What the count up top is counting" — candidate FAQ (slug map-count-vs-turf-cutting, audience lead, sourceDoc MAPS.md) if it recurs
- "I opened one of my orgs on the phone, tapped More → Notes, and it says 'Pick a campaign to see its notes' with nothing to pick. Now what?" → entering an org clears the phone's cached campaign, so the chip starts empty — tap it and pick one (archived campaigns are under the **Archived · read-only** divider). Two things made this a dead end and are now fixed: the chip hid archived campaigns entirely, so an org whose campaigns had all finished offered nothing at all; and Overlaps had no chip, with an empty state telling you to "pick a campaign you manage from the Overview," which never sets the campaign. Covered in pages/page-notes.md ("On the phone") + ADMIN_APP.md → *The campaign chip* — candidate FAQ if it recurs, probably "Nothing to pick in the campaign chip"
- "Why can't I assign books on this campaign any more? The Assign buttons are gone." → it's archived, and archived now genuinely means read-only (the server refuses the write, not just the app). Reactivate it from the web to resume. Covered in faq/archive-vs-delete-campaign.md + guides/turf-and-books.md
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
- "Does an admin-entered survey answer count in my client report?" → **yes**, identically to one collected at the door — the "Entered by" stamp is about where the answer came from, not whether it counts. Covered in pages/page-door-outcomes.md + METRICS.md §Surveys — candidate FAQ if a client ever asks
- "Why didn't the app warn before replacing a survey?" → the confirm needs a fresh sync; offline / a stale cache fails open **by design**, and the replaced answers are preserved server-side either way — guides/canvasser-door-survey.md + pages/page-duplicate-surveys.md

## Triaged (answered — safe to delete)

- "Why can't I import a .xls, only .xlsx? What's the real difference?" → xls-file-wont-upload.md (two different files share the extension: delimited text named .xls imports fine, a real Excel 97–2003 workbook is a different binary format and is refused with the Save-As remedy)
- "I uploaded a second voter file — now what?" → add-a-second-voter-file.md
- "I forgot my password" → reset-my-password.md
- "The client says the files hold N doors but the import made fewer — did we lose some?" → fewer-doors-than-file-rows.md (rows are people; doors are addresses; a precinct's strong/swing files share addresses; one row skipped ≠ one door lost)
- "My import has been on Analyzing / Linking forever — is it stuck?" → import-taking-long.md (stages explained; a genuinely stuck import now fails itself within minutes with a reason)
- "Can the activity export give me one row per voter instead of one per house for the not-homes?" → activity-export-one-row-per-voter.md (opt-in **One row per voter at the door**; repeated-not-attributed; file renamed activity-log-by-voter; never invoice from it)
- "Can I change everyone who answered X to a survey question?" → yes: Door Outcomes → open **Survey answers**, set one other filter first (canvasser, walk list, round or dates), pick the question and answer, then Select all N matching. The answer filter finds doors where SOMEONE gave that answer. Covered in pages/page-door-outcomes.md — candidate FAQ once it recurs
