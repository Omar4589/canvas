# Brief for counsel

A one-page primer to send an attorney, so the billable hour is spent **answering questions** rather
than discovering the business. Copy the body of this file into an email.

**This is not legal advice and was not written by a lawyer.** It states facts about how the product
behaves and frames the questions we don't know the answers to.

---

## What Doorline is

Doorline LLC sells **multi-tenant SaaS for door-to-door canvassing** to political consulting firms,
campaigns, and advocacy organizations. It is **$300 per campaign per month, invoiced** — there is no
in-app purchase and no consumer sale.

Three facts carry all of our legal exposure:

1. **Our customers upload state voter files** to the platform (names, home addresses, party
   affiliation, date of birth, voter ID numbers). Voters themselves never interact with us.
2. **Our mobile app GPS-stamps every door a canvasser knocks**, and records the distance between the
   canvasser and the house, so the campaign can verify the work actually happened. This is a headline
   feature, not a side effect.
3. **There is no public sign-up.** Accounts are created by a customer's administrators for their own
   staff.

## Documents to read

- Terms of Service — https://doorline.app/terms
- Privacy Policy — https://doorline.app/privacy

Both are live, short, and current.

---

## The questions

### 1. Voter files — is our processing lawful?

Several states restrict voter-file use to "election purposes" or bar "commercial use" outright. **We
are a commercial vendor.** Our customer licenses the file lawfully and uses it to canvass; we store
and process it for them, for a fee.

- Is **our** processing itself a prohibited commercial use, or is only the **customer's** use
  relevant?
- Terms §3 has the customer warrant they obtained the data lawfully and may use it for canvassing. Is
  that warranty sufficient protection for us, or do we need indemnification and state-specific reps?
- Do we need to register or certify anything, in any state, simply to **hold** voter files as a vendor?

*(This is the one we'd lead with.)*

### 2. Are we a processor or a controller?

Our Privacy Policy asserts that the **customer controls** the voter data and Doorline merely processes
it on the customer's instructions. That framing carries most of the compliance burden.

- Does it hold up?
- Should the customer relationship include a signed **Data Processing Addendum**, rather than a
  click-through Terms page?

### 3. Worker location monitoring — the one we nearly missed

Our GPS-audit feature exists so a campaign can verify that a canvasser really walked the block. Those
canvassers are frequently the **customer's employees or paid staff**. Several states regulate
electronic monitoring of workers and require notice.

- Who owes that notice — **us**, or the **customer**?
- Does our in-app permission prompt plus the Privacy Policy discharge it, or does the employer have
  to give separate notice?

### 4. Have we crossed the CCPA threshold?

CCPA/CPRA obligations attach at **100,000+ consumers'** personal information. A *single* campaign's
voter file is on the order of **8,000–10,000 voters**. A handful of customers clears that line, and we
may already have.

- Whether it matters turns on Q2: a **service provider** is not a "business" for its customers' data.
- Which side of that line are we on, and what changes if we're wrong?

### 5. Does our 180-day retention survive a deletion request?

When a user deletes their account, we destroy their login, name, email, phone and password. We
**retain their name for 180 days** so the organization can still attribute past field work — including
the GPS trail — to a real person, as a fraud- and quality-control measure. This is disclosed to the
user at the moment they delete, on a public page, and in the Privacy Policy. After 180 days the name
is purged; the records then no longer directly identify the person but remain linked to a stable
internal identifier — pseudonymous, not anonymous (see [PRIVACY_VERIFICATION.md](PRIVACY_VERIFICATION.md) A3).

- CCPA's deletion right has express carve-outs for security and fraud prevention, so this is
  *probably* fine. **Confirm it** — "probably" is what we're paying to remove.

---

## Likely moot, but confirm rather than assume

**GDPR.** Political opinion is a special category of personal data under GDPR, and party affiliation
is in every voter record. We have no EU users and no EU data today, and no plans to. If that ever
changes, it changes materially.

---

## What we are *not* sending you

The source code. Counsel needs to know **what the product does**, not how it's implemented. If any
answer turns on an implementation detail, ask and we'll describe the behaviour in plain English.
