import { useEffect } from 'react';

const LAST_UPDATED = 'July 5, 2026';
const CONTACT_EMAIL = 'hello@doorline.app';
const APP_NAME = 'Doorline';

export default function PrivacyPolicyPage() {
  useEffect(() => {
    document.title = 'Privacy Policy — Doorline';
  }, []);

  return (
    // Public page — keep light regardless of the app's saved theme.
    <div className="theme-light min-h-screen bg-gray-50 py-10 px-4 text-gray-900">
      <div className="mx-auto max-w-3xl rounded-lg bg-white p-8 shadow-sm">
        <h1 className="text-3xl font-semibold text-gray-900">Privacy Policy</h1>
        <p className="mt-1 text-sm text-gray-500">Last updated: {LAST_UPDATED}</p>

        <Section title="Overview">
          <p>
            {APP_NAME} is a door-to-door canvassing platform operated for
            customer organizations — typically political consulting firms and
            campaigns. Customers use a web console to manage campaigns and
            voter data, their canvassers use the {APP_NAME} mobile app for iOS
            and Android in the field, and the customer&apos;s own clients can
            view published reports through tokenized share links without
            creating an account.
          </p>
          <p>
            This policy explains what information the {APP_NAME} platform
            collects, how it is used, who it is shared with, and the choices
            available to you. It applies to the {APP_NAME} web console, the
            mobile app, and the public report pages at doorline.app.
          </p>
        </Section>

        <Section title="Two roles: our data and our customers' data">
          <p>
            {APP_NAME} handles two distinct categories of personal
            information, and our responsibilities differ between them:
          </p>
          <ul className="ml-5 list-disc">
            <li>
              <strong>Platform account data.</strong> Information about the
              people who use {APP_NAME} itself — administrators, team leads,
              and canvassers. {APP_NAME} determines how this data is collected
              and used, and is directly responsible for it.
            </li>
            <li>
              <strong>Customer-uploaded voter file data.</strong> Voter and
              constituent records that a customer organization uploads to the
              platform. The customer controls this data: it decides what to
              upload, who on its team can see it, and how long it is kept.
              {APP_NAME} processes it only on the customer&apos;s behalf and
              under the customer&apos;s instructions. Each customer warrants
              that it lawfully obtained its voter file data and has the right
              to use it for canvassing.
            </li>
          </ul>
          <p>
            {APP_NAME} does not sell either category of data, and does not use
            either category for advertising.
          </p>
        </Section>

        <Section title="Information we collect">
          <h3 className="mt-3 font-semibold text-gray-800">Account information</h3>
          <ul className="ml-5 list-disc">
            <li>
              Your name, email address, and phone number, provided when your
              organization&apos;s administrator creates your account.
            </li>
            <li>
              A password you choose. Passwords are hashed with bcrypt and are
              never stored or transmitted in plaintext.
            </li>
          </ul>

          <h3 className="mt-4 font-semibold text-gray-800">
            Location information (canvassers only)
          </h3>
          <ul className="ml-5 list-disc">
            <li>
              Your device&apos;s GPS coordinates and reported accuracy are
              captured <strong>only at the moment you record a canvass
              action</strong> (for example, marking a door &quot;not
              home&quot; or submitting a survey), along with the computed
              distance between your position and the door. Location is never
              collected continuously or in the background.
            </li>
            <li>
              The map screen shows your live position to help you navigate to
              assigned households. That live position is rendered on your
              device only; it is not transmitted to our servers unless you
              record an action.
            </li>
            <li>
              If you record actions while offline, they are stored on your
              device and synced to our servers when connectivity returns.
              Synced actions are flagged as offline submissions.
            </li>
          </ul>

          <h3 className="mt-4 font-semibold text-gray-800">Canvass activity</h3>
          <ul className="ml-5 list-disc">
            <li>
              Survey responses you record at a household, the voter the
              response is associated with, the door status you set, the
              timestamp of the action, and any notes you add. Your
              organization&apos;s administrators can review this activity,
              including the location and timestamp of recorded actions.
            </li>
          </ul>

          <h3 className="mt-4 font-semibold text-gray-800">
            Customer-uploaded voter file data
          </h3>
          <ul className="ml-5 list-disc">
            <li>
              Customer organizations upload voter records that may include
              names, residential addresses, party affiliation, date of birth,
              phone numbers, electoral districts, and state voter
              identification numbers. Voters do not interact with {APP_NAME}{' '}
              directly. This data is used solely to organize and record the
              uploading organization&apos;s door-to-door outreach, and access
              to it is limited to that organization&apos;s authorized users.
            </li>
          </ul>

          <h3 className="mt-4 font-semibold text-gray-800">
            Technical information
          </h3>
          <ul className="ml-5 list-disc">
            <li>
              Standard server logs (timestamp, IP address, request path,
              status code) are retained for security and debugging purposes.
            </li>
          </ul>
        </Section>

        <Section title="Local storage, tokens, and tracking">
          <p>
            {APP_NAME} uses local storage on your device in place of
            traditional cookies to keep you signed in:
          </p>
          <ul className="ml-5 list-disc">
            <li>
              On the web, an authentication token (JWT) is stored in your
              browser&apos;s local storage.
            </li>
            <li>
              On mobile, the authentication token is stored in the
              device&apos;s secure enclave — the iOS Keychain or the Android
              Keystore.
            </li>
          </ul>
          <p>
            {APP_NAME} uses <strong>no advertising cookies, no third-party
            analytics, and no trackers</strong> on any of its pages or in the
            mobile app.
          </p>
        </Section>

        <Section title="How we use information">
          <ul className="ml-5 list-disc">
            <li>To authenticate you and keep your account secure.</li>
            <li>
              To display the canvassing map, route canvassers to assigned
              households, and record and review field activity.
            </li>
            <li>
              To let customer administrators manage their teams, audit
              canvasser activity, and generate reports about their outreach.
            </li>
            <li>
              To publish aggregate reports that a customer chooses to share
              with its clients.
            </li>
            <li>To provide support, and to secure and debug the platform.</li>
          </ul>
          <p className="mt-3">
            We do <strong>not</strong> sell, rent, or share any information on
            the platform for advertising purposes, and we do not use
            customer-uploaded voter data for any purpose other than providing
            the service to that customer.
          </p>
        </Section>

        <Section title="Public report links">
          <p>
            A customer can publish a report for its own clients at a
            tokenized link (doorline.app/r/…). Published reports are built to
            expose only aggregate information:
          </p>
          <ul className="ml-5 list-disc">
            <li>Aggregate canvassing statistics for the campaign.</li>
            <li>
              A map of door statuses. Canvasser identities, voter names, and
              action timestamps are stripped from published report data by
              design — the published map stores none of them.
            </li>
          </ul>
          <p>
            Report links can be revoked by the customer at any time and can be
            protected with a password.
          </p>
        </Section>

        <Section title="Service providers (subprocessors)">
          <p>
            We use the following service providers to operate {APP_NAME}. Each
            handles only the limited data required to provide its service:
          </p>
          <ul className="ml-5 list-disc">
            <li>
              <strong>MongoDB Atlas</strong> — cloud database hosting for
              account data, voter data, and canvassing records.
            </li>
            <li>
              <strong>Heroku (Salesforce)</strong> — application hosting for
              the backend API and web console.
            </li>
            <li>
              <strong>Redis</strong> (via a Heroku add-on) — background job
              queue for processing tasks such as voter file imports.
            </li>
            <li>
              <strong>Mapbox</strong> — map tiles and map display.
            </li>
            <li>
              <strong>Geocodio</strong> — geocoding. When a customer uploads a
              voter file that lacks coordinates, street addresses are sent to
              Geocodio to be converted into map coordinates.
            </li>
            <li>
              <strong>Expo / EAS</strong> — mobile app builds and
              over-the-air updates.
            </li>
            <li>
              <strong>Apple App Store / Google Play</strong> — distribution
              and installation of the mobile app.
            </li>
          </ul>
        </Section>

        <Section title="Security">
          <ul className="ml-5 list-disc">
            <li>Passwords are hashed with bcrypt; plaintext passwords are never stored.</li>
            <li>All traffic is encrypted in transit via HTTPS.</li>
            <li>
              Access is role-based and scoped to your organization — users in
              one organization cannot see another organization&apos;s data.
            </li>
            <li>Login attempts are rate-limited.</li>
            <li>
              Accounts can be deactivated immediately by an administrator,
              which cuts off access to the platform.
            </li>
          </ul>
          <p>
            Despite these measures, no system can guarantee absolute security.
          </p>
        </Section>

        <Section title="Data retention">
          <p>
            Account and campaign data are retained for the life of the
            customer relationship, or as otherwise instructed by the customer
            organization that controls the data. Customers can request an
            export of their data or deletion of some or all of it. When a
            customer relationship ends, the customer&apos;s data is deleted or
            returned per its instructions.
          </p>
          <p>
            Platform users may request deletion of their own account at any
            time by contacting us at the address below or by asking their
            organization&apos;s administrator.
          </p>
        </Section>

        <Section title="Your privacy rights">
          <p>
            Depending on where you live, state privacy laws (such as the
            California Consumer Privacy Act, as amended by the CPRA) may give
            you the right to:
          </p>
          <ul className="ml-5 list-disc">
            <li>
              <strong>Know and access</strong> the personal information we
              hold about you.
            </li>
            <li>
              <strong>Correct</strong> inaccurate personal information.
            </li>
            <li>
              <strong>Delete</strong> your personal information, subject to
              legal exceptions.
            </li>
            <li>
              <strong>Non-discrimination</strong> — we will not treat you
              differently for exercising these rights.
            </li>
          </ul>
          <p>
            To exercise any of these rights, email{' '}
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="text-brand-accent underline hover:text-brand-accent"
            >
              {CONTACT_EMAIL}
            </a>
            . We may need to verify your identity before acting on a request.
          </p>
          <p>
            <strong>If you are a voter whose information appears in a
            customer&apos;s uploaded file:</strong> the organization that
            uploaded your data controls it. You may contact that organization
            directly, or contact us and we will route your request to the
            controlling organization and assist in fulfilling it.
          </p>
        </Section>

        <Section title="Your choices">
          <ul className="ml-5 list-disc">
            <li>
              You may decline location permission on your device. Without
              location access you can still browse the map and view voter
              information, but you will not be able to record canvass actions.
            </li>
            <li>
              You may request access to, correction of, or deletion of your
              personal information by emailing us.
            </li>
            <li>
              You may ask your organization&apos;s administrator to deactivate
              your account.
            </li>
          </ul>
        </Section>

        <Section title="Children">
          <p>
            {APP_NAME} is not intended for use by anyone under 18 years of
            age, and we do not knowingly collect personal information from
            children.
          </p>
        </Section>

        <Section title="Changes to this policy">
          <p>
            We may update this policy from time to time. The &quot;Last
            updated&quot; date at the top of the page reflects the most recent
            revision. Material changes will be communicated to customer
            organizations and active users.
          </p>
        </Section>

        <Section title="Contact">
          <p>
            Questions about this policy or about your information can be sent
            to{' '}
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="text-brand-accent underline hover:text-brand-accent"
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
