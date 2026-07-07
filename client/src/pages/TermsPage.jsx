import { useEffect } from 'react';

const LAST_UPDATED = 'July 5, 2026';
const CONTACT_EMAIL = 'hello@doorline.app';
const APP_NAME = 'Doorline';

export default function TermsPage() {
  useEffect(() => {
    document.title = 'Terms of Service — Doorline';
  }, []);

  return (
    // Public page — keep light regardless of the app's saved theme.
    <div className="theme-light min-h-screen bg-gray-50 py-10 px-4 text-gray-900">
      <div className="mx-auto max-w-3xl rounded-lg bg-white p-8 shadow-sm">
        <h1 className="text-3xl font-semibold text-gray-900">Terms of Service</h1>
        <p className="mt-1 text-sm text-gray-500">Last updated: {LAST_UPDATED}</p>

        <Section title="1. Agreement and who we are">
          <p>
            These Terms of Service (&quot;Terms&quot;) govern access to and
            use of the {APP_NAME} platform — the web console at doorline.app,
            the {APP_NAME} mobile app for iOS and Android, and the client
            report portal (together, the &quot;Service&quot;). The Service is
            operated by Doorline LLC (&quot;{APP_NAME},&quot; &quot;we,&quot; &quot;us&quot;).
          </p>
          <p>
            By creating an account, signing in, or using the Service, you
            agree to these Terms on your own behalf and, if you use the
            Service for an organization, on behalf of that organization (the
            &quot;Customer&quot;). If a separate written agreement between the
            Customer and {APP_NAME} conflicts with these Terms, the written
            agreement controls.
          </p>
        </Section>

        <Section title="2. Accounts and eligibility">
          <ul className="ml-5 list-disc">
            <li>
              Accounts are created by a Customer&apos;s administrators for
              members of the Customer&apos;s team. There is no public
              self-signup.
            </li>
            <li>
              You must be authorized by your organization to use the Service,
              and you must be at least 18 years old.
            </li>
            <li>
              You are responsible for keeping your credentials confidential
              and for all activity under your account. Notify your
              administrator or us promptly if you suspect unauthorized use.
            </li>
            <li>
              Customers are responsible for the acts and omissions of their
              users, including canvassers in the field.
            </li>
          </ul>
        </Section>

        <Section title="3. Customer data — ownership and warranties">
          <p>
            The Customer retains all right, title, and interest in the voter
            files and other data it uploads to the Service (&quot;Customer
            Data&quot;). We claim no ownership of Customer Data and process it
            only to provide the Service, as described in our Privacy Policy.
          </p>
          <p>The Customer represents and warrants that:</p>
          <ul className="ml-5 list-disc">
            <li>
              It lawfully obtained all Customer Data, including any voter file
              data licensed from a state, vendor, or party organization, and
              has the right to use that data for door-to-door canvassing.
            </li>
            <li>
              Its upload and use of Customer Data on the Service complies with
              the terms of any license under which the data was obtained.
            </li>
            <li>
              It is responsible for compliance with all laws that apply to
              its canvassing operations, including election and campaign
              laws, canvassing and solicitation ordinances, telemarketing and
              contact rules, and data-protection laws in every jurisdiction
              where it operates.
            </li>
          </ul>
        </Section>

        <Section title="4. Acceptable use">
          <p>You and the Customer agree not to:</p>
          <ul className="ml-5 list-disc">
            <li>
              Use the Service in connection with unlawful harassment,
              trespass, or intimidation of any person at their door or
              elsewhere.
            </li>
            <li>
              Use the Service for unlawful voter suppression, voter
              intimidation, or election interference of any kind.
            </li>
            <li>
              Scrape, harvest, extract, resell, or redistribute data from the
              Service, other than the Customer exporting its own data through
              features we provide.
            </li>
            <li>
              Attempt to access accounts, organizations, or data you are not
              authorized to access, probe or test the Service&apos;s security
              without written permission, or interfere with its operation.
            </li>
            <li>
              Share credentials, or use another person&apos;s account.
            </li>
          </ul>
          <p>
            We may suspend or terminate access for violations of this
            section, as described in Section 13.
          </p>
        </Section>

        <Section title="5. Mobile app">
          <ul className="ml-5 list-disc">
            <li>
              The mobile app is distributed through the Apple App Store and
              Google Play, and your use of it is also subject to the
              applicable app-store terms.
            </li>
            <li>
              We may deliver updates to the app automatically, including
              over-the-air updates that install without going through the app
              store. Updates may add, change, or remove features.
            </li>
            <li>
              Standard carrier data rates may apply to the app&apos;s network
              usage.
            </li>
          </ul>
        </Section>

        <Section title="6. Client report links">
          <p>
            The Service lets a Customer publish reports for its clients at
            tokenized links. The Customer controls whether a report is
            published, who receives its link, whether it is password
            protected, and when it is revoked. Anyone with an unrevoked link
            (and password, where set) can view the report, so links should be
            treated as confidential and shared only with intended recipients.
            We are not responsible for access resulting from a Customer&apos;s
            distribution of a report link.
          </p>
        </Section>

        <Section title="7. Availability and support">
          <p>
            The Service is provided on an &quot;as is&quot; and &quot;as
            available&quot; basis. We do not guarantee any particular level of
            uptime. We may perform maintenance, which can temporarily make
            some or all of the Service unavailable; where practical, we will
            schedule maintenance to minimize disruption. Support is provided
            by email at{' '}
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="text-brand-accent underline hover:text-brand-accent"
            >
              {CONTACT_EMAIL}
            </a>
            .
          </p>
        </Section>

        <Section title="8. Fees">
          <p>
            Fees for the Service are set out in the ordering agreement,
            proposal, or invoice between the Customer and {APP_NAME}. Unless
            that agreement says otherwise, fees are due as invoiced and are
            non-refundable. We may suspend access for accounts with overdue
            balances after reasonable notice.
          </p>
        </Section>

        <Section title="9. Intellectual property">
          <p>
            {APP_NAME} owns the Service, including its software, design,
            documentation, and all related intellectual property. Subject to
            these Terms and payment of applicable fees, the Customer receives
            a limited, non-exclusive, non-transferable, revocable license to
            use the Service for its own canvassing operations during the term
            of the customer relationship. No other rights are granted. Except
            as permitted by law, you may not copy, modify, reverse engineer,
            or create derivative works of the Service.
          </p>
        </Section>

        <Section title="10. Disclaimer of warranties">
          <p>
            TO THE MAXIMUM EXTENT PERMITTED BY LAW, THE SERVICE IS PROVIDED
            &quot;AS IS&quot; AND &quot;AS AVAILABLE,&quot; WITHOUT WARRANTIES
            OF ANY KIND, WHETHER EXPRESS, IMPLIED, OR STATUTORY, INCLUDING
            WITHOUT LIMITATION ANY IMPLIED WARRANTIES OF MERCHANTABILITY,
            FITNESS FOR A PARTICULAR PURPOSE, TITLE, AND NON-INFRINGEMENT. WE
            DO NOT WARRANT THAT THE SERVICE WILL BE UNINTERRUPTED, ERROR-FREE,
            OR SECURE, OR THAT DATA (INCLUDING GEOCODING AND MAP DATA) WILL BE
            ACCURATE OR COMPLETE.
          </p>
        </Section>

        <Section title="11. Limitation of liability">
          <p>
            TO THE MAXIMUM EXTENT PERMITTED BY LAW, IN NO EVENT WILL{' '}
            {APP_NAME.toUpperCase()} BE LIABLE FOR ANY INDIRECT, INCIDENTAL,
            SPECIAL, CONSEQUENTIAL, EXEMPLARY, OR PUNITIVE DAMAGES, OR FOR ANY
            LOSS OF PROFITS, REVENUE, DATA, OR GOODWILL, ARISING OUT OF OR
            RELATED TO THE SERVICE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH
            DAMAGES. OUR TOTAL AGGREGATE LIABILITY ARISING OUT OF OR RELATED
            TO THE SERVICE WILL NOT EXCEED THE FEES PAID BY THE CUSTOMER TO{' '}
            {APP_NAME.toUpperCase()} IN THE TWELVE (12) MONTHS PRECEDING THE
            EVENT GIVING RISE TO THE CLAIM. THESE LIMITATIONS APPLY REGARDLESS
            OF THE THEORY OF LIABILITY AND EVEN IF A REMEDY FAILS OF ITS
            ESSENTIAL PURPOSE.
          </p>
        </Section>

        <Section title="12. Indemnification">
          <p>
            The Customer will defend, indemnify, and hold harmless {APP_NAME}{' '}
            and its officers, employees, and contractors from and against any
            claims, damages, and expenses (including reasonable
            attorneys&apos; fees) arising out of (a) Customer Data, including
            any claim that its collection, upload, or use was unlawful or
            infringed a third party&apos;s rights; (b) the Customer&apos;s or
            its users&apos; canvassing activities; or (c) the Customer&apos;s
            or its users&apos; violation of these Terms or applicable law.
          </p>
        </Section>

        <Section title="13. Suspension and termination">
          <ul className="ml-5 list-disc">
            <li>
              We may suspend or terminate access to the Service for a material
              breach of these Terms, for use that creates security or legal
              risk, or for non-payment, with notice where practical.
            </li>
            <li>
              The Customer may terminate its use of the Service as provided in
              its ordering agreement, or otherwise by written notice to us.
            </li>
            <li>
              Upon termination, the Customer may request an export of its
              Customer Data; after a reasonable wind-down period, we will
              delete Customer Data per the Customer&apos;s instructions and
              our Privacy Policy.
            </li>
            <li>
              Sections 3, 9, 10, 11, 12, and 14 survive termination.
            </li>
          </ul>
        </Section>

        <Section title="14. Governing law">
          <p>
            These Terms are governed by the laws of the State of Texas, USA,
            without regard to its conflict-of-laws rules, and any dispute will
            be brought in the state or federal courts located in Texas, whose
            jurisdiction the parties accept. A written agreement between the
            Customer and {APP_NAME} may specify a different governing law and
            venue, in which case that agreement controls.
          </p>
        </Section>

        <Section title="15. Changes to these Terms">
          <p>
            We may update these Terms from time to time. The &quot;Last
            updated&quot; date at the top of the page reflects the most recent
            revision. Material changes will be communicated to customer
            organizations and active users, and continued use of the Service
            after changes take effect constitutes acceptance of the revised
            Terms.
          </p>
        </Section>

        <Section title="16. Contact">
          <p>
            Questions about these Terms can be sent to{' '}
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
