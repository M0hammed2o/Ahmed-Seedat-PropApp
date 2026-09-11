import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { PRIVACY_VERSION, branding } from '@propvault/config';

/**
 * The real, binding Privacy Policy, published 2026-09-11 for the Google Play v1.0 release. It
 * replaces a placeholder that said outright it "is not binding legal content" -- which Google Play
 * rejects, because a store listing must link to a genuine policy.
 *
 * Every factual claim here was derived from the code, not drafted generically:
 *  - the collected categories match what the app and API actually store;
 *  - "no advertising, analytics, attribution or crash-reporting software" was verified against the
 *    Android dependency list -- there is no such SDK in the build;
 *  - the retention rule matches app/api/v1/account/delete/route.ts, which anonymises rather than
 *    dropping rows because audit_events is immutable and invoices carry statutory retention;
 *  - the processor list matches the services this deployment genuinely uses.
 *
 * The operating legal entity and registered address are deliberately NOT stated: they live in
 * `platformBillingEntity` (packages/config/src/branding.ts), still null by design, and that file's
 * own rule is to omit an unconfirmed field rather than substitute a placeholder. Adding them is a
 * small change once the registered details are confirmed.
 */
export const metadata: Metadata = {
  title: `Privacy Policy — ${branding.productName}`,
  description: `How ${branding.productName} collects, uses and protects your information.`,
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="font-display text-lg font-semibold">{title}</h2>
      <div className="mt-2 space-y-3 text-light-textSecondary dark:text-dark-textSecondary">
        {children}
      </div>
    </section>
  );
}

export default function PrivacyPage() {
  const support = branding.supportEmail;
  return (
    <main className="mx-auto max-w-2xl px-6 py-16 text-sm text-light-textPrimary dark:text-dark-textPrimary">
      <h1 className="font-display text-2xl font-bold">Privacy Policy</h1>
      <p className="mt-2 text-xs text-light-textMuted dark:text-dark-textMuted">
        Version {PRIVACY_VERSION} · Last updated 11 September 2026
      </p>

      <p className="mt-6 text-light-textSecondary dark:text-dark-textSecondary">
        {branding.productName} is property-management software for landlords and property owners.
        This policy explains what we collect, why we collect it, and what you can do about it. It
        covers the {branding.productName} website at proplyst.co.za and the {branding.productName}{' '}
        Android application.
      </p>

      <Section title="What we collect">
        <p>
          <strong>Your account.</strong> Your email address and password when you register, and your
          name and, optionally, your phone number. Passwords are stored hashed by our authentication
          provider; we never see them.
        </p>
        <p>
          <strong>What you put into {branding.productName}.</strong> The records you create to
          manage your portfolio: properties and their addresses, units, tenants and their contact
          details, leases, invoices, payments, expenses, budgets, utility meter readings and
          maintenance items. If you attach a document or photograph — a receipt, a municipal bill,
          evidence of a repair — we store that file.
        </p>
        <p>
          <strong>Information about tenants and other people.</strong> {branding.productName} lets
          you record details about your tenants. Where you do that, you are responsible for having a
          lawful basis to hold that information, and we process it on your behalf and on your
          instructions.
        </p>
        <p>
          <strong>Technical information.</strong> Ordinary server logs generated when your device
          contacts our servers, including IP address and timestamps, kept for security and
          troubleshooting.
        </p>
      </Section>

      <Section title="What we do not collect">
        <p>
          {branding.productName} contains no advertising, analytics, attribution or crash-reporting
          software. We do not track you across other apps or websites, we do not build advertising
          profiles, and we do not collect your location, contacts, calendar, messages or browsing
          history.
        </p>
        <p>
          The Android app requests no camera or storage permission. Photographs are attached through
          your device&apos;s own camera app and file picker, so {branding.productName} never has
          open access to your gallery. The only permissions it requests are internet access and, if
          you switch it on, fingerprint unlock.
        </p>
      </Section>

      <Section title="Why we use it">
        <ul className="list-disc space-y-1 pl-5">
          <li>To provide the service and show you your own records.</li>
          <li>To authenticate you and keep your account secure.</li>
          <li>
            To send service messages you have asked for, such as rent reminders and payment
            confirmations, including by WhatsApp where you have configured it.
          </li>
          <li>To meet our legal obligations, including retention of financial records.</li>
        </ul>
        <p>We do not sell your personal information, and we do not share it for advertising.</p>
      </Section>

      <Section title="Who processes it for us">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Supabase</strong> — database, file storage and authentication.
          </li>
          <li>
            <strong>Render</strong> — application hosting.
          </li>
          <li>
            <strong>Meta Platforms</strong> — delivery of WhatsApp messages, where you enable them.
          </li>
          <li>
            <strong>Resend</strong> — delivery of email.
          </li>
          <li>
            <strong>PayFast</strong> — subscription payments for {branding.productName} itself. Card
            details are handled by PayFast and never reach us.
          </li>
        </ul>
        <p>
          Each acts only on our instructions, and none is permitted to use your data for their own
          purposes.
        </p>
      </Section>

      <Section title="How we protect it">
        <p>
          Data is encrypted in transit using HTTPS. Access is enforced at the database level by
          row-level security, so one organisation cannot read another&apos;s records. On Android
          your session is held in the device&apos;s encrypted storage and is excluded from
          Android&apos;s automatic backups, so it cannot be restored onto another device.
        </p>
      </Section>

      <Section title="How long we keep it">
        <p>
          We keep your records for as long as your account is active. When you delete your account
          we erase the personal information attached to it — your name, email address and phone
          number — and permanently close it so that it can never be signed into again. We keep an
          anonymised sign-in record with no personal information in it, because the financial and
          audit entries described below reference the account that made them and would otherwise
          become untraceable.
        </p>
        <p>
          We retain accounting records — invoices, payments, expenses and the audit trail — for five
          years, because South African tax law requires financial records to be kept for that
          period. Those records stay with the organisation that owns them and no longer identify you
          personally.
        </p>
      </Section>

      <Section title="Deleting your account">
        <p>
          You can delete your account at any time. In the Android app, open{' '}
          <strong>More → Account → Delete account</strong>. On the web, use{' '}
          <Link
            href="/delete-account"
            className="text-light-accent hover:underline dark:text-dark-accent"
          >
            proplyst.co.za/delete-account
          </Link>
          , which also explains what to do if you can no longer sign in.
        </p>
        <p>
          Deleting your account removes <em>you</em>. It does not delete the organisation you
          belonged to, because the property, tenant, lease and financial records in it belong to
          that organisation rather than to you personally, and other people may still rely on them.
        </p>
        <p>
          <strong>If you are the only owner of an organisation,</strong> deleting your account
          leaves that organisation with nobody who can reach it. Transfer ownership to someone else
          first, or ask us to delete the organisation and its data — email{' '}
          <a
            href={`mailto:${support}?subject=Organisation%20deletion%20request`}
            className="text-light-accent hover:underline dark:text-dark-accent"
          >
            {support}
          </a>{' '}
          from the address on the account. There is no self-service way to delete a whole
          organisation; we do it for you, and we will confirm when it is done.
        </p>
      </Section>

      <Section title="Your rights">
        <p>
          Under the Protection of Personal Information Act (POPIA) you may ask us for a copy of the
          personal information we hold about you, ask us to correct it, or object to how we use it.
          Contact us at{' '}
          <a
            href={`mailto:${support}`}
            className="text-light-accent hover:underline dark:text-dark-accent"
          >
            {support}
          </a>
          .
        </p>
        <p>
          If you believe we have not handled your information properly, you may complain to the
          Information Regulator of South Africa.
        </p>
      </Section>

      <Section title="Children">
        <p>{branding.productName} is business software and is not directed at children under 18.</p>
      </Section>

      <Section title="Changes to this policy">
        <p>
          If we change this policy we will update the version and date above and, for significant
          changes, tell you in the app or by email.
        </p>
      </Section>

      <Section title="Contact us">
        <p>
          <a
            href={`mailto:${support}`}
            className="text-light-accent hover:underline dark:text-dark-accent"
          >
            {support}
          </a>
          <br />
          {branding.websiteUrl}
        </p>
      </Section>

      <p className="mt-10 text-xs text-light-textMuted dark:text-dark-textMuted">
        See also our{' '}
        <Link href="/terms" className="text-light-accent hover:underline dark:text-dark-accent">
          Terms of Service
        </Link>
        .
      </p>
    </main>
  );
}
