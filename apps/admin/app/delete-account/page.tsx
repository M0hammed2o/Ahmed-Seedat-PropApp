import type { Metadata } from 'next';
import Link from 'next/link';
import { branding } from '@propvault/config';

// Public, unauthenticated page required by Google Play's "App account deletion" policy
// (support.google.com/googleplay/android-developer/answer/13327111): a person who has uninstalled
// the app -- or who never had it -- must still be able to find and start account deletion on the
// web. It is deliberately reachable without signing in, names the app and developer, and puts the
// deletion pathway at the top rather than buried in prose, which is what the policy asks for.
export const metadata: Metadata = {
  title: `Delete your ${branding.productName} account`,
  description: `How to delete your ${branding.productName} account and what happens to your data.`,
};

// Repo convention (packages/config/src/branding.ts, app/access-restricted/page.tsx): the support
// address is a documented TO_BE_CONFIRMED placeholder and must never be rendered to a customer.
// Once a real mailbox exists, setting branding.supportEmail switches the email route on here with
// no other change.
const supportEmailConfigured = !branding.supportEmail.endsWith('.example');

export default function DeleteAccountPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16 text-sm text-light-textPrimary dark:text-dark-textPrimary">
      <h1 className="font-display text-2xl font-bold">
        Delete your {branding.productName} account
      </h1>
      <p className="mt-3 text-light-textSecondary dark:text-dark-textSecondary">
        {branding.productName} is property-management software published by {branding.productName}.
        This page explains how to delete your account and exactly what happens to your information.
      </p>

      <h2 className="mt-10 font-display text-lg font-semibold">Delete it yourself, now</h2>
      <ol className="mt-3 list-decimal space-y-2 pl-5 text-light-textSecondary dark:text-dark-textSecondary">
        <li>
          <strong>In the Android app:</strong> open <strong>More → Account → Delete account</strong>,
          then confirm. Deletion happens immediately.
        </li>
        <li>
          <strong>On the web:</strong>{' '}
          <Link href="/login" className="text-light-accent hover:underline dark:text-dark-accent">
            sign in
          </Link>{' '}
          and use the same option under your account settings.
        </li>
      </ol>

      <h2 className="mt-10 font-display text-lg font-semibold">
        If you can no longer sign in
      </h2>
      {supportEmailConfigured ? (
        <p className="mt-3 text-light-textSecondary dark:text-dark-textSecondary">
          If you have uninstalled the app or lost access to your sign-in details, email{' '}
          <a
            href={`mailto:${branding.supportEmail}?subject=Account%20deletion%20request`}
            className="text-light-accent hover:underline dark:text-dark-accent"
          >
            {branding.supportEmail}
          </a>{' '}
          from the address on the account, with the subject{' '}
          <strong>Account deletion request</strong>. We verify the request and complete the
          deletion within 30 days.
        </p>
      ) : (
        <p className="mt-3 text-light-textSecondary dark:text-dark-textSecondary">
          If you have uninstalled the app, reinstall it and sign in once to use the in-app option
          above, or{' '}
          <Link href="/login" className="text-light-accent hover:underline dark:text-dark-accent">
            sign in on the web
          </Link>
          . If you have lost access to your sign-in details, use{' '}
          <Link
            href="/forgot-password"
            className="text-light-accent hover:underline dark:text-dark-accent"
          >
            password reset
          </Link>{' '}
          to regain access first, then delete the account.
        </p>
      )}

      <h2 className="mt-10 font-display text-lg font-semibold">What is deleted</h2>
      <ul className="mt-3 list-disc space-y-1 pl-5 text-light-textSecondary dark:text-dark-textSecondary">
        <li>Your name, email address and phone number are erased.</li>
        <li>
          The account is permanently closed and can never be signed into again. An anonymised
          sign-in record remains, holding no personal information, because the accounting and audit
          entries below reference the account that created them.
        </li>
        <li>Your access to every organisation you belonged to is removed.</li>
      </ul>
      <p className="mt-3 text-light-textSecondary dark:text-dark-textSecondary">
        It takes effect immediately and cannot be undone.
      </p>

      <h2 className="mt-10 font-display text-lg font-semibold">What is kept, and why</h2>
      <p className="mt-3 text-light-textSecondary dark:text-dark-textSecondary">
        {branding.productName} keeps accounting records — invoices, payments, expenses and the audit
        trail — because South African tax law requires financial records to be retained for five
        years. These records are kept in the organisation that owns them and no longer identify you
        personally once your account is deleted.
      </p>
      <p className="mt-3 text-light-textSecondary dark:text-dark-textSecondary">
        Property, tenant and lease records belong to the organisation, not to your personal account,
        so deleting your account does not delete them. If you are an invited user, you simply lose
        access and the organisation carries on without you.
      </p>

      <h2 className="mt-10 font-display text-lg font-semibold">
        If you are the only owner of an organisation
      </h2>
      <p className="mt-3 text-light-textSecondary dark:text-dark-textSecondary">
        Deleting your account leaves that organisation with nobody who can reach it. Before you
        delete, either transfer ownership to someone else, or ask us to delete the whole
        organisation.
      </p>
      <p className="mt-3 text-light-textSecondary dark:text-dark-textSecondary">
        To have an organisation and everything in it deleted, email{' '}
        <a
          href={`mailto:${branding.supportEmail}?subject=Organisation%20deletion%20request`}
          className="text-light-accent hover:underline dark:text-dark-accent"
        >
          {branding.supportEmail}
        </a>{' '}
        from the address on the account, with the subject{' '}
        <strong>Organisation deletion request</strong>. There is no self-service way to do this — we
        verify the request, delete the organisation and confirm when it is done, keeping only the
        accounting records the law requires us to keep.
      </p>

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
