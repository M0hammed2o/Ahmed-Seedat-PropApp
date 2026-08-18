import 'server-only';
import {
  TextractClient,
  AnalyzeExpenseCommand,
  AnalyzeDocumentCommand,
  DetectDocumentTextCommand,
} from '@aws-sdk/client-textract';
import type { Block } from '@aws-sdk/client-textract';
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

export interface TextractConfig {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export function getTextractConfig(): TextractConfig | null {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  const region = process.env.AWS_TEXTRACT_REGION ?? process.env.AWS_REGION;
  if (!accessKeyId || !secretAccessKey || !region) return null;
  return { region, accessKeyId, secretAccessKey };
}

// Amazon Textract's synchronous APIs (used throughout this class) accept inline document bytes up
// to this size -- documented AWS limit for Bytes-based (non-S3) synchronous calls. A document over
// this size needs the async, S3-based StartDocumentAnalysis/GetDocumentAnalysis flow instead, not
// implemented here (TECHNICAL_DEBT_REGISTER.md TD-39) -- most single-page bills/statements are
// well under this, multi-page leases are the more likely case to hit it.
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
      `Document is ${bytes.byteLength} bytes, over Textract's ${MAX_SYNC_BYTES}-byte synchronous-API limit -- the async S3-based flow this provider doesn't yet implement is required for documents this large`,
      'non_retryable',
      providerName,
    );
  }
  return bytes;
}

function blocksToRawText(blocks: Block[] | undefined): { rawText: string; confidence: number } {
  const lines = (blocks ?? []).filter((b) => b.BlockType === 'LINE');
  const rawText = lines.map((b) => b.Text ?? '').join('\n');
  const confidences = lines.map((b) => (b.Confidence ?? 0) / 100).filter((c) => c > 0);
  const confidence =
    confidences.length > 0 ? confidences.reduce((a, b) => a + b, 0) / confidences.length : 0;
  return { rawText, confidence };
}

// Very small, disclosed-as-a-heuristic classifier -- Textract itself has no "what kind of document
// is this" feature (that's AWS Comprehend or a custom-trained classifier, neither wired here).
// Keyword matching on the raw OCR'd text, lower confidence than field extraction by design; a
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

const LEASE_QUERIES: { alias: keyof FieldExtractionResult; text: string }[] = [
  { alias: 'tenantName', text: 'Who is the tenant?' },
  { alias: 'rentAmount', text: 'What is the monthly rent amount?' },
  { alias: 'depositAmount', text: 'What is the deposit amount?' },
  { alias: 'leaseStartDate', text: 'What is the lease start date?' },
  { alias: 'leaseEndDate', text: 'What is the lease end date?' },
  { alias: 'propertyAddress', text: 'What is the address of the rental property?' },
];

function extractQueryAnswers(
  blocks: Block[] | undefined,
): Map<string, { text: string; confidence: number }> {
  const blockById = new Map((blocks ?? []).map((b) => [b.Id, b]));
  const results = new Map<string, { text: string; confidence: number }>();
  for (const block of blocks ?? []) {
    if (block.BlockType !== 'QUERY' || !block.Query?.Alias) continue;
    const answerRelation = block.Relationships?.find((r) => r.Type === 'ANSWER');
    const answerBlock = answerRelation?.Ids?.[0] ? blockById.get(answerRelation.Ids[0]) : undefined;
    if (answerBlock?.Text) {
      results.set(block.Query.Alias, {
        text: answerBlock.Text,
        confidence: (answerBlock.Confidence ?? 0) / 100,
      });
    }
  }
  return results;
}

// Real AWS Textract integration (Stage 5, commercial-launch execution plan, WORKLOG.md this
// date), per Mohammed's vendor decision this date. No real AWS account/IAM credentials exist in
// this environment (external-service blocker, same class of gap as PayFast/Resend/Meta --
// TECHNICAL_DEBT_REGISTER.md TD-36/37/38/39) -- never run against live Textract this session.
//
// Two different Textract features for the two document types this codebase extracts fields for,
// not one generic call reused for both:
//   - 'bill': AnalyzeExpenseCommand -- a purpose-built Textract feature for invoices/receipts/
//     utility bills, returning normalized SummaryFields (VENDOR_NAME, ACCOUNT_NUMBER, DUE_DATE,
//     ...). The exact set of normalized Type.Text values was reconstructed from AWS's published
//     documentation/training-data knowledge, not verified against a live response -- multiple
//     candidate aliases are checked per field (e.g. AMOUNT_DUE falling back to TOTAL) specifically
//     because of that uncertainty, so a real response is more likely to match on at least one.
//   - 'lease': no purpose-built AWS feature exists for lease agreements, so this uses
//     AnalyzeDocumentCommand's QUERIES feature -- natural-language questions Textract answers
//     directly against the document, aliased to this codebase's own field names so the response
//     can be mapped back without positional guessing.
// classify()/extractText() apply to either document type and use DetectDocumentTextCommand (raw
// OCR) -- classify() is a disclosed keyword heuristic on top of that text, not a real ML
// classifier (Textract itself doesn't do document-type classification).
export class AWSTextractDocumentIntelligenceProvider implements DocumentIntelligenceProvider {
  private readonly client: TextractClient;
  readonly providerName = 'aws-textract';

  constructor(config: TextractConfig) {
    this.client = new TextractClient({
      region: config.region,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    });
  }

  async classify(input: ProcessingInput): Promise<ClassificationResult> {
    const start = Date.now();
    const { rawText } = await this.detectText(input);
    const { documentType, confidence } = classifyFromText(rawText);
    return { documentType, confidence, metadata: this.metadata(Date.now() - start) };
  }

  async extractText(input: ProcessingInput): Promise<OcrResult> {
    const start = Date.now();
    const { rawText, confidence } = await this.detectText(input);
    return { rawText, confidence, metadata: this.metadata(Date.now() - start) };
  }

  async extractFields(
    input: ProcessingInput,
    documentType: DocumentType,
  ): Promise<FieldExtractionResult> {
    const start = Date.now();
    if (documentType === 'lease') {
      return this.extractLeaseFields(input, start);
    }
    return this.extractBillFields(input, start);
  }

  private async detectText(
    input: ProcessingInput,
  ): Promise<{ rawText: string; confidence: number }> {
    const bytes = await fetchDocumentBytes(input, this.providerName);
    const response = await this.client.send(
      new DetectDocumentTextCommand({ Document: { Bytes: bytes } }),
    );
    return blocksToRawText(response.Blocks);
  }

  private async extractBillFields(
    input: ProcessingInput,
    start: number,
  ): Promise<FieldExtractionResult> {
    const bytes = await fetchDocumentBytes(input, this.providerName);
    const response = await this.client.send(
      new AnalyzeExpenseCommand({ Document: { Bytes: bytes } }),
    );
    const summaryFields = response.ExpenseDocuments?.[0]?.SummaryFields ?? [];

    const byType = new Map<string, { text: string; confidence: number }>();
    for (const field of summaryFields) {
      const type = field.Type?.Text;
      const text = field.ValueDetection?.Text;
      if (type && text) {
        byType.set(type, { text, confidence: (field.ValueDetection?.Confidence ?? 0) / 100 });
      }
    }
    const find = (...types: string[]) =>
      types.map((t) => byType.get(t)).find((v) => v !== undefined);

    const supplierName = find('VENDOR_NAME');
    const accountNumber = find('ACCOUNT_NUMBER');
    const amountDue = find('AMOUNT_DUE', 'TOTAL', 'BALANCE_DUE');
    const dueDate = find('DUE_DATE');
    const statementDate = find('INVOICE_RECEIPT_DATE', 'STATEMENT_DATE');
    const invoiceNumber = find('INVOICE_RECEIPT_ID');

    const confidences = [
      supplierName,
      accountNumber,
      amountDue,
      dueDate,
      statementDate,
      invoiceNumber,
    ]
      .filter((v): v is { text: string; confidence: number } => v !== undefined)
      .map((v) => v.confidence);
    const overallConfidence =
      confidences.length > 0 ? confidences.reduce((a, b) => a + b, 0) / confidences.length : 0;

    return {
      supplierName: toExtractedField(supplierName?.text, supplierName?.confidence ?? 0),
      accountNumber: toExtractedField(accountNumber?.text, accountNumber?.confidence ?? 0),
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

  private async extractLeaseFields(
    input: ProcessingInput,
    start: number,
  ): Promise<FieldExtractionResult> {
    const bytes = await fetchDocumentBytes(input, this.providerName);
    const response = await this.client.send(
      new AnalyzeDocumentCommand({
        Document: { Bytes: bytes },
        FeatureTypes: ['QUERIES'],
        QueriesConfig: { Queries: LEASE_QUERIES.map((q) => ({ Text: q.text, Alias: q.alias })) },
      }),
    );
    const answers = extractQueryAnswers(response.Blocks);

    const tenantName = answers.get('tenantName');
    const rentAmount = answers.get('rentAmount');
    const depositAmount = answers.get('depositAmount');
    const leaseStartDate = answers.get('leaseStartDate');
    const leaseEndDate = answers.get('leaseEndDate');
    const propertyAddress = answers.get('propertyAddress');

    const confidences = [...answers.values()].map((v) => v.confidence);
    const overallConfidence =
      confidences.length > 0 ? confidences.reduce((a, b) => a + b, 0) / confidences.length : 0;

    return {
      tenantName: toExtractedField(tenantName?.text, tenantName?.confidence ?? 0),
      rentAmount: toExtractedField(
        parseCurrencyToNumber(rentAmount?.text),
        rentAmount?.confidence ?? 0,
      ),
      depositAmount: toExtractedField(
        parseCurrencyToNumber(depositAmount?.text),
        depositAmount?.confidence ?? 0,
      ),
      leaseStartDate: toExtractedField(leaseStartDate?.text, leaseStartDate?.confidence ?? 0),
      leaseEndDate: toExtractedField(leaseEndDate?.text, leaseEndDate?.confidence ?? 0),
      propertyAddress: toExtractedField(propertyAddress?.text, propertyAddress?.confidence ?? 0),
      overallConfidence,
      metadata: this.metadata(Date.now() - start),
    };
  }

  private metadata(processingDurationMs: number): ProviderMetadata {
    // Textract pricing is per-page/per-API-call, not a flat per-document cost -- estimatedCostUsd
    // left null (DocumentIntelligenceProvider's own type treats null as "unknown," not zero)
    // rather than guessing a number that would misrepresent real spend on any usage/cost dashboard
    // reading this field.
    return {
      providerName: this.providerName,
      providerVersion: null,
      processingDurationMs,
      estimatedCostUsd: null,
    };
  }
}

// Google Document AI integration (overnight platform pass, WORKLOG.md this date, Phase 8-11) --
// a second real DocumentIntelligenceProvider alongside AWS Textract, not a replacement.
// getDocumentIntelligenceProvider() below still checks Textract FIRST specifically to preserve
// existing behaviour for any environment that already has AWS credentials configured (CORE
// OPERATING RULES: "Preserve all existing working... behaviour" -- silently swapping the default
// vendor for an already-working integration is exactly the kind of shortcut that rule forbids).
// Google is only selected when Textract is not configured.
//
// No @google-cloud/documentai SDK dependency was added -- this implements the OAuth2 service-
// account JWT-bearer flow directly with Node's built-in `node:crypto` and calls the Document AI
// REST API with `fetch`, matching this codebase's existing preference for small, dependency-free
// provider implementations and avoiding a new package install in an environment where that could
// not be verified against a reachable registry this session.
//
// No real Google Cloud project/service account exists in this environment (same class of
// external-service blocker as AWS/Meta/Resend/PayFast) -- never fabricate a successful call
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
   * Google has no single processor that handles both bills and leases well, unlike Textract's
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
    if (documentType === 'lease') {
      return this.extractLeaseFields(input, start);
    }
    return this.extractBillFields(input, start);
  }

  // Invoice/Expense-parser entity type names as published in Google's Document AI schema
  // reference -- reconstructed from documentation, not verified against a live response (same
  // disclosed uncertainty as Textract's AnalyzeExpense field aliases above; multiple candidate
  // names are checked per field for the same reason). There is no standard "account_number"
  // entity on Google's stock Invoice/Expense parsers -- left unmapped (undefined) rather than
  // guessing a field name that likely doesn't exist, unlike Textract where ACCOUNT_NUMBER is a
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

  // Google has no purpose-built lease-agreement processor (unlike Textract's QUERIES feature,
  // which works against any document with no per-vendor training). The only viable path is a
  // Document AI "Custom Extractor" processor Mohammed trains himself in Cloud Console -- this
  // implementation only works correctly once he labels its training entities with these EXACT
  // type names (tenantName, rentAmount, depositAmount, leaseStartDate, leaseEndDate,
  // propertyAddress), documented here rather than guessed at, since there is no default schema to
  // fall back to.
  private async extractLeaseFields(
    input: ProcessingInput,
    start: number,
  ): Promise<FieldExtractionResult> {
    const { entities } = await this.process(input, this.config.processorId);

    const tenantName = entities.get('tenantName');
    const rentAmount = entities.get('rentAmount');
    const depositAmount = entities.get('depositAmount');
    const leaseStartDate = entities.get('leaseStartDate');
    const leaseEndDate = entities.get('leaseEndDate');
    const propertyAddress = entities.get('propertyAddress');

    const confidences = [
      tenantName,
      rentAmount,
      depositAmount,
      leaseStartDate,
      leaseEndDate,
      propertyAddress,
    ]
      .filter((v): v is { text: string; confidence: number } => v !== undefined)
      .map((v) => v.confidence);
    const overallConfidence =
      confidences.length > 0 ? confidences.reduce((a, b) => a + b, 0) / confidences.length : 0;

    return {
      tenantName: toExtractedField(tenantName?.text, tenantName?.confidence ?? 0),
      rentAmount: toExtractedField(
        parseCurrencyToNumber(rentAmount?.text),
        rentAmount?.confidence ?? 0,
      ),
      depositAmount: toExtractedField(
        parseCurrencyToNumber(depositAmount?.text),
        depositAmount?.confidence ?? 0,
      ),
      leaseStartDate: toExtractedField(leaseStartDate?.text, leaseStartDate?.confidence ?? 0),
      leaseEndDate: toExtractedField(leaseEndDate?.text, leaseEndDate?.confidence ?? 0),
      propertyAddress: toExtractedField(propertyAddress?.text, propertyAddress?.confidence ?? 0),
      overallConfidence,
      metadata: this.metadata(Date.now() - start),
    };
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
    // convention as AWSTextractDocumentIntelligenceProvider.metadata() above, rather than guessing
    // a number that would misrepresent real spend on any usage/cost dashboard reading this field.
    return {
      providerName: this.providerName,
      providerVersion: null,
      processingDurationMs,
      estimatedCostUsd: null,
    };
  }
}

// PRECEDENCE (explicit, not incidental -- infrastructure hardening pass, WORKLOG.md this date):
// AWS Textract wins whenever BOTH AWS and Google credentials are configured; Google Document AI
// is only used when Textract's own required env vars are absent. This order predates Google's
// integration (Textract was the original/only provider; Google was added later as a second
// option, per WORKLOG.md's own "second extraction provider" framing) and has never been
// deliberately revisited as a product decision -- it is simply "whichever was checked first" in
// the original implementation. A live production test (WORKLOG.md this date) proved a REAL
// (non-Mock) provider is active and correctly extracting text, but could not determine from the
// app's own data alone whether that was Textract or Google specifically, precisely because this
// precedence was implicit. extraction_jobs.provider_name / extraction_results.provider_name (now
// actually populated, see the two extract routes) closes that observability gap going forward --
// this function's OWN precedence is deliberately left unchanged here, since silently reordering
// it without evidence of which vendor Mohammed actually intends as primary would be a real
// behavior change, not an infrastructure/observability fix. Flagged as an open product question
// in this pass's own completion report, not decided unilaterally.
export function getDocumentIntelligenceProvider(): DocumentIntelligenceProvider {
  const textractConfig = getTextractConfig();
  if (textractConfig) {
    // Final pre-UAT engineering pass (WORKLOG.md this date): Google Document AI is the intended
    // production provider (SUBSCRIPTIONS.md-adjacent decision, confirmed by Mohammed). If AWS
    // Textract env vars are ALSO present -- even stale leftovers from an earlier setup attempt --
    // this branch silently wins per the precedence comment above, which would mean Google looks
    // configured but never actually runs. No credential VALUES are logged here, only the fact that
    // both are present, so Mohammed can catch this from server logs rather than discovering it only
    // via extraction_results.provider_name after documents have already been processed by the
    // wrong vendor.
    if (getGoogleDocumentAIConfig() !== null) {
      console.warn(
        '[documentIntelligence] Both AWS Textract and Google Document AI credentials are configured -- AWS Textract is taking precedence (see the PRECEDENCE comment above getDocumentIntelligenceProvider()). If Google Document AI is intended as the active provider, remove the AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY/AWS_TEXTRACT_REGION/AWS_REGION environment variables.',
      );
    }
    return new AWSTextractDocumentIntelligenceProvider(textractConfig);
  }
  const googleConfig = getGoogleDocumentAIConfig();
  if (googleConfig) {
    return new GoogleDocumentAIProvider(googleConfig);
  }
  return new MockDocumentIntelligenceProvider();
}

export function isRealDocumentIntelligenceProviderConfigured(): boolean {
  return getTextractConfig() !== null || getGoogleDocumentAIConfig() !== null;
}
