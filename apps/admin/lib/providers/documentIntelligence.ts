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

export function getDocumentIntelligenceProvider(): DocumentIntelligenceProvider {
  const textractConfig = getTextractConfig();
  if (textractConfig) {
    return new AWSTextractDocumentIntelligenceProvider(textractConfig);
  }
  return new MockDocumentIntelligenceProvider();
}
