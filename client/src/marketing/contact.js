// The public contact address. Every "Request a demo" action now opens the demo dialog
// (DemoRequest.jsx → useDemoRequest) instead of a mail client; this address survives as the
// visible fallback INSIDE that dialog, and as the footer's plain "Contact" link for someone who
// would rather write their own email.
//
// The `demoMailto()` helper that used to live here is gone on purpose: a `mailto:` primary CTA
// does visibly NOTHING for a visitor whose OS has no mail handler — a silent failure on the only
// conversion path this site has. Don't reintroduce one as a primary button.

export const CONTACT_EMAIL = 'hello@doorline.app';

/** `mailto:` for the plain "Contact" affordances — never for the primary demo CTA. */
export function contactMailto() {
  return `mailto:${CONTACT_EMAIL}`;
}
