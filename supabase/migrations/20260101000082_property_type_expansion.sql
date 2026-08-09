-- Workflow-integration pass (WORKLOG.md this date), Stage 2: property_type only had six values
-- (house/apartment/townhouse/vacant_land/commercial/other), with no way to represent an apartment
-- block, retail/office/industrial premises, mixed-use, or student accommodation -- all real,
-- common South African rental property categories this product needs to serve. Additive only
-- (ALTER TYPE ... ADD VALUE, same safe pattern migration 20260101000047 already used for
-- application_status): existing rows and every existing value are untouched.
alter type public.property_type add value if not exists 'apartment_building' after 'apartment';
alter type public.property_type add value if not exists 'retail' after 'commercial';
alter type public.property_type add value if not exists 'office' after 'retail';
alter type public.property_type add value if not exists 'industrial' after 'office';
alter type public.property_type add value if not exists 'mixed_use' after 'industrial';
alter type public.property_type add value if not exists 'student_accommodation' after 'mixed_use';
