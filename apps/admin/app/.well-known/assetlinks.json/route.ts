import { NextResponse } from 'next/server';
import { branding } from '@propvault/config';

/**
 * GET /.well-known/assetlinks.json -- WhatsApp V1 completion pass, Phase J (WORKLOG.md this
 * date). Digital Asset Links file Android's App Links verification fetches from the production
 * domain to confirm this app is authorized to open `https://proplyst.co.za/...` links directly
 * instead of falling back to a browser -- what lets a WhatsApp template's CTA link open the
 * Proplyst app when installed. Served dynamically (not a static public/ file) so the real
 * signing-certificate fingerprint can come from an env var once Mohammed provides it, rather than
 * being hand-edited into a committed static file.
 *
 * `androidPackageName` (packages/config/src/branding.ts) is the real, already-established package
 * id -- not invented here. The SHA-256 fingerprint is NOT invented -- `ANDROID_APP_SHA256_FINGERPRINTS`
 * is unset today (no keystore fingerprint has been provided), so this route deliberately returns
 * an EMPTY statements array rather than a placeholder/fake fingerprint: an empty array is a valid,
 * honest "not yet configured" response (Android's verifier simply finds no match and falls back to
 * the browser, the same safe behavior as if this endpoint didn't exist yet) -- a fake fingerprint
 * would either fail verification anyway or, worse, silently look "done" while being wrong.
 *
 * MANUAL ACTION REQUIRED (see the session's own readiness report): set
 * ANDROID_APP_SHA256_FINGERPRINTS in Render to the real release-keystore SHA-256 fingerprint
 * (comma-separated if more than one, e.g. debug + release) once Mohammed retrieves it via
 * `keytool -list -v -keystore <path-to-keystore>` or the Play Console's own "App signing" page.
 */
export async function GET() {
  const fingerprints = (process.env.ANDROID_APP_SHA256_FINGERPRINTS ?? '')
    .split(',')
    .map((f) => f.trim())
    .filter(Boolean);

  const statements =
    fingerprints.length > 0
      ? [
          {
            relation: ['delegate_permission/common.handle_all_urls'],
            target: {
              namespace: 'android_app',
              package_name: branding.androidPackageName,
              sha256_cert_fingerprints: fingerprints,
            },
          },
        ]
      : [];

  return NextResponse.json(statements, {
    headers: { 'Content-Type': 'application/json' },
  });
}
