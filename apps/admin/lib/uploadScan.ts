import 'server-only';
import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import type { ScanResult } from '@propvault/types';
import { resolveMalwareScanner } from './providers/malwareScan';

/**
 * Real content-scanning for uploaded files (Stage 7, commercial-launch execution plan,
 * TECHNICAL_DEBT_REGISTER.md TD-43, R-03).
 *
 * THE RULE: bytes are stored or processed only after a scanner has explicitly reported them clean.
 * Every other outcome refuses them:
 * - No scanner in this runtime (lib/providers/malwareScan.ts resolveMalwareScanner(): in deployed
 *   production that means CLOUDMERSIVE_API_KEY is missing).
 * - File larger than the scanner can accept (Cloudmersive's plan cap -- 3.5 MB on the free tier,
 *   below Proplyst's own 25 MB limit). Never passed through unscanned.
 * - Threat found.
 * - The scan itself fails (timeout, network error, rejected API key, rate limit, provider error,
 *   malformed response), whether or not the upload is sensitive.
 *
 * Upload routes call scanUpload(). A clean result carries a CleanUploadVerdict holding the exact
 * bytes that were scanned, and lib/protectedStorage.ts storeScannedUpload() -- the only code that
 * writes a user-supplied file to protected Storage -- accepts nothing else. Clients have no Storage
 * INSERT/UPDATE policy (migration 20260101000171), so that is the only way a user-supplied file gets
 * in. Processing routes (OCR, lease merging) use lib/protectedStorage.ts
 * requireCleanScanBeforeProcessing(), which relies on the same checkForMalware() below.
 *
 * `sensitive: false` (an explicit, audited per-call-site opt-out -- currently only property photos,
 * whose MIME allowlist is image-only) matters in exactly one place: local development and tests with
 * no scanner configured, where the always-clean MockMalwareScanProvider may stand in for it.
 * Production never uses the mock.
 */

export type MalwareCheck =
  | { outcome: 'clean'; scanner: string }
  | { outcome: 'no_scanner' }
  | { outcome: 'too_large'; scanner: string; maxFileBytes: number }
  | { outcome: 'infected'; scanner: string; threatName: string }
  | { outcome: 'scan_failed' };

/** Scans bytes and says what happened. Callers decide how to respond; none may treat anything but 'clean' as clean. */
export async function checkForMalware(
  bytes: Uint8Array,
  options: { sensitive?: boolean } = {},
): Promise<MalwareCheck> {
  const sensitive = options.sensitive ?? true;
  const scanner = resolveMalwareScanner();

  if (scanner.status === 'unavailable' || (scanner.status === 'mock' && sensitive)) {
    console.error('[uploadScan] no malware scanner is configured -- refusing (fail closed)');
    return { outcome: 'no_scanner' };
  }

  const { provider } = scanner;

  if (provider.maxFileBytes !== undefined && bytes.byteLength > provider.maxFileBytes) {
    console.warn(
      `[uploadScan] refused ${bytes.byteLength} bytes: above ${provider.providerName}'s ${provider.maxFileBytes}-byte scan limit`,
    );
    return {
      outcome: 'too_large',
      scanner: provider.providerName,
      maxFileBytes: provider.maxFileBytes,
    };
  }

  let result: ScanResult;
  try {
    result = await provider.scan(bytes);
  } catch (err) {
    console.error('[uploadScan] malware scan failed -- refusing (fail closed)', err);
    return { outcome: 'scan_failed' };
  }

  if (result.clean === true) {
    return { outcome: 'clean', scanner: result.providerName };
  }
  if (result.clean === false) {
    console.error(
      `[uploadScan] refused a file: ${result.providerName} matched "${result.threatName}"`,
    );
    return {
      outcome: 'infected',
      scanner: result.providerName,
      threatName: result.threatName ?? 'unnamed threat',
    };
  }

  // Not a verdict at all. Unreachable through the typed providers; refuse rather than assume.
  console.error('[uploadScan] malware scan returned no verdict -- refusing (fail closed)');
  return { outcome: 'scan_failed' };
}

declare const cleanUploadVerdictBrand: unique symbol;

/**
 * Proof that these exact bytes were scanned clean. Only scanUpload() creates one; the brand stops a
 * route from building one by hand. lib/protectedStorage.ts re-hashes `bytes` against `sha256` before
 * writing, so a buffer changed after the scan is refused.
 */
export interface CleanUploadVerdict {
  readonly [cleanUploadVerdictBrand]: true;
  readonly bytes: Uint8Array;
  readonly sha256: string;
  readonly scanner: string;
}

export type UploadScanOutcome =
  { clean: true; verdict: CleanUploadVerdict } | { clean: false; response: NextResponse };

export async function scanUpload(
  bytes: Uint8Array,
  options: { sensitive?: boolean } = {},
): Promise<UploadScanOutcome> {
  const check = await checkForMalware(bytes, options);
  switch (check.outcome) {
    case 'clean':
      return {
        clean: true,
        verdict: {
          bytes,
          sha256: createHash('sha256').update(bytes).digest('hex'),
          scanner: check.scanner,
        } as CleanUploadVerdict,
      };
    case 'no_scanner':
      return {
        clean: false,
        response: NextResponse.json(
          {
            error: {
              code: 'upload_temporarily_unavailable',
              message:
                'Document uploads are temporarily unavailable while secure file scanning is being configured.',
            },
          },
          { status: 503 },
        ),
      };
    case 'too_large':
      return {
        clean: false,
        response: NextResponse.json(
          {
            error: {
              code: 'file_too_large_to_scan',
              message: `This file is too large to be checked for malware. Upload a file of ${formatMegabytes(check.maxFileBytes)} or smaller.`,
            },
          },
          { status: 413 },
        ),
      };
    case 'infected':
      return {
        clean: false,
        response: NextResponse.json(
          {
            error: {
              code: 'malware_detected',
              message: 'This file could not be uploaded — it was flagged by malware scanning.',
            },
          },
          { status: 422 },
        ),
      };
    case 'scan_failed':
      return {
        clean: false,
        response: NextResponse.json(
          {
            error: {
              code: 'scan_unavailable',
              message: 'File scanning is temporarily unavailable. Try again shortly.',
            },
          },
          { status: 503 },
        ),
      };
  }
}

/** 3_500_000 -> "3.5 MB". Decimal megabytes, matching how the limit itself is defined. */
export function formatMegabytes(bytes: number): string {
  return `${Number((bytes / 1_000_000).toFixed(1))} MB`;
}
