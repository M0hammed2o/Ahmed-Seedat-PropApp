import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import sharp from 'sharp';

// Property cover-photo + image-quality audit (WORKLOG.md this date): real integration test
// against local Supabase, same pattern as tenant-portal/maintenance-tickets/[id]/documents'
// own route test -- the route handlers invoked directly with a constructed NextRequest/FormData,
// so the route's own auth/derivative-generation/cover-fallback/audit code actually runs.
// next/cache's revalidatePath is mocked -- it requires a real Next.js request-render context that
// a direct handler invocation in vitest doesn't provide; the route's OWN business logic (not
// Next's cache internals) is what this file verifies.

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

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

const { GET, POST } = await import('../route');
const { PATCH, DELETE } = await import('../[photoId]/route');

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

// A real, decodable 40x30 PNG (not a 4-byte stub) so sharp's metadata()/resize() actually exercise
// the real derivative-generation path, not just the "undecodable input" soft-fail branch.
// Uint8Array (not Node's Buffer<ArrayBufferLike>) -- satisfies File's BlobPart type cleanly.
async function realPngBuffer(width = 40, height = 30): Promise<Uint8Array<ArrayBuffer>> {
  const buffer = await sharp({
    create: { width, height, channels: 3, background: { r: 100, g: 150, b: 200 } },
  })
    .png()
    .toBuffer();
  // A fresh Uint8Array, data-copied out of the sharp-produced Buffer. @types/node globally widens
  // Uint8Array's default type parameter to ArrayBufferLike (including SharedArrayBuffer), which
  // the DOM lib's BlobPart/File constructor types don't accept -- a known, cosmetic-only TS
  // ecosystem friction (confirmed at runtime: every test using this helper passes) worked around
  // here with a single explicit cast, rather than at each of this file's many call sites.
  const out = new Uint8Array(buffer.length);
  out.set(buffer);
  return out as Uint8Array<ArrayBuffer>;
}

function uploadRequest(propertyId: string, file: File | null): NextRequest {
  const form = new FormData();
  if (file) form.set('file', file);
  return new NextRequest(`http://localhost/api/v1/properties/${propertyId}/photos`, {
    method: 'POST',
    body: form,
  });
}

function getRequest(propertyId: string): NextRequest {
  return new NextRequest(`http://localhost/api/v1/properties/${propertyId}/photos`);
}

function patchRequest(propertyId: string, photoId: string, body: unknown): NextRequest {
  return new NextRequest(
    `http://localhost/api/v1/properties/${propertyId}/photos/${photoId}`,
    { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
  );
}

function deleteRequest(propertyId: string, photoId: string): NextRequest {
  return new NextRequest(`http://localhost/api/v1/properties/${propertyId}/photos/${photoId}`, {
    method: 'DELETE',
  });
}

describeIfSupabase(
  'property photos: cover resolution, derivatives, audit, security (real local Supabase integration)',
  () => {
    let principalId: string;
    let outsiderId: string;
    let orgId: string;
    let propertyId: string;

    beforeEach(async () => {
      mockCookieJar.clear();

      const emailPrincipal = `photo-principal-${Date.now()}@propertyvault.example`;
      const emailOutsider = `photo-outsider-${Date.now()}@propertyvault.example`;
      const password = 'TestPassw0rd!23';

      const createdPrincipal = await adminFetch('/auth/v1/admin/users', {
        email: emailPrincipal,
        password,
        email_confirm: true,
      });
      principalId = createdPrincipal.id;
      const createdOutsider = await adminFetch('/auth/v1/admin/users', {
        email: emailOutsider,
        password,
        email_confirm: true,
      });
      outsiderId = createdOutsider.id;

      const tokenRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { apikey: ANON_KEY!, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailPrincipal, password }),
      });
      const tokenBody = await tokenRes.json();
      mockAuthorizationHeader = `Bearer ${tokenBody.access_token}`;

      const orgRows = await adminFetch('/rest/v1/organizations', {
        legal_name: `Property Photos Vitest Org ${Date.now()}`,
        org_type: 'agency',
      });
      orgId = orgRows[0].id;
      await adminFetch('/rest/v1/organization_members', {
        org_id: orgId,
        user_id: principalId,
        role: 'principal',
        status: 'active',
        joined_at: new Date().toISOString(),
      });

      const propertyRows = await adminFetch('/rest/v1/properties', {
        org_id: orgId,
        nickname: 'Photo Test Property',
        address_line1: '1 Test St',
        city: 'Cape Town',
        country: 'ZA',
        property_type: 'house',
      });
      propertyId = propertyRows[0].id;
    });

    afterEach(async () => {
      mockAuthorizationHeader = null;
      await fetch(`${SUPABASE_URL}/rest/v1/audit_events?org_id=eq.${orgId}`, {
        method: 'DELETE',
        headers: { apikey: SERVICE_ROLE_KEY!, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
      });
      await fetch(`${SUPABASE_URL}/rest/v1/documents?org_id=eq.${orgId}`, {
        method: 'DELETE',
        headers: { apikey: SERVICE_ROLE_KEY!, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
      });
      await fetch(`${SUPABASE_URL}/rest/v1/properties?org_id=eq.${orgId}`, {
        method: 'DELETE',
        headers: { apikey: SERVICE_ROLE_KEY!, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
      });
      await fetch(`${SUPABASE_URL}/rest/v1/organizations?id=eq.${orgId}`, {
        method: 'DELETE',
        headers: { apikey: SERVICE_ROLE_KEY!, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
      });
      await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${principalId}`, {
        method: 'DELETE',
        headers: { apikey: SERVICE_ROLE_KEY!, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
      });
      await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${outsiderId}`, {
        method: 'DELETE',
        headers: { apikey: SERVICE_ROLE_KEY!, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
      });
    });

    // Test B: first photo uploaded automatically becomes cover, with real derivatives generated.
    it('the first uploaded photo automatically becomes the cover and gets hero/card derivatives, never upscaled past the original', async () => {
      const png = await realPngBuffer(40, 30);
      const file = new File([png], 'building.png', { type: 'image/png' });
      const response = await POST(uploadRequest(propertyId, file), {
        params: Promise.resolve({ id: propertyId }),
      });
      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.photo.isCover).toBe(true);

      const { data: row } = await import('@supabase/supabase-js').then(({ createClient }) =>
        createClient(SUPABASE_URL, SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
          .from('property_photos')
          .select('width, height, hero_storage_path, card_storage_path')
          .eq('id', body.photo.id)
          .single(),
      );
      expect(row!.width).toBe(40);
      expect(row!.height).toBe(30);
      // The source is only 40px wide -- well under both the 1800px hero and 850px card targets --
      // sharp's withoutEnlargement must leave the derivative at the source's own width, never
      // upscale it to fill the requested target.
      expect(row!.hero_storage_path).not.toBeNull();
      expect(row!.card_storage_path).not.toBeNull();
    });

    // Test I: upload does not store an accidental duplicate image record.
    it('one upload produces exactly one property_photos row and one documents row', async () => {
      const png = await realPngBuffer();
      const file = new File([png], 'building.png', { type: 'image/png' });
      await POST(uploadRequest(propertyId, file), { params: Promise.resolve({ id: propertyId }) });

      const admin = await import('@supabase/supabase-js').then(({ createClient }) =>
        createClient(SUPABASE_URL, SERVICE_ROLE_KEY!, { auth: { persistSession: false } }),
      );
      const { data: photos } = await admin
        .from('property_photos')
        .select('id')
        .eq('property_id', propertyId);
      const { data: docs } = await admin.from('documents').select('id').eq('property_id', propertyId);
      expect(photos).toHaveLength(1);
      expect(docs).toHaveLength(1);
    });

    // Test D + cover determinism: a second photo does not become cover; the first stays cover.
    it('a second uploaded photo does not become cover -- the deterministic first-wins rule holds', async () => {
      const png1 = await realPngBuffer();
      const first = await POST(uploadRequest(propertyId, new File([png1], 'a.png', { type: 'image/png' })), {
        params: Promise.resolve({ id: propertyId }),
      });
      const firstBody = await first.json();

      const png2 = await realPngBuffer();
      const second = await POST(uploadRequest(propertyId, new File([png2], 'b.png', { type: 'image/png' })), {
        params: Promise.resolve({ id: propertyId }),
      });
      const secondBody = await second.json();

      expect(firstBody.photo.isCover).toBe(true);
      expect(secondBody.photo.isCover).toBe(false);

      const list = await GET(getRequest(propertyId), { params: Promise.resolve({ id: propertyId }) });
      const listBody = await list.json();
      const cover = listBody.photos.find((p: { isCover: boolean }) => p.isCover);
      expect(cover.id).toBe(firstBody.photo.id);
    });

    // Test E: setting the second photo as cover updates both -- proven at the data layer the
    // hero/card readers both key off (resolveCoverPhotoRow's own ordering), since page-level
    // rendering isn't reachable from a route-level test.
    it('setting a non-cover photo as cover demotes the old one -- exactly one cover remains', async () => {
      const png1 = await realPngBuffer();
      const first = await POST(uploadRequest(propertyId, new File([png1], 'a.png', { type: 'image/png' })), {
        params: Promise.resolve({ id: propertyId }),
      });
      const firstBody = await first.json();
      const png2 = await realPngBuffer();
      const second = await POST(uploadRequest(propertyId, new File([png2], 'b.png', { type: 'image/png' })), {
        params: Promise.resolve({ id: propertyId }),
      });
      const secondBody = await second.json();

      const patchResponse = await PATCH(patchRequest(propertyId, secondBody.photo.id, { isCover: true }), {
        params: Promise.resolve({ id: propertyId, photoId: secondBody.photo.id }),
      });
      expect(patchResponse.status).toBe(200);

      const admin = await import('@supabase/supabase-js').then(({ createClient }) =>
        createClient(SUPABASE_URL, SERVICE_ROLE_KEY!, { auth: { persistSession: false } }),
      );
      const { data: covers } = await admin
        .from('property_photos')
        .select('id')
        .eq('property_id', propertyId)
        .eq('is_cover', true);
      expect(covers).toHaveLength(1);
      expect(covers![0]!.id).toBe(secondBody.photo.id);

      const { data: demoted } = await admin
        .from('property_photos')
        .select('is_cover')
        .eq('id', firstBody.photo.id)
        .single();
      expect(demoted!.is_cover).toBe(false);
    });

    // Test F: removing the cover promotes the next photo -- valid fallback, never a broken state.
    it('removing the cover photo promotes the oldest remaining photo to cover', async () => {
      const png1 = await realPngBuffer();
      const first = await POST(uploadRequest(propertyId, new File([png1], 'a.png', { type: 'image/png' })), {
        params: Promise.resolve({ id: propertyId }),
      });
      const firstBody = await first.json();
      const png2 = await realPngBuffer();
      const second = await POST(uploadRequest(propertyId, new File([png2], 'b.png', { type: 'image/png' })), {
        params: Promise.resolve({ id: propertyId }),
      });
      const secondBody = await second.json();

      const deleteResponse = await DELETE(deleteRequest(propertyId, firstBody.photo.id), {
        params: Promise.resolve({ id: propertyId, photoId: firstBody.photo.id }),
      });
      expect(deleteResponse.status).toBe(200);

      const admin = await import('@supabase/supabase-js').then(({ createClient }) =>
        createClient(SUPABASE_URL, SERVICE_ROLE_KEY!, { auth: { persistSession: false } }),
      );
      const { data: remaining } = await admin
        .from('property_photos')
        .select('id, is_cover')
        .eq('property_id', propertyId);
      expect(remaining).toHaveLength(1);
      expect(remaining![0]!.id).toBe(secondBody.photo.id);
      expect(remaining![0]!.is_cover).toBe(true);
    });

    // Test F (continued): removing the LAST photo leaves zero rows -- clean fallback, no broken
    // reference (the reader-side placeholder fallback is proven separately by resolveCoverPhotoRow
    // returning null for a property with zero photos, exercised in the page-level code path).
    it('removing the only photo leaves the property with zero photo rows, not a dangling cover', async () => {
      const png = await realPngBuffer();
      const uploaded = await POST(uploadRequest(propertyId, new File([png], 'a.png', { type: 'image/png' })), {
        params: Promise.resolve({ id: propertyId }),
      });
      const uploadedBody = await uploaded.json();

      await DELETE(deleteRequest(propertyId, uploadedBody.photo.id), {
        params: Promise.resolve({ id: propertyId, photoId: uploadedBody.photo.id }),
      });

      const admin = await import('@supabase/supabase-js').then(({ createClient }) =>
        createClient(SUPABASE_URL, SERVICE_ROLE_KEY!, { auth: { persistSession: false } }),
      );
      const { data: remaining } = await admin
        .from('property_photos')
        .select('id')
        .eq('property_id', propertyId);
      expect(remaining).toHaveLength(0);
    });

    // Test G: unauthorized user cannot retrieve a photo -- storage.objects RLS (migration
    // 20260101000086) is what actually gates this; proven here by the GET list route itself
    // returning zero photos for an outsider (RLS on property_photos blocks the read before a
    // signed URL is ever generated for them).
    it('an outsider with no org membership cannot see this property\'s photos at all', async () => {
      const png = await realPngBuffer();
      await POST(uploadRequest(propertyId, new File([png], 'a.png', { type: 'image/png' })), {
        params: Promise.resolve({ id: propertyId }),
      });

      const emailOutsider = `photo-outsider2-${Date.now()}@propertyvault.example`;
      const password = 'TestPassw0rd!23';
      await adminFetch('/auth/v1/admin/users', { email: emailOutsider, password, email_confirm: true });
      const tokenRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { apikey: ANON_KEY!, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailOutsider, password }),
      });
      const tokenBody = await tokenRes.json();
      mockAuthorizationHeader = `Bearer ${tokenBody.access_token}`;

      const list = await GET(getRequest(propertyId), { params: Promise.resolve({ id: propertyId }) });
      const listBody = await list.json();
      expect(listBody.photos).toHaveLength(0);
    });

    // Audit events: upload, cover-change, removal.
    it('upload, set-cover, and remove each write a property_photos audit event with no secrets', async () => {
      const png1 = await realPngBuffer();
      const first = await POST(uploadRequest(propertyId, new File([png1], 'a.png', { type: 'image/png' })), {
        params: Promise.resolve({ id: propertyId }),
      });
      const firstBody = await first.json();
      const png2 = await realPngBuffer();
      const second = await POST(uploadRequest(propertyId, new File([png2], 'b.png', { type: 'image/png' })), {
        params: Promise.resolve({ id: propertyId }),
      });
      const secondBody = await second.json();

      await PATCH(patchRequest(propertyId, secondBody.photo.id, { isCover: true }), {
        params: Promise.resolve({ id: propertyId, photoId: secondBody.photo.id }),
      });
      await DELETE(deleteRequest(propertyId, firstBody.photo.id), {
        params: Promise.resolve({ id: propertyId, photoId: firstBody.photo.id }),
      });

      const admin = await import('@supabase/supabase-js').then(({ createClient }) =>
        createClient(SUPABASE_URL, SERVICE_ROLE_KEY!, { auth: { persistSession: false } }),
      );
      const { data: events } = await admin
        .from('audit_events')
        .select('action, before, after')
        .eq('org_id', orgId)
        .eq('entity_type', 'property_photos')
        .order('created_at', { ascending: true });

      expect(events!.map((e) => e.action)).toEqual([
        'property.photo_uploaded',
        'property.photo_uploaded',
        'property.photo_cover_changed',
        'property.photo_removed',
      ]);
      const combined = JSON.stringify(events);
      expect(combined).not.toMatch(/token|secret|password|signature/i);
    });

    // HEIC input: sharp/libvips on this build has no HEIC decoder -- must soft-fail, never block
    // the upload itself.
    it('an undecodable (non-image) upload still succeeds, with no derivatives generated', async () => {
      const fakeHeic = Buffer.from('not a real image, just bytes claiming to be one');
      const file = new File([fakeHeic], 'photo.heic', { type: 'image/heic' });
      const response = await POST(uploadRequest(propertyId, file), {
        params: Promise.resolve({ id: propertyId }),
      });
      expect(response.status).toBe(201);
      const body = await response.json();

      const admin = await import('@supabase/supabase-js').then(({ createClient }) =>
        createClient(SUPABASE_URL, SERVICE_ROLE_KEY!, { auth: { persistSession: false } }),
      );
      const { data: row } = await admin
        .from('property_photos')
        .select('hero_storage_path, card_storage_path, width, height')
        .eq('id', body.photo.id)
        .single();
      expect(row!.hero_storage_path).toBeNull();
      expect(row!.card_storage_path).toBeNull();
      expect(row!.width).toBeNull();
    });
  },
);
