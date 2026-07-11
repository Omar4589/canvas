---
slug: locked-out-too-many-attempts
title: Too many login attempts — how do I get back in?
audience: admin
kind: faq
order: 22
sourceDoc: USERS.md
summary: After too many wrong passwords the login is throttled for a few minutes; a super-admin can clear it instantly from All Users.
tags: login, lockout, password, security
---

For security, repeated **wrong passwords** temporarily throttle sign-in — roughly **10 wrong tries
for one account (or 50 from one device) within 15 minutes** shows *"Too many login attempts — try
again in a few minutes."*

This is **not** the same as forgetting your password (for that, see [I forgot my password](reset-my-password)).
To get back in:

1. **Just wait a few minutes.** The limit clears on its own once the 15-minute window passes — then
   the correct password works again.
2. **Or ask a super-admin to clear it.** On **Super-admin ▸ All Users**, they click **Clear lockout**
   on your row and you can retry immediately.

> Owner note: add your own super-admin email to the `LOGIN_RATELIMIT_ALLOWLIST` setting so *you* can
> never be locked out — allowlisted accounts skip the throttle entirely.
