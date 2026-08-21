-- Commercial plan restructure (WORKLOG.md this date): replaces the three placeholder plans
-- (starter/professional/business, seeded 20260101000075, never actually sold to a real paying
-- customer -- confirmed live: only 1 of 14 production organizations has ever had an
-- organization_subscriptions row at all) with the real, final commercial structure, plus monthly
-- and annual variants for each tier.
--
-- New plan codes (starter_monthly/starter_annual/professional_monthly/professional_annual/
-- business_monthly/business_annual), not new versions of the existing codes -- billing_cycle is a
-- genuinely different SKU here, not a price revision of the same product, and this way the one
-- existing subscriber's plan_id foreign key is completely undisturbed (old rows are deactivated,
-- never deleted or mutated). Annual price = round(monthly * 12 * 0.85) -- the exact 15%-discount
-- formula this pass's own instruction specifies, computed once here for auditability:
--   Starter:      299  * 12 * 0.85 = 3049.80 -> 3050
--   Professional: 699  * 12 * 0.85 = 7129.80 -> 7130
--   Business:     1999 * 12 * 0.85 = 20389.80 -> 20390
--
-- feature_limits keys, extending (not replacing the shape of) the existing jsonb convention:
--   maxProperties, maxStaff, includedOwners (external owners included free), ocrEnabled,
--   ownerPortalEnabled, advancedReporting, bulkCommunications, multiOwnerManagement,
--   prioritySupport, apiAccess, extraPropertyPrice, extraOwnerPrice (both null on Starter -- not
--   sold as an agency plan, per this pass's own explicit "Starter is not intended for agencies
--   managing external property owners").

update public.plans set is_active = false where code in ('starter', 'professional', 'business');

insert into public.plans (code, name, billing_cycle, base_price, currency, feature_limits, is_active) values
  (
    'starter_monthly', 'Starter', 'monthly', 299.00, 'ZAR',
    jsonb_build_object(
      'maxProperties', 5, 'maxStaff', 1, 'includedOwners', 0,
      'ocrEnabled', false, 'ownerPortalEnabled', false, 'advancedReporting', false,
      'bulkCommunications', false, 'multiOwnerManagement', false, 'prioritySupport', false,
      'apiAccess', false, 'extraPropertyPrice', null, 'extraOwnerPrice', null
    ),
    true
  ),
  (
    'starter_annual', 'Starter', 'annual', 3050.00, 'ZAR',
    jsonb_build_object(
      'maxProperties', 5, 'maxStaff', 1, 'includedOwners', 0,
      'ocrEnabled', false, 'ownerPortalEnabled', false, 'advancedReporting', false,
      'bulkCommunications', false, 'multiOwnerManagement', false, 'prioritySupport', false,
      'apiAccess', false, 'extraPropertyPrice', null, 'extraOwnerPrice', null
    ),
    true
  ),
  (
    'professional_monthly', 'Professional', 'monthly', 699.00, 'ZAR',
    jsonb_build_object(
      'maxProperties', 15, 'maxStaff', 5, 'includedOwners', 2,
      'ocrEnabled', true, 'ownerPortalEnabled', true, 'advancedReporting', true,
      'bulkCommunications', true, 'multiOwnerManagement', false, 'prioritySupport', false,
      'apiAccess', false, 'extraPropertyPrice', 99.00, 'extraOwnerPrice', 199.00
    ),
    true
  ),
  (
    'professional_annual', 'Professional', 'annual', 7130.00, 'ZAR',
    jsonb_build_object(
      'maxProperties', 15, 'maxStaff', 5, 'includedOwners', 2,
      'ocrEnabled', true, 'ownerPortalEnabled', true, 'advancedReporting', true,
      'bulkCommunications', true, 'multiOwnerManagement', false, 'prioritySupport', false,
      'apiAccess', false, 'extraPropertyPrice', 99.00, 'extraOwnerPrice', 199.00
    ),
    true
  ),
  (
    'business_monthly', 'Business', 'monthly', 1999.00, 'ZAR',
    jsonb_build_object(
      'maxProperties', 25, 'maxStaff', 15, 'includedOwners', 5,
      'ocrEnabled', true, 'ownerPortalEnabled', true, 'advancedReporting', true,
      'bulkCommunications', true, 'multiOwnerManagement', true, 'prioritySupport', true,
      'apiAccess', true, 'extraPropertyPrice', 99.00, 'extraOwnerPrice', 199.00
    ),
    true
  ),
  (
    'business_annual', 'Business', 'annual', 20390.00, 'ZAR',
    jsonb_build_object(
      'maxProperties', 25, 'maxStaff', 15, 'includedOwners', 5,
      'ocrEnabled', true, 'ownerPortalEnabled', true, 'advancedReporting', true,
      'bulkCommunications', true, 'multiOwnerManagement', true, 'prioritySupport', true,
      'apiAccess', true, 'extraPropertyPrice', 99.00, 'extraOwnerPrice', 199.00
    ),
    true
  )
on conflict (code, version) do nothing;
