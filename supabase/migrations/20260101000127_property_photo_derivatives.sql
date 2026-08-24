-- Property cover-photo + image-quality audit (WORKLOG.md this date): the property list/card
-- (properties/page.tsx -> loadPropertyCards()) never queried property_photos at all -- it read
-- properties.image_path directly, a column with no writer anywhere in the app (already documented
-- by a comment in properties/[id]/page.tsx, which correctly uses property_photos/is_cover). That
-- app-layer fix needs no schema change on its own; this migration is for the SEPARATE finding from
-- the same audit -- there is no image-derivative pipeline anywhere (the raw uploaded original is
-- stored and served unmodified at every display size, hero and card alike), which is the real
-- cause of the reported softness for a genuinely small (520x280px) real upload. Adds storage for
-- resized derivatives on the EXISTING property_photos link row -- not a new cover-photo authority,
-- not a new table; a photo's derivatives are exactly as scoped as the photo itself already is.

alter table public.property_photos
  add column hero_storage_path text,
  add column card_storage_path text,
  add column width integer,
  add column height integer;

comment on column public.property_photos.hero_storage_path is
  'Storage path (same private "documents" bucket, same RLS as the original) of a resized WebP
   derivative for large display (property detail hero, ~1600-2000px max width, never upscaled
   beyond the original). Null for a photo uploaded before this migration, or if derivative
   generation failed -- readers must fall back to the original document''s storage_path.';

comment on column public.property_photos.card_storage_path is
  'Same shape as hero_storage_path, for small display (property list card / thumbnail grids,
   ~700-1000px max width).';

comment on column public.property_photos.width is
  'The ORIGINAL upload''s pixel width, captured at upload time -- used to decide whether a
   derivative would upscale (skipped, never enlarged beyond this) and to size <img>/<Image>
   attributes correctly. Null for a photo uploaded before this migration.';

comment on column public.property_photos.height is
  'Same shape as width, for the original''s pixel height.';

-- Found live while implementing derivative generation: the 'documents' bucket's own
-- allowed_mime_types allowlist (set 20260101000015) never included image/webp, even though
-- apps/admin/app/api/v1/properties/[id]/photos/route.ts's ALLOWED_PHOTO_MIME_TYPES already lists
-- 'image/webp' as an accepted ORIGINAL upload type -- a pre-existing gap where a user uploading a
-- native .webp photo would already have hit a silent storage-level rejection, unrelated to this
-- migration. New WebP hero/card derivatives hit the exact same restriction. Both are fixed by the
-- same one-line allowlist addition.
update storage.buckets
set allowed_mime_types = array_append(allowed_mime_types, 'image/webp')
where id = 'documents'
  and not ('image/webp' = any(allowed_mime_types));
