-- Real coordinates for the Owner Dashboard's Portfolio map (2026-08-04, Lovable-adoption batch
-- follow-up -- Mohammed confirmed Mapbox + automatic geocoding-on-save as the approach). Both
-- columns or neither -- there is no meaningful "half a coordinate" state, and the check keeps
-- that structurally impossible rather than relying on every write path to remember it.
alter table public.properties
  add column latitude numeric(9, 6),
  add column longitude numeric(9, 6),
  add constraint properties_coordinates_both_or_neither
    check ((latitude is null) = (longitude is null));

comment on column public.properties.latitude is
  'Geocoded from the property address via Mapbox on create/update (apps/admin/lib/providers/geocoding.ts). Null until geocoding succeeds or when no MAPBOX_ACCESS_TOKEN is configured -- never guessed or defaulted to 0,0.';
comment on column public.properties.longitude is
  'See latitude.';
