---
slug: client-link-asks-for-password-again
title: Why did my client's link ask for the password again?
audience: lead
kind: faq
order: 80
sourceDoc: CLIENT_PORTAL.md
summary: Usually because they didn't tick Keep me signed in, or because someone changed, rotated, renewed or disabled the link, which signs everyone out on purpose.
tags: client report, client link, share link, password, signed out, keep me signed in, locked, wrong password, rotate, renew, expired
---

A client link remembers your client only for a while, and some changes sign everyone out on purpose. The usual reasons, most common first:

- **They didn't tick Keep me signed in on this device.** Without it, the link remembers them only until the browser tab closes. With it, they stay signed in for up to 30 days, though some phones clear it sooner.
- **Someone changed the link's password.** Every device is signed out at once, so send your client the new password.
- **They're on another browser or device**, or in a private window. Each one asks once.
- **They pressed Sign out on this device.**

**Check the tab's History first.** On the campaign's **Client Reports** tab, press **History**: a password change, rotate, renew or disable shows there with who did it and when.

## If the page says something else

- **"This link isn't available"**: the link was rotated, renewed, disabled or deleted, so the address your client has no longer works. Rotating and renewing give the link a new address: copy it from the **Client links** panel and send it again (the password stays the same).
- **"This report link has expired. Ask your campaign contact for a new one."**: press **Renew** on the link. That gives it a new address, which you send to your client.
- **"This link is locked after too many wrong passwords"**: someone typed 50 wrong passwords within a day. Anyone already signed in keeps reading, but nobody new can sign in until the lock ends or you press **Unlock now**. Fifty wrong passwords is never your client, so **Rotate** the link and send the new address.
- **"Too many tries from this connection — wait 15 minutes"**: they guessed wrong several times in a row. Send the password again and have them wait a few minutes.

## Keeping it simple for your client

Send the link and the password separately, and tell them about **Keep me signed in on this device** so a phone they read on every week doesn't ask each time. Leave it off on a shared computer.

For everything about links, see [Client reports and share links](client-reports).
