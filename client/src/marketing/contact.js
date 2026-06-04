// Single source of truth for the demo-request contact path. Every
// "Request a demo" / "Contact" action across the marketing site uses
// demoMailto() — no raw mailto strings live anywhere else.

export const CONTACT_EMAIL = 'hello@doorline.app';

export function demoMailto() {
  const subject = 'Doorline demo request';
  const body =
    "Hi Doorline team,\n\n" +
    "We'd like a demo of Doorline for our campaign / organization.\n\n" +
    'Organization:\n' +
    'Role:\n' +
    'Approx. team size:\n' +
    'Timeline:\n\n' +
    'Thanks!';
  return `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(
    subject
  )}&body=${encodeURIComponent(body)}`;
}
