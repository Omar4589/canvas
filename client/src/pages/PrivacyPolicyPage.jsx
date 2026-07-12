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
            Doorline LLC (&quot;{APP_NAME},&quot; &quot;we,&quot; &quot;us&quot;) provides door-to-door canvassing software to
            organizations that run field campaigns — including political
            campaigns, advocacy and issue organizations, and the firms that
            run canvassing on their behalf. This Privacy Policy describes how
            we collect, use, disclose, and protect personal information in
            connection with our web console, our mobile applications, and the
            public report pages available at doorline.app (together, the
            &quot;Services&quot;). We encourage you to read it in full.
          </p>
          <p>
            Our customers use the Services to manage their campaigns and to
            record the work of their canvassers. In doing so, our customers
            upload and control voter and constituent information. Where we
            process that information on a customer&apos;s behalf and under its
            instructions, the customer — not {APP_NAME} — is responsible for it
            and for its lawful collection and use. We process our customers&apos;
            uploaded information only to provide the Services, and each customer
            represents that it has the right to use that information for
            canvassing. We do not sell personal information, and we do not use
            it for advertising.
          </p>
        </Section>

        <Section title="Personal information we collect and how we use it">
          <p>
            We collect the following categories of personal information and use
            each of them to provide, secure, and support the Services:
          </p>
          <ul className="ml-5 list-disc">
            <li>
              <strong>Account information.</strong> When an administrator
              creates an account for you, we collect your name, email address,
              phone number, and a password you set. We use this information to
              authenticate you, administer your account, and keep it secure.
            </li>
            <li>
              <strong>Canvassing activity.</strong> When a canvasser records
              activity at a door — such as a survey response, a door status, or
              a note — we collect that activity, the record it relates to, and
              the time it occurred. Authorized administrators within the same
              organization may review this activity. We use it to operate the
              canvass and to provide reporting to that organization.
            </li>
            <li>
              <strong>Voter and constituent information.</strong> Our customers
              upload records that may include names, residential addresses,
              party affiliation, date of birth, telephone numbers, electoral
              districts, and voter identification numbers. Voters do not
              interact with the Services directly. We use this information only
              to provide the Services to the customer that uploaded it, and
              access is limited to that customer&apos;s authorized users.
            </li>
          </ul>
        </Section>

        <Section title="Location information">
          <p>
            When a canvasser records an action in our mobile app, we collect
            the device&apos;s location and reported accuracy at that moment,
            together with the approximate distance between the device and the
            door. We collect location <strong>only at the time an action is
            recorded</strong>; we do not track location continuously or in the
            background. The app may display a canvasser&apos;s live position on
            their own device to aid navigation, but that live position is not
            transmitted to us unless an action is recorded. Actions recorded
            without a connection are stored on the device and transmitted when
            connectivity returns.
          </p>
        </Section>

        <Section title="Information collected automatically">
          <p>
            When you use the Services, we automatically collect limited
            technical information, such as your IP address, the pages or
            resources you request, and the date and time of your request. We
            use this information to operate, secure, and troubleshoot the
            Services. We use local storage on your device to keep you signed
            in. We do <strong>not</strong> use advertising cookies, third-party
            analytics, or tracking technologies on our sites or in our apps.
          </p>
        </Section>

        <Section title="Published reports">
          <p>
            A customer may choose to publish a report and make it available at
            a unique link. Published reports are designed to present only
            aggregate campaign statistics and a map of door statuses;
            individual canvasser identities, voter names, and action timestamps
            are excluded from published reports by design. A customer may
            protect a report link with a password and may revoke it at any
            time.
          </p>
        </Section>

        <Section title="With whom we share information">
          <p>We may share personal information as follows:</p>
          <ul className="ml-5 list-disc">
            <li>
              <strong>Within your organization.</strong> Information is
              available to authorized users of the customer organization you
              belong to, according to their role. It is not shared with other
              customer organizations.
            </li>
            <li>
              <strong>Service providers.</strong> We share information with
              service providers that perform functions on our behalf — for
              example, hosting our systems and databases, providing maps and
              converting addresses into map coordinates, and distributing and
              updating our mobile app. These providers are authorized to use
              the information only as necessary to perform services for us. A
              current list of our service providers is available on request.
            </li>
            <li>
              <strong>Legal and safety.</strong> We may disclose information
              where we believe in good faith that doing so is required by law
              or legal process, or is necessary to protect our rights, our
              users, or the public.
            </li>
            <li>
              <strong>Business transfers.</strong> Information may be
              transferred in connection with a merger, acquisition, financing,
              or sale of assets, subject to this Policy.
            </li>
          </ul>
          <p>
            We do not sell personal information, and we do not share it for
            advertising purposes.
          </p>
        </Section>

        <Section title="How we protect information">
          <p>
            We maintain reasonable administrative, technical, and physical
            safeguards designed to protect personal information against
            unauthorized access, use, or disclosure. These include encryption
            of data in transit, access controls that limit each user to the
            information of their own organization, and the ability for
            administrators to disable access promptly. No method of
            transmission or storage is completely secure, and we cannot
            guarantee absolute security.
          </p>
        </Section>

        <Section title="How long we keep information">
          <p>
            We retain account and campaign information for as long as the
            related account is active, or as otherwise instructed by the
            customer organization that controls the information, and thereafter
            as needed to comply with our legal obligations or resolve disputes.
            A customer may request export or deletion of the information it
            controls.
          </p>
        </Section>

        {/* Anchor id is load-bearing: Google Play lets a privacy policy double as the required
            public deletion resource only when the deletion section is "prominently featured and
            easily discoverable" — i.e. anchor-linked. Do not rename #delete-account. */}
        <Section title="Deleting your account" id="delete-account">
          <p>
            You can delete your {APP_NAME} account yourself, at any time, from
            inside the mobile app: <strong>Profile → Delete account</strong>.
            Deleting is permanent — it removes your login, your name, your
            email address, your phone number and your password, and it cannot
            be undone by you or by an administrator. If you have already
            uninstalled the app, see the{' '}
            <a className="font-medium text-red-600 underline" href="/delete-account">
              account deletion page
            </a>
            .
          </p>
          <p>
            The doors you knocked and the survey answers you recorded stay with
            the campaign. Those are the organization&apos;s records of work
            performed, not your personal content, and the organization — not{' '}
            {APP_NAME} — controls them. Alongside those records we keep your
            name for a limited period (180 days by default) so the organization
            can verify who performed which field work; canvassing records
            include the location at which each door was logged, and an
            organization must be able to attach that record to a person in
            order to check it. This is a fraud- and quality-prevention measure.
            After that period your name is permanently removed and the records
            become anonymous.
          </p>
        </Section>

        <Section title="Your privacy rights">
          <p>
            Depending on where you live and subject to applicable law, you may
            have the right to request access to the personal information we
            hold about you, to correct or delete it, and to not be treated
            differently for exercising these rights. To make a request, contact
            us at{' '}
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="text-brand-accent underline hover:text-brand-accent"
            >
              {CONTACT_EMAIL}
            </a>
            . We may need to verify your identity before responding, and we
            will respond as required by applicable law.
          </p>
          <p>
            If your information appears in a file uploaded by one of our
            customers, that customer controls the information. You may contact
            that organization directly, or contact us and we will refer your
            request to the controlling organization and assist as appropriate.
          </p>
        </Section>

        <Section title="Your choices">
          <p>
            You may decline the location permission on your device; you will
            still be able to browse the map and view records, but you will not
            be able to record canvass actions. You may request access to,
            correction of, or deletion of your personal information by
            contacting us, and you may ask your organization&apos;s
            administrator to disable your account.
          </p>
        </Section>

        <Section title="Children">
          <p>
            The Services are not directed to, and are not intended for use by,
            anyone under 18 years of age, and we do not knowingly collect
            personal information from children.
          </p>
        </Section>

        <Section title="Changes to this policy">
          <p>
            We may update this Privacy Policy from time to time. The &quot;Last
            updated&quot; date above reflects the most recent revision, and
            material changes will be communicated to affected customers and
            users.
          </p>
        </Section>

        <Section title="How to contact us">
          <p>
            If you have questions about this Privacy Policy or about your
            personal information, contact us at{' '}
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

// `id` is optional and only used by the deletion section, whose anchor Google Play relies on
// to treat this page as the required public deletion resource. Without it the #delete-account
// link is dead and the section is no longer "easily discoverable".
function Section({ title, id, children }) {
  return (
    <section id={id} className="mt-8 space-y-3 text-sm leading-relaxed text-gray-700">
      <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
      {children}
    </section>
  );
}
