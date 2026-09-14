import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// Cross-organisation path ownership at the APPLICATION layer (2026-09-14). The confirmed exploit: a
// row in organisation A whose storage_path named organisation B's object, which the app then signed.
// Migration 20260101000172 stops such a row being written; these tests prove the routes refuse it
// anyway -- a row that already exists, or a database without the constraint -- and that they refuse
// BEFORE any Storage call, extraction job or OCR provider call. Each route runs for real; only the
// Supabase clients and the permission/plan helpers are scripted. Paired with same-org controls.

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const PROPERTY_A = '33333333-3333-4333-8333-333333333333';
const PROPERTY_B = '44444444-4444-4444-8444-444444444444';
const OWN_PATH = `${ORG_A}/${PROPERTY_A}/own.pdf`;
const FOREIGN_PATH = `${ORG_B}/${PROPERTY_B}/secret.pdf`;

const h = vi.hoisted(() => {
  type Script = Record<string, { maybeSingle?: unknown; single?: unknown; list?: unknown[] }>;
  const state = {
    session: {} as Script,
    service: {} as Script,
    rpcSingle: null as unknown,
    calls: [] as string[],
  };
  function makeClient(kind: 'session' | 'service') {
    const from = (table: string) => {
      const script = (kind === 'session' ? state.session : state.service)[table] ?? {};
      const builder: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'neq', 'in', 'order', 'limit']) builder[m] = () => builder;
      builder.insert = () => {
        state.calls.push(`${kind}:${table}.insert`);
        return builder;
      };
      builder.update = () => {
        state.calls.push(`${kind}:${table}.update`);
        return builder;
      };
      builder.maybeSingle = async () => ({ data: script.maybeSingle ?? null, error: null });
      builder.single = async () => ({
        data: script.single ?? script.maybeSingle ?? null,
        error: null,
      });
      builder.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: script.list ?? [], error: null }).then(resolve);
      return builder;
    };
    return {
      from,
      auth: { getUser: async () => ({ data: { user: { id: 'user-a' } } }) },
      rpc: () => ({ single: async () => ({ data: state.rpcSingle, error: null }) }),
      storage: {
        from: (bucket: string) => ({
          createSignedUrl: async (path: string) => {
            state.calls.push(`${kind}:storage.createSignedUrl:${bucket}:${path}`);
            return { data: { signedUrl: `https://storage.example/${path}?token=t` }, error: null };
          },
          download: async (path: string) => {
            state.calls.push(`${kind}:storage.download:${bucket}:${path}`);
            return { data: new Blob([new Uint8Array([1])]), error: null };
          },
        }),
      },
    };
  }
  const getServiceRoleClient = vi.fn(() => makeClient('service'));
  return { state, makeClient, getServiceRoleClient };
});

vi.mock('@/lib/supabase/server', () => ({
  getServerSupabaseClient: async () => h.makeClient('session'),
  getServiceRoleClient: h.getServiceRoleClient,
}));
vi.mock('@/lib/portfolio', () => ({
  requireOrgRole: async () => true,
  requirePropertyAccess: async () => true,
}));
vi.mock('@/lib/subscriptionEntitlements', () => ({ canUseOcr: async () => true }));
vi.mock('@/lib/audit', () => ({ writeAuditEvent: vi.fn(async () => undefined) }));

import { MockDocumentIntelligenceProvider } from '@/lib/providers/documentIntelligence';
import { GET as getDocument } from '@/app/api/v1/documents/[id]/route';
import { GET as downloadLeaseDocument } from '@/app/api/v1/leases/[id]/documents/[documentId]/download/route';
import { GET as getLeaseTemplate } from '@/app/api/v1/lease-templates/[id]/route';
import { POST as extractDocument } from '@/app/api/v1/documents/[id]/extract/route';
import { POST as extractLevyStatement } from '@/app/api/v1/levy-statements/[id]/extract/route';
import { POST as extractApplicantDocument } from '@/app/api/v1/apply/[token]/documents/[documentId]/extract/route';

const get = (url = 'http://localhost/api/test') => new NextRequest(url);
const post = () => new NextRequest('http://localhost/api/test', { method: 'POST' });
const storageCalls = () => h.state.calls.filter((c) => c.includes(':storage.'));

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'test');
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  h.state.session = {};
  h.state.service = {};
  h.state.rpcSingle = null;
  h.state.calls = [];
  h.getServiceRoleClient.mockClear();
});

function documentRow(path: string) {
  return {
    id: 'doc-a',
    org_id: ORG_A,
    property_id: PROPERTY_A,
    category_id: 'cat',
    document_type: 'bill',
    storage_path: path,
    original_file_name: 'file.pdf',
    mime_type: 'application/pdf',
    file_size_bytes: 10,
    checksum_sha256: 'x',
    created_at: '2026-09-14T00:00:00Z',
  };
}

describe('download routes never sign a path outside the row organisation', () => {
  it('GET /api/v1/documents/:id -- forged row: 403 and no signed URL is created', async () => {
    h.state.session.documents = { maybeSingle: documentRow(FOREIGN_PATH) };
    const response = await getDocument(get(), { params: Promise.resolve({ id: 'doc-a' }) });
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error.code).toBe('document_file_not_accessible');
    expect(JSON.stringify(body)).not.toContain('token=');
    expect(storageCalls()).toEqual([]);
  });

  it('GET /api/v1/documents/:id -- CONTROL: a same-org row is signed', async () => {
    h.state.session.documents = { maybeSingle: documentRow(OWN_PATH) };
    const response = await getDocument(get(), { params: Promise.resolve({ id: 'doc-a' }) });
    expect(response.status).toBe(200);
    expect((await response.json()).signedUrl).toContain(OWN_PATH);
    expect(storageCalls()).toEqual([`session:storage.createSignedUrl:documents:${OWN_PATH}`]);
  });

  it('GET lease document download -- forged row: 403, no signed URL; same-org row: signed', async () => {
    h.state.session.lease_documents = {
      maybeSingle: { org_id: ORG_A, storage_path: FOREIGN_PATH },
    };
    const forged = await downloadLeaseDocument(get(), {
      params: Promise.resolve({ id: 'lease-a', documentId: 'ld-a' }),
    });
    expect(forged.status).toBe(403);
    expect(storageCalls()).toEqual([]);

    h.state.session.lease_documents = { maybeSingle: { org_id: ORG_A, storage_path: OWN_PATH } };
    const own = await downloadLeaseDocument(get(), {
      params: Promise.resolve({ id: 'lease-a', documentId: 'ld-a' }),
    });
    expect(own.status).toBe(200);
    expect((await own.json()).signedUrl).toContain(OWN_PATH);
  });

  it('GET /api/v1/lease-templates/:id -- forged row: 403, no signed URL; same-org row: signed', async () => {
    const template = (path: string) => ({
      id: 'lt-a',
      org_id: ORG_A,
      name: 'T',
      storage_path: path,
      original_file_name: 't.docx',
      mime_type: 'application/pdf',
      file_size_bytes: 1,
      is_default: false,
      status: 'active',
      created_at: '2026-09-14T00:00:00Z',
    });
    h.state.session.lease_templates = { maybeSingle: template(`${ORG_B}/lease-templates/t.docx`) };
    const forged = await getLeaseTemplate(get(), { params: Promise.resolve({ id: 'lt-a' }) });
    expect(forged.status).toBe(403);
    expect(storageCalls()).toEqual([]);

    h.state.session.lease_templates = { maybeSingle: template(`${ORG_A}/lease-templates/t.docx`) };
    const own = await getLeaseTemplate(get(), { params: Promise.resolve({ id: 'lt-a' }) });
    expect(own.status).toBe(200);
    expect((await own.json()).signedUrl).toContain(`${ORG_A}/lease-templates/t.docx`);
  });
});

describe('OCR never processes a path outside the row organisation', () => {
  it('documents extract -- forged row pointing at B, even with a clean verdict recorded for B: 403, no job, no URL, no OCR', async () => {
    h.state.session.documents = { maybeSingle: documentRow(FOREIGN_PATH) };
    h.state.service.upload_malware_scans = {
      maybeSingle: { org_id: ORG_B, scanner: 'cloudmersive' },
    };
    const extractSpy = vi.spyOn(MockDocumentIntelligenceProvider.prototype, 'extractFields');

    const response = await extractDocument(post(), { params: Promise.resolve({ id: 'doc-a' }) });
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe('document_not_processable');
    expect(h.state.calls).not.toContain('service:extraction_jobs.insert');
    expect(storageCalls()).toEqual([]);
    expect(extractSpy).not.toHaveBeenCalled();
  });

  it('documents extract -- CONTROL: a same-org verified-clean document reaches the job and a signed URL', async () => {
    h.state.session.documents = { maybeSingle: documentRow(OWN_PATH) };
    h.state.service.upload_malware_scans = {
      maybeSingle: { org_id: ORG_A, scanner: 'cloudmersive' },
    };
    h.state.service.extraction_jobs = { single: { id: 'job-1' } };
    h.state.service.extraction_results = { single: { id: 'res-1', extraction_job_id: 'job-1' } };

    await extractDocument(post(), { params: Promise.resolve({ id: 'doc-a' }) });
    expect(h.state.calls).toContain('service:extraction_jobs.insert');
    expect(storageCalls()).toEqual([`service:storage.createSignedUrl:documents:${OWN_PATH}`]);
  });

  it('levy statement extract -- a statement whose document belongs to another organisation: 404, nothing written', async () => {
    h.state.session.levy_statements = {
      maybeSingle: { id: 'levy-a', org_id: ORG_A, document_id: 'doc-b' },
    };
    h.state.service.documents = {
      maybeSingle: {
        id: 'doc-b',
        org_id: ORG_B,
        storage_path: FOREIGN_PATH,
        mime_type: 'application/pdf',
      },
    };
    const response = await extractLevyStatement(post(), {
      params: Promise.resolve({ id: 'levy-a' }),
    });
    expect(response.status).toBe(404);
    expect(h.state.calls.filter((c) => c.includes('.insert') || c.includes('.update'))).toEqual([]);
    expect(storageCalls()).toEqual([]);
  });

  it("applicant extract -- a document from another organisation than the token's: 404, nothing written", async () => {
    h.state.rpcSingle = { valid: true, error_code: null, application_id: 'app-a', org_id: ORG_A };
    h.state.service.documents = {
      maybeSingle: {
        id: 'doc-b',
        org_id: ORG_B,
        application_id: 'app-a',
        document_type: 'id_document',
        storage_path: FOREIGN_PATH,
        mime_type: 'application/pdf',
      },
    };
    const response = await extractApplicantDocument(post(), {
      params: Promise.resolve({ token: 't', documentId: 'doc-b' }),
    });
    expect(response.status).toBe(404);
    expect(h.state.calls.filter((c) => c.includes('.insert') || c.includes('.update'))).toEqual([]);
    expect(storageCalls()).toEqual([]);
  });
});
