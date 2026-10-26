-- ROLLBACK of migration 184 (Cemetery Management). NOT a migration: run by hand, as one transaction
-- (psql -1 -v ON_ERROR_STOP=1 -f ...), only where 184 was applied and something forces going back.
--
-- The PREFERRED rollback is to switch the module off, which hides it everywhere (navigation, pages, API, RLS) and
-- keeps the records:
--   update public.organizations set cemetery_enabled = false where id = '<org id>';
--
-- This script drops the module's objects. It REFUSES while any organisation other than a demo cemetery holds cemetery
-- records (dropping them would destroy customer data: restore from backup/PITR instead). Override ONLY on a
-- throw-away database, or after the demo data has been reviewed:
--   set proplyst.rollback_discard_cemetery_data = 'yes';
-- audit_events rows written by the module's triggers are immutable and stay behind (entity_type cemetery_*).

do $$
declare
  v_discard boolean := coalesce(current_setting('proplyst.rollback_discard_cemetery_data', true), '') = 'yes';
  v_rows bigint;
begin
  select count(*) into v_rows from public.cemeteries where not is_demo;
  if v_rows > 0 and not v_discard then
    raise exception 'Rollback refused: % non-demo cemeteries exist. Switch the module off instead, or restore from backup.', v_rows;
  end if;
  if exists (select 1 from public.cemeteries) and not v_discard then
    raise exception 'Rollback refused: demo cemetery data exists. Set proplyst.rollback_discard_cemetery_data = ''yes'' to drop it.';
  end if;
end $$;

drop function if exists public.cemetery_record_burial(uuid, text, date, date, date, text, text, text);
drop function if exists public.cemetery_record_payment(uuid, numeric, date, public.payment_method, text, text);
drop function if exists public.cemetery_record_sale(uuid, uuid, numeric, date, numeric, public.payment_method, text, text);
drop function if exists public.cemetery_set_site_unavailable(uuid, boolean, text);
drop function if exists public.cemetery_release_reservation(uuid);
drop function if exists public.cemetery_reserve_site(uuid, uuid, date, text);
drop function if exists public.cemetery_generate_sites(uuid, integer, numeric, numeric, numeric);

drop view if exists public.cemetery_sale_balances;
drop table if exists public.cemetery_site_documents;
drop table if exists public.cemetery_burials;
drop table if exists public.cemetery_payments;
drop table if exists public.cemetery_sales;
drop table if exists public.cemetery_sites;
drop table if exists public.cemetery_purchasers;
drop table if exists public.cemetery_sections;
drop table if exists public.cemeteries;
drop sequence if exists public.cemetery_receipt_number_seq;
drop sequence if exists public.cemetery_sale_number_seq;

drop function if exists public.cemetery_org_ids(public.organization_member_role);
drop function if exists public.cemetery_payments_immutable();
drop function if exists public.cemetery_payments_before_insert();
drop function if exists public.cemetery_sales_before_update();
drop function if exists public.cemetery_sales_before_insert();
drop function if exists public.cemetery_sites_check_status();
drop function if exists public.cemetery_audit_trigger();

drop type if exists public.cemetery_sale_status;
drop type if exists public.grave_burial_status;
drop type if exists public.grave_sale_status;
drop type if exists public.cemetery_tenure_model;

alter table public.organizations drop column if exists cemetery_enabled;
