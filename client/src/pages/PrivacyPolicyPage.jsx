const LAST_UPDATED = 'April 29, 2026';
const CONTACT_EMAIL = 'omar@foxbryant.com';
const APP_NAME = 'Canvass';

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="mx-auto max-w-3xl rounded-lg bg-white p-8 shadow-sm">
        <h1 className="text-3xl font-semibold text-gray-900">Privacy Policy</h1>
        <p className="mt-1 text-sm text-gray-500">Last updated: {LAST_UPDATED}</p>

        <Section title="Overview">
          <p>
            {APP_NAME} is an internal door-to-door canvassing tool used by an
            authorized political campaign and its volunteer canvassers. This
            policy explains what information the {APP_NAME} mobile app and admin
            dashboard collect, how it is used, and the choices you have.
          </p>
          <p>
            {APP_NAME} is <strong>not a public app</strong>. Access requires an
            account created by a campaign administrator. The app is distributed
            through internal testing channels (Apple TestFlight and Google Play
            Closed Testing) to a defined list of users.
          </p>
        </Section>

        <Section title="Information we collect">
          <h3 className="mt-3 font-semibold text-gray-800">Account information</h3>
          <ul className="ml-5 list-disc">
            <li>Your name and email address (provided by an administrator)</li>
            <li>A password you choose (stored as a hashed value, never in plaintext)</li>
          </ul>

          <h3 className="mt-4 font-semibold text-gray-800">
            Location information (canvassers only)
          </h3>
          <ul className="ml-5 list-disc">
            <li>
              Your device&apos;s GPS coordinates and accuracy at the moment you
              record a canvass action (e.g., &quot;not home,&quot; survey
              submission). Location is only collected at the moment of action,
              not continuously in the background.
            </li>
            <li>
              The map screen displays your live position to help you navigate to
              assigned households. This live position is rendered on-device only
              and is not transmitted to our servers unless you record an action.
            </li>
          </ul>

          <h3 className="mt-4 font-semibold text-gray-800">Canvass activity</h3>
          <ul className="ml-5 list-disc">
            <li>
              Survey responses you record at a household, the voter who answered,
              the household status you set, the timestamp of the action, and any
              note you add.
            </li>
          </ul>

          <h3 className="mt-4 font-semibold text-gray-800">Voter roll data</h3>
          <ul className="ml-5 list-disc">
            <li>
              {APP_NAME} stores voter names, addresses, party affiliation,
              precinct, and similar information sourced from
              campaign-licensed voter file vendors and uploaded by an
              administrator. Voters do not interact with {APP_NAME} directly.
              This information is used solely for the purpose of organizing
              door-to-door outreach by the campaign.
            </li>
          </ul>

          <h3 className="mt-4 font-semibold text-gray-800">
            Technical information
          </h3>
          <ul className="ml-5 list-disc">
            <li>
              Standard server logs (timestamp, IP address, request path, status
              code) are retained for security and debugging purposes.
            </li>
          </ul>
        </Section>

        <Section title="How we use information">
          <ul className="ml-5 list-disc">
            <li>To authenticate you and keep your account secure.</li>
            <li>
              To display the canvassing map, route you to assigned households,
              and let you record and review the campaign&apos;s field activity.
            </li>
            <li>
              To allow administrators to audit canvasser activity, including
              location and timestamp of recorded actions.
            </li>
            <li>To generate aggregate reports about the campaign&apos;s outreach.</li>
          </ul>
          <p className="mt-3">
            We do <strong>not</strong> sell, rent, or share your information for
            advertising purposes. We do not use your information for purposes
            unrelated to the campaign&apos;s door-to-door canvassing.
          </p>
        </Section>

        <Section title="Third-party services">
          <p>
            We use the following service providers to operate {APP_NAME}. Each
            handles only the limited data required to provide their service:
          </p>
          <ul className="ml-5 list-disc">
            <li>
              <strong>MongoDB Atlas</strong> — secure cloud database hosting for
              your account data and canvassing records.
            </li>
            <li>
              <strong>Heroku (Salesforce)</strong> — application hosting for the
              backend API and admin dashboard.
            </li>
            <li>
              <strong>Mapbox</strong> — map tiles and geocoding services.
            </li>
            <li>
              <strong>Expo / EAS</strong> — over-the-air mobile app updates.
            </li>
            <li>
              <strong>Apple App Store / Google Play</strong> — distribution and
              installation of the mobile app.
            </li>
          </ul>
        </Section>

        <Section title="Data retention">
          <p>
            Account data, canvass activity, and voter roll data are retained for
            the duration of the campaign. After the conclusion of the campaign,
            data is either deleted or archived in a secure, offline location.
            You may request deletion of your account at any time by contacting
            us at the address below.
          </p>
        </Section>

        <Section title="Your choices">
          <ul className="ml-5 list-disc">
            <li>
              You may decline location permission on your device. Without
              location access, you can still browse the map and view voter
              information, but you will not be able to record canvass actions.
            </li>
            <li>
              You may request access to, correction of, or deletion of your
              personal information by emailing us.
            </li>
            <li>
              You may request that your account be deactivated by contacting an
              administrator.
            </li>
          </ul>
        </Section>

        <Section title="Children">
          <p>
            {APP_NAME} is not intended for use by anyone under 18 years of age.
            We do not knowingly collect personal information from children.
          </p>
        </Section>

        <Section title="Security">
          <p>
            We take reasonable steps to protect your information. Passwords are
            hashed using industry-standard algorithms. All API traffic is
            encrypted in transit via HTTPS. Authentication tokens on the mobile
            app are stored in the device&apos;s secure storage (iOS Keychain,
            Android Keystore). Despite these measures, no system can guarantee
            absolute security.
          </p>
        </Section>

        <Section title="Changes to this policy">
          <p>
            We may update this policy from time to time. The &quot;Last
            updated&quot; date at the top of the page reflects the most recent
            revision. Material changes will be communicated to active users.
          </p>
        </Section>

        <Section title="Contact">
          <p>
            Questions about this policy or about your information can be sent
            to{' '}
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="text-brand-700 underline hover:text-brand-800"
            >
              {CONTACT_EMAIL}
            </a>
            .
          </p>
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section className="mt-8 space-y-3 text-sm leading-relaxed text-gray-700">
      <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
      {children}
    </section>
  );
}
