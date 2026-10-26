-- Rent-invoice numbering could hand out a number that already exists (found 2026-10-26, docs/CEMETERY_MANAGEMENT.md
-- §Invoice numbering).
--
-- In production invoice_number_seq stood at 3 while invoice numbers up to INV-002296 existed:
--   - the marketing demo portfolio (432 invoices, 2026-09-06) was copied from a local database WITH its invoice_number
--     values (INV-001865..002296) by scripts/provision-production-demo-portfolio.mjs, which never advances the sequence;
--   - the UAT portfolio holds INV-000003..000007 while the sequence was at 3.
-- The next generated number (INV-000004) therefore already existed: every new rent invoice, for every organisation,
-- would fail on invoices_invoice_number_key. No invoice had been created since 2026-09-08.
--
-- Fix, forward-only and idempotent:
--   1. move the shared sequence past the highest number in use (never backwards);
--   2. set_invoice_number() skips a generated number that is already taken, so rows copied in with explicit numbers
--      can never block numbering again. Existing invoice numbers are not changed.
-- Rollback: none needed (a sequence only moves forward; the previous trigger function is restored by re-running
-- migration 154's definition if ever wanted).

select setval(
  'public.invoice_number_seq',
  greatest(
    (select last_value from public.invoice_number_seq),
    coalesce((select max((regexp_match(invoice_number, '(\d+)$'))[1]::bigint) from public.invoices), 0),
    1
  )
);

create or replace function public.set_invoice_number()
returns trigger
language plpgsql
as $$
declare
  v_candidate text;
begin
  if new.invoice_number is null then
    loop
      v_candidate := public.generate_invoice_number(new.org_id);
      exit when not exists (select 1 from public.invoices where invoice_number = v_candidate);
    end loop;
    new.invoice_number := v_candidate;
  end if;
  return new;
end;
$$;
