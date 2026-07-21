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

Production provider (Phase 2, not yet selected/integrated): interface is provider-agnostic on purpose — candidates are AWS Textract, Google Document AI, or Azure Document Intelligence. Selection is deferred to Phase 2 and documented as a decision to make then (see TODO.md), not guessed now, since it affects cost and accuracy tradeoffs Mohammed should weigh in on.

## Processing pipeline

1. Upload creates a `documents` row + an `extraction_jobs` row (`status = queued`, `attempt = 1`).
2. Server-side processing (Edge Function, Phase 2) calls the configured provider. All provider calls — including secret keys — happen server-side only; the mobile client never talks to the OCR vendor directly.
3. Idempotency: `extraction_jobs` has a unique `(document_id, attempt)` — a duplicated trigger for the same document/attempt is a no-op, not a duplicate job.
4. Retry: capped at `MAX_EXTRACTION_RETRIES` (packages/config, default 3), with the job moving to `needs_review` (not silently failing) once exhausted.
5. Result: `extraction_results` stores raw provider output (jsonb, for diagnostics only) plus per-field values are written to the typed columns on `bills`/`payments` with a `extraction_confidence` per record.
6. The customer always sees extracted fields in an editable confirmation screen before they're treated as final — the spec's explicit V1 rule. Nothing is "auto-saved as truth."

## Status tracking

`extraction_jobs.status`: `queued → processing → succeeded | failed | needs_review`. Admin's Processing screen reads this table directly (see ADMIN_DASHBOARD.md).
