import { FileText } from 'lucide-react';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';

const SIGNED_URL_TTL_SECONDS = 60 * 10;

interface OwnerDocumentRow {
  id: string;
  originalFileName: string;
  documentType: string;
  propertyNickname: string | null;
  fileSizeBytes: number;
  createdAt: string;
  signedUrl: string | null;
}

const DEMO_DOCUMENTS: OwnerDocumentRow[] = [
  {
    id: 'demo-owner-document-1',
    originalFileName: 'Municipal Rates Statement.pdf',
    documentType: 'rates_and_taxes',
    propertyNickname: 'Oakwood Apartments',
    fileSizeBytes: 92160,
    createdAt: '2026-07-15T00:00:00Z',
    signedUrl: null,
  },
];

/**
 * GET /owner-portal/documents (Phase 5, commercial-launch execution plan) -- the "supporting
 * evidence" governance requirement. `documents_select_staff_or_owner` (migration 20260101000072)
 * already scopes this to documents on properties the caller holds an 'owner' grant on.
 */
export default async function OwnerDocumentsPage() {
  const documents = ADMIN_DEMO_MODE ? DEMO_DOCUMENTS : await loadOwnerDocuments();

  return (
    <div className="space-y-5 animate-rise">
      <PageHeader title="Documents" subtitle="Bills, statements, and other evidence for your properties." />

      {documents.length === 0 ? (
        <div className="rounded-card border border-light-border bg-light-surfaceRaised dark:border-dark-border dark:bg-dark-surfaceRaised">
          <EmptyState
            icon={<FileText size={20} aria-hidden="true" />}
            title="No documents yet"
            description="Bills, statements, and other supporting documents for your properties will appear here."
          />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-card border border-light-border bg-light-surfaceRaised shadow-card dark:border-dark-border dark:bg-dark-surfaceRaised">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-light-border bg-light-surfaceStrong dark:border-dark-border dark:bg-dark-surfaceStrong">
              <tr>
                <th className="px-4 py-3 font-medium text-light-textSecondary dark:text-dark-textSecondary">File</th>
                <th className="px-4 py-3 font-medium text-light-textSecondary dark:text-dark-textSecondary">Property</th>
                <th className="px-4 py-3 font-medium text-light-textSecondary dark:text-dark-textSecondary">Type</th>
                <th className="px-4 py-3 font-medium text-light-textSecondary dark:text-dark-textSecondary">Size</th>
                <th className="px-4 py-3 font-medium text-light-textSecondary dark:text-dark-textSecondary">Added</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {documents.map((doc) => (
                <tr key={doc.id} className="border-b border-light-border last:border-b-0 dark:border-dark-border">
                  <td className="px-4 py-3 text-light-textPrimary dark:text-dark-textPrimary">{doc.originalFileName}</td>
                  <td className="px-4 py-3 text-light-textPrimary dark:text-dark-textPrimary">{doc.propertyNickname ?? '—'}</td>
                  <td className="px-4 py-3 capitalize text-light-textPrimary dark:text-dark-textPrimary">
                    {doc.documentType.replace(/_/g, ' ')}
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
                      <span className="text-light-textMuted dark:text-dark-textMuted">Unavailable</span>
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

async function loadOwnerDocuments(): Promise<OwnerDocumentRow[]> {
  const supabase = await getServerSupabaseClient();
  const { data, error } = await supabase
    .from('documents')
    .select('id, original_file_name, document_type, storage_path, file_size_bytes, created_at, properties(nickname)')
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  if (error) throw new Error(`Failed to load documents: ${error.message}`);

  return Promise.all(
    (data ?? []).map(async (row) => {
      const { data: signed } = await supabase.storage
        .from('documents')
        .createSignedUrl(row.storage_path as string, SIGNED_URL_TTL_SECONDS);
      const property = row.properties as unknown as { nickname: string } | null;
      return {
        id: row.id as string,
        originalFileName: row.original_file_name as string,
        documentType: row.document_type as string,
        propertyNickname: property?.nickname ?? null,
        fileSizeBytes: row.file_size_bytes as number,
        createdAt: row.created_at as string,
        signedUrl: signed?.signedUrl ?? null,
      };
    }),
  );
}
