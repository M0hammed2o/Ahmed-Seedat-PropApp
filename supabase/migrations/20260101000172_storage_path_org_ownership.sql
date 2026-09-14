-- Protected Storage paths must belong to the organisation of the row that references them
-- (2026-09-14).
--
-- THE HOLE THIS CLOSES. The Storage SELECT policies grant read access to any object a visible row
-- names (documents / lease_documents / lease_templates / property_photos). Nothing tied a row's
-- storage path to the row's own organisation, and those rows are client-writable: a principal of
-- organisation A could insert or update a documents row in A whose storage_path named an object in
-- organisation B, and then download B's bytes through the normal document endpoint -- or straight
-- from the Storage API. (Also reachable through record_application_document_upload(p_storage_path).)
-- Reproduced locally before this fix; the object path being a UUID is not a security control.
--
-- AFTER THIS MIGRATION no row -- whoever writes it, client, SECURITY DEFINER function or service
-- role -- can reference a path outside its own organisation's folder:
--   * documents, lease_documents, lease_templates: CHECK (storage_path_in_org(org_id, storage_path))
--   * property_photos.hero_storage_path / card_storage_path: a trigger checks them against the
--     organisation of the photo's property (a CHECK constraint cannot read another table).
-- The application enforces the identical rule before every signed URL, download and processing
-- step (apps/admin/lib/protectedStorage.ts isStoragePathInOrg()).
--
-- WHAT THIS DOES NOT DO: no row is updated or deleted, no path is rewritten, no Storage object is
-- touched, and no RLS policy changes. If ANY existing row already violates the rule the migration
-- stops before changing anything and reports how many rows per table -- nothing is silently locked.
--
-- ROLLBACK: drop the three constraints, the trigger and the two functions:
--   alter table public.documents drop constraint documents_storage_path_in_org_folder;
--   alter table public.lease_documents drop constraint lease_documents_storage_path_in_org_folder;
--   alter table public.lease_templates drop constraint lease_templates_storage_path_in_org_folder;
--   drop trigger property_photos_storage_paths_in_org on public.property_photos;
--   drop function public.enforce_property_photo_storage_paths_in_org();
--   drop function public.storage_path_in_org(uuid, text);
-- Rolling back reopens the hole.

-- 1. The canonical rule ------------------------------------------------------------------------------

create or replace function public.storage_path_in_org(p_org_id uuid, p_path text)
returns boolean
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select coalesce(
        p_org_id is not null
    and p_path is not null
    -- the first segment is exactly the organisation id: a real "/" boundary, so "{org}evil/..." fails
    and split_part(p_path, '/', 1) = p_org_id::text
    -- at least one non-empty segment after the organisation folder
    and p_path ~ '^[^/]+/[^/]'
    -- no empty segments: no "//", no leading or trailing "/"
    and p_path !~ '//'
    and right(p_path, 1) <> '/'
    -- no "." or ".." segments
    and p_path !~ '(^|/)[.][.]?(/|$)'
    -- no backslash, no percent-encoded ".", "/" or "\", no control characters
    and strpos(p_path, chr(92)) = 0
    and p_path !~* '%(2e|2f|5c)'
    and p_path !~ '[[:cntrl:]]',
    false
  );
$$;

comment on function public.storage_path_in_org(uuid, text) is
  'True when a protected Storage path sits inside the given organisation''s folder
   ({org_id}/...). The single database definition of path ownership; mirrored exactly by
   apps/admin/lib/protectedStorage.ts isStoragePathInOrg().';

-- 2. Refuse to proceed if existing data already breaks the rule ---------------------------------------

do $$
declare
  v_documents bigint;
  v_lease_documents bigint;
  v_lease_templates bigint;
  v_property_photos bigint;
begin
  select count(*) into v_documents
    from public.documents
   where not public.storage_path_in_org(org_id, storage_path);
  select count(*) into v_lease_documents
    from public.lease_documents
   where not public.storage_path_in_org(org_id, storage_path);
  select count(*) into v_lease_templates
    from public.lease_templates
   where not public.storage_path_in_org(org_id, storage_path);
  select count(*) into v_property_photos
    from public.property_photos pp
    left join public.properties p on p.id = pp.property_id
   where (pp.hero_storage_path is not null and not public.storage_path_in_org(p.org_id, pp.hero_storage_path))
      or (pp.card_storage_path is not null and not public.storage_path_in_org(p.org_id, pp.card_storage_path));

  if v_documents + v_lease_documents + v_lease_templates + v_property_photos > 0 then
    raise exception
      'storage path ownership: % documents, % lease_documents, % lease_templates and % property_photos rows reference a path outside their organisation folder. Nothing was changed. Review those rows before re-running this migration.',
      v_documents, v_lease_documents, v_lease_templates, v_property_photos;
  end if;
end;
$$;

-- 3. Enforce it on every row that references a protected object -----------------------------------------

alter table public.documents
  add constraint documents_storage_path_in_org_folder
  check (public.storage_path_in_org(org_id, storage_path));

alter table public.lease_documents
  add constraint lease_documents_storage_path_in_org_folder
  check (public.storage_path_in_org(org_id, storage_path));

alter table public.lease_templates
  add constraint lease_templates_storage_path_in_org_folder
  check (public.storage_path_in_org(org_id, storage_path));

-- property_photos has no org_id of its own; its paths must sit inside its property's organisation.
-- SECURITY DEFINER only so the property's org can be read regardless of the writer's RLS view; it
-- reads one column of one row and grants nothing.
create or replace function public.enforce_property_photo_storage_paths_in_org()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_org_id uuid;
begin
  if new.hero_storage_path is null and new.card_storage_path is null then
    return new;
  end if;

  select p.org_id into v_org_id from public.properties p where p.id = new.property_id;

  if (new.hero_storage_path is not null and not public.storage_path_in_org(v_org_id, new.hero_storage_path))
     or (new.card_storage_path is not null and not public.storage_path_in_org(v_org_id, new.card_storage_path)) then
    raise exception 'property_photos storage paths must be inside the property''s organisation folder'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_property_photo_storage_paths_in_org() from public, anon, authenticated;

create trigger property_photos_storage_paths_in_org
  before insert or update of hero_storage_path, card_storage_path, property_id
  on public.property_photos
  for each row execute function public.enforce_property_photo_storage_paths_in_org();
