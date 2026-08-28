import Link from 'next/link';
import type { DocumentRecord } from '@propvault/types';
import {
  DocumentsFilterClient,
  type PropertyOption,
  type CategoryOption,
} from '@/components/tables/DocumentsFilterClient';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapDocumentRow } from '@/lib/documents';
import { resolvePortalSession, findActiveMembership, canWriteOrgRecords } from '@/lib/orgSession';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';

type SearchParams = {
  searchParams: Promise<{ propertyId?: string; categoryId?: string; unitId?: string }>;
};

type DocumentFilters = { propertyId?: string; categoryId?: string; unitId?: string };

const DEMO_PROPERTIES: PropertyOption[] = [{ id: 'demo-property-1', nickname: 'Sea Point Apartment' }];
const DEMO_CATEGORIES: CategoryOption[] = [{ id: 'demo-category-1', label: 'Rental Documents' }];

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
    leaseId: null,
    unitId: null,
    tenantId: null,
    maintenanceTicketId: null,
    uploadedBy: null,
    deletedAt: null,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
  },
];

/**
 * GET /documents -- Documents module first implementation (TASKS.md M11/M20). Same direct-RLS-read
 * pattern as every list page this milestone.
 *
 * Property/category filtering pass (V1 launch-completion, this date): now reads ?propertyId=,
 * ?categoryId= and (defensively, no current UI linker) ?unitId= from the URL and applies them as
 * real Supabase .eq() filters server-side, instead of fetching every org document and filtering in
 * memory -- matters for orgs with large document counts. Property page's "View all documents ->"
 * link (owned by another agent this pass) lands here with ?propertyId=<id> set.
 */
export default async function DocumentsPage({ searchParams }: SearchParams) {
  const { propertyId, categoryId, unitId } = await searchParams;
  const filters: DocumentFilters = { propertyId, categoryId, unitId };

  if (ADMIN_DEMO_MODE) {
    const documents = DEMO_DOCUMENTS.filter(
      (d) =>
        (!filters.propertyId || d.propertyId === filters.propertyId) &&
        (!filters.categoryId || d.categoryId === filters.categoryId) &&
        (!filters.unitId || d.unitId === filters.unitId),
    );
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
          actions={documents.length > 0 ? addAction : undefined}
        />
        <DocumentsFilterClient
          documents={documents}
          properties={DEMO_PROPERTIES}
          categories={DEMO_CATEGORIES}
          emptyAction={addAction}
        />
      </div>
    );
  }

  const session = await resolvePortalSession();
  const activeOrg = session?.organizations.find((m) => m.status === 'active');
  const membership = activeOrg ? findActiveMembership(session!, activeOrg.orgId) : undefined;
  const canWrite = Boolean(membership && canWriteOrgRecords(membership.role));

  const [documents, properties, categories] = await Promise.all([
    loadDocuments(filters),
    loadProperties(activeOrg?.orgId),
    loadCategories(),
  ]);

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
      <DocumentsFilterClient
        documents={documents}
        properties={properties}
        categories={categories}
        emptyAction={canWrite ? addAction : undefined}
      />
    </div>
  );
}

async function loadDocuments(filters: DocumentFilters): Promise<DocumentRecord[]> {
  const supabase = await getServerSupabaseClient();
  let query = supabase
    .from('documents')
    .select('*')
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  if (filters.propertyId) query = query.eq('property_id', filters.propertyId);
  if (filters.categoryId) query = query.eq('category_id', filters.categoryId);
  if (filters.unitId) query = query.eq('unit_id', filters.unitId);
  const { data, error } = await query;
  if (error) throw new Error(`Failed to load documents: ${error.message}`);
  return (data ?? []).map(mapDocumentRow);
}

async function loadProperties(orgId: string | undefined): Promise<PropertyOption[]> {
  if (!orgId) return [];
  const supabase = await getServerSupabaseClient();
  const { data, error } = await supabase
    .from('properties')
    .select('id, nickname')
    .eq('org_id', orgId)
    .eq('status', 'active')
    .order('nickname', { ascending: true });
  if (error) throw new Error(`Failed to load properties: ${error.message}`);
  return data ?? [];
}

async function loadCategories(): Promise<CategoryOption[]> {
  const supabase = await getServerSupabaseClient();
  const { data, error } = await supabase
    .from('document_categories')
    .select('id, label')
    .order('label', { ascending: true });
  if (error) throw new Error(`Failed to load categories: ${error.message}`);
  return data ?? [];
}
