---
slug: who-sees-billing
title: Why can't another admin see the Billing page?
audience: admin
kind: faq
order: 36
sourceDoc: BILLING.md
summary: Billing is limited to specific admins; grant access on the Users page.
tags: billing, access, admin, permissions
---

Billing is deliberately limited to the admins who actually handle the bill — not every admin. So a new admin won't see the **Billing** page or the cost view until they're given access.

To grant it: go to **Users**, find the admin, and turn on **Billing access**. They'll see the Billing page the next time they sign in. Only an admin who already has billing access can grant it to someone else.

The admin you set up with the account starts with billing access automatically. Everyone else defaults to off until you turn it on.

One guardrail to know: billing admins are also who receives important account emails (like a notice before any scheduled data deletion), so the app **won't let you remove, demote, or switch off the last admin with billing access** — you'll see *"Give billing access to another admin first."* Grant it to a second admin, then make your change.

See [Billing and your account](billing) for how pricing and trials work.
