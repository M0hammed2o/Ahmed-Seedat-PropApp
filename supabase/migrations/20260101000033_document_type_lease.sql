-- TASKS.md M12: extends DocumentIntelligenceProvider (and the documents.document_type it feeds)
-- to cover leases, not just bills -- unblocks POST /api/v1/leases/:id/upload-and-parse
-- (API_SPEC.md §4), deferred from M10 pending exactly this.
alter type public.document_type add value 'lease';
