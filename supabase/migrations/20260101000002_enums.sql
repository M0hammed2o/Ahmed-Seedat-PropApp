-- Closed, stable enums. Mirror packages/types/src/enums.ts exactly — update both together.

create type public.property_status as enum ('active', 'archived');

create type public.property_type as enum (
  'house', 'apartment', 'townhouse', 'vacant_land', 'commercial', 'other'
);

create type public.document_type as enum (
  'bill', 'statement', 'proof_of_payment', 'receipt', 'supporting_document', 'other'
);

create type public.bill_status as enum (
  'processing', 'needs_review', 'unpaid', 'partially_paid', 'paid', 'overdue', 'disputed', 'void'
);

create type public.subscription_status as enum (
  'unknown', 'trialing', 'active', 'grace_period', 'billing_issue', 'expired', 'cancelled', 'revoked'
);

create type public.subscription_platform as enum ('ios', 'android', 'mock');

create type public.admin_role as enum (
  'super_admin', 'support_admin', 'operations_admin', 'read_only_admin'
);

create type public.extraction_job_status as enum (
  'queued', 'processing', 'succeeded', 'failed', 'needs_review'
);

create type public.payment_match_status as enum ('proposed', 'confirmed', 'rejected', 'unlinked');

create type public.actor_type as enum ('customer', 'admin', 'system');
