import Link from 'next/link';
import type { DocumentRecord } from '@propvault/types';
import { DocumentsFilterClient } from '@/components/tables/DocumentsFilterClient';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapDocumentRow } from '@/lib/documents';
import { resolvePortalSession, findActiveMembership, canWriteOrgRecords } from '@/lib/orgSession';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';

const DEMO_DOCUMENTS: DocumentRecord[] = [
  {
    id: 'demo-document-1',
    ownerUserId: null,
    orgId: 'demo-org-1',
    propertyId: 'demo-property-1',
    categoryId: 'demo-category-1',
    documentType: 'lease',
    storagePath: 'demo-org-1/demo-property-1/demo.pdf',
    originalFileName: 'Sea Point Apartment Lease.pdf',
    mimeType: 'application/pdf',
    fileSizeBytes: 245760,
    checksumSha256: 'demo',
    billingYear: null,
    billingMonth: null,
    deletedAt: null,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
  },
];

/**
 * GET /documents -- Documents module first implementation (TASKS.md M11/M20). Same direct-RLS-read
 * pattern as every list page this milestone.
 */
export default async function DocumentsPage() {
  const documents: DocumentRecord[] = ADMIN_DEMO_MODE ? DEMO_DOCUMENTS : await loadDocuments();
  const canWrite = ADMIN_DEMO_MODE ? true : await resolveCanWrite();

  const addAction = (
    <Link href="/documents/new">
      <Button variant="primary" size="sm">
        + Upload document
      </Button>
    </Link>
  );

  return (
    <div className="space-y-5 animate-rise">
      <PageHeader
        title="Documents"
        subtitle={`${documents.length} across your portfolio.`}
        actions={canWrite && documents.length > 0 ? addAction : undefined}
      />
      <DocumentsFilterClient documents={documents} emptyAction={canWrite ? addAction : undefined} />
    </div>
  );
}

async function loadDocuments(): Promise<DocumentRecord[]> {
  const supabase = await getServerSupabaseClient();
  const { data, error } = await supabase
    .from('documents')
    .select('*')
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  if (error) throw new Error(`Failed to load documents: ${error.message}`);
  return (data ?? []).map(mapDocumentRow);
}

async function resolveCanWrite(): Promise<boolean> {
  const session = await resolvePortalSession();
  if (!session) return false;
  const activeOrg = session.organizations.find((m) => m.status === 'active');
  if (!activeOrg) return false;
  const membership = findActiveMembership(session, activeOrg.orgId);
  return Boolean(membership && canWriteOrgRecords(membership.role));
}
