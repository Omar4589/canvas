import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { CONTACT_EMAIL } from '../marketing/contact.js';

const APP_NAME = 'Doorline';

// The public account-deletion resource that Google Play requires.
//
// Play's policy is an AND, not an OR: an app that supports account creation must offer an
// in-app deletion path *and* "a web link resource where users can request app account deletion".
// Their FAQ is explicit that a perfect in-app flow does not excuse you — "some users may have
// already uninstalled your app", so the web page must let them request deletion "without sending
// the user back to the app and requiring them to re-download it".
//
// The constraints this page is built to satisfy, all from that policy:
//   · reachable WITHOUT logging in (a login wall here is the most common rejection),
//   · names the app and the developer as they appear on the store listing,
//   · the deletion pathway is prominent and easily discoverable — not buried,
//   · states plainly what is deleted and what is retained, and for how long.
//
// Declared in Play Console under App content → Data safety → Data deletion.
export default function DeleteAccountPage() {
  useEffect(() => {
    document.title = 'Delete your account — Doorline';
  }, []);

  return (
    // Public page — keep light regardless of the app's saved theme.
    <div className="theme-light min-h-screen bg-gray-50 py-10 px-4 text-gray-900">
      <div className="mx-auto max-w-3xl rounded-lg bg-white p-8 shadow-sm">
        <h1 className="text-3xl font-semibold text-gray-900">Delete your {APP_NAME} account</h1>
        <p className="mt-1 text-sm text-gray-500">
          {APP_NAME} LLC — canvassing software for field campaigns
        </p>

        <Section title="The fastest way: delete it in the app">
          <p>
            Open {APP_NAME} on your phone, go to{' '}
            <strong>Profile → Delete account</strong>, and follow the prompts. Your account is
            deleted immediately and you&apos;ll be signed out.
          </p>
          <p>
            The app will first make sure any doors you knocked while offline have reached your
            campaign, so none of your work is lost.
          </p>
        </Section>

        <Section title="If you&rsquo;ve already uninstalled the app">
          <p>
            Email{' '}
            <a className="font-medium text-red-600 underline" href={`mailto:${CONTACT_EMAIL}?subject=Delete%20my%20Doorline%20account`}>
              {CONTACT_EMAIL}
            </a>{' '}
            from the address you used to sign in, with the subject{' '}
            <strong>&ldquo;Delete my {APP_NAME} account&rdquo;</strong>. We&apos;ll verify that
            you own the address and delete the account within 30 days.
          </p>
        </Section>

        <Section title="What gets deleted">
          <ul className="list-disc space-y-1 pl-5">
            <li>Your login, and your ability to sign in — permanently. This cannot be undone.</li>
            <li>Your name, email address and phone number.</li>
            <li>Your password.</li>
            <li>Your place on every campaign roster and any walk lists assigned to you.</li>
          </ul>
        </Section>

        <Section title="What your organization keeps, and why">
          <p>
            The doors you knocked and the survey answers you recorded stay with the campaign.
            Those are the organization&apos;s records of work performed — not your personal
            content — and the organization, not {APP_NAME}, controls them.
          </p>
          <p>
            Alongside them we keep your name for a limited period (180 days by default) so the
            organization can still verify who performed which field work. This is a fraud- and
            quality-prevention measure: canvassing records include the location where each door
            was logged, and an organization needs to be able to attach that record to a person
            in order to check it. After that period your name is permanently removed and the
            records become anonymous.
          </p>
          <p>
            If you believe your organization is retaining information about you improperly,
            contact them directly, or write to us at{' '}
            <a className="font-medium text-red-600 underline" href={`mailto:${CONTACT_EMAIL}`}>
              {CONTACT_EMAIL}
            </a>
            .
          </p>
        </Section>

        <Section title="Deleting a whole organization&rsquo;s account">
          <p>
            If you administer an organization on {APP_NAME} and want the entire account and all
            of its campaign data deleted, email{' '}
            <a className="font-medium text-red-600 underline" href={`mailto:${CONTACT_EMAIL}`}>
              {CONTACT_EMAIL}
            </a>{' '}
            from your admin address. Note that you cannot delete your own admin account while
            you are the only admin — make someone else an admin first, or ask us to close the
            organization.
          </p>
        </Section>

        <p className="mt-10 border-t border-gray-200 pt-6 text-sm text-gray-500">
          See our{' '}
          <Link className="font-medium text-red-600 underline" to="/privacy">
            Privacy Policy
          </Link>{' '}
          for the full picture of what we collect and how long we keep it.
        </p>
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
      <div className="mt-2 space-y-3 text-sm leading-relaxed text-gray-700">{children}</div>
    </section>
  );
}
