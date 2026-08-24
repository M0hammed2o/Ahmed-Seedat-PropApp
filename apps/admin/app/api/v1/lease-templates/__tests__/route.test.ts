import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import PizZip from 'pizzip';

// Lease-template DOCX audit (WORKLOG.md 2026-08-25): real integration test against local
// Supabase, same pattern as other route tests this session. Proves the DOCX bucket-MIME fix
// (migration 20260101000129) and the real content-verification layer (lib/leaseTemplateValidation.ts)
// both work end to end through the actual deployed route.

let mockAuthorizationHeader: string | null = null;
const mockCookieJar = new Map<string, string>();

vi.mock('next/headers', () => ({
  headers: async () => ({
    get: (name: string) => (name.toLowerCase() === 'authorization' ? mockAuthorizationHeader : null),
  }),
  cookies: async () => ({
    get: (name: string) => (mockCookieJar.has(name) ? { value: mockCookieJar.get(name) } : undefined),
    set: (name: string, value: string) => {
      mockCookieJar.set(name, value);
    },
    getAll: () => [],
  }),
}));

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
process.env.SUPABASE_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const { POST } = await import('../route');

const SUPABASE_URL = 'http://127.0.0.1:54321';
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

let supabaseReachable = false;
try {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/health`);
  supabaseReachable = res.ok;
} catch {
  supabaseReachable = false;
}
const describeIfSupabase = supabaseReachable ? describe : describe.skip;

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function realDocxBuffer(): Buffer {
  const zip = new PizZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="x"></Types>');
  zip.file('word/document.xml', '<?xml version="1.0"?><w:document xmlns:w="x"><w:body/></w:document>');
  return zip.generate({ type: 'nodebuffer' });
}

function docmLikeBuffer(): Buffer {
  const zip = new PizZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="x"></Types>');
  zip.file('word/document.xml', '<?xml version="1.0"?><w:document xmlns:w="x"><w:body/></w:document>');
  zip.file('word/vbaProject.bin', Buffer.from([0x01, 0x02, 0x03]));
  return zip.generate({ type: 'nodebuffer' });
}

async function adminFetch(path: string, body: unknown, method = 'POST') {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method,
    headers: {
      apikey: SERVICE_ROLE_KEY!,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(body),
  });
  return res.json();
}

function uploadRequest(fields: Record<string, string>, file: File): NextRequest {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  form.set('file', file);
  return new NextRequest('http://localhost/api/v1/lease-templates', { method: 'POST', body: form });
}

describeIfSupabase('POST /api/v1/lease-templates (real local Supabase integration)', () => {
  const serviceClient: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let orgId: string;
  let managerId: string;

  beforeEach(async () => {
    mockCookieJar.clear();
    const email = `lt-manager-${Date.now()}@propertyvault.example`;
    const password = 'TestPassw0rd!23';
    const created = await adminFetch('/auth/v1/admin/users', { email, password, email_confirm: true });
    managerId = created.id;

    const tokenRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: ANON_KEY!, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const tokenBody = await tokenRes.json();
    mockAuthorizationHeader = `Bearer ${tokenBody.access_token}`;

    const orgRows = await adminFetch('/rest/v1/organizations', {
      legal_name: `Lease Template Vitest Org ${Date.now()}`,
      org_type: 'agency',
    });
    orgId = orgRows[0].id;
    await adminFetch('/rest/v1/organization_members', {
      org_id: orgId,
      user_id: managerId,
      role: 'manager',
      status: 'active',
      joined_at: new Date().toISOString(),
    });
  });

  afterEach(async () => {
    mockAuthorizationHeader = null;
    await serviceClient.from('lease_templates').delete().eq('org_id', orgId);
    await serviceClient.from('organizations').delete().eq('id', orgId);
    await serviceClient.auth.admin.deleteUser(managerId);
  });

  it('a real DOCX upload succeeds', async () => {
    const file = new File([Uint8Array.from(realDocxBuffer())], 'template.docx', { type: DOCX_MIME });
    const response = await POST(uploadRequest({ orgId, name: 'Default Residential' }, file));
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.leaseTemplate.mimeType).toBe(DOCX_MIME);
  });

  it('PDF upload still works (no regression from the DOCX fix)', async () => {
    const pdfBytes = Uint8Array.from(Buffer.from('%PDF-1.4\n%mock pdf content\n%%EOF'));
    const file = new File([pdfBytes], 'template.pdf', { type: 'application/pdf' });
    const response = await POST(uploadRequest({ orgId, name: 'PDF Template' }, file));
    expect(response.status).toBe(201);
  });

  it('a DOCM-like file (real vbaProject.bin, claiming the DOCX MIME type) is rejected', async () => {
    const file = new File([Uint8Array.from(docmLikeBuffer())], 'sneaky.docx', { type: DOCX_MIME });
    const response = await POST(uploadRequest({ orgId, name: 'Sneaky' }, file));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe('invalid_docx_content');
  });

  it('a non-zip file claiming the DOCX MIME type is rejected', async () => {
    const file = new File([Uint8Array.from(Buffer.from('not actually a zip file at all'))], 'fake.docx', {
      type: DOCX_MIME,
    });
    const response = await POST(uploadRequest({ orgId, name: 'Fake' }, file));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe('invalid_docx_content');
  });

  it('an unsupported MIME type (e.g. a raw zip) is rejected before even reaching content validation', async () => {
    const file = new File([Uint8Array.from(Buffer.from('PK zip stub'))], 'archive.zip', {
      type: 'application/zip',
    });
    const response = await POST(uploadRequest({ orgId, name: 'Zip' }, file));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe('unsupported_mime_type');
  });

  it('setting isDefault persists and clears any prior default', async () => {
    const file1 = new File([Uint8Array.from(realDocxBuffer())], 'first.docx', { type: DOCX_MIME });
    const first = await POST(uploadRequest({ orgId, name: 'First', isDefault: 'true' }, file1));
    const firstBody = await first.json();
    expect(firstBody.leaseTemplate.isDefault).toBe(true);

    const file2 = new File([Uint8Array.from(realDocxBuffer())], 'second.docx', { type: DOCX_MIME });
    const second = await POST(uploadRequest({ orgId, name: 'Second', isDefault: 'true' }, file2));
    const secondBody = await second.json();
    expect(secondBody.leaseTemplate.isDefault).toBe(true);

    const { data: firstRow } = await serviceClient
      .from('lease_templates')
      .select('is_default')
      .eq('id', firstBody.leaseTemplate.id)
      .single();
    expect(firstRow!.is_default).toBe(false);
  });

  it('replacing a template (supersedesId) archives the old one, never deletes it', async () => {
    const file1 = new File([Uint8Array.from(realDocxBuffer())], 'v1.docx', { type: DOCX_MIME });
    const v1 = await POST(uploadRequest({ orgId, name: 'Versioned' }, file1));
    const v1Body = await v1.json();

    const file2 = new File([Uint8Array.from(realDocxBuffer())], 'v2.docx', { type: DOCX_MIME });
    const v2 = await POST(
      uploadRequest({ orgId, name: 'Versioned', supersedesId: v1Body.leaseTemplate.id }, file2),
    );
    expect(v2.status).toBe(201);
    const v2Body = await v2.json();
    expect(v2Body.leaseTemplate.supersedesId ?? v2Body.leaseTemplate.supersedes_id).toBe(v1Body.leaseTemplate.id);

    const { data: v1Row } = await serviceClient
      .from('lease_templates')
      .select('status')
      .eq('id', v1Body.leaseTemplate.id)
      .single();
    expect(v1Row!.status).toBe('archived');
  });
});
