import 'server-only';
import { NextResponse } from 'next/server';
import type { ScanResult } from '@propvault/types';
import { resolveMalwareScanner } from './providers/malwareScan';

/**
 * Real content-scanning for uploaded files (Stage 7, commercial-launch execution plan,
 * TECHNICAL_DEBT_REGISTER.md TD-43, R-03) -- called by every upload route after authorization and
 * MIME-allowlist validation, before the file reaches Storage. Storage is the only way a file reaches
 * Google Document AI: the extraction routes read files back out of Storage and never accept an
 * upload themselves. Returns a NextResponse to send back immediately if the upload must be refused,
 * or null if the route may proceed.
 *
 * THE RULE: an upload proceeds only when a scanner has explicitly reported the file clean. Every
 * other outcome refuses it:
 * - No scanner in this runtime (lib/providers/malwareScan.ts resolveMalwareScanner(): in deployed
 *   production that means CLOUDMERSIVE_API_KEY is missing): 503 `upload_temporarily_unavailable`,
 *   for every upload.
 * - File larger than the scanner can accept (Cloudmersive's plan cap -- 3.5 MB on the free tier,
 *   below Proplyst's own 25 MB limit): 413 `file_too_large_to_scan`. Never passed through unscanned.
 * - Threat found: 422 `malware_detected`.
 * - The scan itself fails (timeout, network error, rejected API key, rate limit, provider error,
 *   malformed response): 503 `scan_unavailable`, whether or not the upload is sensitive.
 *
 * `sensitive: false` (an explicit, audited per-call-site opt-out -- currently only property photos,
 * whose MIME allowlist is image-only) now matters in exactly one place: local development and tests
 * with no scanner configured, where the always-clean MockMalwareScanProvider may stand in for it.
 * Production never uses the mock.
 */
export async function scanUploadOrRespond(
  bytes: Uint8Array,
  options: { sensitive?: boolean } = {},
): Promise<NextResponse | null> {
  const sensitive = options.sensitive ?? true;
  const scanner = resolveMalwareScanner();

  if (scanner.status === 'unavailable' || (scanner.status === 'mock' && sensitive)) {
    console.error(
      '[uploadScan] no malware scanner is configured -- refusing the upload (fail closed)',
    );
    return NextResponse.json(
      {
        error: {
          code: 'upload_temporarily_unavailable',
          message:
            'Document uploads are temporarily unavailable while secure file scanning is being configured.',
        },
      },
      { status: 503 },
    );
  }

  const { provider } = scanner;

  if (provider.maxFileBytes !== undefined && bytes.byteLength > provider.maxFileBytes) {
    console.warn(
      `[uploadScan] refused a ${bytes.byteLength}-byte upload: above ${provider.providerName}'s ${provider.maxFileBytes}-byte scan limit`,
    );
    return NextResponse.json(
      {
        error: {
          code: 'file_too_large_to_scan',
          message: `This file is too large to be checked for malware. Upload a file of ${formatMegabytes(provider.maxFileBytes)} or smaller.`,
        },
      },
      { status: 413 },
    );
  }

  let result: ScanResult;
  try {
    result = await provider.scan(bytes);
  } catch (err) {
    console.error('[uploadScan] malware scan failed -- refusing the upload (fail closed)', err);
    return scanUnavailableResponse();
  }

  if (result.clean === true) {
    return null;
  }
  if (result.clean === false) {
    console.error(
      `[uploadScan] rejected an upload: ${result.providerName} matched "${result.threatName}"`,
    );
    return NextResponse.json(
      {
        error: {
          code: 'malware_detected',
          message: 'This file could not be uploaded — it was flagged by malware scanning.',
        },
      },
      { status: 422 },
    );
  }

  // Not a verdict at all. Unreachable through the typed providers; refuse rather than assume.
  console.error(
    '[uploadScan] malware scan returned no verdict -- refusing the upload (fail closed)',
  );
  return scanUnavailableResponse();
}

function scanUnavailableResponse(): NextResponse {
  return NextResponse.json(
    {
      error: {
        code: 'scan_unavailable',
        message: 'File scanning is temporarily unavailable. Try again shortly.',
      },
    },
    { status: 503 },
  );
}

/** 3_500_000 -> "3.5 MB". Decimal megabytes, matching how the limit itself is defined. */
function formatMegabytes(bytes: number): string {
  return `${Number((bytes / 1_000_000).toFixed(1))} MB`;
}
