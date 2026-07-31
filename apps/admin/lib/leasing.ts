import 'server-only';
import type { Tenant } from '@propvault/types';

// Leasing-domain row mapping (apps/admin/app/api/v1/tenants). Role checks reuse
// requireOrgRole() from ./portfolio -- one has_org_role() RPC wrapper, not a per-domain copy.

interface TenantRow {
  id: string;
  org_id: string;
  user_id: string | null;
  full_name: string;
  email: string | null;
  phone: string | null;
  id_number_ref: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export function mapTenantRow(row: TenantRow): Tenant {
  return {
    id: row.id,
    orgId: row.org_id,
    userId: row.user_id,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    idNumberRef: row.id_number_ref,
    status: row.status as Tenant['status'],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
