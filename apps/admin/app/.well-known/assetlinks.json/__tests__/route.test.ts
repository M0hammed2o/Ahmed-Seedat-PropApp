import { afterEach, describe, expect, it } from 'vitest';
import { GET } from '../route';

// WhatsApp V1 completion pass, Phase J (WORKLOG.md this date). Pure unit test -- no DB, no auth --
// for the Android App Links verification endpoint. The route reads process.env fresh on every
// call (not at module load time), so a plain static import is safe here -- no module-cache
// re-import trick needed.

describe('GET /.well-known/assetlinks.json', () => {
  const originalEnv = process.env.ANDROID_APP_SHA256_FINGERPRINTS;
  afterEach(() => {
    if (originalEnv === undefined) delete process.env.ANDROID_APP_SHA256_FINGERPRINTS;
    else process.env.ANDROID_APP_SHA256_FINGERPRINTS = originalEnv;
  });

  it('returns an empty statements array when no fingerprint is configured -- never a fake one', async () => {
    delete process.env.ANDROID_APP_SHA256_FINGERPRINTS;
    const response = await GET();
    const body = await response.json();
    expect(body).toEqual([]);
  });

  it('returns a real statement with the configured fingerprint(s) and the real package name', async () => {
    process.env.ANDROID_APP_SHA256_FINGERPRINTS = 'AA:BB:CC,DD:EE:FF';
    const response = await GET();
    const body = await response.json();
    expect(body).toHaveLength(1);
    expect(body[0].target.package_name).toBe('za.co.proplyst.app');
    expect(body[0].target.sha256_cert_fingerprints).toEqual(['AA:BB:CC', 'DD:EE:FF']);
    expect(body[0].relation).toEqual(['delegate_permission/common.handle_all_urls']);
  });
});
