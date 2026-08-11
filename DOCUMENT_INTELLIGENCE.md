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

Two real providers are implemented in `apps/admin/lib/providers/documentIntelligence.ts`
(overnight platform pass, WORKLOG.md this date, adding the second):

- **`AWSTextractDocumentIntelligenceProvider`** (Mohammed's original vendor decision) — bills use
  `AnalyzeExpenseCommand`, leases use `AnalyzeDocumentCommand`'s QUERIES feature. Configured via
  `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_TEXTRACT_REGION` (falls back to
  `AWS_REGION`).
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

`getDocumentIntelligenceProvider()` checks Textract first (preserving existing behaviour for any
environment that already has AWS credentials configured), then Google, then falls back to Mock.
No real AWS or Google account exists in this development environment — never fabricate a
successful extraction result when neither is configured; the Mock provider's output is always
clearly labelled as such.

## Processing pipeline

1. Upload creates a `documents` row + an `extraction_jobs` row (`status = queued`, `attempt = 1`).
2. Server-side processing (Edge Function, Phase 2) calls the configured provider. All provider calls — including secret keys — happen server-side only; the mobile client never talks to the OCR vendor directly.
3. Idempotency: `extraction_jobs` has a unique `(document_id, attempt)` — a duplicated trigger for the same document/attempt is a no-op, not a duplicate job.
4. Retry: capped at `MAX_EXTRACTION_RETRIES` (packages/config, default 3), with the job moving to `needs_review` (not silently failing) once exhausted.
5. Result: `extraction_results` stores raw provider output (jsonb, for diagnostics only) plus per-field values are written to the typed columns on `bills`/`payments` with a `extraction_confidence` per record.
6. The customer always sees extracted fields in an editable confirmation screen before they're treated as final — the spec's explicit V1 rule. Nothing is "auto-saved as truth."

## Status tracking

`extraction_jobs.status`: `queued → processing → succeeded | failed | needs_review`. Admin's Processing screen reads this table directly (see ADMIN_DASHBOARD.md).
