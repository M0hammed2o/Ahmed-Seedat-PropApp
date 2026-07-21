import { AdminDataTable } from '@/components/ui/AdminDataTable';
import { requireRole } from '@/lib/auth';
import { getServiceRoleClient } from '@/lib/supabase/server';

export default async function ProcessingPage() {
  await requireRole('read_only_admin');
  const supabase = getServiceRoleClient();
  const { data } = await supabase
    .from('extraction_jobs')
    .select('id, document_id, status, attempt, provider_name, error_message, created_at')
    .order('created_at', { ascending: false })
    .limit(50);

  return (
    <div>
      <h1 className="text-xl font-semibold text-light-textPrimary dark:text-dark-textPrimary">
        Document processing
      </h1>
      <p className="mt-1 text-sm text-light-textSecondary dark:text-dark-textSecondary">
        No OCR provider is integrated yet (Phase 2 — DOCUMENT_INTELLIGENCE.md), so this queue is
        empty until real uploads start generating extraction jobs.
      </p>
      <div className="mt-6">
        <AdminDataTable
          emptyMessage="No extraction jobs yet."
          data={data ?? []}
          columns={[
            {
              header: 'Document',
              accessorKey: 'document_id',
              cell: (info) => (info.getValue() as string).slice(0, 8),
            },
            { header: 'Status', accessorKey: 'status' },
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
