import 'server-only';
import { NextResponse } from 'next/server';
import { getMalwareScanProvider, getClamAVConfig } from './providers/malwareScan';

/**
 * Real content-scanning for uploaded files (Stage 7, commercial-launch execution plan,
 * TECHNICAL_DEBT_REGISTER.md TD-43, R-03) -- called by every upload route (documents,
 * lease-templates) after MIME-allowlist validation, before the file reaches Storage. Returns a
 * NextResponse to send back immediately if the upload must be refused, or null if it's clean and
 * the route should proceed.
 *
 * Three deliberately different failure modes, not two (autonomous overnight completion pass,
 * WORKLOG.md this date -- TD-43's disclosed gap was real and this closes it for the highest-risk
 * upload paths without standing up new infrastructure):
 * - `sensitive: true` (the default -- a caller must opt OUT, never silently opt in) AND no real
 *   scanner configured: fails CLOSED with a professional, detail-free 503 message. Sensitive
 *   document/proof-of-payment/applicant-document uploads must never go through completely
 *   unscanned in production -- MIME-allowlisting alone (PDFs can carry embedded exploits) is not
 *   an acceptable substitute for the malware-scanning guarantee this codebase's own security
 *   posture implies. Existing documents remain fully readable -- this only blocks new uploads.
 * - `sensitive: false` (an explicit, audited per-call-site opt-out -- currently only property
 *   photos, whose MIME allowlist is image-only, a narrower attack surface, and whose loss would
 *   block an unrelated, lower-risk product feature) AND no real scanner configured: unchanged
 *   behaviour -- falls back to MockMalwareScanProvider (clean, logs loudly), same disclosed gap
 *   as before this pass.
 * - A real scanner IS configured but the scan call itself throws (connection refused, timeout,
 *   protocol error): fails CLOSED regardless of `sensitive` -- the upload is refused with a 503,
 *   never silently allowed through. An operator who configured real scanning gets the guarantee
 *   that implies; a scanner outage must not quietly become "uploads go through unscanned."
 */
export async function scanUploadOrRespond(
  bytes: Uint8Array,
  options: { sensitive?: boolean } = {},
): Promise<NextResponse | null> {
  const sensitive = options.sensitive ?? true;
  const provider = getMalwareScanProvider();
  const isRealScannerConfigured = getClamAVConfig() !== null;

  if (sensitive && !isRealScannerConfigured) {
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

  try {
    const result = await provider.scan(bytes);
    if (!result.clean) {
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
    return null;
  } catch (err) {
    if (!isRealScannerConfigured) {
      // Should be unreachable -- MockMalwareScanProvider.scan() never throws -- but if it ever
      // does, treat it the same as "no scanner" rather than blocking every upload in an
      // environment that never opted into real scanning.
      console.error('[uploadScan] mock scan provider threw unexpectedly', err);
      return null;
    }
    console.error(
      '[uploadScan] real malware scan failed -- refusing the upload (fail closed)',
      err,
    );
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
}
