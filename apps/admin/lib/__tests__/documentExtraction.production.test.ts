import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * PRODUCTION NEVER USES THE MOCK PROVIDER -- every extraction entry point (13 September 2026).
 *
 * The applicant extract route and the levy extract route are proven end to end against real local
 * Supabase in their own integration suites. This suite covers what those cannot reach cheaply and
 * pins the same guarantee across EVERY route that can run or serve document extraction:
 *
 *   extraction:  documents/:id/extract, leases/:id/upload-and-parse, levy-statements/:id/extract
 *   stored data: documents/:id/review, apply/:token/documents/:id/corrections,
 *                applications/:id/document-requirements
 *
 * Each route runs for real; only Supabase and the permission/plan helpers are scripted, so every
 * pre-check passes and the route reaches the point that matters.
 *
 * WHY EACH "NEVER REACHED" ASSERTION HAS A CONTROL. "The service-role client was never obtained" is
 * only meaningful if, with the same scripted fakes, the route WOULD otherwise have obtained it. A
 * route that bailed out at auth because a fake was wrong would pass that assertion vacuously. So
 * every such test is paired with a control, run outside production, proving the same setup does get
 * through to the write path.
 */

const h = vi.hoisted(() => {
  type Script = Record<string, { maybeSingle?: unknown; single?: unknown; list?: unknown[]; error?: unknown }>;
  const state = {
    session: {} as Script,
    service: {} as Script,
    rpcSingle: null as unknown,
    calls: [] as string[],
  };

  function makeClient(kind: 'session' | 'service') {
    const from = (table: string) => {
      const script = (kind === 'session' ? state.session : state.service)[table] ?? {};
      const result = (data: unknown) => ({ data: data ?? null, error: script.error ?? null });
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
      builder.maybeSingle = async () => result(script.maybeSingle);
      builder.single = async () => result(script.single ?? script.maybeSingle);
      builder.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve({ data: script.list ?? [], error: script.error ?? null }).then(resolve, reject);
      return builder;
    };
    return {
      from,
      auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) },
      rpc: () => ({ single: async () => ({ data: state.rpcSingle, error: null }) }),
      storage: {
        from: () => ({
          createSignedUrl: async () => ({ data: null, error: { message: 'blocked in test' } }),
        }),
      },
    };
  }

  const getServiceRoleClient = vi.fn(() => {
    state.calls.push('getServiceRoleClient');
    return makeClient('service');
  });

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
import {
  DOCUMENT_EXTRACTION_UNAVAILABLE_MESSAGE,
  EXTRACTION_RESULT_NOT_TRUSTED_MESSAGE,
} from '@/lib/documentIntelligencePolicy';
import { POST as documentsExtract } from '@/app/api/v1/documents/[id]/extract/route';
import { POST as leaseUploadAndParse } from '@/app/api/v1/leases/[id]/upload-and-parse/route';
import { POST as levyExtract } from '@/app/api/v1/levy-statements/[id]/extract/route';
import { POST as documentReview } from '@/app/api/v1/documents/[id]/review/route';
import { POST as applyCorrections } from '@/app/api/v1/apply/[token]/documents/[documentId]/corrections/route';
import { GET as documentRequirements } from '@/app/api/v1/applications/[id]/document-requirements/route';

const GOOGLE_VARS = [
  'GOOGLE_CLOUD_PROJECT_ID',
  'GOOGLE_CLOUD_LOCATION',
  'GOOGLE_DOCUMENT_AI_PROCESSOR_ID',
  'GOOGLE_DOCUMENT_AI_CREDENTIALS_JSON',
] as const;

/** Every value the mock fabricates for a lease, an ID document or a payslip. */
const MOCK_SENTINELS = [
  'Mock Tenant',
  'Mock Applicant',
  'Mock Employer',
  '1 Mock Street',
  '9001015800086',
  '8500',
  '25000',
  '19500',
  'MOCK EXTRACTED',
];

function runtime(mode: 'production' | 'test') {
  vi.stubEnv('NODE_ENV', mode);
  for (const v of GOOGLE_VARS) vi.stubEnv(v, ''); // Google NOT configured
}

function request(body?: unknown) {
  return new NextRequest('http://localhost/api/test', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function expectNoMockValues(body: unknown) {
  const serialised = JSON.stringify(body);
  for (const sentinel of MOCK_SENTINELS) {
    expect(serialised, `leaked mock value "${sentinel}"`).not.toContain(sentinel);
  }
}

function spyOnMockProvider() {
  return [
    vi.spyOn(MockDocumentIntelligenceProvider.prototype, 'extractFields'),
    vi.spyOn(MockDocumentIntelligenceProvider.prototype, 'extractText'),
    vi.spyOn(MockDocumentIntelligenceProvider.prototype, 'classify'),
  ];
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  h.state.session = {};
  h.state.service = {};
  h.state.rpcSingle = null;
  h.state.calls = [];
  h.getServiceRoleClient.mockClear();
});

// ---------------------------------------------------------------------------------------------------
// Extraction entry points
// ---------------------------------------------------------------------------------------------------

describe('POST /api/v1/documents/:id/extract', () => {
  function scriptLeaseDocument() {
    // document_type 'lease' -- the mock would return rentAmount 8500, depositAmount 8500.
    h.state.session.documents = {
      maybeSingle: {
        id: 'doc-1',
        org_id: 'org-1',
        property_id: 'prop-1',
        document_type: 'lease',
        storage_path: 'org-1/prop-1/lease.pdf',
        mime_type: 'application/pdf',
      },
    };
    // A clean malware-scan record for that object, so the route clears
    // requireCleanScanBeforeProcessing() and reaches the part this suite is about.
    h.state.service.upload_malware_scans = { maybeSingle: { org_id: 'org-1', scanner: 'cloudmersive' } };
    h.state.service.extraction_jobs = { error: { message: 'insert blocked in test' } };
  }

  it('production + no Google: 503, and a lease can never get mock rent or deposit values', async () => {
    runtime('production');
    scriptLeaseDocument();
    const mockSpies = spyOnMockProvider();

    const response = await documentsExtract(request(), { params: Promise.resolve({ id: 'doc-1' }) });
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error).toEqual({
      code: 'document_extraction_unavailable',
      message: DOCUMENT_EXTRACTION_UNAVAILABLE_MESSAGE,
    });
    expectNoMockValues(body);
    for (const spy of mockSpies) expect(spy).not.toHaveBeenCalled();
  });

  it('production + no Google: refuses before obtaining the service-role client, so nothing is written', async () => {
    runtime('production');
    scriptLeaseDocument();
    await documentsExtract(request(), { params: Promise.resolve({ id: 'doc-1' }) });
    expect(h.getServiceRoleClient).not.toHaveBeenCalled();
    expect(h.state.calls.filter((c) => c.includes('.insert') || c.includes('.update'))).toEqual([]);
  });

  it('CONTROL: outside production the same setup does reach the write path', async () => {
    runtime('test');
    scriptLeaseDocument();
    await documentsExtract(request(), { params: Promise.resolve({ id: 'doc-1' }) });
    expect(h.getServiceRoleClient).toHaveBeenCalled();
    expect(h.state.calls).toContain('service:extraction_jobs.insert');
  });
});

describe('POST /api/v1/leases/:id/upload-and-parse', () => {
  function scriptLease() {
    h.state.session.leases = { maybeSingle: { id: 'lease-1', org_id: 'org-1' } };
    h.state.session.documents = {
      maybeSingle: {
        id: '11111111-1111-4111-8111-111111111111',
        org_id: 'org-1',
        storage_path: 'org-1/lease.pdf',
        mime_type: 'application/pdf',
      },
    };
    h.state.service.upload_malware_scans = { maybeSingle: { org_id: 'org-1', scanner: 'cloudmersive' } };
    h.state.service.extraction_jobs = { error: { message: 'insert blocked in test' } };
  }
  const BODY = { documentId: '11111111-1111-4111-8111-111111111111' };

  it('production + no Google: 503, never mock lease fields', async () => {
    runtime('production');
    scriptLease();
    const mockSpies = spyOnMockProvider();

    const response = await leaseUploadAndParse(request(BODY), {
      params: Promise.resolve({ id: 'lease-1' }),
    });
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error.code).toBe('document_extraction_unavailable');
    expect(body).not.toHaveProperty('extraction');
    expectNoMockValues(body);
    for (const spy of mockSpies) expect(spy).not.toHaveBeenCalled();
    expect(h.getServiceRoleClient).not.toHaveBeenCalled();
  });

  it('CONTROL: outside production the same setup does reach the write path', async () => {
    runtime('test');
    scriptLease();
    await leaseUploadAndParse(request(BODY), { params: Promise.resolve({ id: 'lease-1' }) });
    expect(h.state.calls).toContain('service:extraction_jobs.insert');
  });
});

describe('POST /api/v1/levy-statements/:id/extract', () => {
  function scriptStatement() {
    h.state.session.levy_statements = {
      maybeSingle: { id: 'levy-1', org_id: 'org-1', document_id: 'doc-1' },
    };
    h.state.service.documents = {
      maybeSingle: { id: 'doc-1', storage_path: 'org-1/prop-1/levy.pdf', mime_type: 'application/pdf' },
    };
    h.state.service.upload_malware_scans = { maybeSingle: { org_id: 'org-1', scanner: 'cloudmersive' } };
    h.state.service.extraction_jobs = { error: { message: 'insert blocked in test' } };
  }

  it('production + no Google: 503, never touches the levy statement or the ledger', async () => {
    runtime('production');
    scriptStatement();
    const mockSpies = spyOnMockProvider();

    const response = await levyExtract(request(), { params: Promise.resolve({ id: 'levy-1' }) });

    expect(response.status).toBe(503);
    expectNoMockValues(await response.json());
    for (const spy of mockSpies) expect(spy).not.toHaveBeenCalled();
    expect(h.getServiceRoleClient).not.toHaveBeenCalled();
    expect(h.state.calls).not.toContain('service:levy_statements.update');
    expect(h.state.calls).not.toContain('service:levy_statement_line_items.insert');
  });

  it('CONTROL: outside production the same setup does reach the write path', async () => {
    runtime('test');
    scriptStatement();
    await levyExtract(request(), { params: Promise.resolve({ id: 'levy-1' }) });
    expect(h.getServiceRoleClient).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------------------------------
// Stored results: a mock result written before this fix must never be confirmed, corrected or shown
// ---------------------------------------------------------------------------------------------------

describe('POST /api/v1/documents/:id/review', () => {
  function scriptStoredResult(providerName: string | null) {
    h.state.session.documents = { maybeSingle: { id: 'doc-1', org_id: 'org-1', property_id: 'prop-1' } };
    h.state.service.extraction_jobs = { maybeSingle: { id: 'job-1' } };
    h.state.service.extraction_results = {
      maybeSingle: { provider_name: providerName },
      single: { id: 'res-1', extraction_job_id: 'job-1', provider_name: providerName, reviewed_at: 'now' },
    };
  }

  it.each(['mock', null])(
    'production refuses to confirm a result whose provider_name is %s -- 409, and nothing is marked reviewed',
    async (providerName) => {
      runtime('production');
      scriptStoredResult(providerName);

      const response = await documentReview(request({ confirmed: true }), {
        params: Promise.resolve({ id: 'doc-1' }),
      });
      const body = await response.json();

      expect(response.status).toBe(409);
      expect(body.error).toEqual({
        code: 'extraction_result_not_trusted',
        message: EXTRACTION_RESULT_NOT_TRUSTED_MESSAGE,
      });
      expect(h.state.calls).not.toContain('service:extraction_results.update');
    },
  );

  it('CONTROL: production still confirms a result Google Document AI produced', async () => {
    runtime('production');
    scriptStoredResult('google-document-ai');
    await documentReview(request({ confirmed: true }), { params: Promise.resolve({ id: 'doc-1' }) }).catch(
      () => null,
    );
    expect(h.state.calls).toContain('service:extraction_results.update');
  });
});

describe('POST /api/v1/apply/:token/documents/:documentId/corrections', () => {
  function scriptStoredResult(providerName: string | null) {
    h.state.rpcSingle = { valid: true, error_code: null, application_id: 'app-1', org_id: 'org-1' };
    h.state.service.documents = { maybeSingle: { id: 'doc-1', application_id: 'app-1' } };
    h.state.service.extraction_jobs = { maybeSingle: { id: 'job-1' } };
    h.state.service.extraction_results = { maybeSingle: { provider_name: providerName, id: 'res-1' } };
  }
  const BODY = { correctedFields: { fullName: 'Real Name' } };

  it('production refuses to layer corrections over a mock result -- 409, nothing written', async () => {
    runtime('production');
    scriptStoredResult('mock');

    const response = await applyCorrections(request(BODY), {
      params: Promise.resolve({ token: 't', documentId: 'doc-1' }),
    });

    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe('extraction_result_not_trusted');
    expect(h.state.calls).not.toContain('service:extraction_results.update');
  });

  it('CONTROL: production still records corrections over a real Google result', async () => {
    runtime('production');
    scriptStoredResult('google-document-ai');
    const response = await applyCorrections(request(BODY), {
      params: Promise.resolve({ token: 't', documentId: 'doc-1' }),
    });
    expect(response.status).toBe(200);
    expect(h.state.calls).toContain('service:extraction_results.update');
  });
});

describe('GET /api/v1/applications/:id/document-requirements', () => {
  function scriptRequirementWithStoredResult(providerName: string | null) {
    h.state.session.application_document_requirements = {
      list: [
        {
          id: 'req-1',
          requirement_key: 'id_document',
          label: 'Copy of ID',
          is_required: true,
          status: 'uploaded',
          rejection_reason: null,
          document_id: 'doc-1',
          reviewed_at: null,
          documents: { original_file_name: 'id.pdf', mime_type: 'application/pdf', created_at: 'now' },
        },
      ],
    };
    h.state.session.extraction_jobs = { maybeSingle: { id: 'job-1' } };
    h.state.session.extraction_results = {
      maybeSingle: {
        provider_name: providerName,
        overall_confidence: 0.9,
        reviewed_at: null,
        raw_provider_output: {
          fullName: { value: 'Mock Applicant', confidence: 0.95 },
          idNumber: { value: '9001015800086', confidence: 0.92 },
        },
      },
    };
  }

  async function ocrSummaryFor(providerName: string | null) {
    scriptRequirementWithStoredResult(providerName);
    const response = await documentRequirements(new NextRequest('http://localhost/api/test'), {
      params: Promise.resolve({ id: 'app-1' }),
    });
    const body = await response.json();
    return { body, requirement: (body.requirements ?? body)[0] };
  }

  it('production shows NO OCR summary for a mock result -- staff never see "90% confidence" on fabricated data', async () => {
    runtime('production');
    const { body, requirement } = await ocrSummaryFor('mock');
    expect(requirement.ocr).toBeNull();
    expectNoMockValues(body);
  });

  it('CONTROL: production does show the summary for a real Google result', async () => {
    runtime('production');
    const { requirement } = await ocrSummaryFor('google-document-ai');
    expect(requirement.ocr).toEqual({ overallConfidence: 0.9, fieldCount: 2, reviewedAt: null });
  });
});
