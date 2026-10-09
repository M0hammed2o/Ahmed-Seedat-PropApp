-- Smart Utilities: where the meter physically is (e.g. "Boundary box, left of gate", "DB room, level 2").
-- Additive only.
alter table public.utility_meters
  add column location text check (location is null or char_length(location) <= 200);
