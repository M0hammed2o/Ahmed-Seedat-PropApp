import 'server-only';
import type { LeaseTemplate } from '@propvault/types';

// Row-mapping for apps/admin/app/api/v1/lease-templates/** (PWA_V1_COMPLETION_PLAN.md #9).

interface LeaseTemplateRow {
  id: string;
  org_id: string;
  name: string;
  storage_path: string;
  original_file_name: string;
  mime_type: string;
  file_size_bytes: number;
  is_default: boolean;
  status: string;
  supersedes_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export function mapLeaseTemplateRow(row: LeaseTemplateRow): LeaseTemplate {
  return {
    id: row.id,
    orgId: row.org_id,
    name: row.name,
    storagePath: row.storage_path,
    originalFileName: row.original_file_name,
    mimeType: row.mime_type,
    fileSizeBytes: row.file_size_bytes,
    isDefault: row.is_default,
    status: row.status as LeaseTemplate['status'],
    supersedesId: row.supersedes_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
