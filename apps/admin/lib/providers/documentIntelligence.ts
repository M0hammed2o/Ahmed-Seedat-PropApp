import 'server-only';
import type {
  ClassificationResult,
  DocumentIntelligenceProvider,
  DocumentType,
  ExtractedField,
  FieldExtractionResult,
  OcrResult,
  ProcessingInput,
  ProviderMetadata,
} from '@propvault/types';
import { ProviderError } from '@propvault/types';

// Server-side DocumentIntelligenceProvider (DOCUMENT_INTELLIGENCE.md: "All provider calls...
// happen server-side only"). apps/mobile already has its own MockDocumentIntelligenceProvider for
// the client-side demo path (a distinct runtime -- React Native, not importable into a Next.js
// route handler); this is the server-side counterpart real API routes call, extended (TASKS.md
// M12) to branch on documentType and return lease-shaped fields for 'lease', not just bill fields
// for everything regardless of type the way the mobile mock currently does.

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mockMetadata(processingDurationMs: number) {
  return {
    providerName: 'mock',
    providerVersion: '1.0.0',
    processingDurationMs,
    estimatedCostUsd: 0,
  };
}

export class MockDocumentIntelligenceProvider implements DocumentIntelligenceProvider {
  readonly providerName = 'mock';

  async classify(_input: ProcessingInput): Promise<ClassificationResult> {
    await delay(50);
    return { documentType: 'other', confidence: 0.5, metadata: mockMetadata(50) };
  }

  async extractText(_input: ProcessingInput): Promise<OcrResult> {
    await delay(50);
    return {
      rawText: 'MOCK EXTRACTED TEXT — no real OCR has run against this document.',
      confidence: 0.75,
      metadata: mockMetadata(50),
    };
  }

  async extractFields(
    _input: ProcessingInput,
    documentType: DocumentType,
  ): Promise<FieldExtractionResult> {
    await delay(100);

    if (documentType === 'lease') {
      return {
        tenantName: { value: 'Mock Tenant', confidence: 0.7 },
        rentAmount: { value: 8500, confidence: 0.65 },
        depositAmount: { value: 8500, confidence: 0.6 },
        leaseStartDate: { value: new Date().toISOString().slice(0, 10), confidence: 0.6 },
        propertyAddress: { value: '1 Mock Street, Cape Town', confidence: 0.55 },
        overallConfidence: 0.62,
        metadata: mockMetadata(100),
      };
    }

    if (documentType === 'id_document') {
      return {
        fullName: { value: 'Mock Applicant', confidence: 0.95 },
        idNumber: { value: '9001015800086', confidence: 0.92 },
        dateOfBirth: { value: '1990-01-01', confidence: 0.9 },
        nationality: { value: 'South African', confidence: 0.85 },
        overallConfidence: 0.9,
        metadata: mockMetadata(100),
      };
    }

    if (documentType === 'proof_of_address') {
      return {
        personName: { value: 'Mock Applicant', confidence: 0.85 },
        residentialAddress: { value: '1 Mock Street, Cape Town, 8001', confidence: 0.75 },
        documentDate: { value: new Date().toISOString().slice(0, 10), confidence: 0.7 },
        overallConfidence: 0.77,
        metadata: mockMetadata(100),
      };
    }

    if (documentType === 'payslip') {
      return {
        employeeName: { value: 'Mock Applicant', confidence: 0.88 },
        employerName: { value: 'Mock Employer (Pty) Ltd', confidence: 0.8 },
        grossIncome: { value: 25000, confidence: 0.75 },
        netIncome: { value: 19500, confidence: 0.72 },
        payPeriod: { value: new Date().toISOString().slice(0, 7), confidence: 0.7 },
        overallConfidence: 0.77,
        metadata: mockMetadata(100),
      };
    }

    if (documentType === 'bank_statement') {
      return {
        accountHolderName: { value: 'Mock Applicant', confidence: 0.86 },
        statementPeriod: { value: new Date().toISOString().slice(0, 7), confidence: 0.7 },
        residentialAddress: { value: '1 Mock Street, Cape Town, 8001', confidence: 0.6 },
        overallConfidence: 0.72,
        metadata: mockMetadata(100),
      };
    }

    return {
      supplierName: { value: 'City of Cape Town (mock)', confidence: 0.7 },
      accountNumber: { value: '000000000', confidence: 0.65 },
      amountDue: { value: 0, confidence: 0.5 },
      dueDate: { value: new Date().toISOString().slice(0, 10), confidence: 0.6 },
      overallConfidence: 0.62,
      metadata: mockMetadata(100),
    };
  }
}

// Largest document we will send for synchronous extraction. Google Document AI's own :process
// limit is higher than this, so 5 MB is Proplyst's deliberately conservative ceiling rather than a
// vendor one: base64 inflates the payload by a third, and a document bigger than this wants the
// batch/async flow, which is not implemented here (TECHNICAL_DEBT_REGISTER.md TD-39). Most
// single-page bills and statements are well under it; a long multi-page lease is the likely case
// to hit it. Raising it toward Google's real limit is a separate, deliberate change.
const MAX_SYNC_BYTES = 5 * 1024 * 1024;

async function fetchDocumentBytes(
  input: ProcessingInput,
  providerName: string,
): Promise<Uint8Array> {
  if (!input.signedUrl) {
    throw new ProviderError(
      'No signedUrl provided -- the caller must resolve one before invoking a real DocumentIntelligenceProvider',
      'non_retryable',
      providerName,
    );
  }
  const response = await fetch(input.signedUrl);
  if (!response.ok) {
    throw new ProviderError(
      `Failed to download document from signed URL (${response.status})`,
      'retryable',
      providerName,
    );
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_SYNC_BYTES) {
    throw new ProviderError(
      `Document is ${bytes.byteLength} bytes, over the ${MAX_SYNC_BYTES}-byte limit for synchronous extraction -- a document this large needs the batch flow, which is not implemented yet`,
      'non_retryable',
      providerName,
    );
  }
  return bytes;
}

// Very small, disclosed-as-a-heuristic classifier. Document AI's processors extract fields; they
// do not answer "what kind of document is this" for an arbitrary upload, so this is keyword
// matching on the raw extracted text, at deliberately lower confidence than field extraction. A
// document with no matching keywords falls back to 'other' rather than a guessed specific type.
function classifyFromText(rawText: string): { documentType: DocumentType; confidence: number } {
  const text = rawText.toLowerCase();
  if (/\blease agreement\b|\btenancy agreement\b|\blandlord\b.*\btenant\b/.test(text)) {
    return { documentType: 'lease', confidence: 0.55 };
  }
  if (
    /\binvoice\b|\bstatement\b|\bamount due\b|\baccount number\b|\bmunicipal(ity)?\b/.test(text)
  ) {
    return { documentType: 'bill', confidence: 0.55 };
  }
  return { documentType: 'other', confidence: 0.3 };
}

function parseCurrencyToNumber(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const cleaned = raw.replace(/[^0-9.,-]/g, '').replace(/,/g, '');
  const value = Number.parseFloat(cleaned);
  return Number.isFinite(value) ? value : undefined;
}

function toExtractedField<T>(
  value: T | undefined,
  confidence: number,
): ExtractedField<T> | undefined {
  return value === undefined ? undefined : { value, confidence };
}

// Field aliases whose FieldExtractionResult type is ExtractedField<number> (currency amounts) --
// Which extracted answers need parseCurrencyToNumber() run on them: an extractor returns plain
// text regardless of the semantic field type, so money fields are named explicitly.
const NUMERIC_FIELD_ALIASES = new Set(['rentAmount', 'depositAmount', 'grossIncome', 'netIncome']);

// Google Document AI integration (overnight platform pass, WORKLOG.md this date, Phase 8-11).
// Since 12 September 2026 this is the ONLY real DocumentIntelligenceProvider: the AWS Textract
// implementation that used to sit alongside it -- and take precedence over it -- was removed
// outright on Mohammed's confirmed architecture decision that Proplyst uses Google Cloud Document
// AI only.
//
// No @google-cloud/documentai SDK dependency was added -- this implements the OAuth2 service-
// account JWT-bearer flow directly with Node's built-in `node:crypto` and calls the Document AI
// REST API with `fetch`, matching this codebase's existing preference for small, dependency-free
// provider implementations and avoiding a new package install in an environment where that could
// not be verified against a reachable registry this session.
//
// No real Google Cloud project/service account exists in this environment (same class of
// external-service blocker as Meta/Resend/PayFast) -- never fabricate a successful call
// against it; getGoogleDocumentAIConfig() returns null (falling through to Mock) whenever any
// required env var is absent or the credentials JSON fails to parse.
import { createSign } from 'node:crypto';

export interface GoogleDocumentAIConfig {
  projectId: string;
  location: string;
  /** Processor used for extractText()/classify() and, absent a dedicated invoice processor, as
   * the fallback for extractFields() -- e.g. a "Document OCR" or "Custom Extractor" processor. */
  processorId: string;
  /** Optional dedicated "Invoice Parser"/"Expense Parser" processor for 'bill'-type documents --
   * Google has no single processor that handles both bills and leases equally well, so a
   * AnalyzeExpense/AnalyzeDocument split, so this is a second, independently-configured processor
   * ID rather than a mode flag on one processor. Falls back to `processorId` if unset. */
  invoiceProcessorId: string | null;
  clientEmail: string;
  privateKey: string;
}

/** Required env vars (documented for Mohammed): GOOGLE_CLOUD_PROJECT_ID, GOOGLE_CLOUD_LOCATION
 * (e.g. "us" or "eu" -- must match where the processor(s) were created in the Cloud Console),
 * GOOGLE_DOCUMENT_AI_PROCESSOR_ID, and GOOGLE_DOCUMENT_AI_CREDENTIALS_JSON (the full service-
 * account key JSON downloaded from Cloud Console, as one env var -- matches how most PaaS hosts
 * including Render store multi-line secrets; never a file path, since a mounted-file convention
 * doesn't reliably survive Render deploys). GOOGLE_DOCUMENT_AI_INVOICE_PROCESSOR_ID is optional. */
export function getGoogleDocumentAIConfig(): GoogleDocumentAIConfig | null {
  const projectId = process.env.GOOGLE_CLOUD_PROJECT_ID;
  const location = process.env.GOOGLE_CLOUD_LOCATION;
  const processorId = process.env.GOOGLE_DOCUMENT_AI_PROCESSOR_ID;
  const credentialsJson = process.env.GOOGLE_DOCUMENT_AI_CREDENTIALS_JSON;
  if (!projectId || !location || !processorId || !credentialsJson) return null;

  let parsed: { client_email?: string; private_key?: string };
  try {
    parsed = JSON.parse(credentialsJson);
  } catch {
    return null;
  }
  if (!parsed.client_email || !parsed.private_key) return null;

  return {
    projectId,
    location,
    processorId,
    invoiceProcessorId: process.env.GOOGLE_DOCUMENT_AI_INVOICE_PROCESSOR_ID ?? null,
    clientEmail: parsed.client_email,
    // Service-account JSON keys always contain literal "\n" sequences in the PEM -- env vars
    // collapse real newlines, so this is the standard round-trip fix every Google server-side
    // integration guide documents, not a workaround specific to this codebase.
    privateKey: parsed.private_key.replace(/\\n/g, '\n'),
  };
}

function base64Url(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input) : input;
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

interface GoogleDocumentAIEntity {
  type?: string;
  mentionText?: string;
  confidence?: number;
}

interface GoogleDocumentAIToken {
  layout?: {
    textAnchor?: { textSegments?: { startIndex?: string; endIndex?: string }[] };
    confidence?: number;
  };
}

interface GoogleDocumentAIResponse {
  document?: {
    text?: string;
    pages?: { tokens?: GoogleDocumentAIToken[] }[];
    entities?: GoogleDocumentAIEntity[];
  };
}

// Entity alias lists for extractByEntities() -- the alias names this codebase uses throughout
// above, reused (not duplicated with different names) so both providers report the exact same
// FieldExtractionResult keys regardless of which vendor actually served a given extraction.
const LEASE_ENTITY_ALIASES: (keyof FieldExtractionResult)[] = [
  'tenantName',
  'rentAmount',
  'depositAmount',
  'leaseStartDate',
  'leaseEndDate',
  'propertyAddress',
];
const ID_DOCUMENT_ENTITY_ALIASES: (keyof FieldExtractionResult)[] = [
  'fullName',
  'idNumber',
  'dateOfBirth',
  'nationality',
  'documentExpiryDate',
];
const PROOF_OF_ADDRESS_ENTITY_ALIASES: (keyof FieldExtractionResult)[] = [
  'personName',
  'residentialAddress',
  'documentDate',
];
const PAYSLIP_ENTITY_ALIASES: (keyof FieldExtractionResult)[] = [
  'employeeName',
  'employerName',
  'grossIncome',
  'netIncome',
  'payPeriod',
];
const BANK_STATEMENT_ENTITY_ALIASES: (keyof FieldExtractionResult)[] = [
  'accountHolderName',
  'statementPeriod',
  'residentialAddress',
];

export class GoogleDocumentAIProvider implements DocumentIntelligenceProvider {
  readonly providerName = 'google-document-ai';
  private readonly config: GoogleDocumentAIConfig;
  private cachedToken: { value: string; expiresAtMs: number } | null = null;

  constructor(config: GoogleDocumentAIConfig) {
    this.config = config;
  }

  async classify(input: ProcessingInput): Promise<ClassificationResult> {
    const start = Date.now();
    const { rawText } = await this.process(input, this.config.processorId);
    const { documentType, confidence } = classifyFromText(rawText.text);
    return { documentType, confidence, metadata: this.metadata(Date.now() - start) };
  }

  async extractText(input: ProcessingInput): Promise<OcrResult> {
    const start = Date.now();
    const { rawText } = await this.process(input, this.config.processorId);
    return {
      rawText: rawText.text,
      confidence: rawText.confidence,
      metadata: this.metadata(Date.now() - start),
    };
  }

  async extractFields(
    input: ProcessingInput,
    documentType: DocumentType,
  ): Promise<FieldExtractionResult> {
    const start = Date.now();
    switch (documentType) {
      case 'lease':
        return this.extractByEntities(input, LEASE_ENTITY_ALIASES, start);
      case 'id_document':
        return this.extractByEntities(input, ID_DOCUMENT_ENTITY_ALIASES, start);
      case 'proof_of_address':
        return this.extractByEntities(input, PROOF_OF_ADDRESS_ENTITY_ALIASES, start);
      case 'payslip':
        return this.extractByEntities(input, PAYSLIP_ENTITY_ALIASES, start);
      case 'bank_statement':
        return this.extractByEntities(input, BANK_STATEMENT_ENTITY_ALIASES, start);
      default:
        return this.extractBillFields(input, start);
    }
  }

  // Invoice/Expense-parser entity type names as published in Google's Document AI schema
  // reference -- reconstructed from documentation, not verified against a live response (same
  // disclosed uncertainty: multiple candidate
  // names are checked per field for the same reason). There is no standard "account_number"
  // entity on Google's stock Invoice/Expense parsers -- left unmapped (undefined) rather than
  // guessing a field name that likely doesn't exist, since Document AI's invoice processor has no
  // real, documented SummaryField type.
  private async extractBillFields(
    input: ProcessingInput,
    start: number,
  ): Promise<FieldExtractionResult> {
    const processorId = this.config.invoiceProcessorId ?? this.config.processorId;
    const { entities } = await this.process(input, processorId);

    const find = (...types: string[]) =>
      types.map((t) => entities.get(t)).find((v) => v !== undefined);

    const supplierName = find('supplier_name');
    const amountDue = find('total_amount', 'due_amount', 'amount_due');
    const dueDate = find('due_date');
    const statementDate = find('invoice_date', 'receipt_date');
    const invoiceNumber = find('invoice_id', 'receipt_id');

    const confidences = [supplierName, amountDue, dueDate, statementDate, invoiceNumber]
      .filter((v): v is { text: string; confidence: number } => v !== undefined)
      .map((v) => v.confidence);
    const overallConfidence =
      confidences.length > 0 ? confidences.reduce((a, b) => a + b, 0) / confidences.length : 0;

    return {
      supplierName: toExtractedField(supplierName?.text, supplierName?.confidence ?? 0),
      amountDue: toExtractedField(
        parseCurrencyToNumber(amountDue?.text),
        amountDue?.confidence ?? 0,
      ),
      dueDate: toExtractedField(dueDate?.text, dueDate?.confidence ?? 0),
      statementDate: toExtractedField(statementDate?.text, statementDate?.confidence ?? 0),
      invoiceNumber: toExtractedField(invoiceNumber?.text, invoiceNumber?.confidence ?? 0),
      overallConfidence,
      metadata: this.metadata(Date.now() - start),
    };
  }

  // Google has no purpose-built lease-agreement processor (there is no natural-language query
  // which works against any document with no per-vendor training). The only viable path is a
  // Document AI "Custom Extractor" processor Mohammed trains himself in Cloud Console -- this
  // implementation only works correctly once he labels its training entities with these EXACT
  // type names (tenantName, rentAmount, depositAmount, leaseStartDate, leaseEndDate,
  // propertyAddress), documented here rather than guessed at, since there is no default schema to
  // fall back to.
  // Generic Custom-Extractor-entity reader shared by every entity-based document type (lease, and
  // the 4 applicant document types added WORKLOG.md 2026-08-25) -- each still only works correctly
  // once Mohammed trains a processor whose entity labels match these exact alias names (documented
  // per query-set constant below), same caveat the original lease-only version already carried.
  private async extractByEntities(
    input: ProcessingInput,
    aliases: (keyof FieldExtractionResult)[],
    start: number,
  ): Promise<FieldExtractionResult> {
    const { entities } = await this.process(input, this.config.processorId);

    const confidences = aliases
      .map((alias) => entities.get(alias))
      .filter((v): v is { text: string; confidence: number } => v !== undefined)
      .map((v) => v.confidence);
    const overallConfidence =
      confidences.length > 0 ? confidences.reduce((a, b) => a + b, 0) / confidences.length : 0;

    const result: FieldExtractionResult = {
      overallConfidence,
      metadata: this.metadata(Date.now() - start),
    };
    for (const alias of aliases) {
      const entity = entities.get(alias);
      const field = NUMERIC_FIELD_ALIASES.has(alias)
        ? toExtractedField(parseCurrencyToNumber(entity?.text), entity?.confidence ?? 0)
        : toExtractedField(entity?.text, entity?.confidence ?? 0);
      if (field !== undefined) {
        (result as unknown as Record<string, unknown>)[alias] = field;
      }
    }
    return result;
  }

  private async process(
    input: ProcessingInput,
    processorId: string,
  ): Promise<{
    rawText: { text: string; confidence: number };
    entities: Map<string, { text: string; confidence: number }>;
  }> {
    const bytes = await fetchDocumentBytes(input, this.providerName);
    const accessToken = await this.getAccessToken();
    const endpoint = `https://${this.config.location}-documentai.googleapis.com/v1/projects/${this.config.projectId}/locations/${this.config.location}/processors/${processorId}:process`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rawDocument: {
          content: Buffer.from(bytes).toString('base64'),
          mimeType: input.mimeType,
        },
      }),
    });
    if (!response.ok) {
      const retryable = response.status === 429 || response.status >= 500;
      throw new ProviderError(
        `Google Document AI returned ${response.status}`,
        retryable ? 'retryable' : 'non_retryable',
        this.providerName,
      );
    }
    const payload = (await response.json()) as GoogleDocumentAIResponse;
    const text = payload.document?.text ?? '';

    const tokenConfidences = (payload.document?.pages ?? [])
      .flatMap((page) => page.tokens ?? [])
      .map((token) => token.layout?.confidence)
      .filter((c): c is number => typeof c === 'number');
    const rawTextConfidence =
      tokenConfidences.length > 0
        ? tokenConfidences.reduce((a, b) => a + b, 0) / tokenConfidences.length
        : 0;

    const entities = new Map<string, { text: string; confidence: number }>();
    for (const entity of payload.document?.entities ?? []) {
      if (entity.type && entity.mentionText) {
        entities.set(entity.type, { text: entity.mentionText, confidence: entity.confidence ?? 0 });
      }
    }

    return { rawText: { text, confidence: rawTextConfidence }, entities };
  }

  // OAuth2 service-account JWT-bearer flow (Google's documented server-to-server auth for
  // credentials with no interactive user) -- cached in-instance since a Next.js server process
  // handles multiple requests and each real Document AI call would otherwise mint a fresh token.
  // The cache is intentionally NOT shared across provider instances/requests via any external
  // store; a fresh instance (e.g. a new serverless invocation) just re-authenticates, same
  // tradeoff every stateless-function OAuth client in this codebase's own dependencies makes.
  private async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.cachedToken && this.cachedToken.expiresAtMs > now + 60_000) {
      return this.cachedToken.value;
    }

    const issuedAt = Math.floor(now / 1000);
    const expiresAt = issuedAt + 3600;
    const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claims = base64Url(
      JSON.stringify({
        iss: this.config.clientEmail,
        scope: 'https://www.googleapis.com/auth/cloud-platform',
        aud: 'https://oauth2.googleapis.com/token',
        iat: issuedAt,
        exp: expiresAt,
      }),
    );
    const signingInput = `${header}.${claims}`;
    const signature = base64Url(
      createSign('RSA-SHA256').update(signingInput).sign(this.config.privateKey),
    );
    const assertion = `${signingInput}.${signature}`;

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
    });
    if (!response.ok) {
      throw new ProviderError(
        `Google OAuth2 token exchange failed (${response.status}) -- check GOOGLE_DOCUMENT_AI_CREDENTIALS_JSON`,
        'non_retryable',
        this.providerName,
      );
    }
    const payload = (await response.json()) as { access_token?: string; expires_in?: number };
    if (!payload.access_token) {
      throw new ProviderError(
        'Google OAuth2 response had no access_token',
        'retryable',
        this.providerName,
      );
    }
    this.cachedToken = {
      value: payload.access_token,
      expiresAtMs: now + (payload.expires_in ?? 3600) * 1000,
    };
    return payload.access_token;
  }

  private metadata(processingDurationMs: number): ProviderMetadata {
    // Document AI pricing is per-page and varies by processor type -- left null (unknown), same
    // convention the mock provider uses above, rather than guessing
    // a number that would misrepresent real spend on any usage/cost dashboard reading this field.
    return {
      providerName: this.providerName,
      providerVersion: null,
      processingDurationMs,
      estimatedCostUsd: null,
    };
  }
}

/**
 * The one place a provider is chosen.
 *
 * Google Cloud Document AI is the only real OCR provider Proplyst supports (architecture decision
 * confirmed by Mohammed, 12 September 2026). An AWS Textract implementation used to live in this
 * file and, worse, took precedence over Google whenever AWS credentials happened to be present --
 * so a stale AWS_REGION left over from something unrelated could silently route customer documents
 * to a vendor the Privacy Policy does not name. It has been removed outright rather than
 * de-prioritised, so that failure mode cannot come back by configuration.
 *
 * There is no second real provider and no precedence to reason about: either Document AI is fully
 * configured, or nothing real runs.
 */
export function getDocumentIntelligenceProvider(): DocumentIntelligenceProvider {
  const googleConfig = getGoogleDocumentAIConfig();
  if (googleConfig) {
    return new GoogleDocumentAIProvider(googleConfig);
  }
  return new MockDocumentIntelligenceProvider();
}

/**
 * Whether a REAL provider is configured, as opposed to the mock standing in for one.
 *
 * Callers must use this before presenting extraction output as though a document had actually been
 * read -- the mock returns plausible-looking values, and passing those off as real OCR would be a
 * lie to the user. See the platform-admin pages, which surface it.
 */
export function isRealDocumentIntelligenceProviderConfigured(): boolean {
  return getGoogleDocumentAIConfig() !== null;
}
