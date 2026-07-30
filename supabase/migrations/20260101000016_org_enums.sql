-- New enums for the PropertyVault multi-tenancy layer. Mirror packages/types/src/enums.ts
-- exactly — update both together (see DATABASE.md).

create type public.organization_status as enum (
  'trial', 'active', 'overdue', 'suspended', 'cancelled'
);

create type public.organization_type as enum ('owner_managed', 'agency');

create type public.organization_member_role as enum (
  'principal', 'manager', 'agent', 'accountant', 'viewer'
);

create type public.organization_member_status as enum ('invited', 'active', 'revoked');

create type public.billing_cycle as enum ('monthly', 'annual');
