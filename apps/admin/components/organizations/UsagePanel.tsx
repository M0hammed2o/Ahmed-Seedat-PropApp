const USAGE_LABELS: Record<string, string> = {
  storage_bytes: 'Storage',
  email_sent: 'Emails sent',
  whatsapp_sent: 'WhatsApp sent',
  ocr_page: 'OCR pages',
  ai_token: 'AI tokens',
};

function formatUsage(usageType: string, quantity: number): string {
  if (usageType === 'storage_bytes') return `${(quantity / 1024 / 1024).toFixed(2)} MB`;
  return quantity.toLocaleString('en-ZA');
}

// PWA_V1_COMPLETION_PLAN.md #13 -- usage_events/usage_snapshots (DATABASE.md §7) existed with
// zero UI reading them anywhere (SUPER_ADMIN.md §7 gap list, resolved as "usage metering" item
// there). Shows the live current-month totals (see lib/superAdmin.ts's own note on why -- no
// rollup job exists yet to populate usage_snapshots).
export function UsagePanel({
  periodStart,
  totals,
}: {
  periodStart: string;
  totals: Record<string, number>;
}) {
  return (
    <div className="mt-6">
      <h2 className="text-sm font-semibold text-light-textPrimary dark:text-dark-textPrimary">
        Usage this period ({new Date(periodStart).toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' })})
      </h2>
      <dl className="mt-2 grid grid-cols-2 gap-4 text-sm lg:grid-cols-5">
        {Object.entries(totals).map(([usageType, quantity]) => (
          <div key={usageType} className="rounded-card border border-light-border bg-light-surfaceRaised p-3 dark:border-dark-border dark:bg-dark-surfaceRaised">
            <dt className="text-xs text-light-textMuted dark:text-dark-textMuted">{USAGE_LABELS[usageType] ?? usageType}</dt>
            <dd className="mt-1 text-light-textPrimary dark:text-dark-textPrimary">{formatUsage(usageType, quantity)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
