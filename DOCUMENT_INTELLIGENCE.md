# Document Intelligence

## Abstraction

`DocumentIntelligenceProvider` (`packages/types/documentIntelligence.ts` for the interface, implementations in `apps/mobile`/edge functions as appropriate) decouples the product from any single OCR/AI vendor:

```ts
interface DocumentIntelligenceProvider {
  classify(input: ProcessingInput): Promise<ClassificationResult>;
  extractText(input: ProcessingInput): Promise<OcrResult>;
  extractFields(input: ProcessingInput, documentType: DocumentType): Promise<FieldExtractionResult>;
  // FieldExtractionResult includes per-field confidence, providerMetadata, costMetadata?, and
  // throws a typed ProviderError (retryable | non_retryable) rather than a bare Error.
}
```

`MockDocumentIntelligenceProvider` (Phase 1, implemented) returns deterministic fake structured data with plausible confidence scores after a simulated delay, so the full extraction-confirmation UI can be built and tested before any real provider account exists.

**Google Cloud Document AI is the only real provider.** This was made explicit on
12 September 2026: an `AWSTextractDocumentIntelligenceProvider` previously lived in the same module
and — worse — was checked FIRST, so any `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`/
`AWS_TEXTRACT_REGION`/`AWS_REGION` value present in the environment, including a stale leftover set
for something unrelated, silently won and Google never ran. That implementation, its config getter,
its tests and the `@aws-sdk/client-textract` dependency have all been removed, so the failure mode
cannot return through configuration. AWS is not a supported OCR vendor for Proplyst.

One real provider is implemented in `apps/admin/lib/providers/documentIntelligence.ts`:

- **`GoogleDocumentAIProvider`** — a second, independently-configured option, added alongside
  Textract rather than replacing it. Implements the OAuth2 service-account JWT-bearer flow with
  `node:crypto` (no `@google-cloud/documentai` SDK dependency) and calls the Document AI REST
  API directly. Configured via:
  - `GOOGLE_CLOUD_PROJECT_ID`
  - `GOOGLE_CLOUD_LOCATION` (e.g. `us` or `eu` — must match where the processor(s) were created)
  - `GOOGLE_DOCUMENT_AI_PROCESSOR_ID` (used for `classify()`/`extractText()`, and as the
    `extractFields()` fallback for leases via a Custom Extractor processor Mohammed trains with
    entity labels matching this codebase's field names exactly: `tenantName`, `rentAmount`,
    `depositAmount`, `leaseStartDate`, `leaseEndDate`, `propertyAddress`)
  - `GOOGLE_DOCUMENT_AI_INVOICE_PROCESSOR_ID` (optional — a dedicated Invoice/Expense parser used
    for `extractFields()` on `'bill'` documents; falls back to `GOOGLE_DOCUMENT_AI_PROCESSOR_ID`
    if unset)
  - `GOOGLE_DOCUMENT_AI_CREDENTIALS_JSON` (the full service-account key JSON, as one env var)

`getDocumentIntelligenceProvider()` returns `GoogleDocumentAIProvider` when all four required
`GOOGLE_*` variables are present and the credentials JSON parses, and `MockDocumentIntelligence
Provider` otherwise. There is no second real provider and no precedence to reason about. Never
fabricate a successful extraction result when Google is not configured — the Mock provider's raw
text is explicitly labelled as mock.

**Resolved 12 September 2026.** The precedence hazard described in the previous revision of this
document — AWS Textract silently winning over Google whenever any AWS variable was present — no
longer exists, because the AWS provider no longer exists. The `console.warn` that used to flag the
misconfiguration went with it; there is nothing left to warn about.

The platform-admin **System** page (`/platform-admin/system`) shows the REAL active provider
identity (`google-document-ai`, or not connected) next to "Document intelligence provider". No
credentials are ever shown, only the provider's own non-secret `providerName`.

Also fixed this pass: `provider_name` is now recorded on `extraction_jobs`/`extraction_results`
for the lease `upload-and-parse` route too (the other two extraction routes — documents, levy
statements — already did this; lease was the one gap).

## Processing pipeline

1. Upload creates a `documents` row + an `extraction_jobs` row (`status = queued`, `attempt = 1`).
2. Server-side processing (Edge Function, Phase 2) calls the configured provider. All provider calls — including secret keys — happen server-side only; the mobile client never talks to the OCR vendor directly.
3. Idempotency: `extraction_jobs` has a unique `(document_id, attempt)` — a duplicated trigger for the same document/attempt is a no-op, not a duplicate job.
4. Retry: capped at `MAX_EXTRACTION_RETRIES` (packages/config, default 3), with the job moving to `needs_review` (not silently failing) once exhausted.
5. Result: `extraction_results` stores raw provider output (jsonb, for diagnostics only) plus per-field values are written to the typed columns on `bills`/`payments` with a `extraction_confidence` per record.
6. **Correction step — audited live this pass, corrected from the aspirational claim this section
   previously made**: only the **levy statement** flow actually has an editable correction step
   before values are treated as final (a real line-item table, "Save corrections", "Mark
   reviewed"). The **bill/Documents module** flow has NO field-editing UI at all — only a
   read-only field display and a "Confirm reviewed" button; `packages/validation`'s
   `billCorrectionSchema` exists but is never wired to any route. **Receipts** are not supported
   for extraction at all (`extraction_not_supported`, by design — never guessed at). **Leases**
   have a working backend route (`upload-and-parse`) but no UI anywhere calls it. See
   `UAT_TEST_PLAN.md` §2 for the exact, honest per-document-type checklist this produced.

## Status tracking

`extraction_jobs.status`: `queued → processing → succeeded | failed | needs_review`. Admin's Processing screen reads this table directly (see ADMIN_DASHBOARD.md).
