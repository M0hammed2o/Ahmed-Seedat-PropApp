import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getServiceRoleClient } from '@/lib/supabase/server';
import { writeAuditEvent } from '@/lib/audit';

// Lease preparation (Phase N, migration 20260101000134): shared version-creation logic between
// "generate from template" and "upload completed lease" -- both produce exactly the same kind of
// row, just with a different `kind`/`template_id`/`generated_at`. Supersedes the previous current
// document first (lease_documents_one_current_per_lease only ever allows one non-superseded row),
// then inserts the new one as the new current draft. Regenerating/re-uploading also resets any
// prior review/send back to 'drafting' -- a stale review acknowledgement must never survive a
// document actually changing underneath it.

export interface CreateLeaseDocumentVersionInput {
  leaseId: string;
  orgId: string;
  kind: 'generated' | 'uploaded';
  storagePath: string;
  originalFileName: string | null;
  mimeType: string;
  fileSizeBytes: number;
  templateId?: string | null;
  generatedBy: string;
}

export async function createLeaseDocumentVersion(
  supabase: SupabaseClient,
  input: CreateLeaseDocumentVersionInput,
) {
  await supabase
    .from('lease_documents')
    .update({ status: 'superseded' })
    .eq('lease_id', input.leaseId)
    .neq('status', 'superseded');

  const { data: maxRow } = await supabase
    .from('lease_documents')
    .select('version')
    .eq('lease_id', input.leaseId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextVersion = (maxRow?.version ?? 0) + 1;

  const { data, error } = await supabase
    .from('lease_documents')
    .insert({
      lease_id: input.leaseId,
      org_id: input.orgId,
      kind: input.kind,
      status: 'draft',
      version: nextVersion,
      template_id: input.templateId ?? null,
      storage_path: input.storagePath,
      original_file_name: input.originalFileName,
      mime_type: input.mimeType,
      file_size_bytes: input.fileSizeBytes,
      generated_by: input.generatedBy,
      generated_at: input.kind === 'generated' ? new Date().toISOString() : null,
    })
    .select('*')
    .single();

  // A new document invalidates any prior review/send -- upsert so the very first document for a
  // lease also gets a lease_preparations row (drafting), not just resets an existing one.
  await supabase.from('lease_preparations').upsert(
    {
      lease_id: input.leaseId,
      org_id: input.orgId,
      status: 'drafting',
      template_id: input.templateId ?? null,
      reviewed_by: null,
      reviewed_at: null,
      sent_by: null,
      sent_at: null,
    },
    { onConflict: 'lease_id' },
  );

  if (!error && data) {
    // Phase J audit coverage: every new document version, never the file bytes themselves.
    const serviceClient = getServiceRoleClient();
    await writeAuditEvent(serviceClient, {
      orgId: input.orgId,
      actorUserId: input.generatedBy,
      actorType: 'user',
      action: input.kind === 'generated' ? 'lease_document.generated' : 'lease_document.uploaded',
      entityType: 'lease_documents',
      entityId: data.id,
      after: {
        leaseId: input.leaseId,
        version: nextVersion,
        kind: input.kind,
        mimeType: input.mimeType,
        templateId: input.templateId ?? null,
      },
    });

    // First-tenant-workflow predeploy pass (WORKLOG.md 2026-08-25), Phase 10: the same event
    // additionally recorded against the LEASE itself (not just the document version) -- the exact
    // lifecycle action names the audit spec calls for. nextVersion > 1 is exactly "a document
    // already existed for this lease before this call", i.e. a real regeneration, not the first
    // generation.
    let leaseAction: string;
    if (input.kind === 'generated') {
      leaseAction = nextVersion > 1 ? 'lease.regenerated' : 'lease.generated';
    } else {
      leaseAction = 'lease.manual_document_uploaded';
    }
    await writeAuditEvent(serviceClient, {
      orgId: input.orgId,
      actorUserId: input.generatedBy,
      actorType: 'user',
      action: leaseAction,
      entityType: 'leases',
      entityId: input.leaseId,
      after: { leaseDocumentId: data.id, version: nextVersion, templateId: input.templateId ?? null },
    });
  }

  return { data, error };
}
