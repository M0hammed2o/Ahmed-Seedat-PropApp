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
 * Two deliberately different failure modes, not one:
 * - CLAMAV_HOST/CLAMAV_PORT unset (no scanner configured, e.g. this environment's own default):
 *   falls back to MockMalwareScanProvider, which always reports clean but logs loudly -- the
 *   existing MIME-allowlist remains the only real protection, a disclosed gap
 *   (TECHNICAL_DEBT_REGISTER.md TD-43), not a silent one.
 * - CLAMAV_HOST/CLAMAV_PORT set but the scan call itself throws (connection refused, timeout,
 *   protocol error): fails CLOSED -- the upload is refused with a 503, never silently allowed
 *   through. An operator who configured real scanning gets the guarantee that implies; a scanner
 *   outage must not quietly become "uploads go through unscanned."
 */
export async function scanUploadOrRespond(bytes: Uint8Array): Promise<NextResponse | null> {
  const provider = getMalwareScanProvider();
  const isRealScannerConfigured = getClamAVConfig() !== null;

  try {
    const result = await provider.scan(bytes);
    if (!result.clean) {
      console.error(`[uploadScan] rejected an upload: ${result.providerName} matched "${result.threatName}"`);
      return NextResponse.json(
        { error: { code: 'malware_detected', message: 'This file could not be uploaded — it was flagged by malware scanning.' } },
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
    console.error('[uploadScan] real malware scan failed -- refusing the upload (fail closed)', err);
    return NextResponse.json(
      { error: { code: 'scan_unavailable', message: 'File scanning is temporarily unavailable. Try again shortly.' } },
      { status: 503 },
    );
  }
}
