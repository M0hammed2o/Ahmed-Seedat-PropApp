import { afterEach, describe, expect, it, vi } from 'vitest';
import * as malwareScanModule from '../providers/malwareScan';
import { scanUploadOrRespond } from '../uploadScan';

// Pins the two deliberately-different failure modes uploadScan.ts's own header comment
// describes: unconfigured (mock, fail open) vs configured-but-erroring (fail closed). Mocks
// getMalwareScanProvider()/getClamAVConfig() directly rather than going through env vars, since
// this needs to control both "is a real scanner configured" and "what does scan() do" independently.

describe('scanUploadOrRespond', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns null (allow) when the scan reports clean', async () => {
    vi.spyOn(malwareScanModule, 'getMalwareScanProvider').mockReturnValue({
      providerName: 'test',
      scan: vi.fn().mockResolvedValue({ clean: true, providerName: 'test' }),
    });
    vi.spyOn(malwareScanModule, 'getClamAVConfig').mockReturnValue(null);

    const result = await scanUploadOrRespond(new Uint8Array([1, 2, 3]));
    expect(result).toBeNull();
  });

  it('returns a 422 rejection when the scan reports a match', async () => {
    vi.spyOn(malwareScanModule, 'getMalwareScanProvider').mockReturnValue({
      providerName: 'test',
      scan: vi
        .fn()
        .mockResolvedValue({ clean: false, threatName: 'Test-Signature', providerName: 'test' }),
    });
    vi.spyOn(malwareScanModule, 'getClamAVConfig').mockReturnValue({
      host: 'x',
      port: 1,
      timeoutMs: 1,
    });

    const result = await scanUploadOrRespond(new Uint8Array([1, 2, 3]));
    expect(result).not.toBeNull();
    expect(result!.status).toBe(422);
    const body = await result!.json();
    expect(body.error.code).toBe('malware_detected');
  });

  it('fails OPEN (allows the upload) when no real scanner is configured and the mock throws unexpectedly', async () => {
    vi.spyOn(malwareScanModule, 'getMalwareScanProvider').mockReturnValue({
      providerName: 'mock',
      scan: vi.fn().mockRejectedValue(new Error('should never happen')),
    });
    vi.spyOn(malwareScanModule, 'getClamAVConfig').mockReturnValue(null);

    const result = await scanUploadOrRespond(new Uint8Array([1, 2, 3]));
    expect(result).toBeNull();
  });

  it('fails CLOSED (refuses the upload with 503) when a real scanner is configured but the scan call throws', async () => {
    vi.spyOn(malwareScanModule, 'getMalwareScanProvider').mockReturnValue({
      providerName: 'clamav',
      scan: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    });
    vi.spyOn(malwareScanModule, 'getClamAVConfig').mockReturnValue({
      host: 'x',
      port: 1,
      timeoutMs: 1,
    });

    const result = await scanUploadOrRespond(new Uint8Array([1, 2, 3]));
    expect(result).not.toBeNull();
    expect(result!.status).toBe(503);
    const body = await result!.json();
    expect(body.error.code).toBe('scan_unavailable');
  });
});
