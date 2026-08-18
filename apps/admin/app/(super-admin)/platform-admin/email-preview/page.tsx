import { notFound } from 'next/navigation';
import Link from 'next/link';
import { PageHeader } from '@/components/ui/PageHeader';
import { getAdminSessionWithoutMfaCheck } from '@/lib/auth';
import { renderEmailTemplate, type EmailTemplateName } from '@/lib/emailDispatch';

// Final pre-UAT engineering pass (WORKLOG.md this date), Part 16: makes it possible for Mohammed
// to visually inspect representative branded emails without triggering a real send. Platform-
// admin-only (gated by the (super-admin) layout's own session check, same as every other page in
// this route group -- see system/page.tsx's identical comment). Calls renderEmailTemplate()
// directly (a pure function -- subject/bodyText/bodyHtml only, no EmailProvider call anywhere in
// this file), so there is no code path here that can ever dispatch a real email, even by mistake.
// All sample values below are obviously synthetic, never real customer data.

const PREVIEWS: Array<{
  key: string;
  label: string;
  template: EmailTemplateName;
  vars: Record<string, unknown>;
  note?: string;
}> = [
  {
    key: 'tenant-invitation',
    label: 'Tenant invitation',
    template: 'tenant_invitation',
    vars: {
      orgName: 'Sample Property Management (Pty) Ltd',
      expiresAt: '2026-09-01',
      acceptUrl: 'https://proplyst.co.za/activate?token=sample-preview-token',
    },
  },
  {
    key: 'rent-invoice',
    label: 'Rent invoice issued',
    template: 'invoice_issued',
    vars: {
      propertyAddress: '12 Sample Street, Sea Point',
      amount: 'R9,500.00',
      period: 'September 2026',
    },
    note: 'Rent reminder/overdue notices are WhatsApp-only in this release (no email template exists for them) -- this is the closest genuine rent-related EMAIL template.',
  },
  {
    key: 'payment-confirmation',
    label: 'Payment confirmation',
    template: 'payment_recorded',
    vars: { propertyAddress: '12 Sample Street, Sea Point' },
  },
  {
    key: 'maintenance-update',
    label: 'Maintenance update',
    template: 'maintenance_update',
    vars: {
      summary: 'Your maintenance ticket "Leaking tap in Unit 4B" has been marked In Progress.',
    },
  },
  {
    key: 'subscription-invoice',
    label: 'Subscription communication',
    template: 'subscription_activated',
    vars: { planName: 'Professional', legalName: 'Sample Property Management (Pty) Ltd' },
  },
];

export default async function EmailPreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string }>;
}) {
  const session = await getAdminSessionWithoutMfaCheck();
  if (!session) notFound();

  const { t } = await searchParams;
  const active = PREVIEWS.find((p) => p.key === t) ?? PREVIEWS[0]!;
  const rendered = renderEmailTemplate(active.template, active.vars);

  return (
    <div>
      <PageHeader
        title="Email preview"
        subtitle="Visual QA only -- renders the real shared template with synthetic sample data. Never sends a real email."
      />

      <div className="mt-6 flex flex-wrap gap-2">
        {PREVIEWS.map((p) => (
          <Link
            key={p.key}
            href={`/platform-admin/email-preview?t=${p.key}`}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium ${
              p.key === active.key
                ? 'border-light-accent bg-light-accentSoft text-light-accent dark:border-dark-accent dark:bg-dark-accentSoft dark:text-dark-accent'
                : 'border-light-border text-light-textPrimary hover:bg-light-surfaceRaised dark:border-dark-border dark:text-dark-textPrimary dark:hover:bg-dark-surfaceRaised'
            }`}
          >
            {p.label}
          </Link>
        ))}
      </div>

      {active.note ? (
        <p className="mt-3 rounded-md border border-light-warning bg-light-warning/10 px-3 py-2 text-xs text-light-warning dark:border-dark-warning dark:bg-dark-warning/10 dark:text-dark-warning">
          {active.note}
        </p>
      ) : null}

      <div className="mt-4 rounded-lg border border-light-border bg-light-surfaceRaised p-4 dark:border-dark-border dark:bg-dark-surfaceRaised">
        <p className="text-xs text-light-textMuted dark:text-dark-textMuted">Subject</p>
        <p className="mt-1 text-sm font-medium text-light-textPrimary dark:text-dark-textPrimary">
          {rendered.subject}
        </p>
      </div>

      <div className="mt-4 overflow-hidden rounded-lg border border-light-border dark:border-dark-border">
        <iframe
          title={`${active.label} preview`}
          srcDoc={rendered.bodyHtml}
          sandbox=""
          className="h-[720px] w-full bg-white"
        />
      </div>

      <details className="mt-4 rounded-lg border border-light-border p-4 text-xs dark:border-dark-border">
        <summary className="cursor-pointer font-medium text-light-textPrimary dark:text-dark-textPrimary">
          Plain-text fallback
        </summary>
        <pre className="mt-2 whitespace-pre-wrap text-light-textSecondary dark:text-dark-textSecondary">
          {rendered.bodyText}
        </pre>
      </details>
    </div>
  );
}
