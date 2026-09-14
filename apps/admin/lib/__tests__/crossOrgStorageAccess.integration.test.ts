import { createHash } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import PizZip from 'pizzip';

// THE CONFIRMED CROSS-ORGANISATION READ, reproduced as a regression test against REAL local Supabase
// (migration 20260101000172 applied). Before the fix a principal of organisation A could create a
// documents row in A whose storage_path named organisation B's object, then download B's bytes
// through the normal document endpoint or the Storage API.
//
// The exploit test walks the whole chain with expect.soft, so if any layer regresses -- the database
// constraint AND the application check -- the report shows exactly which steps now leak. Then every
// other protected reference (lease_documents, lease_templates, property_photos, the applicant upload
// RPC) is proven unforgeable, and the legitimate same-organisation flows -- document download, lease
// document download, lease-template processing, verified-clean OCR -- are proven to still work.
//
// Cloudmersive is never called (answered here); plan gating is scripted. 127.0.0.1:54321 only.

let mockAuthorizationHeader: string | null = null;
vi.mock('next/headers', () => ({
  headers: async () => ({
    get: (name: string) =>
      name.toLowerCase() === 'authorization' ? mockAuthorizationHeader : null,
  }),
  cookies: async () => ({ get: () => undefined, set: () => {}, getAll: () => [] }),
}));
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
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const { POST: uploadDocument } = await import('@/app/api/v1/documents/route');
const { GET: getDocument } = await import('@/app/api/v1/documents/[id]/route');
const { POST: extractDocument } = await import('@/app/api/v1/documents/[id]/extract/route');
const { POST: uploadLeaseDocument } = await import('@/app/api/v1/leases/[id]/documents/route');
const { GET: downloadLeaseDocument } =
  await import('@/app/api/v1/leases/[id]/documents/[documentId]/download/route');
const { POST: uploadLeaseTemplate } = await import('@/app/api/v1/lease-templates/route');
const { GET: getLeaseTemplate } = await import('@/app/api/v1/lease-templates/[id]/route');
const { POST: generateLeaseDocument } =
  await import('@/app/api/v1/leases/[id]/documents/generate/route');
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
const asUser = (token: string, extra: Record<string, string> = {}) => ({
  apikey: ANON_KEY!,
  Authorization: `Bearer ${token}`,
  ...extra,
});

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
async function adminSelect(query: string) {
  return (await realFetch(`${SUPABASE_URL}/rest/v1/${query}`, { headers: service })).json();
}
async function adminDelete(query: string) {
  await realFetch(`${SUPABASE_URL}/rest/v1/${query}`, { method: 'DELETE', headers: service });
}
async function userRest(token: string, method: string, query: string, body?: unknown) {
  const res = await realFetch(`${SUPABASE_URL}/rest/v1/${query}`, {
    method,
    headers: asUser(token, { 'Content-Type': 'application/json', Prefer: 'return=representation' }),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return {
    ok: res.ok,
    status: res.status,
    json: json as { code?: string } & Record<string, unknown>,
  };
}
async function signIn(email: string) {
  const res = await realFetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY!, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  return (await res.json()).access_token as string;
}

function cloudmersiveClean() {
  vi.stubEnv('CLOUDMERSIVE_API_KEY', 'test-cloudmersive-key-0000-not-real');
  vi.stubEnv('CLOUDMERSIVE_MAX_FILE_BYTES', '');
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith('https://api.cloudmersive.com/')) {
      return Promise.resolve(Response.json({ CleanResult: true, FoundViruses: null }));
    }
    return realFetch(input, init);
  });
}

const pdf = (label: string) =>
  new Uint8Array(Buffer.from(`%PDF-1.4\n% ${label} -- synthetic, no personal data\n%%EOF\n`));

function leaseTemplateDocx(): Uint8Array<ArrayBuffer> {
  const zip = new PizZip();
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  zip.file(
    'word/document.xml',
    '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Lease for {{tenant_full_name}} at {{property_name}}, {{property_address}}, {{unit_label}}: {{monthly_rent}} from {{lease_start_date}}.</w:t></w:r></w:p></w:body></w:document>',
  );
  return new Uint8Array(zip.generate({ type: 'nodebuffer' }));
}

describeIfSupabase('cross-organisation Storage access is blocked (real local Supabase)', () => {
  const suffix = `${Date.now()}`;
  const ids: Record<string, string> = {};
  const userIds: string[] = [];
  const objectPaths: string[] = [];
  let tokenA: string;
  let foreignPath: string;
  // The exploit's real target: one of B's objects that no documents row references (a photo
  // derivative, a lease document, an orphan) -- so nothing but path ownership stops a forged row in A
  // from naming it exactly. (documents.storage_path is unique, so B's document object itself can't be.)
  let unreferencedForeignPath: string;
  const SECRET = pdf('ORGANISATION B CONFIDENTIAL');

  beforeAll(async () => {
    const property = {
      address_line1: '1 Test St',
      city: 'Cape Town',
      country: 'ZA',
      property_type: 'house',
    };
    for (const org of ['A', 'B']) {
      [{ id: ids[`org${org}`] }] = await adminInsert('organizations', {
        legal_name: `Cross Org Storage Vitest Org ${org} ${suffix}`,
        org_type: 'agency',
      });
      [{ id: ids[`property${org}`] }] = await adminInsert('properties', {
        org_id: ids[`org${org}`],
        nickname: `Cross Org Property ${org}`,
        ...property,
      });
    }
    [{ id: ids.category }] = await adminSelect(
      'document_categories?slug=eq.proof_of_payment&select=id',
    );

    const email = `cross-org-a-${suffix}@test.propertyvault.example`;
    const created = await (
      await realFetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
        method: 'POST',
        headers: { ...service, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: PASSWORD, email_confirm: true }),
      })
    ).json();
    ids.userA = created.id;
    userIds.push(created.id);
    await adminInsert('organization_members', {
      org_id: ids.orgA,
      user_id: ids.userA,
      role: 'principal',
      status: 'active',
      joined_at: new Date().toISOString(),
    });
    // (Joining as principal auto-grants access to the org's existing properties.)
    tokenA = await signIn(email);
    mockAuthorizationHeader = `Bearer ${tokenA}`;

    [{ id: ids.unitA }] = await adminInsert('units', {
      org_id: ids.orgA,
      property_id: ids.propertyA,
      unit_label: 'Unit 1',
      status: 'occupied',
    });
    [{ id: ids.leaseA }] = await adminInsert('leases', {
      org_id: ids.orgA,
      unit_id: ids.unitA,
      start_date: '2026-10-01',
      rent_amount: 9500,
      status: 'draft',
      source: 'manual',
    });
    [{ id: ids.tenantA }] = await adminInsert('tenants', {
      org_id: ids.orgA,
      full_name: 'Synthetic Tenant',
    });
    await adminInsert('lease_tenants', {
      lease_id: ids.leaseA,
      tenant_id: ids.tenantA,
      is_primary: true,
    });

    // Organisation B's protected file: written as the server writes it, with B's own documents row
    // and a clean malware-scan record for it.
    foreignPath = `${ids.orgB}/${ids.propertyB}/confidential-${suffix}.pdf`;
    const upload = await realFetch(`${SUPABASE_URL}/storage/v1/object/documents/${foreignPath}`, {
      method: 'POST',
      headers: { ...service, 'Content-Type': 'application/pdf' },
      body: SECRET,
    });
    if (!upload.ok) throw new Error(`org B fixture upload failed: ${upload.status}`);
    objectPaths.push(foreignPath);
    unreferencedForeignPath = `${ids.orgB}/${ids.propertyB}/confidential-${suffix}-derivative.pdf`;
    const derivative = await realFetch(
      `${SUPABASE_URL}/storage/v1/object/documents/${unreferencedForeignPath}`,
      {
        method: 'POST',
        headers: { ...service, 'Content-Type': 'application/pdf' },
        body: SECRET,
      },
    );
    if (!derivative.ok)
      throw new Error(`org B derivative fixture upload failed: ${derivative.status}`);
    objectPaths.push(unreferencedForeignPath);
    [{ id: ids.documentB }] = await adminInsert('documents', {
      org_id: ids.orgB,
      property_id: ids.propertyB,
      category_id: ids.category,
      document_type: 'bill',
      storage_path: foreignPath,
      original_file_name: 'confidential.pdf',
      mime_type: 'application/pdf',
      file_size_bytes: SECRET.byteLength,
      checksum_sha256: createHash('sha256').update(SECRET).digest('hex'),
    });
    await adminInsert('upload_malware_scans', {
      bucket_id: 'documents',
      object_path: foreignPath,
      org_id: ids.orgB,
      sha256: createHash('sha256').update(SECRET).digest('hex'),
      scanner: 'test-fixture',
      source: 'upload',
    });
  }, 90_000);

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    mockAuthorizationHeader = `Bearer ${tokenA}`;
  });

  afterAll(async () => {
    mockAuthorizationHeader = null;
    for (const org of [ids.orgA, ids.orgB]) {
      const docs: { storage_path: string }[] = await adminSelect(
        `documents?org_id=eq.${org}&select=storage_path`,
      );
      const leaseDocs: { storage_path: string }[] = await adminSelect(
        `lease_documents?org_id=eq.${org}&select=storage_path`,
      );
      const templates: { storage_path: string }[] = await adminSelect(
        `lease_templates?org_id=eq.${org}&select=storage_path`,
      );
      objectPaths.push(
        ...docs.map((d) => d.storage_path),
        ...leaseDocs.map((d) => d.storage_path),
        ...templates.map((d) => d.storage_path),
      );
    }
    await realFetch(`${SUPABASE_URL}/storage/v1/object/documents`, {
      method: 'DELETE',
      headers: { ...service, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefixes: [...new Set(objectPaths)] }),
    });
    for (const org of [ids.orgA, ids.orgB]) {
      await adminDelete(`extraction_results?org_id=eq.${org}`);
      await adminDelete(`extraction_jobs?org_id=eq.${org}`);
      await adminDelete(`property_photos?property_id=in.(${ids.propertyA},${ids.propertyB})`);
      await adminDelete(`lease_preparations?org_id=eq.${org}`);
      await adminDelete(`lease_documents?org_id=eq.${org}`);
      await adminDelete(`lease_templates?org_id=eq.${org}`);
      await adminDelete(`application_document_requirements?org_id=eq.${org}`);
      await adminDelete(`application_access_tokens?org_id=eq.${org}`);
      await adminDelete(`applications?org_id=eq.${org}`);
      await adminDelete(`documents?org_id=eq.${org}`);
      await adminDelete(`upload_malware_scans?org_id=eq.${org}`);
      await adminDelete(`lease_tenants?lease_id=eq.${ids.leaseA}`);
      await adminDelete(`leases?org_id=eq.${org}`);
      await adminDelete(`tenants?org_id=eq.${org}`);
      await adminDelete(`units?org_id=eq.${org}`);
      await adminDelete(`property_access?property_id=in.(${ids.propertyA},${ids.propertyB})`);
      await adminDelete(`properties?org_id=eq.${org}`);
      await adminDelete(`organization_members?org_id=eq.${org}`);
      await adminDelete(`organizations?id=eq.${org}`);
    }
    for (const id of userIds) {
      await realFetch(`${SUPABASE_URL}/auth/v1/admin/users/${id}`, {
        method: 'DELETE',
        headers: service,
      });
    }
  }, 90_000);

  const documentRow = (path: string) => ({
    org_id: ids.orgA,
    property_id: ids.propertyA,
    category_id: ids.category,
    document_type: 'bill',
    storage_path: path,
    original_file_name: 'forged.pdf',
    mime_type: 'application/pdf',
    file_size_bytes: 10,
    checksum_sha256: 'f'.repeat(64),
  });

  it("THE EXPLOIT: org A cannot forge a reference to org B's file, and B's bytes are unreachable at every step", async () => {
    // Step 6 -- forge a reference in A naming B's object exactly.
    const forged = await userRest(
      tokenA,
      'POST',
      'documents',
      documentRow(unreferencedForeignPath),
    );
    const forgedId = forged.ok ? (forged.json as unknown as { id: string }[])[0]!.id : null;

    // Step 7 -- normal Proplyst retrieval: B's own document, and the forged row if a regression let it in.
    const leakedByApi: string[] = [];
    for (const id of [ids.documentB!, ...(forgedId ? [forgedId] : [])]) {
      const read = await getDocument(new NextRequest(`http://localhost/api/v1/documents/${id}`), {
        params: Promise.resolve({ id }),
      });
      const body = (await read.json()) as { signedUrl?: string };
      expect.soft(read.status, `GET /api/v1/documents/${id} as org A`).not.toBe(200);
      if (body.signedUrl) {
        const fetched = await realFetch(body.signedUrl);
        if (fetched.ok && Buffer.from(await fetched.arrayBuffer()).equals(Buffer.from(SECRET))) {
          leakedByApi.push(id);
        }
      }
    }
    expect.soft(leakedByApi, "org B's bytes returned through the Proplyst API").toEqual([]);

    // Step 8 -- signed URL straight from the Storage API with A's own session.
    for (const path of [foreignPath, unreferencedForeignPath]) {
      const sign = await realFetch(`${SUPABASE_URL}/storage/v1/object/sign/documents/${path}`, {
        method: 'POST',
        headers: asUser(tokenA, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ expiresIn: 60 }),
      });
      expect.soft(sign.ok, `Storage API signed URL for org B's ${path} as org A`).toBe(false);
    }

    // Step 9 -- byte download straight from the Storage API with A's own session.
    for (const path of [foreignPath, unreferencedForeignPath]) {
      const download = await realFetch(
        `${SUPABASE_URL}/storage/v1/object/authenticated/documents/${path}`,
        {
          headers: asUser(tokenA),
        },
      );
      const bytes = download.ok ? Buffer.from(await download.arrayBuffer()) : Buffer.alloc(0);
      expect
        .soft(bytes.equals(Buffer.from(SECRET)), `org A downloaded org B's bytes from ${path}`)
        .toBe(false);
    }

    expect(forged.ok, 'the forged documents row was accepted').toBe(false);
    expect(forged.json.code).toBe('23514');
  });

  it("org A cannot UPDATE its own documents row to point at org B's file", async () => {
    const ownPath = `${ids.orgA}/${ids.propertyA}/own-${suffix}.pdf`;
    const created = await userRest(tokenA, 'POST', 'documents', documentRow(ownPath));
    expect(created.ok).toBe(true);
    const id = (created.json as unknown as { id: string }[])[0]!.id;

    const updated = await userRest(tokenA, 'PATCH', `documents?id=eq.${id}`, {
      storage_path: foreignPath + '.upd',
    });
    expect(updated.ok).toBe(false);
    expect(updated.json.code).toBe('23514');
    const [row] = await adminSelect(`documents?id=eq.${id}&select=storage_path`);
    expect(row.storage_path).toBe(ownPath);
  });

  it.each([
    ['an id-prefix boundary trick', (a: string) => `${a}evil/x/forged.pdf`],
    ['a traversal through its own folder', (a: string, b: string) => `${a}/../${b}/x/forged.pdf`],
    ['a leading traversal', (a: string) => `../${a}/forged.pdf`],
    ['an empty segment', (a: string) => `${a}//forged.pdf`],
    ['a percent-encoded traversal', (a: string, b: string) => `${a}/%2e%2e/${b}/forged.pdf`],
    ['no organisation folder', () => 'forged.pdf'],
  ])('a documents row with %s is rejected', async (_label, make) => {
    const res = await userRest(
      tokenA,
      'POST',
      'documents',
      documentRow(make(ids.orgA!, ids.orgB!)),
    );
    expect(res.ok).toBe(false);
    expect(res.json.code).toBe('23514');
  });

  it('forged lease_documents and lease_templates references are rejected', async () => {
    const leaseDoc = await userRest(tokenA, 'POST', 'lease_documents', {
      lease_id: ids.leaseA,
      org_id: ids.orgA,
      kind: 'uploaded',
      status: 'draft',
      version: 99,
      storage_path: foreignPath,
      original_file_name: 'forged.pdf',
      mime_type: 'application/pdf',
      file_size_bytes: 10,
    });
    expect(leaseDoc.ok).toBe(false);
    expect(leaseDoc.json.code).toBe('23514');

    const template = await userRest(tokenA, 'POST', 'lease_templates', {
      org_id: ids.orgA,
      name: 'Forged template',
      storage_path: `${ids.orgB}/lease-templates/forged.docx`,
      original_file_name: 'forged.docx',
      mime_type: DOCX_MIME,
      file_size_bytes: 10,
      created_by: ids.userA,
    });
    expect(template.ok).toBe(false);
    expect(template.json.code).toBe('23514');
  });

  it('a forged property_photos derivative path is rejected, on insert and on update', async () => {
    const ownPath = `${ids.orgA}/${ids.propertyA}/photo-${suffix}.png`;
    const doc = await userRest(tokenA, 'POST', 'documents', {
      ...documentRow(ownPath),
      document_type: 'other',
    });
    expect(doc.ok).toBe(true);
    const documentId = (doc.json as unknown as { id: string }[])[0]!.id;

    const forged = await userRest(tokenA, 'POST', 'property_photos', {
      property_id: ids.propertyA,
      document_id: documentId,
      hero_storage_path: foreignPath,
    });
    expect(forged.ok).toBe(false);
    expect(forged.json.code).toBe('23514');

    const legit = await userRest(tokenA, 'POST', 'property_photos', {
      property_id: ids.propertyA,
      document_id: documentId,
      card_storage_path: `${ids.orgA}/${ids.propertyA}/photo-${suffix}-card.webp`,
    });
    expect(legit.ok).toBe(true);
    const photoId = (legit.json as unknown as { id: string }[])[0]!.id;
    const updated = await userRest(tokenA, 'PATCH', `property_photos?id=eq.${photoId}`, {
      card_storage_path: foreignPath,
    });
    expect(updated.ok).toBe(false);
    expect(updated.json.code).toBe('23514');
  });

  it("the public applicant upload function cannot record a path in another organisation's folder", async () => {
    const [application] = await adminInsert('applications', {
      org_id: ids.orgA,
      property_id: ids.propertyA,
      unit_id: ids.unitA,
      applicant_name: 'Synthetic Applicant',
      status: 'invited',
    });
    await realFetch(`${SUPABASE_URL}/rest/v1/rpc/seed_default_application_document_requirements`, {
      method: 'POST',
      headers: asUser(tokenA, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ p_application_id: application.id }),
    });
    const tokenRes = await realFetch(
      `${SUPABASE_URL}/rest/v1/rpc/create_application_access_token`,
      {
        method: 'POST',
        headers: asUser(tokenA, {
          'Content-Type': 'application/json',
          Accept: 'application/vnd.pgrst.object+json',
        }),
        body: JSON.stringify({ p_application_id: application.id, p_delivery_channel: 'manual' }),
      },
    );
    const { token } = await tokenRes.json();
    expect(typeof token).toBe('string');

    const record = await realFetch(
      `${SUPABASE_URL}/rest/v1/rpc/record_application_document_upload`,
      {
        method: 'POST',
        headers: { apikey: ANON_KEY!, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          p_token: token,
          p_requirement_key: 'id_document',
          p_storage_path: foreignPath + '.applicant',
          p_original_file_name: 'forged.pdf',
          p_mime_type: 'application/pdf',
          p_file_size_bytes: 10,
          p_checksum_sha256: 'a'.repeat(64),
        }),
      },
    );
    const body = await record.json();
    expect(record.ok, JSON.stringify(body)).toBe(false);
    expect(body.code).toBe('23514');
    expect(
      await adminSelect(
        `documents?storage_path=eq.${encodeURIComponent(foreignPath + '.applicant')}&select=id`,
      ),
    ).toEqual([]);
  });

  it("cross-org OCR is blocked: org A cannot run extraction on org B's document, whose clean scan is on record", async () => {
    const extractSpy = vi.spyOn(MockDocumentIntelligenceProvider.prototype, 'extractFields');
    const response = await extractDocument(
      new NextRequest(`http://localhost/api/v1/documents/${ids.documentB}/extract`, {
        method: 'POST',
      }),
      { params: Promise.resolve({ id: ids.documentB! }) },
    );
    expect(response.status).toBe(404);
    expect(extractSpy).not.toHaveBeenCalled();
    expect(await adminSelect(`extraction_jobs?document_id=eq.${ids.documentB}&select=id`)).toEqual(
      [],
    );
  });

  // --- The legitimate same-organisation flows still work ------------------------------------------------

  it('same-org document: uploaded through the API, downloaded through the API, and cleared for verified-clean OCR', async () => {
    cloudmersiveClean();
    const bytes = pdf('own document');
    const form = new FormData();
    form.set('orgId', ids.orgA!);
    form.set('propertyId', ids.propertyA!);
    form.set('categoryId', ids.category!);
    form.set('documentType', 'bill');
    form.set('file', new File([bytes], 'own-bill.pdf', { type: 'application/pdf' }));
    const uploaded = await uploadDocument(
      new NextRequest('http://localhost/api/v1/documents', { method: 'POST', body: form }),
    );
    expect(uploaded.status).toBe(201);
    const { document } = await uploaded.json();

    const read = await getDocument(
      new NextRequest(`http://localhost/api/v1/documents/${document.id}`),
      {
        params: Promise.resolve({ id: document.id }),
      },
    );
    expect(read.status).toBe(200);
    const { signedUrl } = await read.json();
    expect(
      Buffer.from(await (await realFetch(signedUrl)).arrayBuffer()).equals(Buffer.from(bytes)),
    ).toBe(true);

    const extracted = await extractDocument(
      new NextRequest(`http://localhost/api/v1/documents/${document.id}/extract`, {
        method: 'POST',
      }),
      { params: Promise.resolve({ id: document.id }) },
    );
    expect(extracted.status).toBe(200);
  }, 30_000);

  it('same-org lease document: uploaded and downloaded through the API', async () => {
    cloudmersiveClean();
    const bytes = pdf('own signed lease');
    const form = new FormData();
    form.set('file', new File([bytes], 'signed-lease.pdf', { type: 'application/pdf' }));
    const uploaded = await uploadLeaseDocument(
      new NextRequest(`http://localhost/api/v1/leases/${ids.leaseA}/documents`, {
        method: 'POST',
        body: form,
      }),
      { params: Promise.resolve({ id: ids.leaseA! }) },
    );
    expect(uploaded.status).toBe(201);
    const { leaseDocument } = await uploaded.json();

    const download = await downloadLeaseDocument(new NextRequest('http://localhost/x'), {
      params: Promise.resolve({ id: ids.leaseA!, documentId: leaseDocument.id }),
    });
    expect(download.status).toBe(200);
    const { signedUrl } = await download.json();
    expect(
      Buffer.from(await (await realFetch(signedUrl)).arrayBuffer()).equals(Buffer.from(bytes)),
    ).toBe(true);
  }, 30_000);

  it('same-org lease template: uploaded, readable, and processed into a generated lease document', async () => {
    cloudmersiveClean();
    const form = new FormData();
    form.set('orgId', ids.orgA!);
    form.set('name', `Synthetic template ${suffix}`);
    form.set('isDefault', 'false');
    form.set('file', new File([leaseTemplateDocx()], 'template.docx', { type: DOCX_MIME }));
    const uploaded = await uploadLeaseTemplate(
      new NextRequest('http://localhost/api/v1/lease-templates', { method: 'POST', body: form }),
    );
    expect(uploaded.status).toBe(201);
    const { leaseTemplate } = await uploaded.json();

    const read = await getLeaseTemplate(new NextRequest('http://localhost/x'), {
      params: Promise.resolve({ id: leaseTemplate.id }),
    });
    expect(read.status).toBe(200);
    expect((await read.json()).signedUrl).toContain(`${ids.orgA}/lease-templates/`);

    const generated = await generateLeaseDocument(
      new NextRequest(`http://localhost/api/v1/leases/${ids.leaseA}/documents/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ templateId: leaseTemplate.id }),
      }),
      { params: Promise.resolve({ id: ids.leaseA! }) },
    );
    const body = await generated.json();
    expect(generated.status, JSON.stringify(body)).toBe(201);
    expect(body.leaseDocument.storagePath.startsWith(`${ids.orgA}/`)).toBe(true);
  }, 30_000);
});
