import { createHash } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// The Storage write bypass, closed -- proven against REAL local Supabase (migration
// 20260101000171 applied), not against fakes. Skips itself if local Supabase isn't running.
//
// A signed-in principal -- the most privileged org role there is -- talks to the Storage REST API
// directly with their own session, exactly as a malicious or compromised client could, and every
// way of creating or replacing an object is refused. Then the legitimate path is exercised end to
// end through the real route handlers: upload through the API (scan, server-side write, clean-scan
// record), read it back through the normal download flow, and send it to OCR. An object planted
// without a verified clean scan never reaches OCR.
//
// Cloudmersive itself is never called: fetch to api.cloudmersive.com is answered here, every other
// request (Supabase) goes through untouched. Hardcoded to 127.0.0.1:54321 -- never production.

let mockAuthorizationHeader: string | null = null;

vi.mock('next/headers', () => ({
  headers: async () => ({
    get: (name: string) =>
      name.toLowerCase() === 'authorization' ? mockAuthorizationHeader : null,
  }),
  cookies: async () => ({ get: () => undefined, set: () => {}, getAll: () => [] }),
}));
// Plan gating is not what this suite is about; every other check in the OCR route runs for real.
vi.mock('@/lib/subscriptionEntitlements', () => ({ canUseOcr: async () => true }));

const SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
process.env.SUPABASE_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PASSWORD = 'TestPassw0rd!23';

const { POST: uploadDocument } = await import('@/app/api/v1/documents/route');
const { GET: getDocument } = await import('@/app/api/v1/documents/[id]/route');
const { POST: extractDocument } = await import('@/app/api/v1/documents/[id]/extract/route');
const { MockDocumentIntelligenceProvider } = await import('@/lib/providers/documentIntelligence');

const realFetch = globalThis.fetch;

let supabaseReachable = false;
try {
  supabaseReachable = (await realFetch(`${SUPABASE_URL}/auth/v1/health`)).ok;
} catch {
  supabaseReachable = false;
}
const describeIfSupabase = supabaseReachable ? describe : describe.skip;

const service = { apikey: SERVICE_ROLE_KEY!, Authorization: `Bearer ${SERVICE_ROLE_KEY}` };

async function adminInsert(table: string, body: unknown) {
  const res = await realFetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: { ...service, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`insert ${table} failed: ${JSON.stringify(json)}`);
  return json;
}
async function adminSelect(pathAndQuery: string) {
  const res = await realFetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, { headers: service });
  return res.json();
}
async function adminDelete(pathAndQuery: string) {
  await realFetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    method: 'DELETE',
    headers: service,
  });
}
async function serviceUpload(path: string, bytes: Uint8Array) {
  const res = await realFetch(`${SUPABASE_URL}/storage/v1/object/documents/${path}`, {
    method: 'POST',
    headers: { ...service, 'Content-Type': 'application/pdf' },
    body: new Uint8Array(bytes),
  });
  if (!res.ok) throw new Error(`service upload failed: ${res.status} ${await res.text()}`);
}
async function serviceDownload(path: string): Promise<Buffer | null> {
  const res = await realFetch(`${SUPABASE_URL}/storage/v1/object/documents/${path}`, {
    headers: service,
  });
  return res.ok ? Buffer.from(await res.arrayBuffer()) : null;
}

function asUser(token: string, extra: Record<string, string> = {}) {
  return { apikey: ANON_KEY!, Authorization: `Bearer ${token}`, ...extra };
}

/** Answers Cloudmersive; lets everything else (Supabase) through. Returns the Cloudmersive call log. */
function cloudmersiveAnswers(answer: () => Response) {
  vi.stubEnv('CLOUDMERSIVE_API_KEY', 'test-cloudmersive-key-0000-not-real');
  vi.stubEnv('CLOUDMERSIVE_MAX_FILE_BYTES', '');
  const calls: string[] = [];
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith('https://api.cloudmersive.com/')) {
      calls.push(url);
      return Promise.resolve(answer());
    }
    return realFetch(input, init);
  });
  return calls;
}
const CLEAN = () => Response.json({ CleanResult: true, FoundViruses: null });

const pdf = (label: string) =>
  new Uint8Array(Buffer.from(`%PDF-1.4\n% ${label} -- synthetic, no personal data\n%%EOF\n`));

describeIfSupabase(
  'protected Storage: client writes refused, server writes and OCR gated (real local Supabase)',
  () => {
    const suffix = `${Date.now()}`;
    let orgId: string;
    let otherOrgId: string;
    let propertyId: string;
    let otherPropertyId: string;
    let categoryId: string;
    let userId: string;
    let token: string;
    const objectPaths: string[] = [];
    const otherOrgPaths: string[] = [];

    beforeAll(async () => {
      [{ id: orgId }] = await adminInsert('organizations', {
        legal_name: `Protected Storage Vitest Org ${suffix}`,
        org_type: 'agency',
      });
      [{ id: otherOrgId }] = await adminInsert('organizations', {
        legal_name: `Protected Storage Vitest Other Org ${suffix}`,
        org_type: 'agency',
      });
      const property = {
        nickname: 'Protected Storage Property',
        address_line1: '1 Test St',
        city: 'Cape Town',
        country: 'ZA',
        property_type: 'house',
      };
      [{ id: propertyId }] = await adminInsert('properties', { org_id: orgId, ...property });
      [{ id: otherPropertyId }] = await adminInsert('properties', {
        org_id: otherOrgId,
        ...property,
      });
      [{ id: categoryId }] = await adminSelect(
        'document_categories?slug=eq.proof_of_payment&select=id',
      );

      const email = `protected-storage-${suffix}@test.propertyvault.example`;
      const created = await (
        await realFetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
          method: 'POST',
          headers: { ...service, 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password: PASSWORD, email_confirm: true }),
        })
      ).json();
      userId = created.id;
      await adminInsert('organization_members', {
        org_id: orgId,
        user_id: userId,
        role: 'principal',
        status: 'active',
        joined_at: new Date().toISOString(),
      });
      const session = await (
        await realFetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
          method: 'POST',
          headers: { apikey: ANON_KEY!, 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password: PASSWORD }),
        })
      ).json();
      token = session.access_token;
      mockAuthorizationHeader = `Bearer ${token}`;
    }, 60_000);

    afterEach(() => {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
      vi.restoreAllMocks();
    });

    afterAll(async () => {
      mockAuthorizationHeader = null;
      const documents: { id: string; storage_path: string }[] = await adminSelect(
        `documents?org_id=in.(${orgId},${otherOrgId})&select=id,storage_path`,
      );
      const paths = [
        ...new Set([...objectPaths, ...otherOrgPaths, ...documents.map((d) => d.storage_path)]),
      ];
      if (paths.length > 0) {
        await realFetch(`${SUPABASE_URL}/storage/v1/object/documents`, {
          method: 'DELETE',
          headers: { ...service, 'Content-Type': 'application/json' },
          body: JSON.stringify({ prefixes: paths }),
        });
      }
      for (const org of [orgId, otherOrgId]) {
        await adminDelete(`extraction_results?org_id=eq.${org}`);
        await adminDelete(`extraction_jobs?org_id=eq.${org}`);
        await adminDelete(`documents?org_id=eq.${org}`);
        await adminDelete(`upload_malware_scans?org_id=eq.${org}`);
        await adminDelete(`properties?org_id=eq.${org}`);
        await adminDelete(`organization_members?org_id=eq.${org}`);
        await adminDelete(`organizations?id=eq.${org}`);
      }
      await realFetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
        method: 'DELETE',
        headers: service,
      });
    }, 60_000);

    async function jobsFor(documentId: string): Promise<unknown[]> {
      return adminSelect(`extraction_jobs?document_id=eq.${documentId}&select=id`);
    }
    async function scanRecord(
      path: string,
    ): Promise<{ source: string; org_id: string; sha256: string } | null> {
      const rows = await adminSelect(
        `upload_malware_scans?bucket_id=eq.documents&object_path=eq.${encodeURIComponent(path)}&select=source,org_id,sha256`,
      );
      return rows[0] ?? null;
    }
    /** A documents row the client itself is allowed to write (documents_write_agent_plus_and_property_access). */
    async function clientDocumentRow(path: string): Promise<string> {
      const res = await realFetch(`${SUPABASE_URL}/rest/v1/documents`, {
        method: 'POST',
        headers: asUser(token, {
          'Content-Type': 'application/json',
          Prefer: 'return=representation',
        }),
        body: JSON.stringify({
          org_id: orgId,
          property_id: propertyId,
          category_id: categoryId,
          document_type: 'bill',
          storage_path: path,
          original_file_name: 'planted.pdf',
          mime_type: 'application/pdf',
          file_size_bytes: 64,
          checksum_sha256: 'f'.repeat(64),
        }),
      });
      const rows = await res.json();
      if (!res.ok) throw new Error(`client documents insert failed: ${JSON.stringify(rows)}`);
      return rows[0].id;
    }
    function extract(documentId: string) {
      return extractDocument(
        new NextRequest(`http://localhost/api/v1/documents/${documentId}/extract`, {
          method: 'POST',
        }),
        {
          params: Promise.resolve({ id: documentId }),
        },
      );
    }

    // --- 1. Direct client writes are refused -------------------------------------------------------

    it('a signed-in principal cannot INSERT an object directly -- in a property folder or lease-templates', async () => {
      for (const path of [
        `${orgId}/${propertyId}/direct-${suffix}.pdf`,
        `${orgId}/lease-templates/direct-${suffix}.docx`,
      ]) {
        const res = await realFetch(`${SUPABASE_URL}/storage/v1/object/documents/${path}`, {
          method: 'POST',
          headers: asUser(token, { 'Content-Type': 'application/pdf' }),
          body: pdf('direct insert'),
        });
        expect(res.ok, `direct insert to ${path} was accepted`).toBe(false);
        expect(
          await serviceDownload(path),
          `object ${path} exists after a refused insert`,
        ).toBeNull();
      }
    });

    it('a signed-in principal cannot get a signed upload URL for a protected path', async () => {
      const path = `${orgId}/${propertyId}/signed-${suffix}.pdf`;
      const res = await realFetch(
        `${SUPABASE_URL}/storage/v1/object/upload/sign/documents/${path}`,
        {
          method: 'POST',
          headers: asUser(token),
        },
      );
      expect(res.ok).toBe(false);
    });

    it('a signed-in principal cannot UPDATE, upsert, move onto or copy over an existing object', async () => {
      const path = `${orgId}/${propertyId}/existing-${suffix}.pdf`;
      const original = pdf('original bytes');
      await serviceUpload(path, original);
      objectPaths.push(path);
      // A document row the principal can see, so the object is visible to them through the SELECT
      // policies -- the realistic target (replacing a file they can already open). Without it Postgres
      // would hide the row from their UPDATE regardless of any write policy, and this test would pass
      // even with the old policies in place.
      await clientDocumentRow(path);
      const visible = await realFetch(
        `${SUPABASE_URL}/storage/v1/object/authenticated/documents/${path}`,
        {
          headers: asUser(token),
        },
      );
      expect(visible.ok, 'precondition: the principal can read the object').toBe(true);

      const replace = await realFetch(`${SUPABASE_URL}/storage/v1/object/documents/${path}`, {
        method: 'PUT',
        headers: asUser(token, { 'Content-Type': 'application/pdf' }),
        body: pdf('replacement bytes'),
      });
      expect(replace.ok, 'PUT replace accepted').toBe(false);

      const upsert = await realFetch(`${SUPABASE_URL}/storage/v1/object/documents/${path}`, {
        method: 'POST',
        headers: asUser(token, { 'Content-Type': 'application/pdf', 'x-upsert': 'true' }),
        body: pdf('upserted bytes'),
      });
      expect(upsert.ok, 'upsert accepted').toBe(false);

      for (const op of ['move', 'copy'] as const) {
        const res = await realFetch(`${SUPABASE_URL}/storage/v1/object/${op}`, {
          method: 'POST',
          headers: asUser(token, { 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            bucketId: 'documents',
            sourceKey: path,
            destinationKey: `${orgId}/${propertyId}/${op}-${suffix}.pdf`,
          }),
        });
        expect(res.ok, `${op} accepted`).toBe(false);
      }

      expect((await serviceDownload(path))?.equals(Buffer.from(original))).toBe(true);
    });

    it('clients can neither read nor write clean-scan records', async () => {
      const read = await realFetch(`${SUPABASE_URL}/rest/v1/upload_malware_scans?select=*`, {
        headers: asUser(token),
      });
      expect(read.ok).toBe(false);
      const write = await realFetch(`${SUPABASE_URL}/rest/v1/upload_malware_scans`, {
        method: 'POST',
        headers: asUser(token, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          bucket_id: 'documents',
          object_path: `${orgId}/${propertyId}/forged.pdf`,
          org_id: orgId,
          sha256: 'a'.repeat(64),
          scanner: 'forged',
          source: 'upload',
        }),
      });
      expect(write.ok).toBe(false);
      expect(await scanRecord(`${orgId}/${propertyId}/forged.pdf`)).toBeNull();
    });

    // --- 2. The legitimate path still works ------------------------------------------------------------

    it('the server API upload works: scanned, written by the server, recorded, readable, and cleared for OCR without a second scan', async () => {
      const calls = cloudmersiveAnswers(CLEAN);
      const bytes = pdf('api upload');
      const form = new FormData();
      form.set('orgId', orgId);
      form.set('propertyId', propertyId);
      form.set('categoryId', categoryId);
      form.set('documentType', 'bill');
      form.set('file', new File([bytes], 'synthetic-bill.pdf', { type: 'application/pdf' }));

      const uploaded = await uploadDocument(
        new NextRequest('http://localhost/api/v1/documents', { method: 'POST', body: form }),
      );
      expect(uploaded.status).toBe(201);
      const { document } = await uploaded.json();
      expect(calls).toHaveLength(1);

      const record = await scanRecord(document.storagePath);
      expect(record).toEqual({
        source: 'upload',
        org_id: orgId,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      });
      expect((await serviceDownload(document.storagePath))?.equals(Buffer.from(bytes))).toBe(true);

      // The normal read flow, through the caller's own session and the unchanged SELECT policies.
      const read = await getDocument(
        new NextRequest(`http://localhost/api/v1/documents/${document.id}`),
        {
          params: Promise.resolve({ id: document.id }),
        },
      );
      expect(read.status).toBe(200);
      const { signedUrl } = await read.json();
      const downloaded = await realFetch(signedUrl);
      expect(downloaded.ok).toBe(true);
      expect(Buffer.from(await downloaded.arrayBuffer()).equals(Buffer.from(bytes))).toBe(true);

      // Verified clean on record -> OCR proceeds, and Cloudmersive is not called again.
      const extractSpy = vi.spyOn(MockDocumentIntelligenceProvider.prototype, 'extractFields');
      const extracted = await extract(document.id);
      expect(extracted.status).toBe(200);
      expect(extractSpy).toHaveBeenCalledTimes(1);
      expect(calls).toHaveLength(1);
      expect(await jobsFor(document.id)).toHaveLength(1);
    }, 30_000);

    // --- 3. NO VERIFIED CLEAN SCAN -> NO OCR ---------------------------------------------------------

    async function plantedDocument(label: string): Promise<{ id: string; path: string }> {
      // How an unscanned object gets in: an object written before this change (or while clients could
      // still write), plus a documents row the client is allowed to create pointing at it.
      const path = `${orgId}/${propertyId}/planted-${label}-${suffix}.pdf`;
      await serviceUpload(path, pdf(`planted ${label}`));
      objectPaths.push(path);
      return { id: await clientDocumentRow(path), path };
    }

    it('an object with no verified clean scan is NOT sent to OCR when no scanner is available', async () => {
      vi.stubEnv('CLOUDMERSIVE_API_KEY', '');
      vi.stubEnv('CLAMAV_HOST', '');
      const planted = await plantedDocument('no-scanner');
      const extractSpy = vi.spyOn(MockDocumentIntelligenceProvider.prototype, 'extractFields');

      const response = await extract(planted.id);
      expect(response.status).toBe(503);
      expect((await response.json()).error.code).toBe('document_scan_unavailable');
      expect(extractSpy).not.toHaveBeenCalled();
      expect(await jobsFor(planted.id)).toHaveLength(0);
      expect(await scanRecord(planted.path)).toBeNull();
    }, 30_000);

    it.each([
      [
        'infected',
        () =>
          Response.json({
            CleanResult: false,
            FoundViruses: [{ FileName: 'upload', VirusName: 'Eicar-Test-Signature' }],
          }),
        422,
      ],
      ['rate-limited', () => new Response('Too Many Requests', { status: 429 }), 503],
      ['scanner error', () => new Response('Server Error', { status: 500 }), 503],
    ] as const)(
      'an object with no verified clean scan whose scan now comes back %s is NOT sent to OCR',
      async (label, answer, status) => {
        const calls = cloudmersiveAnswers(answer);
        const planted = await plantedDocument(label);
        const extractSpy = vi.spyOn(MockDocumentIntelligenceProvider.prototype, 'extractFields');

        const response = await extract(planted.id);
        expect(response.status).toBe(status);
        expect(calls).toHaveLength(1);
        expect(extractSpy).not.toHaveBeenCalled();
        expect(await jobsFor(planted.id)).toHaveLength(0);
        expect(await scanRecord(planted.path)).toBeNull();
      },
      30_000,
    );

    it('an older object that passes a scan now is cleared, recorded as a rescan, and never scanned twice', async () => {
      const calls = cloudmersiveAnswers(CLEAN);
      const planted = await plantedDocument('rescan-clean');

      expect((await extract(planted.id)).status).toBe(200);
      expect(calls).toHaveLength(1);
      expect((await scanRecord(planted.path))?.source).toBe('rescan');
      expect(await jobsFor(planted.id)).toHaveLength(1);

      // Run it again: the recorded verdict clears it with no new scan. The first job is removed first
      // only because the staff extract route inserts attempt 1 every time and extraction_jobs is
      // UNIQUE (document_id, attempt) -- unrelated to scanning.
      const jobs = (await jobsFor(planted.id)) as { id: string }[];
      await adminDelete(
        `extraction_results?extraction_job_id=in.(${jobs.map((j) => j.id).join(',')})`,
      );
      await adminDelete(`extraction_jobs?document_id=eq.${planted.id}`);
      expect((await extract(planted.id)).status).toBe(200);
      expect(calls).toHaveLength(1);
    }, 30_000);

    it("a row pointing at another organisation's object is refused before anything is read or scanned", async () => {
      const calls = cloudmersiveAnswers(CLEAN);
      const foreignPath = `${otherOrgId}/${otherPropertyId}/foreign-${suffix}.pdf`;
      await serviceUpload(foreignPath, pdf('other organisation'));
      otherOrgPaths.push(foreignPath);
      const documentId = await clientDocumentRow(foreignPath);
      const extractSpy = vi.spyOn(MockDocumentIntelligenceProvider.prototype, 'extractFields');

      const response = await extract(documentId);
      expect(response.status).toBe(403);
      expect((await response.json()).error.code).toBe('document_not_processable');
      expect(calls).toHaveLength(0);
      expect(extractSpy).not.toHaveBeenCalled();
      expect(await jobsFor(documentId)).toHaveLength(0);
    }, 30_000);
  },
);
