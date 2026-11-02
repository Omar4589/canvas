---
slug: page-website
title: The Website page
audience: super
kind: page
order: 132
sourceDoc: MARKETING_SITE.md
summary: Demo requests from doorline.app — open, handled, or deleted on request — and how many people visit the homepage and /aapc each day.
tags: website, demo requests, leads, visits, aapc, marketing, super admin
---

**Website** is in the sidebar, under Emails. It shows the two things the public site at
doorline.app brings in: **demo requests** and **visits** to the homepage and the /aapc page.

## Demo requests

Every time someone sends the **Request a demo** form, the request is saved here *and* emailed to
hello@doorline.app. Saving it first means a failed email can no longer lose a lead: if the email
didn't go out, the request still shows here, marked **email failed**.

Each request shows what the person told us — name, organization, work email, what kind of team they
are, team size, how they heard about us, and anything they wrote — plus **Sent from**: the page they
were on, and the link's tag if it had one (for example `src=home-banner` when they came through the
AAPC banner on the homepage; a request from /aapc with no tag says `src=aapc`).

A request from **/aapc** is a booking: *Book 15 minutes with Omar, at the event or after.* It also
shows **When** (at AAPC on Nov 17, or after the event) and, if they gave one, a **Mobile** number —
there's no table at the event, so you text or email them to set the time.

- **Open** is your to-do list. Reply from your inbox (Reply goes straight to them), then press
  **Mark handled** so nobody replies twice. **Reopen** puts it back.
- **Delete** is for when someone asks us to delete what they sent. It's permanent — the only copy
  left is the email in the inbox.
- Requests delete themselves **24 months** after they came in. That's what our privacy policy
  promises.

## Visits

How many times the homepage and /aapc were loaded each day, for the last 60 days, on Central time —
one column per page, then the biggest sources in their own columns:

- a link's own tag (like `qr` or `home-banner`);
- the website someone came from (like `google.com`);
- **internal** — moving from one of our pages to another (say from /aapc to the homepage), so a
  visitor who's already here isn't counted as a new arrival;
- **direct** — typed in, bookmarked, or scanned. The printed AAPC ad's QR code has no tag, so its
  scans land in **direct**. The demo form's *How did you hear about us?* question is how you tell
  those leads apart.

Visits are counted on our own server, with no cookies and no stored IP addresses. Search-engine
crawlers, link previews and similar robots are left out, but a reload counts again, so read the
numbers as page loads, not people.
