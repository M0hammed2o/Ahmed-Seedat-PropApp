import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { TERMS_VERSION, branding, platformBillingEntity } from '@propvault/config';

/**
 * The real, binding Terms of Service, published 2026-09-11 for the Google Play v1.0 release. It
 * replaces a placeholder that said outright it "is not binding legal content".
 *
 * Written against what Proplyst actually does, not a generic SaaS template. Specifically, and
 * deliberately, it does NOT claim:
 *  - that Proplyst processes, holds or transmits rent or deposit money. It does not: tenants
 *    report payments, owners confirm them, and trust deposits are a ledger record
 *    (release_trust_deposit()), never a transfer.
 *  - any uptime, availability or backup guarantee. No SLA exists.
 *  - artificial intelligence. Portfolio Intelligence is a deterministic rules engine with no LLM
 *    anywhere in its code path (see lib/portfolioIntelligence.ts).
 *  - any security certification or audit.
 *  - that every feature is always available. Document uploads, for instance, are gated behind a
 *    malware scanner that is not yet configured in production, so §"Availability and changes"
 *    is written to cover features being temporarily unavailable rather than promising them.
 *
 * The operating legal entity is NOT stated unless `platformBillingEntity` carries it. That object
 * is null by design and its own rule is to omit an unconfirmed field, never substitute a
 * placeholder -- the same convention lib/subscriptionInvoicePdf.ts follows. Once the registered
 * details are confirmed, setting them there makes the clause below appear with no edit here.
 */
export const metadata: Metadata = {
  title: `Terms of Service — ${branding.productName}`,
  description: `The terms that apply when you use ${branding.productName}.`,
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

export default function TermsPage() {
  const support = branding.supportEmail;
  const product = branding.productName;

  return (
    <main className="mx-auto max-w-2xl px-6 py-16 text-sm text-light-textPrimary dark:text-dark-textPrimary">
      <h1 className="font-display text-2xl font-bold">Terms of Service</h1>
      <p className="mt-2 text-xs text-light-textMuted dark:text-dark-textMuted">
        Version {TERMS_VERSION} · Effective 11 September 2026
      </p>

      <p className="mt-6 text-light-textSecondary dark:text-dark-textSecondary">
        These terms are the agreement between you and {product} for the use of our property
        management software at proplyst.co.za and in the {product} Android app. We have tried to
        write them in plain language. Please read them.
      </p>

      <Section title="1. Accepting these terms">
        <p>
          By creating a {product} account, or by using {product}{' '}
          in any way, you agree to these
          terms. If you are agreeing on behalf of a company, a close corporation, a trust or another
          organisation, you confirm that you are authorised to bind it, and &ldquo;you&rdquo; means
          that organisation.
        </p>
        <p>If you do not agree, please do not use {product}.</p>
      </Section>

      <Section title="2. Who may use Proplyst">
        <p>
          You must be at least 18 years old and legally able to enter into a contract. {product} is
          business software for landlords, property owners and the people they authorise. It is not
          intended for personal or household use.
        </p>
      </Section>

      <Section title="3. Your account and keeping it secure">
        <p>
          You are responsible for your account and for everything done through it. Keep your
          password private, use a password you do not use elsewhere, and tell us promptly at{' '}
          <a
            href={`mailto:${support}`}
            className="text-light-accent hover:underline dark:text-dark-accent"
          >
            {support}
          </a>{' '}
          if you think someone else has gained access.
        </p>
        <p>
          Do not share one login between people. If someone else needs access, invite them properly
          so that their actions are recorded against them.
        </p>
      </Section>

      <Section title="4. Your organisation and the people you invite">
        <p>
          A {product} organisation holds your portfolio. You can invite staff, co-owners and tenants
          and give them different levels of access. You decide who gets access and at what level,
          and you are responsible for what the people you invite do in your organisation. Remove
          access promptly when someone no longer needs it.
        </p>
      </Section>

      <Section title="5. The information you put into Proplyst">
        <p>
          Everything {product} shows you is worked out from the information you enter: properties,
          units, tenants, leases, rent amounts, invoices, payments, expenses, budgets, rates and
          taxes, levies, meter readings and maintenance records. You are responsible for the
          accuracy and completeness of that information, and for keeping it up to date.
        </p>
        <p>
          Where you record information about other people — most obviously your tenants — you are
          responsible for having a lawful basis to hold and use it. We handle it on your behalf and
          on your instructions, as described in our{' '}
          <Link href="/privacy" className="text-light-accent hover:underline dark:text-dark-accent">
            Privacy Policy
          </Link>
          .
        </p>
      </Section>

      <Section title="6. What Proplyst does, and what it does not do">
        <p>
          <strong>{product} keeps records. It does not move money.</strong> When a tenant reports a
          payment, {product} records that report and waits for you to confirm it. Confirming a
          payment in {product} records that you received it — it does not transfer funds, and
          nothing in {product} debits or credits any bank account. Deposit and trust records work
          the same way: they are a ledger of what you are holding, not an account that holds it.
        </p>
        <p>
          Budgets, financial summaries, rent status, reports and the alerts under Needs attention
          are calculated from the records in your organisation using fixed rules. They are a
          convenience, not financial, accounting, tax or legal advice, and they are only ever as
          correct as the information behind them. Check the figures before relying on them for
          anything that matters — a tax return, a lease decision, a dispute.
        </p>
        <p>
          {product} is not a bank, a payment service, an estate agency, an accountant or an attorney,
          and using it does not create any of those relationships.
        </p>
      </Section>

      <Section title="7. Documents and other content you upload">
        <p>
          You keep ownership of what you upload — receipts, statements, lease documents,
          photographs, maintenance evidence and meter photos. You give us permission to store and
          process it only so that we can provide the service to you.
        </p>
        <p>
          Do not upload anything you do not have the right to upload, anything unlawful, or anything
          containing malicious code. We may remove content that breaches these terms.
        </p>
      </Section>

      <Section title="8. Notifications">
        <p>
          {product}{' '}
          can send messages by email and, where you have configured it, by WhatsApp — rent
          reminders, payment confirmations, maintenance updates and similar. Delivery depends on
          third-party networks and on the recipient&apos;s own settings, so we cannot promise that
          any particular message arrives, arrives on time, or is read. Do not rely on a {product}{' '}
          notification as your only means of giving legal notice to a tenant.
        </p>
      </Section>

      <Section title="9. Subscriptions, billing and cancellation">
        <p>
          {product} is sold on subscription plans — currently Starter, Professional and Business —
          billed monthly or annually. The price, billing period and any trial are shown to you
          before you subscribe, and your plan may limit things like how many properties or users
          your organisation can have.
        </p>
        <p>
          Subscription payments are processed by PayFast. We do not receive or store your card
          details. A subscription renews automatically for the same period until you cancel.
        </p>
        <p>
          You can cancel at any time from your billing settings. Cancelling stops future billing;
          it does not refund the period you have already paid for, unless the law requires
          otherwise. If a payment fails or a subscription lapses, we may restrict access to parts of{' '}
          {product} until it is resolved.
        </p>
        <p>
          We may change our prices. If we do, we will give you reasonable notice before the change
          affects your next renewal.
        </p>
      </Section>

      <Section title="10. Services we rely on">
        <p>
          {product} runs on third-party infrastructure and services, including Supabase, Render,
          PayFast, Meta Platforms for WhatsApp delivery, and Resend for email. They are listed, with
          what each one does, in our{' '}
          <Link href="/privacy" className="text-light-accent hover:underline dark:text-dark-accent">
            Privacy Policy
          </Link>
          . An outage or change at one of them can affect {product}, and that is outside our
          control.
        </p>
      </Section>

      <Section title="11. Acceptable use">
        <p>You agree not to:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>use {product} for anything unlawful, or to harass or defraud anyone;</li>
          <li>try to access another organisation&apos;s data, or any part of the system you have not been given access to;</li>
          <li>probe, scan or test the security of the service without our written permission;</li>
          <li>copy, resell or white-label the service, or use it to build a competing product;</li>
          <li>scrape the service, or use automated means to extract data at scale;</li>
          <li>upload malicious code, or deliberately place unreasonable load on the service.</li>
        </ul>
      </Section>

      <Section title="12. Our intellectual property">
        <p>
          {product} — the software, the design, the name and the logo — belongs to us. These terms
          give you permission to use the service while your subscription is active; they do not
          transfer any ownership to you. Your data stays yours.
        </p>
        <p>
          If you send us feedback or suggestions, we may use them to improve {product} without owing
          you anything for them.
        </p>
      </Section>

      <Section title="13. Availability and changes to the service">
        <p>
          We work to keep {product} available and working well, but we do not promise that it will
          be uninterrupted or error-free, and we do not offer a guaranteed uptime level. Maintenance,
          outages at the services we depend on, and faults all happen.
        </p>
        <p>
          We improve {product} continuously, so features change. We may add, alter or withdraw
          features, and a feature may be temporarily unavailable while we work on it. If we
          discontinue something you rely on materially, we will give you reasonable notice where we
          can.
        </p>
      </Section>

      <Section title="14. Your data, and keeping your own records">
        <p>
          We take reasonable care of your data and describe how we protect it in our{' '}
          <Link href="/privacy" className="text-light-accent hover:underline dark:text-dark-accent">
            Privacy Policy
          </Link>
          . We do not, however, guarantee against data loss, and {product} is not a backup service.
        </p>
        <p>
          Keep your own copies of anything you cannot afford to lose — particularly source documents
          such as signed leases, municipal accounts and receipts. You are responsible for keeping
          the financial records the law requires you to keep.
        </p>
      </Section>

      <Section title="15. Suspension and termination">
        <p>
          You can stop using {product} at any time. We may suspend or close an account that breaches
          these terms, that is being used unlawfully, or where a subscription has gone unpaid.
          Where it is reasonable to do so, we will tell you first and give you a chance to put it
          right.
        </p>
      </Section>

      <Section title="16. Deleting your account">
        <p>
          You can delete your account at any time — in the Android app under{' '}
          <strong>More → Account → Delete account</strong>, or on the web at{' '}
          <Link
            href="/delete-account"
            className="text-light-accent hover:underline dark:text-dark-accent"
          >
            proplyst.co.za/delete-account
          </Link>
          .
        </p>
        <p>
          Deleting your account erases the personal information attached to it — your name, email
          address and phone number — and permanently closes it so that it can never be signed into
          again. We keep an anonymised sign-in record containing no personal information, because
          the accounting and audit entries below reference the account that created them.
        </p>
        <p>
          Accounting records — invoices, payments, expenses and the audit trail — are kept for five
          years because South African tax law requires financial records to be retained. Once your
          account is deleted they no longer identify you.
        </p>
        <p>
          <strong>Deleting your account does not delete your organisation.</strong> Property, tenant,
          lease and financial records belong to the organisation, not to you personally, and other
          people may still depend on them. If you are an invited user, you simply lose access and
          the organisation carries on.
        </p>
        <p>
          <strong>If you are the only owner of an organisation,</strong> deleting your account leaves
          it with nobody who can reach it. Transfer ownership to someone else first, or ask us to
          delete the organisation and everything in it by emailing{' '}
          <a
            href={`mailto:${support}?subject=Organisation%20deletion%20request`}
            className="text-light-accent hover:underline dark:text-dark-accent"
          >
            {support}
          </a>{' '}
          from the address on the account. There is no self-service way to delete a whole
          organisation — we do it for you and confirm when it is done, subject to the five-year
          retention above.
        </p>
        <p>
          This is explained in full on the{' '}
          <Link
            href="/delete-account"
            className="text-light-accent hover:underline dark:text-dark-accent"
          >
            deletion page
          </Link>{' '}
          and in our{' '}
          <Link href="/privacy" className="text-light-accent hover:underline dark:text-dark-accent">
            Privacy Policy
          </Link>
          .
        </p>
      </Section>

      <Section title="17. Disclaimers">
        <p>
          Except where the law says otherwise, {product}{' '}
          is provided &ldquo;as is&rdquo;. We do not
          warrant that it will meet your particular requirements, that it will be available without
          interruption, or that the calculations and alerts it produces are free of error.
        </p>
        <p>
          Nothing in these terms excludes or limits any right you have under the Consumer Protection
          Act, the Electronic Communications and Transactions Act, or any other law that cannot be
          excluded by agreement.
        </p>
      </Section>

      <Section title="18. Limitation of liability">
        <p>
          To the extent the law allows, we are not liable for indirect or consequential loss, for
          loss of profit, revenue, goodwill or anticipated savings, or for loss of data, however it
          arises.
        </p>
        <p>
          Where we are liable, our total liability to you for all claims in any twelve-month period
          is limited to the subscription fees you paid us for {product} in that period.
        </p>
        <p>
          This clause does not limit liability for death or personal injury caused by our
          negligence, for fraud, or for anything else that cannot lawfully be limited.
        </p>
      </Section>

      <Section title="19. Indemnity">
        <p>
          You agree to cover us against claims, losses and reasonable costs arising from your use of{' '}
          {product} in breach of these terms or of the law, or from information you put into{' '}
          {product} that you had no right to hold or use — including claims by your tenants about
          how their information was handled.
        </p>
      </Section>

      <Section title="20. Changes to these terms">
        <p>
          We may update these terms. When we do, we will change the version and effective date at
          the top of this page, and for significant changes we will ask you to accept the new terms
          when you next sign in. Continuing to use {product} after a change means you accept it.
        </p>
      </Section>

      <Section title="21. Governing law">
        <p>
          These terms are governed by the law of the Republic of South Africa, and the South African
          courts have jurisdiction over any dispute arising from them.
        </p>
        <p>
          If a dispute arises, please contact us first at{' '}
          <a
            href={`mailto:${support}`}
            className="text-light-accent hover:underline dark:text-dark-accent"
          >
            {support}
          </a>
          . Most problems are quicker to solve that way.
        </p>
      </Section>

      <Section title="22. Contact us">
        <p>
          {platformBillingEntity.legalEntityName ? (
            <>
              {platformBillingEntity.legalEntityName}
              <br />
            </>
          ) : null}
          {platformBillingEntity.companyRegistrationNumber ? (
            <>
              Registration number {platformBillingEntity.companyRegistrationNumber}
              <br />
            </>
          ) : null}
          {platformBillingEntity.vatNumber ? (
            <>
              VAT number {platformBillingEntity.vatNumber}
              <br />
            </>
          ) : null}
          {platformBillingEntity.registeredAddress ? (
            <>
              {platformBillingEntity.registeredAddress}
              <br />
            </>
          ) : null}
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
        <Link href="/privacy" className="text-light-accent hover:underline dark:text-dark-accent">
          Privacy Policy
        </Link>
        .
      </p>
    </main>
  );
}
