import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui/PageHeader';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { resolveTenantSession } from '@/lib/tenantSession';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';
import { ComplianceAcknowledgeClient } from './ComplianceAcknowledgeClient';

type PageParams = { params: Promise<{ id: string }> };

/**
 * Tenant rule detail + acknowledgement (PHASE 4). Server component loads the requirement + a
 * short-lived signed document URL (through the caller's own session-bound client -- RLS is the
 * real gate, both at the table AND storage-object layer, see migration 20260101000097's own
 * comment on `documents_bucket_select_tenant_compliance`), then hands off to a client component
 * for the explicit "I confirm..." acknowledgement action. Viewing this page does NOT itself
 * acknowledge anything -- the client component separately calls .../view once mounted and
 * .../acknowledge only on the explicit button click.
 */
export default async function ComplianceRequirementPage({ params }: PageParams) {
  const { id } = await params;

  if (ADMIN_DEMO_MODE) {
    return (
      <div className="space-y-5 animate-rise">
        <PageHeader title="Required action" />
        <p className="text-sm text-light-textMuted dark:text-dark-textMuted">
          Demo mode -- no live compliance data to show.
        </p>
      </div>
    );
  }

  const supabase = await getServerSupabaseClient();
  const session = await resolveTenantSession();
  if (!session) {
    return (
      <div className="space-y-5 animate-rise">
        <PageHeader title="Required action" />
        <p className="text-sm text-light-danger dark:text-dark-danger">Sign in required.</p>
      </div>
    );
  }

  const { data: requirement, error } = await supabase
    .from('compliance_requirements')
    .select(
      `id, status, due_at,
       property_rule_versions(id, version_number, effective_date, document_id,
         property_rules(title)),
       properties(nickname)`,
    )
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`Failed to load requirement: ${error.message}`);
  if (!requirement) notFound();

  const ruleVersion = requirement.property_rule_versions as unknown as {
    id: string;
    version_number: number;
    effective_date: string;
    document_id: string;
    property_rules: { title: string } | null;
  } | null;
  const property = requirement.properties as unknown as { nickname: string } | null;

  let signedUrl: string | null = null;
  if (ruleVersion) {
    const { data: document } = await supabase
      .from('documents')
      .select('storage_path')
      .eq('id', ruleVersion.document_id)
      .maybeSingle();
    if (document) {
      const { data: signed } = await supabase.storage
        .from('documents')
        .createSignedUrl(document.storage_path, 300);
      signedUrl = signed?.signedUrl ?? null;
    }
  }

  return (
    <div className="space-y-5 animate-rise">
      <PageHeader
        title={ruleVersion?.property_rules?.title ?? 'Required action'}
        subtitle={
          property?.nickname
            ? `${property.nickname} · Version ${ruleVersion?.version_number}`
            : undefined
        }
      />
      <ComplianceAcknowledgeClient
        requirementId={requirement.id}
        status={requirement.status}
        ruleTitle={ruleVersion?.property_rules?.title ?? 'this rule'}
        versionNumber={ruleVersion?.version_number ?? 0}
        effectiveDate={ruleVersion?.effective_date ?? null}
        signedUrl={signedUrl}
      />
    </div>
  );
}
