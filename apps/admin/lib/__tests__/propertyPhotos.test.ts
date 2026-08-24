import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import {
  generatePhotoDerivatives,
  resolveCoverPhotoRow,
  resolveCoverPhotoRowsByProperty,
} from '../propertyPhotos';

// Property cover-photo + image-quality audit (WORKLOG.md this date): unit-level coverage for the
// shared resolver both the property detail hero AND the /properties list card now use (the root
// cause of the reported bug was the list card never calling anything like this at all). Real
// integration test against local Supabase, same pattern as this codebase's other lib/__tests__.

const SUPABASE_URL = 'http://127.0.0.1:54321';
const SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

let supabaseReachable = false;
try {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/health`);
  supabaseReachable = res.ok;
} catch {
  supabaseReachable = false;
}
const describeIfSupabase = supabaseReachable ? describe : describe.skip;

describeIfSupabase('propertyPhotos (real local Supabase integration)', () => {
  const serviceClient: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let orgId: string;
  let propertyId: string;
  let categoryId: string;

  beforeEach(async () => {
    const { data: org, error: orgError } = await serviceClient
      .from('organizations')
      .insert({ legal_name: `Property Photos Lib Vitest Org ${Date.now()}`, org_type: 'agency' })
      .select('id')
      .single();
    if (orgError) throw orgError;
    orgId = org.id;

    const { data: property, error: propertyError } = await serviceClient
      .from('properties')
      .insert({
        org_id: orgId,
        nickname: 'Lib Test Property',
        address_line1: '1 Test St',
        city: 'Cape Town',
        country: 'ZA',
        property_type: 'house',
      })
      .select('id')
      .single();
    if (propertyError) throw propertyError;
    propertyId = property.id;

    const { data: category } = await serviceClient
      .from('document_categories')
      .select('id')
      .eq('slug', 'property_photos')
      .single();
    categoryId = category!.id;
  });

  afterEach(async () => {
    await serviceClient.from('documents').delete().eq('org_id', orgId);
    await serviceClient.from('properties').delete().eq('org_id', orgId);
    await serviceClient.from('organizations').delete().eq('id', orgId);
  });

  async function insertPhoto(opts: { isCover: boolean; createdAt: string }) {
    const { data: doc } = await serviceClient
      .from('documents')
      .insert({
        org_id: orgId,
        property_id: propertyId,
        category_id: categoryId,
        document_type: 'other',
        storage_path: `${orgId}/${propertyId}/${crypto.randomUUID()}.png`,
        original_file_name: 'photo.png',
        mime_type: 'image/png',
        file_size_bytes: 100,
        checksum_sha256: crypto.randomUUID(),
      })
      .select('id')
      .single();
    const { data: photo } = await serviceClient
      .from('property_photos')
      .insert({
        property_id: propertyId,
        document_id: doc!.id,
        is_cover: opts.isCover,
        created_at: opts.createdAt,
      })
      .select('id')
      .single();
    return photo!.id;
  }

  // Test A: no property image -> the resolver returns null (readers fall back to the generic
  // placeholder), not an error or a fabricated fallback.
  it('resolveCoverPhotoRow returns null for a property with zero photos', async () => {
    const row = await resolveCoverPhotoRow(serviceClient, propertyId);
    expect(row).toBeNull();
  });

  it('resolveCoverPhotoRowsByProperty returns an empty map for properties with zero photos, never a placeholder entry', async () => {
    const rows = await resolveCoverPhotoRowsByProperty(serviceClient, [propertyId]);
    expect(rows.size).toBe(0);
  });

  it('resolveCoverPhotoRow prefers the explicitly marked cover over an older, non-cover photo', async () => {
    const olderId = await insertPhoto({ isCover: false, createdAt: '2026-01-01T00:00:00Z' });
    const coverId = await insertPhoto({ isCover: true, createdAt: '2026-01-02T00:00:00Z' });

    const row = await resolveCoverPhotoRow(serviceClient, propertyId);
    expect(row!.photoId).toBe(coverId);
    expect(row!.photoId).not.toBe(olderId);
  });

  it('resolveCoverPhotoRow falls back to the first-uploaded photo when none is explicitly marked cover (defensive tier 2, matches the documented 3-tier rule)', async () => {
    const firstId = await insertPhoto({ isCover: false, createdAt: '2026-01-01T00:00:00Z' });
    await insertPhoto({ isCover: false, createdAt: '2026-01-02T00:00:00Z' });

    const row = await resolveCoverPhotoRow(serviceClient, propertyId);
    expect(row!.photoId).toBe(firstId);
  });

  it('resolveCoverPhotoRowsByProperty resolves the correct cover independently per property, in one batched query', async () => {
    const { data: property2 } = await serviceClient
      .from('properties')
      .insert({
        org_id: orgId,
        nickname: 'Lib Test Property 2',
        address_line1: '2 Test St',
        city: 'Cape Town',
        country: 'ZA',
        property_type: 'house',
      })
      .select('id')
      .single();
    const property2Id = property2!.id;

    const cover1 = await insertPhoto({ isCover: true, createdAt: '2026-01-01T00:00:00Z' });
    const { data: doc2 } = await serviceClient
      .from('documents')
      .insert({
        org_id: orgId,
        property_id: property2Id,
        category_id: categoryId,
        document_type: 'other',
        storage_path: `${orgId}/${property2Id}/${crypto.randomUUID()}.png`,
        original_file_name: 'photo2.png',
        mime_type: 'image/png',
        file_size_bytes: 100,
        checksum_sha256: crypto.randomUUID(),
      })
      .select('id')
      .single();
    const { data: photo2 } = await serviceClient
      .from('property_photos')
      .insert({ property_id: property2Id, document_id: doc2!.id, is_cover: true })
      .select('id')
      .single();

    const rows = await resolveCoverPhotoRowsByProperty(serviceClient, [propertyId, property2Id]);
    expect(rows.get(propertyId)!.photoId).toBe(cover1);
    expect(rows.get(property2Id)!.photoId).toBe(photo2!.id);

    await serviceClient.from('properties').delete().eq('id', property2Id);
  });

  it('generatePhotoDerivatives never upscales past the original dimensions', async () => {
    const small = await sharp({
      create: { width: 100, height: 60, channels: 3, background: { r: 10, g: 20, b: 30 } },
    })
      .png()
      .toBuffer();

    const result = await generatePhotoDerivatives(small);
    expect(result.width).toBe(100);
    expect(result.height).toBe(60);
    expect(result.hero).not.toBeNull();
    expect(result.card).not.toBeNull();

    const heroMeta = await sharp(result.hero!.buffer).metadata();
    const cardMeta = await sharp(result.card!.buffer).metadata();
    // Both requested target widths (1800, 850) are far larger than the 100px source -- neither
    // derivative may exceed the source's own width.
    expect(heroMeta.width).toBeLessThanOrEqual(100);
    expect(cardMeta.width).toBeLessThanOrEqual(100);
  });

  it('generatePhotoDerivatives downscales a large source to the hero/card targets, not just re-encodes it at full size', async () => {
    const large = await sharp({
      create: { width: 3000, height: 2000, channels: 3, background: { r: 200, g: 200, b: 200 } },
    })
      .jpeg()
      .toBuffer();

    const result = await generatePhotoDerivatives(large);
    expect(result.width).toBe(3000);
    expect(result.height).toBe(2000);
    const heroMeta = await sharp(result.hero!.buffer).metadata();
    const cardMeta = await sharp(result.card!.buffer).metadata();
    expect(heroMeta.width).toBe(1800);
    expect(cardMeta.width).toBe(850);
    // Real bandwidth win: both derivatives together are far smaller than the original.
    expect(result.hero!.buffer.length + result.card!.buffer.length).toBeLessThan(large.length);
  });

  it('generatePhotoDerivatives soft-fails (null dims, null derivatives) for undecodable input, never throws', async () => {
    const garbage = Buffer.from('this is not an image');
    const result = await generatePhotoDerivatives(garbage);
    expect(result.width).toBeNull();
    expect(result.height).toBeNull();
    expect(result.hero).toBeNull();
    expect(result.card).toBeNull();
  });
});
