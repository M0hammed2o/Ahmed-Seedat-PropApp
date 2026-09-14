import 'server-only';
import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
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
 *
 * READS. A database row naming a Storage path is not proof that the path belongs to the row's
 * organisation: rows are client-writable, and the Storage SELECT policies grant access to any object
 * a visible row names. So every signed URL and every download goes through
 * createProtectedSignedUrl() / downloadProtectedObject(), which refuse unless the path sits inside
 * the organisation the ROW belongs to (isStoragePathInOrg()). Migration 20260101000172 enforces the
 * same rule in the database (public.storage_path_in_org()), so a mismatched row cannot be written.
 */

export const PROTECTED_STORAGE_BUCKET = 'documents';
export const UPLOAD_MALWARE_SCANS_TABLE = 'upload_malware_scans';

export type StorageWriteResult = { ok: true } | { ok: false; error: { message: string } };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ENCODED_SEPARATOR_OR_DOT = /%(2e|2f|5c)/i;
// eslint-disable-next-line no-control-regex -- control characters are exactly what this rejects.
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;

/**
 * THE rule for "does this protected Storage path belong to this organisation?" -- the only
 * implementation in the application. Mirrors public.storage_path_in_org() (migration
 * 20260101000172) case for case.
 *
 * `orgId` must come from a trusted server-side source -- the org of the row the path was read from,
 * or the org the server resolved for the request -- never from request input on its own.
 *
 * True only when:
 *  - orgId is a UUID and the path's first segment is EXACTLY that UUID (a real "/" boundary, so
 *    `{orgId}evil/...` does not match);
 *  - there is at least one segment after the organisation folder;
 *  - no segment is empty, "." or ".." (no traversal, no `//`, no leading or trailing "/");
 *  - there is no backslash, no percent-encoded ".", "/" or "\" and no control character.
 */
export function isStoragePathInOrg(
  orgId: string | null | undefined,
  path: string | null | undefined,
): boolean {
  if (typeof orgId !== 'string' || typeof path !== 'string') return false;
  if (!UUID.test(orgId)) return false;
  const segments = path.split('/');
  if (segments.length < 2 || segments[0] !== orgId) return false;
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..'))
    return false;
  if (path.includes('\\') || ENCODED_SEPARATOR_OR_DOT.test(path) || CONTROL_CHARACTER.test(path)) {
    return false;
  }
  return true;
}

export type ProtectedStorageRead<T> =
  | { ok: true; value: T }
  | { ok: false; reason: 'path_not_in_org' | 'storage_error'; message: string };

function pathRefused(orgId: string | null | undefined, storagePath: string | null | undefined) {
  console.error(
    `[protectedStorage] refused Storage access: path is not inside organization ${String(orgId)}'s folder`,
  );
  return {
    ok: false as const,
    reason: 'path_not_in_org' as const,
    message: 'This file does not belong to the organisation of the record that references it.',
    storagePath,
  };
}

/**
 * The only way the application turns a stored path into a signed URL. Pass the org of the ROW the
 * path came from (loaded server-side, after the caller has been authorised for that row). `client`
 * is normally the caller's own session client, so the Storage SELECT policies still apply on top.
 */
export async function createProtectedSignedUrl(
  client: SupabaseClient,
  input: { orgId: string | null | undefined; storagePath: string; expiresInSeconds: number },
): Promise<ProtectedStorageRead<string>> {
  if (!isStoragePathInOrg(input.orgId, input.storagePath)) {
    const refused = pathRefused(input.orgId, input.storagePath);
    return { ok: false, reason: refused.reason, message: refused.message };
  }
  const { data, error } = await client.storage
    .from(PROTECTED_STORAGE_BUCKET)
    .createSignedUrl(input.storagePath, input.expiresInSeconds);
  if (error || !data?.signedUrl) {
    return {
      ok: false,
      reason: 'storage_error',
      message: error?.message ?? 'Could not create a signed URL.',
    };
  }
  return { ok: true, value: data.signedUrl };
}

/** The only way the application downloads a stored object's bytes. Same contract as above. */
export async function downloadProtectedObject(
  client: SupabaseClient,
  input: { orgId: string | null | undefined; storagePath: string },
): Promise<ProtectedStorageRead<Blob>> {
  if (!isStoragePathInOrg(input.orgId, input.storagePath)) {
    const refused = pathRefused(input.orgId, input.storagePath);
    return { ok: false, reason: refused.reason, message: refused.message };
  }
  const { data, error } = await client.storage
    .from(PROTECTED_STORAGE_BUCKET)
    .download(input.storagePath);
  if (error || !data) {
    return {
      ok: false,
      reason: 'storage_error',
      message: error?.message ?? 'Could not read the file.',
    };
  }
  return { ok: true, value: data };
}

/** Writes a user-supplied file that scanUpload() cleared, then records the clean verdict. */
export async function storeScannedUpload(input: {
  verdict: CleanUploadVerdict;
  orgId: string;
  path: string;
  contentType: string;
}): Promise<StorageWriteResult> {
  const { verdict, orgId, path, contentType } = input;

  if (!isStoragePathInOrg(orgId, path)) {
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
  if (!isStoragePathInOrg(input.orgId, input.path)) {
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
 *  1. The path must sit inside the organisation's own folder (isStoragePathInOrg()). Pass the org of
 *     the row the path came from, after checking that row belongs to the org the caller is authorised
 *     for; this reads the file with the service role, so without it a row could point processing at
 *     another organisation's file -- even one with a clean verdict on record for that other org.
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

  if (!isStoragePathInOrg(orgId, storagePath)) {
    console.error(
      `[protectedStorage] refused to process a file: path is not inside organization ${orgId}'s folder`,
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

  const downloaded = await downloadProtectedObject(serviceRole, { orgId, storagePath });
  if (!downloaded.ok) {
    return downloaded.reason === 'path_not_in_org'
      ? notProcessable()
      : refuse(
          500,
          'document_unavailable',
          'Could not read this document. Please try again, or contact support if this continues.',
        );
  }
  const bytes = new Uint8Array(await downloaded.value.arrayBuffer());

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
