import { ProcessingTable, type ProcessingRow } from '@/components/tables/ProcessingTable';
import { AdminMetricCard } from '@/components/ui/AdminMetricCard';
import { PageHeader } from '@/components/ui/PageHeader';
import { requireRole } from '@/lib/auth';
import { getServiceRoleClient } from '@/lib/supabase/server';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';
import { DEMO_OCR_JOBS } from '@/lib/demo/adminMockData';

export default async function ProcessingPage() {
  await requireRole('read_only_admin');

  const data: ProcessingRow[] = ADMIN_DEMO_MODE
    ? DEMO_OCR_JOBS.map((job) => ({
        id: job.id,
        document_id: `${job.customerName} · ${job.documentName}`,
        status: job.status,
        attempt: job.status === 'failed' ? 2 : 1,
        provider_name: job.provider,
        error_message: job.errorCategory,
        created_at: job.createdAt,
      }))
    : ((
        await getServiceRoleClient()
          .from('extraction_jobs')
          .select('id, document_id, status, attempt, provider_name, error_message, created_at')
          .order('created_at', { ascending: false })
          .limit(50)
      ).data ?? []);

  const queued = data.filter((j) => j.status === 'queued').length;
  const processing = data.filter((j) => j.status === 'processing').length;
  const failed = data.filter((j) => j.status === 'failed').length;
  const succeeded = data.filter((j) => j.status === 'succeeded').length;

  return (
    <div>
      <PageHeader
        title="Document processing"
        subtitle="OCR extraction queue — retry, dead-letter, and provider metadata at a glance."
        actions={
          ADMIN_DEMO_MODE ? (
            <span className="rounded-full border border-light-accent px-3 py-1 text-xs font-semibold text-light-accent dark:border-dark-accent dark:text-dark-accent">
              Demo data
            </span>
          ) : undefined
        }
      />

      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <AdminMetricCard label="Queued" value={queued} />
        <AdminMetricCard label="Processing" value={processing} />
        <AdminMetricCard label="Succeeded" value={succeeded} />
        <AdminMetricCard
          label="Failed"
          value={failed}
          hint={failed > 0 ? 'Retry eligible' : undefined}
        />
      </div>

      <div className="mt-6">
        <ProcessingTable data={data} />
      </div>
    </div>
  );
}
