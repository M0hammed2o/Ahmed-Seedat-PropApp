import { afterEach, describe, expect, it, vi } from 'vitest';
import * as malwareScanModule from '../providers/malwareScan';
import { scanUploadOrRespond } from '../uploadScan';

// Pins the three deliberately-different failure modes uploadScan.ts's own header comment
// describes: sensitive+unconfigured (fail closed, new -- autonomous overnight completion pass),
// non-sensitive+unconfigured (mock, fail open, unchanged), configured-but-erroring (fail closed,
// unchanged). Mocks getMalwareScanProvider()/getClamAVConfig() directly rather than going through
// env vars, since this needs to control both "is a real scanner configured" and "what does scan()
// do" independently.

describe('scanUploadOrRespond', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns null (allow) when a real scanner is configured and reports clean', async () => {
    vi.spyOn(malwareScanModule, 'getMalwareScanProvider').mockReturnValue({
      providerName: 'test',
      scan: vi.fn().mockResolvedValue({ clean: true, providerName: 'test' }),
    });
    vi.spyOn(malwareScanModule, 'getClamAVConfig').mockReturnValue({
      host: 'x',
      port: 1,
      timeoutMs: 1,
    });

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

  it('fails CLOSED with a professional, ClamAV-free 503 for a sensitive (default) upload when no real scanner is configured -- never falls back to the mock', async () => {
    const mockScan = vi.fn();
    vi.spyOn(malwareScanModule, 'getMalwareScanProvider').mockReturnValue({
      providerName: 'mock',
      scan: mockScan,
    });
    vi.spyOn(malwareScanModule, 'getClamAVConfig').mockReturnValue(null);

    const result = await scanUploadOrRespond(new Uint8Array([1, 2, 3]));
    expect(result).not.toBeNull();
    expect(result!.status).toBe(503);
    const body = await result!.json();
    expect(body.error.code).toBe('upload_temporarily_unavailable');
    expect(body.error.message).not.toMatch(/clamav/i);
    // Refuses outright -- never even attempts the (always-clean) mock scan for a sensitive upload.
    expect(mockScan).not.toHaveBeenCalled();
  });

  it('fails CLOSED the same way when { sensitive: true } is passed explicitly', async () => {
    vi.spyOn(malwareScanModule, 'getMalwareScanProvider').mockReturnValue({
      providerName: 'mock',
      scan: vi.fn(),
    });
    vi.spyOn(malwareScanModule, 'getClamAVConfig').mockReturnValue(null);

    const result = await scanUploadOrRespond(new Uint8Array([1, 2, 3]), { sensitive: true });
    expect(result!.status).toBe(503);
  });

  it('still allows (mock fallback) an explicitly non-sensitive upload when no real scanner is configured', async () => {
    vi.spyOn(malwareScanModule, 'getMalwareScanProvider').mockReturnValue({
      providerName: 'mock',
      scan: vi.fn().mockResolvedValue({ clean: true, providerName: 'mock' }),
    });
    vi.spyOn(malwareScanModule, 'getClamAVConfig').mockReturnValue(null);

    const result = await scanUploadOrRespond(new Uint8Array([1, 2, 3]), { sensitive: false });
    expect(result).toBeNull();
  });

  it('fails OPEN (allows the upload) for a non-sensitive upload when the mock throws unexpectedly', async () => {
    vi.spyOn(malwareScanModule, 'getMalwareScanProvider').mockReturnValue({
      providerName: 'mock',
      scan: vi.fn().mockRejectedValue(new Error('should never happen')),
    });
    vi.spyOn(malwareScanModule, 'getClamAVConfig').mockReturnValue(null);

    const result = await scanUploadOrRespond(new Uint8Array([1, 2, 3]), { sensitive: false });
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

  it('fails CLOSED when a real scanner is configured but throws, even for a non-sensitive upload', async () => {
    vi.spyOn(malwareScanModule, 'getMalwareScanProvider').mockReturnValue({
      providerName: 'clamav',
      scan: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    });
    vi.spyOn(malwareScanModule, 'getClamAVConfig').mockReturnValue({
      host: 'x',
      port: 1,
      timeoutMs: 1,
    });

    const result = await scanUploadOrRespond(new Uint8Array([1, 2, 3]), { sensitive: false });
    expect(result!.status).toBe(503);
  });
});
