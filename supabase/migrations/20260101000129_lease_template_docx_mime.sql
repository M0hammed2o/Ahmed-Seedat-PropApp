-- Lease-template DOCX upload audit (WORKLOG.md 2026-08-25): root cause traced end to end. The
-- browser accept attribute, the frontend form, the API route's own LEASE_TEMPLATE_MIME_TYPES
-- allowlist (packages/types/src/enums.ts), and the Zod schema all already permit DOCX correctly.
-- The rejection happens one layer deeper: the 'documents' Storage bucket's own allowed_mime_types
-- (set once in migration 20260101000015, before DOCX lease templates were ever conceived, and
-- never revisited) never included DOCX -- the exact same class of gap already fixed for
-- image/webp derivatives in migration 20260101000127.
--
-- Adds ONLY application/vnd.openxmlformats-officedocument.wordprocessingml.document (real DOCX,
-- an Office Open XML zip package). Deliberately does NOT add:
--   - application/vnd.ms-word.document.macroEnabled.12 (DOCM) -- macro-enabled, never accepted
--   - application/zip / application/x-zip-compressed -- DOCX's own container format, but accepting
--     the bare zip MIME type would let ANY zip through (including a renamed DOCM/executable-bearing
--     archive) purely on a client-reported Content-Type header, which is not a safe boundary
--   - application/octet-stream or any other generic/binary catch-all
-- The upload path never executes document content or macros server-side (documents are stored as
-- opaque bytes and only ever read back via a signed URL or DOCX-template-merge library, never
-- opened by a script interpreter), so this is a storage-acceptance allowlist only, not a code-
-- execution surface -- but the allowlist itself stays deliberately narrow regardless.

update storage.buckets
set allowed_mime_types = array_append(
  allowed_mime_types,
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
)
where id = 'documents'
  and not ('application/vnd.openxmlformats-officedocument.wordprocessingml.document' = any(allowed_mime_types));
