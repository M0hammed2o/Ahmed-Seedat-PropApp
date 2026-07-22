import { AdminDataTable } from '@/components/ui/AdminDataTable';
import { AdminMetricCard } from '@/components/ui/AdminMetricCard';
import { requireRole } from '@/lib/auth';
import { getServiceRoleClient } from '@/lib/supabase/server';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';
import { DEMO_OCR_JOBS } from '@/lib/demo/adminMockData';

interface ProcessingRow {
  id: string;
  document_id: string;
  status: string;
  attempt: number;
  provider_name: string | null;
  error_message: string | null;
  created_at: string;
}

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
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-light-textPrimary dark:text-dark-textPrimary">
          Document processing
        </h1>
        {ADMIN_DEMO_MODE ? (
          <span className="rounded-full border border-light-accent px-3 py-1 text-xs font-semibold text-light-accent dark:border-dark-accent dark:text-dark-accent">
            Demo data
          </span>
        ) : null}
      </div>
      <p className="mt-1 text-sm text-light-textSecondary dark:text-dark-textSecondary">
        OCR extraction queue — retry, dead-letter, and provider metadata at a glance.
      </p>

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
        <AdminDataTable
          emptyMessage="No extraction jobs yet."
          data={data}
          columns={[
            { header: 'Document', accessorKey: 'document_id' },
            {
              header: 'Status',
              accessorKey: 'status',
              cell: (info) => {
                const status = info.getValue() as string;
                const tone =
                  status === 'succeeded'
                    ? 'text-light-statusPaid dark:text-dark-statusPaid'
                    : status === 'failed'
                      ? 'text-light-statusOverdue dark:text-dark-statusOverdue'
                      : status === 'processing'
                        ? 'text-light-statusProcessing dark:text-dark-statusProcessing'
                        : 'text-light-textMuted dark:text-dark-textMuted';
                return <span className={`text-xs font-semibold ${tone}`}>{status}</span>;
              },
            },
            { header: 'Attempt', accessorKey: 'attempt' },
            {
              header: 'Provider',
              accessorKey: 'provider_name',
              cell: (info) => info.getValue() ?? '—',
            },
            {
              header: 'Error',
              accessorKey: 'error_message',
              cell: (info) => info.getValue() ?? '—',
            },
          ]}
        />
      </div>
    </div>
  );
}
