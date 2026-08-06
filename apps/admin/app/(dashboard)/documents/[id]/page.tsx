import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { DocumentRecord, ExtractionResult } from '@propvault/types';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapDocumentRow, mapExtractionResultRow } from '@/lib/documents';
import { resolvePortalSession, findActiveMembership, canWriteOrgRecords } from '@/lib/orgSession';
import { OcrPanel } from '@/components/documents/OcrPanel';
import { PageHeader } from '@/components/ui/PageHeader';
import { Panel } from '@/components/ui/Panel';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';

type RouteParams = { params: Promise<{ id: string }> };

const SIGNED_URL_TTL_SECONDS = 300;

const DEMO_DOCUMENT: DocumentRecord = {
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
  deletedAt: null,
  createdAt: '2026-08-01T00:00:00Z',
  updatedAt: '2026-08-01T00:00:00Z',
};

export default async function DocumentDetailPage({ params }: RouteParams) {
  const { id } = await params;

  if (ADMIN_DEMO_MODE) {
    if (id !== 'demo-document-1') notFound();
    return (
      <DocumentDetailView
        document={DEMO_DOCUMENT}
        signedUrl={null}
        extractionResult={null}
        canAct
      />
    );
  }

  const supabase = await getServerSupabaseClient();
  const { data, error } = await supabase.from('documents').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(`Failed to load document: ${error.message}`);
  if (!data) notFound();
  const document = mapDocumentRow(data);

  let signedUrl: string | null = null;
  const { data: signed } = await supabase.storage
    .from('documents')
    .createSignedUrl(document.storagePath, SIGNED_URL_TTL_SECONDS);
  if (signed) signedUrl = signed.signedUrl;

  const { data: jobRow } = await supabase
    .from('extraction_jobs')
    .select('id')
    .eq('document_id', id)
    .eq('status', 'succeeded')
    .order('attempt', { ascending: false })
    .limit(1)
    .maybeSingle();

  let extractionResult: ExtractionResult | null = null;
  if (jobRow) {
    const { data: resultRow } = await supabase
      .from('extraction_results')
      .select('*')
      .eq('extraction_job_id', jobRow.id)
      .maybeSingle();
    if (resultRow) extractionResult = mapExtractionResultRow(resultRow);
  }

  const session = await resolvePortalSession();
  const membership =
    session && document.orgId ? findActiveMembership(session, document.orgId) : undefined;
  const canAct = Boolean(membership && canWriteOrgRecords(membership.role));

  return (
    <DocumentDetailView
      document={document}
      signedUrl={signedUrl}
      extractionResult={extractionResult}
      canAct={canAct}
    />
  );
}

function DocumentDetailView({
  document,
  signedUrl,
  extractionResult,
  canAct,
}: {
  document: DocumentRecord;
  signedUrl: string | null;
  extractionResult: ExtractionResult | null;
  canAct: boolean;
}) {
  return (
    <div className="space-y-6 animate-rise">
      <div>
        <Link
          href="/documents"
          className="text-xs text-light-textSecondary hover:underline dark:text-dark-textSecondary"
        >
          ← Back to documents
        </Link>
        <div className="mt-2">
          <PageHeader
            title={document.originalFileName}
            actions={
              signedUrl ? (
                <a
                  href={signedUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm font-medium text-light-accent hover:underline dark:text-dark-accent"
                >
                  View / download
                </a>
              ) : undefined
            }
          />
        </div>
      </div>

      <Panel title="Document details">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-5 text-sm lg:grid-cols-4">
          <div>
            <dt className="text-light-textMuted dark:text-dark-textMuted">Type</dt>
            <dd className="mt-0.5 capitalize text-light-textPrimary dark:text-dark-textPrimary">
              {document.documentType.replace('_', ' ')}
            </dd>
          </div>
          <div>
            <dt className="text-light-textMuted dark:text-dark-textMuted">Size</dt>
            <dd className="mt-0.5 text-light-textPrimary dark:text-dark-textPrimary">
              {(document.fileSizeBytes / 1024 / 1024).toFixed(2)} MB
            </dd>
          </div>
          <div>
            <dt className="text-light-textMuted dark:text-dark-textMuted">Uploaded</dt>
            <dd className="mt-0.5 text-light-textPrimary dark:text-dark-textPrimary">
              {new Date(document.createdAt).toLocaleString('en-ZA')}
            </dd>
          </div>
        </dl>
      </Panel>

      <OcrPanel
        documentId={document.id}
        documentType={document.documentType}
        extractionResult={extractionResult}
        canAct={canAct}
      />
    </div>
  );
}
