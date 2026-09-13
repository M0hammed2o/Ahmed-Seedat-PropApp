import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// lib/protectedStorage.ts branch by branch, against a scripted service-role client -- the failure
// modes the real-Supabase suite (protectedStorage.integration.test.ts) can't easily produce: bytes
// changed after the scan, a path outside the organisation, the scan-record table failing, a mock
// verdict in production, a download failure. Every Storage and table call is recorded so each test
// can assert exactly what was -- and was not -- written or read.

const h = vi.hoisted(() => {
  const state = {
    calls: [] as string[],
    uploadError: null as { message: string } | null,
    insertError: null as { message: string } | null,
    record: null as { org_id: string; scanner: string } | null,
    recordError: null as { message: string } | null,
    downloadBytes: null as Uint8Array | null,
    downloadError: null as { message: string } | null,
    inserted: [] as Record<string, unknown>[],
  };
  const client = {
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string, bytes: Uint8Array, options: { upsert?: boolean }) => {
          state.calls.push(
            `upload:${bucket}:${path}:upsert=${String(options.upsert)}:${bytes.byteLength}`,
          );
          return { error: state.uploadError };
        },
        remove: async (paths: string[]) => {
          state.calls.push(`remove:${bucket}:${paths.join(',')}`);
          return { error: null };
        },
        download: async (path: string) => {
          state.calls.push(`download:${bucket}:${path}`);
          return state.downloadError
            ? { data: null, error: state.downloadError }
            : { data: new Blob([new Uint8Array(state.downloadBytes ?? [])]), error: null };
        },
      }),
    },
    from: (table: string) => ({
      insert: async (row: Record<string, unknown>) => {
        state.calls.push(`insert:${table}`);
        state.inserted.push(row);
        return { error: state.insertError };
      },
      select: () => {
        state.calls.push(`select:${table}`);
        const chain = {
          eq: () => chain,
          maybeSingle: async () => ({ data: state.record, error: state.recordError }),
        };
        return chain;
      },
      delete: () => {
        state.calls.push(`delete:${table}`);
        const chain = { eq: () => chain, in: async () => ({ error: null }) };
        return chain;
      },
    }),
  };
  return { state, client };
});

vi.mock('@/lib/supabase/server', () => ({ getServiceRoleClient: () => h.client }));
vi.mock('../supabase/server', () => ({ getServiceRoleClient: () => h.client }));

import * as malwareScanModule from '../providers/malwareScan';
import {
  removeProtectedObjects,
  requireCleanScanBeforeProcessing,
  storeScannedUpload,
  storeServerGeneratedObject,
} from '../protectedStorage';
import type { CleanUploadVerdict } from '../uploadScan';

const ORG = '22222222-2222-4222-8222-222222222222';
const PATH = `${ORG}/33333333-3333-4333-8333-333333333333/file.pdf`;
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

function verdictFor(bytes: Uint8Array, scanner = 'cloudmersive'): CleanUploadVerdict {
  return { bytes, sha256: sha(bytes), scanner } as CleanUploadVerdict;
}

function scannerSays(
  result: { clean: boolean; threatName?: string } | 'throws',
  maxFileBytes?: number,
) {
  const scan = vi.fn(async (_bytes: Uint8Array) => {
    if (result === 'throws') throw new Error('scanner down');
    return { ...result, providerName: 'cloudmersive' };
  });
  vi.spyOn(malwareScanModule, 'resolveMalwareScanner').mockReturnValue({
    status: 'real',
    provider: { providerName: 'cloudmersive', maxFileBytes, scan },
  });
  return scan;
}

beforeEach(() => {
  Object.assign(h.state, {
    calls: [],
    uploadError: null,
    insertError: null,
    record: null,
    recordError: null,
    downloadBytes: null,
    downloadError: null,
    inserted: [],
  });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('storeScannedUpload', () => {
  it('writes the scanned bytes with the service role (never upsert) and records the clean verdict', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const result = await storeScannedUpload({
      verdict: verdictFor(bytes),
      orgId: ORG,
      path: PATH,
      contentType: 'application/pdf',
    });
    expect(result).toEqual({ ok: true });
    expect(h.state.calls).toEqual([
      `upload:documents:${PATH}:upsert=false:4`,
      'insert:upload_malware_scans',
    ]);
    expect(h.state.inserted[0]).toEqual({
      bucket_id: 'documents',
      object_path: PATH,
      org_id: ORG,
      sha256: sha(bytes),
      scanner: 'cloudmersive',
      source: 'upload',
    });
  });

  it('refuses -- writing nothing -- when the buffer changed after it was scanned', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const verdict = verdictFor(bytes);
    bytes[0] = 99; // mutated after scanUpload() returned
    const result = await storeScannedUpload({
      verdict,
      orgId: ORG,
      path: PATH,
      contentType: 'application/pdf',
    });
    expect(result.ok).toBe(false);
    expect(h.state.calls).toEqual([]);
  });

  it.each([
    ['another organisation', `99999999-9999-4999-8999-999999999999/x/file.pdf`],
    ['a path with no organisation folder', 'file.pdf'],
    ['a traversal path', `${ORG}/../99999999-9999-4999-8999-999999999999/file.pdf`],
  ])('refuses -- writing nothing -- for %s', async (_label, path) => {
    const result = await storeScannedUpload({
      verdict: verdictFor(new Uint8Array([1])),
      orgId: ORG,
      path,
      contentType: 'application/pdf',
    });
    expect(result.ok).toBe(false);
    expect(h.state.calls).toEqual([]);
  });

  it('reports a Storage failure and records no verdict', async () => {
    h.state.uploadError = { message: 'The resource already exists' };
    const result = await storeScannedUpload({
      verdict: verdictFor(new Uint8Array([1])),
      orgId: ORG,
      path: PATH,
      contentType: 'application/pdf',
    });
    expect(result).toEqual({ ok: false, error: { message: 'The resource already exists' } });
    expect(h.state.calls).not.toContain('insert:upload_malware_scans');
  });

  it('still succeeds if the verdict cannot be recorded -- the file was scanned before it was written', async () => {
    h.state.insertError = { message: 'relation "upload_malware_scans" does not exist' };
    const result = await storeScannedUpload({
      verdict: verdictFor(new Uint8Array([1])),
      orgId: ORG,
      path: PATH,
      contentType: 'application/pdf',
    });
    expect(result).toEqual({ ok: true });
  });
});

describe('storeServerGeneratedObject', () => {
  it('writes server-made bytes with the service role and records NO scan verdict', async () => {
    const result = await storeServerGeneratedObject({
      orgId: ORG,
      path: PATH,
      bytes: new Uint8Array([1, 2]),
      contentType: 'image/webp',
    });
    expect(result).toEqual({ ok: true });
    expect(h.state.calls).toEqual([`upload:documents:${PATH}:upsert=false:2`]);
  });

  it('refuses a path outside the organisation folder', async () => {
    const result = await storeServerGeneratedObject({
      orgId: ORG,
      path: 'elsewhere/file.docx',
      bytes: new Uint8Array([1]),
      contentType: 'application/pdf',
    });
    expect(result.ok).toBe(false);
    expect(h.state.calls).toEqual([]);
  });
});

describe('removeProtectedObjects', () => {
  it('removes the objects and their scan records; does nothing for an empty list', async () => {
    await removeProtectedObjects([]);
    expect(h.state.calls).toEqual([]);
    await removeProtectedObjects([PATH]);
    expect(h.state.calls).toEqual([`remove:documents:${PATH}`, 'delete:upload_malware_scans']);
  });
});

describe('requireCleanScanBeforeProcessing', () => {
  async function codeOf(result: Awaited<ReturnType<typeof requireCleanScanBeforeProcessing>>) {
    if (result.ok) return { status: 200, code: result.source };
    return { status: result.response.status, code: (await result.response.json()).error.code };
  }

  it('clears an object with a clean verdict on record for the same organisation -- no download, no scan', async () => {
    h.state.record = { org_id: ORG, scanner: 'cloudmersive' };
    const scan = scannerSays({ clean: true });
    expect(await requireCleanScanBeforeProcessing({ orgId: ORG, storagePath: PATH })).toEqual({
      ok: true,
      source: 'recorded',
    });
    expect(h.state.calls).toEqual(['select:upload_malware_scans']);
    expect(scan).not.toHaveBeenCalled();
  });

  it("refuses an object outside the organisation's folder before reading anything", async () => {
    const scan = scannerSays({ clean: true });
    const result = await requireCleanScanBeforeProcessing({
      orgId: ORG,
      storagePath: '99999999-9999-4999-8999-999999999999/x/file.pdf',
    });
    expect(await codeOf(result)).toEqual({ status: 403, code: 'document_not_processable' });
    expect(h.state.calls).toEqual([]);
    expect(scan).not.toHaveBeenCalled();
  });

  it('refuses when the recorded verdict belongs to another organisation', async () => {
    h.state.record = { org_id: '99999999-9999-4999-8999-999999999999', scanner: 'cloudmersive' };
    const result = await requireCleanScanBeforeProcessing({ orgId: ORG, storagePath: PATH });
    expect(await codeOf(result)).toEqual({ status: 403, code: 'document_not_processable' });
    expect(h.state.calls).not.toContain(`download:documents:${PATH}`);
  });

  it('does not trust a mock verdict in production -- scans the stored file instead', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    h.state.record = { org_id: ORG, scanner: 'mock' };
    h.state.downloadBytes = new Uint8Array([5, 6]);
    const scan = scannerSays({ clean: true });
    expect(
      await codeOf(await requireCleanScanBeforeProcessing({ orgId: ORG, storagePath: PATH })),
    ).toEqual({
      status: 200,
      code: 'rescanned',
    });
    expect(scan).toHaveBeenCalledTimes(1);
  });

  it('with no record: scans the stored bytes, and only a clean result clears them (recorded as a rescan)', async () => {
    h.state.downloadBytes = new Uint8Array([7, 8, 9]);
    const scan = scannerSays({ clean: true });
    expect(
      await codeOf(await requireCleanScanBeforeProcessing({ orgId: ORG, storagePath: PATH })),
    ).toEqual({
      status: 200,
      code: 'rescanned',
    });
    expect(scan).toHaveBeenCalledTimes(1);
    expect(Array.from(scan.mock.calls[0]![0] as Uint8Array)).toEqual([7, 8, 9]);
    expect(h.state.inserted[0]).toMatchObject({
      object_path: PATH,
      org_id: ORG,
      source: 'rescan',
      sha256: sha(new Uint8Array([7, 8, 9])),
    });
  });

  it('if the record lookup fails, it scans rather than trusting or refusing blindly', async () => {
    h.state.recordError = { message: 'relation "upload_malware_scans" does not exist' };
    h.state.downloadBytes = new Uint8Array([1]);
    const scan = scannerSays({ clean: true });
    expect((await requireCleanScanBeforeProcessing({ orgId: ORG, storagePath: PATH })).ok).toBe(
      true,
    );
    expect(scan).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['infected', { clean: false, threatName: 'Eicar-Test-Signature' }, 422, 'malware_detected'],
    ['a scanner failure', 'throws', 503, 'document_scan_unavailable'],
  ] as const)(
    'with no record: %s refuses processing and records nothing',
    async (_label, result, status, code) => {
      h.state.downloadBytes = new Uint8Array([1]);
      scannerSays(result);
      expect(
        await codeOf(await requireCleanScanBeforeProcessing({ orgId: ORG, storagePath: PATH })),
      ).toEqual({
        status,
        code,
      });
      expect(h.state.inserted).toEqual([]);
    },
  );

  it('with no record: a file too large to scan refuses processing (413) without scanning', async () => {
    h.state.downloadBytes = new Uint8Array(11);
    const scan = scannerSays({ clean: true }, 10);
    expect(
      await codeOf(await requireCleanScanBeforeProcessing({ orgId: ORG, storagePath: PATH })),
    ).toEqual({
      status: 413,
      code: 'file_too_large_to_scan',
    });
    expect(scan).not.toHaveBeenCalled();
  });

  it('with no record and no scanner available: refuses processing (503)', async () => {
    h.state.downloadBytes = new Uint8Array([1]);
    vi.spyOn(malwareScanModule, 'resolveMalwareScanner').mockReturnValue({ status: 'unavailable' });
    expect(
      await codeOf(await requireCleanScanBeforeProcessing({ orgId: ORG, storagePath: PATH })),
    ).toEqual({
      status: 503,
      code: 'document_scan_unavailable',
    });
  });

  it('with no record: a download failure refuses processing without scanning', async () => {
    h.state.downloadError = { message: 'Object not found' };
    const scan = scannerSays({ clean: true });
    expect(
      await codeOf(await requireCleanScanBeforeProcessing({ orgId: ORG, storagePath: PATH })),
    ).toEqual({
      status: 500,
      code: 'document_unavailable',
    });
    expect(scan).not.toHaveBeenCalled();
  });
});
