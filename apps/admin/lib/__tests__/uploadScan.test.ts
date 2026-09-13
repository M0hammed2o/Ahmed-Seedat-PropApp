import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MalwareScanProvider } from '@propvault/types';
import * as malwareScanModule from '../providers/malwareScan';
import { MalwareScanFailedError } from '../providers/malwareScan';
import { scanUploadOrRespond } from '../uploadScan';

// Pins uploadScan.ts's one rule -- an upload proceeds only on an explicit clean verdict -- across
// every outcome. The first block controls resolveMalwareScanner() directly, so each case can set
// "which scanner" and "what scan() does" independently. The second block goes through the real
// resolver and the real Cloudmersive provider, faking only fetch and the environment.

function real(scan: MalwareScanProvider['scan'], maxFileBytes?: number) {
  vi.spyOn(malwareScanModule, 'resolveMalwareScanner').mockReturnValue({
    status: 'real',
    provider: { providerName: 'test-scanner', maxFileBytes, scan },
  });
}

function mock(scan: MalwareScanProvider['scan']) {
  vi.spyOn(malwareScanModule, 'resolveMalwareScanner').mockReturnValue({
    status: 'mock',
    provider: { providerName: 'mock', scan },
  });
}

async function errorOf(response: Response | null) {
  expect(response).not.toBeNull();
  return { status: response!.status, ...(await response!.json()).error };
}

describe('scanUploadOrRespond', () => {
  afterEach(() => vi.restoreAllMocks());

  it('allows the upload (null) when the scanner reports clean', async () => {
    real(vi.fn().mockResolvedValue({ clean: true, providerName: 'test-scanner' }));
    expect(await scanUploadOrRespond(new Uint8Array([1, 2, 3]))).toBeNull();
  });

  it('rejects with 422 malware_detected when the scanner reports a threat', async () => {
    real(
      vi
        .fn()
        .mockResolvedValue({
          clean: false,
          threatName: 'Test-Signature',
          providerName: 'test-scanner',
        }),
    );
    const error = await errorOf(await scanUploadOrRespond(new Uint8Array([1, 2, 3])));
    expect(error.status).toBe(422);
    expect(error.code).toBe('malware_detected');
  });

  it.each([true, false])(
    'refuses every upload with 503 when no scanner is available (sensitive: %s) -- the production state without CLOUDMERSIVE_API_KEY',
    async (sensitive) => {
      vi.spyOn(malwareScanModule, 'resolveMalwareScanner').mockReturnValue({
        status: 'unavailable',
      });
      const error = await errorOf(await scanUploadOrRespond(new Uint8Array([1]), { sensitive }));
      expect(error.status).toBe(503);
      expect(error.code).toBe('upload_temporarily_unavailable');
      expect(error.message).not.toMatch(/clamav|cloudmersive/i);
    },
  );

  it('refuses a sensitive upload (the default) when only the mock exists, without running it', async () => {
    const mockScan = vi.fn();
    mock(mockScan);
    const error = await errorOf(await scanUploadOrRespond(new Uint8Array([1])));
    expect(error.status).toBe(503);
    expect(error.code).toBe('upload_temporarily_unavailable');
    expect(mockScan).not.toHaveBeenCalled();

    const explicit = await errorOf(
      await scanUploadOrRespond(new Uint8Array([1]), { sensitive: true }),
    );
    expect(explicit.status).toBe(503);
  });

  it('lets the mock clear an explicitly non-sensitive upload (local development and tests only)', async () => {
    mock(vi.fn().mockResolvedValue({ clean: true, providerName: 'mock' }));
    expect(await scanUploadOrRespond(new Uint8Array([1]), { sensitive: false })).toBeNull();
  });

  it('fails CLOSED when the mock throws -- no path lets an unscanned file through', async () => {
    mock(vi.fn().mockRejectedValue(new Error('should never happen')));
    const error = await errorOf(
      await scanUploadOrRespond(new Uint8Array([1]), { sensitive: false }),
    );
    expect(error.status).toBe(503);
    expect(error.code).toBe('scan_unavailable');
  });

  it.each([true, false])(
    'fails CLOSED with 503 scan_unavailable when the scan throws (sensitive: %s)',
    async (sensitive) => {
      real(vi.fn().mockRejectedValue(new MalwareScanFailedError('rate_limited', 'HTTP 429')));
      const error = await errorOf(await scanUploadOrRespond(new Uint8Array([1]), { sensitive }));
      expect(error.status).toBe(503);
      expect(error.code).toBe('scan_unavailable');
    },
  );

  it('fails CLOSED when a scanner returns something that is not a verdict', async () => {
    real(vi.fn().mockResolvedValue({ clean: 'yes', providerName: 'test-scanner' }));
    const error = await errorOf(await scanUploadOrRespond(new Uint8Array([1])));
    expect(error.status).toBe(503);
    expect(error.code).toBe('scan_unavailable');
  });

  it('refuses a file larger than the scanner accepts with a controlled 413, without scanning it', async () => {
    const scan = vi.fn().mockResolvedValue({ clean: true, providerName: 'test-scanner' });
    real(scan, 3_500_000);
    const error = await errorOf(await scanUploadOrRespond(new Uint8Array(3_500_001)));
    expect(error.status).toBe(413);
    expect(error.code).toBe('file_too_large_to_scan');
    expect(error.message).toBe(
      'This file is too large to be checked for malware. Upload a file of 3.5 MB or smaller.',
    );
    expect(scan).not.toHaveBeenCalled();

    expect(await scanUploadOrRespond(new Uint8Array(3_500_000))).toBeNull();
    expect(scan).toHaveBeenCalledTimes(1);
  });
});

describe('scanUploadOrRespond with the real resolver and Cloudmersive provider (fetch faked)', () => {
  const FAKE_KEY = 'test-cloudmersive-key-0000-not-real';

  function cloudmersiveReturns(response: () => Response | Promise<Response>) {
    const fetchMock = vi.fn(async () => response());
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  function production(withKey: boolean) {
    // Every refusal below logs by design; keep the expected output out of the test report.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CLOUDMERSIVE_API_KEY', withKey ? FAKE_KEY : '');
    vi.stubEnv('CLOUDMERSIVE_MAX_FILE_BYTES', '');
  }

  it('production without CLOUDMERSIVE_API_KEY refuses the upload and never calls out', async () => {
    production(false);
    vi.stubEnv('CLAMAV_HOST', 'localhost');
    vi.stubEnv('CLAMAV_PORT', '3310');
    const fetchMock = cloudmersiveReturns(() => new Response('{}'));
    for (const sensitive of [true, false]) {
      const error = await errorOf(await scanUploadOrRespond(new Uint8Array([1]), { sensitive }));
      expect(error.status).toBe(503);
      expect(error.code).toBe('upload_temporarily_unavailable');
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('production with the key: clean -> allowed, infected -> 422', async () => {
    production(true);
    cloudmersiveReturns(() => Response.json({ CleanResult: true, FoundViruses: null }));
    expect(await scanUploadOrRespond(new Uint8Array([1]))).toBeNull();

    cloudmersiveReturns(() =>
      Response.json({
        CleanResult: false,
        FoundViruses: [{ FileName: 'upload', VirusName: 'Eicar-Test-Signature' }],
      }),
    );
    expect((await errorOf(await scanUploadOrRespond(new Uint8Array([1])))).status).toBe(422);
  });

  it.each([401, 403, 429, 500, 503])(
    'production with the key: HTTP %i from Cloudmersive -> 503, never allowed',
    async (status) => {
      production(true);
      cloudmersiveReturns(() => new Response('error', { status }));
      const error = await errorOf(
        await scanUploadOrRespond(new Uint8Array([1]), { sensitive: false }),
      );
      expect(error.status).toBe(503);
      expect(error.code).toBe('scan_unavailable');
    },
  );

  it('production with the key: a malformed body -> 503', async () => {
    production(true);
    cloudmersiveReturns(() => new Response('<html>maintenance</html>', { status: 200 }));
    expect((await errorOf(await scanUploadOrRespond(new Uint8Array([1])))).status).toBe(503);
  });

  it('production with the key: a network failure or timeout -> 503', async () => {
    production(true);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
      }),
    );
    expect((await errorOf(await scanUploadOrRespond(new Uint8Array([1])))).status).toBe(503);

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    );
    expect((await errorOf(await scanUploadOrRespond(new Uint8Array([1])))).status).toBe(503);
  });

  it('production with the key: a file over the free-tier 3.5 MB cap -> 413 without contacting Cloudmersive', async () => {
    production(true);
    const fetchMock = cloudmersiveReturns(() =>
      Response.json({ CleanResult: true, FoundViruses: null }),
    );
    const error = await errorOf(await scanUploadOrRespond(new Uint8Array(3_500_001)));
    expect(error.status).toBe(413);
    expect(error.code).toBe('file_too_large_to_scan');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never puts the API key in a response a client receives', async () => {
    production(true);
    for (const make of [
      () => new Response('nope', { status: 401 }),
      () => new Response('nope', { status: 429 }),
      () => new Response('not json', { status: 200 }),
    ]) {
      cloudmersiveReturns(make);
      const response = await scanUploadOrRespond(new Uint8Array([1]));
      expect(await response!.text()).not.toContain(FAKE_KEY);
    }
  });
});
