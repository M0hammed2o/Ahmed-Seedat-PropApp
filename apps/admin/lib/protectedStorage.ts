import 'server-only';
import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getServiceRoleClient } from './supabase/server';
import { isDeployedProductionRuntime } from './documentIntelligencePolicy';
import { checkForMalware, formatMegabytes, type CleanUploadVerdict } from './uploadScan';

/**
 * The only code that writes to Proplyst's protected Storage bucket, and the check every route runs
 * before it processes a stored file.
 *
 * WRITES. Migration 20260101000171 removed every client INSERT/UPDATE policy from storage.objects,
 * so a signed-in user can no longer upload or replace an object with their own session -- which was
 * how an unscanned file could be planted directly through the Storage API. Server routes write with
 * the service-role client, and only through the two functions below:
 *  - storeScannedUpload(): a user-supplied file, and only with the CleanUploadVerdict scanUpload()
 *    returned for those exact bytes. It also records that verdict in public.upload_malware_scans.
 *  - storeServerGeneratedObject(): bytes the server produced itself (resized photos, merged leases).
 *    No verdict is recorded, so these can never be sent for processing without a scan.
 * Callers authorise the request BEFORE calling either; the service-role client bypasses RLS.
 *
 * PROCESSING. A file being in Storage does not prove it was scanned: objects uploaded before this
 * change, or planted while clients could still write, look exactly like scanned ones.
 * requireCleanScanBeforeProcessing() allows processing only when a clean verdict is on record for
 * that exact object, or when a scan run right now comes back clean. NO VERIFIED CLEAN SCAN -> NO OCR.
 *
 * upload_malware_scans has RLS enabled and no policies, and anon/authenticated have no grants: only
 * the server can write a verdict. If the table is missing or unreachable (e.g. this code deployed
 * before its migration), a successful store still succeeds -- the file WAS scanned before it was
 * written -- and processing simply scans again instead of trusting a record it cannot read.
 */

export const PROTECTED_STORAGE_BUCKET = 'documents';
export const UPLOAD_MALWARE_SCANS_TABLE = 'upload_malware_scans';

export type StorageWriteResult = { ok: true } | { ok: false; error: { message: string } };

function orgPrefixMatches(orgId: string, path: string): boolean {
  return orgId.length > 0 && path.startsWith(`${orgId}/`) && !path.includes('..');
}

/** Writes a user-supplied file that scanUpload() cleared, then records the clean verdict. */
export async function storeScannedUpload(input: {
  verdict: CleanUploadVerdict;
  orgId: string;
  path: string;
  contentType: string;
}): Promise<StorageWriteResult> {
  const { verdict, orgId, path, contentType } = input;

  if (!orgPrefixMatches(orgId, path)) {
    return { ok: false, error: { message: 'Storage path is not inside the organization folder.' } };
  }
  // The buffer is mutable: refuse if it no longer holds the bytes that were scanned.
  const sha256 = createHash('sha256').update(verdict.bytes).digest('hex');
  if (sha256 !== verdict.sha256) {
    console.error('[protectedStorage] bytes changed after the malware scan -- refusing to store');
    return { ok: false, error: { message: 'File changed after it was scanned.' } };
  }

  const serviceRole = getServiceRoleClient();
  const { error: uploadError } = await serviceRole.storage
    .from(PROTECTED_STORAGE_BUCKET)
    .upload(path, verdict.bytes, { contentType, upsert: false });
  if (uploadError) {
    return { ok: false, error: { message: uploadError.message } };
  }

  const { error: recordError } = await serviceRole.from(UPLOAD_MALWARE_SCANS_TABLE).insert({
    bucket_id: PROTECTED_STORAGE_BUCKET,
    object_path: path,
    org_id: orgId,
    sha256,
    scanner: verdict.scanner,
    source: 'upload',
  });
  if (recordError) {
    // Not a reason to refuse: the file was scanned clean before it was written. Without the record,
    // processing it later just scans it again.
    console.error(
      `[protectedStorage] could not record the clean scan for ${path}; processing will rescan it`,
      recordError.message,
    );
  }
  return { ok: true };
}

/** Writes bytes the server generated itself. Never use this for anything a user supplied. */
export async function storeServerGeneratedObject(input: {
  orgId: string;
  path: string;
  bytes: Uint8Array;
  contentType: string;
}): Promise<StorageWriteResult> {
  if (!orgPrefixMatches(input.orgId, input.path)) {
    return { ok: false, error: { message: 'Storage path is not inside the organization folder.' } };
  }
  const { error } = await getServiceRoleClient()
    .storage.from(PROTECTED_STORAGE_BUCKET)
    .upload(input.path, input.bytes, { contentType: input.contentType, upsert: false });
  return error ? { ok: false, error: { message: error.message } } : { ok: true };
}

/**
 * Best-effort cleanup of objects THIS request just wrote, when a later step of the same request
 * failed. Also drops their scan records. Never call it with a path taken from a client.
 */
export async function removeProtectedObjects(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const serviceRole = getServiceRoleClient();
  await serviceRole.storage.from(PROTECTED_STORAGE_BUCKET).remove(paths);
  await serviceRole
    .from(UPLOAD_MALWARE_SCANS_TABLE)
    .delete()
    .eq('bucket_id', PROTECTED_STORAGE_BUCKET)
    .in('object_path', paths);
}

export type ProcessingClearance =
  { ok: true; source: 'recorded' | 'rescanned' } | { ok: false; response: NextResponse };

function refuse(status: number, code: string, message: string): ProcessingClearance {
  return { ok: false, response: NextResponse.json({ error: { code, message } }, { status }) };
}

/**
 * May the stored object at `storagePath`, belonging to `orgId`, be sent to OCR or otherwise
 * processed? Call it after the route has authorised the caller and before any external call or
 * job/record write, so a refusal leaves nothing half-done.
 *
 *  1. The path must sit inside the organisation's own folder. Client-writable rows (documents,
 *     lease_documents, lease_templates) can hold any storage_path, and this route reads the file with
 *     the service role, so without this a row could point processing at another organisation's file.
 *  2. A clean verdict recorded for this exact object and organisation clears it with no new scan.
 *  3. Otherwise the stored bytes are scanned now, treated as sensitive. Only a clean result clears
 *     them, and that verdict is recorded so the next request doesn't scan again.
 */
export async function requireCleanScanBeforeProcessing(input: {
  orgId: string;
  storagePath: string;
}): Promise<ProcessingClearance> {
  const { orgId, storagePath } = input;
  const notProcessable = () =>
    refuse(403, 'document_not_processable', 'This document cannot be processed.');

  if (!orgPrefixMatches(orgId, storagePath)) {
    console.error(
      `[protectedStorage] refused to process ${storagePath}: outside organization ${orgId}'s folder`,
    );
    return notProcessable();
  }

  const serviceRole = getServiceRoleClient();

  const { data: record, error: recordError } = await serviceRole
    .from(UPLOAD_MALWARE_SCANS_TABLE)
    .select('org_id, scanner')
    .eq('bucket_id', PROTECTED_STORAGE_BUCKET)
    .eq('object_path', storagePath)
    .maybeSingle();
  if (recordError) {
    console.error(
      '[protectedStorage] could not read scan records -- scanning the stored file instead',
      recordError.message,
    );
  } else if (record) {
    if (record.org_id !== orgId) {
      console.error(
        `[protectedStorage] scan record for ${storagePath} belongs to another organization`,
      );
      return notProcessable();
    }
    // A mock "verdict" only ever exists in development databases; never trust one in production.
    if (record.scanner !== 'mock' || !isDeployedProductionRuntime()) {
      return { ok: true, source: 'recorded' };
    }
  }

  const { data: file, error: downloadError } = await serviceRole.storage
    .from(PROTECTED_STORAGE_BUCKET)
    .download(storagePath);
  if (downloadError || !file) {
    return refuse(
      500,
      'document_unavailable',
      'Could not read this document. Please try again, or contact support if this continues.',
    );
  }
  const bytes = new Uint8Array(await file.arrayBuffer());

  const check = await checkForMalware(bytes, { sensitive: true });
  switch (check.outcome) {
    case 'clean': {
      const { error: insertError } = await serviceRole.from(UPLOAD_MALWARE_SCANS_TABLE).insert({
        bucket_id: PROTECTED_STORAGE_BUCKET,
        object_path: storagePath,
        org_id: orgId,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        scanner: check.scanner,
        source: 'rescan',
      });
      if (insertError) {
        console.error(
          `[protectedStorage] could not record the rescan of ${storagePath}`,
          insertError.message,
        );
      }
      return { ok: true, source: 'rescanned' };
    }
    case 'infected':
      return refuse(
        422,
        'malware_detected',
        'This document was flagged by malware scanning and cannot be processed.',
      );
    case 'too_large':
      return refuse(
        413,
        'file_too_large_to_scan',
        `This document is too large to be checked for malware (the limit is ${formatMegabytes(check.maxFileBytes)}), so it cannot be processed.`,
      );
    case 'no_scanner':
    case 'scan_failed':
      return refuse(
        503,
        'document_scan_unavailable',
        'This document must be checked for malware before it can be processed, and scanning is temporarily unavailable. Try again shortly.',
      );
  }
}
