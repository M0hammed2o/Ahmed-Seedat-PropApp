import { FileText } from 'lucide-react';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';

const SIGNED_URL_TTL_SECONDS = 60 * 10;

interface TenantDocumentRow {
  id: string;
  originalFileName: string;
  documentType: string;
  fileSizeBytes: number;
  createdAt: string;
  signedUrl: string | null;
}

const DEMO_DOCUMENTS: TenantDocumentRow[] = [
  {
    id: 'demo-tenant-document-1',
    originalFileName: 'Signed Lease Agreement.pdf',
    documentType: 'lease',
    fileSizeBytes: 184320,
    createdAt: '2026-02-01T00:00:00Z',
    signedUrl: null,
  },
];

/**
 * GET /my-documents -- PWA_V1_COMPLETION_PLAN.md #10. `documents_select_tenant_self`
 * (migration 20260101000049) already scopes this to documents a staff member explicitly tagged
 * with the caller's own lease -- never a blanket property grant (PERMISSIONS.md §4). RLS is the
 * real isolation boundary; this page just renders whatever it returns, the same
 * plain-RLS-protected-read pattern every other list page in this codebase uses.
 */
export default async function MyDocumentsPage() {
  const documents = ADMIN_DEMO_MODE ? DEMO_DOCUMENTS : await loadTenantDocuments();

  return (
    <div className="space-y-5 animate-rise">
      <PageHeader
        title="My Documents"
        subtitle="Documents your landlord or property manager has shared with you."
      />

      {documents.length === 0 ? (
        <div className="rounded-card border border-light-border bg-light-surfaceRaised dark:border-dark-border dark:bg-dark-surfaceRaised">
          <EmptyState
            icon={<FileText size={20} aria-hidden="true" />}
            title="No documents shared yet"
            description="Your lease and other shared documents will appear here."
          />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-card border border-light-border bg-light-surfaceRaised shadow-card dark:border-dark-border dark:bg-dark-surfaceRaised">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-light-border bg-light-surfaceStrong dark:border-dark-border dark:bg-dark-surfaceStrong">
              <tr>
                <th className="px-4 py-3 font-medium text-light-textSecondary dark:text-dark-textSecondary">
                  File
                </th>
                <th className="px-4 py-3 font-medium text-light-textSecondary dark:text-dark-textSecondary">
                  Type
                </th>
                <th className="px-4 py-3 font-medium text-light-textSecondary dark:text-dark-textSecondary">
                  Size
                </th>
                <th className="px-4 py-3 font-medium text-light-textSecondary dark:text-dark-textSecondary">
                  Shared
                </th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {documents.map((doc) => (
                <tr
                  key={doc.id}
                  className="border-b border-light-border last:border-b-0 dark:border-dark-border"
                >
                  <td className="px-4 py-3 text-light-textPrimary dark:text-dark-textPrimary">
                    {doc.originalFileName}
                  </td>
                  <td className="px-4 py-3 capitalize text-light-textPrimary dark:text-dark-textPrimary">
                    {doc.documentType.replace('_', ' ')}
                  </td>
                  <td className="px-4 py-3 text-light-textPrimary dark:text-dark-textPrimary">
                    {(doc.fileSizeBytes / 1024 / 1024).toFixed(2)} MB
                  </td>
                  <td className="px-4 py-3 text-light-textPrimary dark:text-dark-textPrimary">
                    {new Date(doc.createdAt).toLocaleDateString('en-ZA')}
                  </td>
                  <td className="px-4 py-3">
                    {doc.signedUrl ? (
                      <a
                        href={doc.signedUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="font-medium text-light-accent hover:underline dark:text-dark-accent"
                      >
                        View
                      </a>
                    ) : (
                      <span className="text-light-textMuted dark:text-dark-textMuted">
                        Unavailable
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

async function loadTenantDocuments(): Promise<TenantDocumentRow[]> {
  const supabase = await getServerSupabaseClient();
  const { data, error } = await supabase
    .from('documents')
    .select('id, original_file_name, document_type, file_size_bytes, storage_path, created_at')
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  if (error) throw new Error(`Failed to load documents: ${error.message}`);

  return Promise.all(
    (data ?? []).map(async (row) => {
      const { data: signed } = await supabase.storage
        .from('documents')
        .createSignedUrl(row.storage_path, SIGNED_URL_TTL_SECONDS);
      return {
        id: row.id,
        originalFileName: row.original_file_name,
        documentType: row.document_type,
        fileSizeBytes: row.file_size_bytes,
        createdAt: row.created_at,
        signedUrl: signed?.signedUrl ?? null,
      };
    }),
  );
}
