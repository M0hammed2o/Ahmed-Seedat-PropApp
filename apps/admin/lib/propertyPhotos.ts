import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import sharp from 'sharp';

// Property cover-photo + image-quality audit (WORKLOG.md this date): the authoritative
// cover-photo rule, in one place, used by BOTH the property detail hero and the /properties list
// card (previously only the detail page implemented this at all -- the list card read
// properties.image_path, a column with no writer anywhere in the app). Rule: (1) the explicitly
// marked cover photo, (2) otherwise the first-uploaded valid photo, (3) otherwise the generic
// placeholder -- expressed as a single `order by is_cover desc, created_at asc limit 1` so there
// is exactly one query, never two competing cover authorities.

const SIGNED_URL_TTL_SECONDS = 300;
const HERO_MAX_WIDTH = 1800;
const HERO_WEBP_QUALITY = 82;
const CARD_MAX_WIDTH = 850;
const CARD_WEBP_QUALITY = 78;

export interface CoverPhotoRow {
  photoId: string;
  originalStoragePath: string;
  heroStoragePath: string | null;
  cardStoragePath: string | null;
  width: number | null;
  height: number | null;
}

/**
 * The single query every reader (detail hero, list card) must use to resolve "the" cover photo
 * for one property. `supabase` must be the CALLER's own session-bound client (never service-role)
 * -- property_photos_select_staff_or_owner (migration 20260101000080) is what actually authorizes
 * this read; a service-role client would silently bypass it.
 */
export async function resolveCoverPhotoRow(
  supabase: SupabaseClient,
  propertyId: string,
): Promise<CoverPhotoRow | null> {
  const { data } = await supabase
    .from('property_photos')
    .select('id, hero_storage_path, card_storage_path, width, height, documents(storage_path)')
    .eq('property_id', propertyId)
    .order('is_cover', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const row = data as unknown as {
    id: string;
    hero_storage_path: string | null;
    card_storage_path: string | null;
    width: number | null;
    height: number | null;
    documents: { storage_path: string } | null;
  };
  if (!row.documents) return null;
  return {
    photoId: row.id,
    originalStoragePath: row.documents.storage_path,
    heroStoragePath: row.hero_storage_path,
    cardStoragePath: row.card_storage_path,
    width: row.width,
    height: row.height,
  };
}

/**
 * Batch form of resolveCoverPhotoRow() for a list of properties in one round trip (the
 * /properties grid) -- same authorization posture (caller's own session client), same fallback
 * rule, applied per property_id via a single IN() query instead of N+1.
 */
export async function resolveCoverPhotoRowsByProperty(
  supabase: SupabaseClient,
  propertyIds: string[],
): Promise<Map<string, CoverPhotoRow>> {
  const result = new Map<string, CoverPhotoRow>();
  if (propertyIds.length === 0) return result;

  const { data } = await supabase
    .from('property_photos')
    .select(
      'id, property_id, is_cover, created_at, hero_storage_path, card_storage_path, width, height, documents(storage_path)',
    )
    .in('property_id', propertyIds)
    .order('is_cover', { ascending: false })
    .order('created_at', { ascending: true });

  const rows = (data ?? []) as unknown as {
    id: string;
    property_id: string;
    hero_storage_path: string | null;
    card_storage_path: string | null;
    width: number | null;
    height: number | null;
    documents: { storage_path: string } | null;
  }[];

  // Rows already arrive ordered cover-first-then-oldest per the query above; the first row seen
  // for a given property_id is therefore always the correct one under the 3-tier rule.
  for (const row of rows) {
    if (result.has(row.property_id) || !row.documents) continue;
    result.set(row.property_id, {
      photoId: row.id,
      originalStoragePath: row.documents.storage_path,
      heroStoragePath: row.hero_storage_path,
      cardStoragePath: row.card_storage_path,
      width: row.width,
      height: row.height,
    });
  }
  return result;
}

/** Signs whichever derivative path is available, falling back to the original -- a photo
 * uploaded before this feature existed (or one whose derivative generation failed) still renders,
 * just at its original resolution/format instead of the resized WebP. */
export async function signCoverPhotoUrl(
  supabase: SupabaseClient,
  row: CoverPhotoRow,
  size: 'hero' | 'card',
): Promise<string | null> {
  const path = (size === 'hero' ? row.heroStoragePath : row.cardStoragePath) ?? row.originalStoragePath;
  const { data } = await supabase.storage.from('documents').createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  return data?.signedUrl ?? null;
}

export interface PhotoDerivatives {
  width: number;
  height: number;
  hero: { buffer: Buffer; contentType: 'image/webp' } | null;
  card: { buffer: Buffer; contentType: 'image/webp' } | null;
}

/**
 * Resizes the uploaded original into a hero (~1800px) and card (~850px) WebP derivative, never
 * upscaling past the original's own dimensions (sharp's `withoutEnlargement` -- a request for a
 * wider derivative than the source just returns the source's own width unchanged). Best-effort:
 * some accepted formats (notably HEIC -- the installed sharp/libvips build here has no HEIC
 * decoder, only HEIF/AVIF encode) cannot be processed at all; in that case this returns width/
 * height as null and both derivatives as null rather than throwing, and the caller falls back to
 * serving the original file unmodified -- exactly the pre-fix behavior for that one format, never
 * a blocked upload.
 */
export async function generatePhotoDerivatives(
  buffer: Buffer,
): Promise<PhotoDerivatives | { width: null; height: null; hero: null; card: null }> {
  try {
    const image = sharp(buffer, { failOn: 'none' });
    const metadata = await image.metadata();
    if (!metadata.width || !metadata.height) {
      return { width: null, height: null, hero: null, card: null };
    }

    const [hero, card] = await Promise.all([
      sharp(buffer, { failOn: 'none' })
        .rotate() // apply EXIF orientation before resizing, matching how the browser would render it
        .resize({ width: HERO_MAX_WIDTH, withoutEnlargement: true })
        .webp({ quality: HERO_WEBP_QUALITY })
        .toBuffer(),
      sharp(buffer, { failOn: 'none' })
        .rotate()
        .resize({ width: CARD_MAX_WIDTH, withoutEnlargement: true })
        .webp({ quality: CARD_WEBP_QUALITY })
        .toBuffer(),
    ]);

    return {
      width: metadata.width,
      height: metadata.height,
      hero: { buffer: hero, contentType: 'image/webp' },
      card: { buffer: card, contentType: 'image/webp' },
    };
  } catch {
    // Unsupported/undecodable input (e.g. HEIC on this build) -- soft-fail, never block the
    // primary upload over a derivative-generation problem (same posture as this codebase's
    // existing best-effort geocoding-after-property-create).
    return { width: null, height: null, hero: null, card: null };
  }
}

export function derivativeStoragePath(originalStoragePath: string, size: 'hero' | 'card'): string {
  const dot = originalStoragePath.lastIndexOf('.');
  const withoutExt = dot === -1 ? originalStoragePath : originalStoragePath.slice(0, dot);
  return `${withoutExt}-${size}.webp`;
}
