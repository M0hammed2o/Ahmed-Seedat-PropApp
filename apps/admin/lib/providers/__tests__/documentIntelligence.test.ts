import { afterEach, describe, expect, it, vi } from 'vitest';
import { TextractClient } from '@aws-sdk/client-textract';
import {
  MockDocumentIntelligenceProvider,
  AWSTextractDocumentIntelligenceProvider,
  type TextractConfig,
} from '../documentIntelligence';

describe('MockDocumentIntelligenceProvider', () => {
  it('extractFields returns lease-shaped fields for documentType "lease"', async () => {
    const provider = new MockDocumentIntelligenceProvider();
    const result = await provider.extractFields(
      { documentId: 'd-1', storagePath: 'x', mimeType: 'application/pdf' },
      'lease',
    );
    expect(result.tenantName).toBeDefined();
    expect(result.supplierName).toBeUndefined();
  });

  it('extractFields returns bill-shaped fields for documentType "bill"', async () => {
    const provider = new MockDocumentIntelligenceProvider();
    const result = await provider.extractFields(
      { documentId: 'd-1', storagePath: 'x', mimeType: 'application/pdf' },
      'bill',
    );
    expect(result.supplierName).toBeDefined();
    expect(result.tenantName).toBeUndefined();
  });
});

const CONFIG: TextractConfig = {
  region: 'af-south-1',
  accessKeyId: 'test-key',
  secretAccessKey: 'test-secret',
};

// Mocks TextractClient.prototype.send rather than the whole module -- so the provider's own
// Command-construction (AnalyzeExpenseCommand/AnalyzeDocumentCommand/DetectDocumentTextCommand)
// is exercised for real; only the actual network call is stubbed.
function mockTextractSend(responses: unknown[]) {
  const sendSpy = vi.fn();
  for (const response of responses) sendSpy.mockResolvedValueOnce(response);
  vi.spyOn(TextractClient.prototype, 'send').mockImplementation(sendSpy as never);
  return sendSpy;
}

describe('AWSTextractDocumentIntelligenceProvider', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function mockDocumentFetch() {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(10),
    }) as unknown as typeof fetch;
  }

  it('throws a non_retryable ProviderError when no signedUrl is provided', async () => {
    const provider = new AWSTextractDocumentIntelligenceProvider(CONFIG);
    await expect(
      provider.extractText({ documentId: 'd-1', storagePath: 'x', mimeType: 'application/pdf' }),
    ).rejects.toThrow(/signedUrl/);
  });

  it('extractText concatenates LINE blocks and averages their confidence', async () => {
    mockDocumentFetch();
    mockTextractSend([
      {
        Blocks: [
          { BlockType: 'LINE', Text: 'CITY OF CAPE TOWN', Confidence: 99 },
          { BlockType: 'LINE', Text: 'Account: 12345', Confidence: 95 },
          { BlockType: 'WORD', Text: 'ignored', Confidence: 10 },
        ],
      },
    ]);
    const provider = new AWSTextractDocumentIntelligenceProvider(CONFIG);
    const result = await provider.extractText({
      documentId: 'd-1',
      storagePath: 'x',
      mimeType: 'application/pdf',
      signedUrl: 'https://example.test/x',
    });
    expect(result.rawText).toBe('CITY OF CAPE TOWN\nAccount: 12345');
    expect(result.confidence).toBeCloseTo(0.97, 2);
  });

  it('extractFields("bill") maps AnalyzeExpense SummaryFields onto the bill-shaped result', async () => {
    mockDocumentFetch();
    mockTextractSend([
      {
        ExpenseDocuments: [
          {
            SummaryFields: [
              {
                Type: { Text: 'VENDOR_NAME' },
                ValueDetection: { Text: 'City of Cape Town', Confidence: 98 },
              },
              {
                Type: { Text: 'ACCOUNT_NUMBER' },
                ValueDetection: { Text: '000111222', Confidence: 96 },
              },
              {
                Type: { Text: 'AMOUNT_DUE' },
                ValueDetection: { Text: 'R 1,234.56', Confidence: 92 },
              },
              {
                Type: { Text: 'DUE_DATE' },
                ValueDetection: { Text: '2026-09-01', Confidence: 90 },
              },
            ],
          },
        ],
      },
    ]);
    const provider = new AWSTextractDocumentIntelligenceProvider(CONFIG);
    const result = await provider.extractFields(
      {
        documentId: 'd-1',
        storagePath: 'x',
        mimeType: 'application/pdf',
        signedUrl: 'https://example.test/x',
      },
      'bill',
    );
    expect(result.supplierName).toEqual({ value: 'City of Cape Town', confidence: 0.98 });
    expect(result.accountNumber?.value).toBe('000111222');
    expect(result.amountDue?.value).toBeCloseTo(1234.56, 2);
    expect(result.dueDate?.value).toBe('2026-09-01');
  });

  it('extractFields("bill") falls back from AMOUNT_DUE to TOTAL when AMOUNT_DUE is absent', async () => {
    mockDocumentFetch();
    mockTextractSend([
      {
        ExpenseDocuments: [
          {
            SummaryFields: [
              { Type: { Text: 'TOTAL' }, ValueDetection: { Text: '499.00', Confidence: 91 } },
            ],
          },
        ],
      },
    ]);
    const provider = new AWSTextractDocumentIntelligenceProvider(CONFIG);
    const result = await provider.extractFields(
      {
        documentId: 'd-1',
        storagePath: 'x',
        mimeType: 'application/pdf',
        signedUrl: 'https://example.test/x',
      },
      'bill',
    );
    expect(result.amountDue?.value).toBeCloseTo(499, 2);
  });

  it('extractFields("lease") maps QUERY/QUERY_RESULT answer blocks by alias', async () => {
    mockDocumentFetch();
    mockTextractSend([
      {
        Blocks: [
          {
            BlockType: 'QUERY',
            Id: 'q1',
            Query: { Alias: 'tenantName' },
            Relationships: [{ Type: 'ANSWER', Ids: ['a1'] }],
          },
          { BlockType: 'QUERY_RESULT', Id: 'a1', Text: 'Jane Doe', Confidence: 88 },
          {
            BlockType: 'QUERY',
            Id: 'q2',
            Query: { Alias: 'rentAmount' },
            Relationships: [{ Type: 'ANSWER', Ids: ['a2'] }],
          },
          { BlockType: 'QUERY_RESULT', Id: 'a2', Text: 'R 8,500.00', Confidence: 80 },
        ],
      },
    ]);
    const provider = new AWSTextractDocumentIntelligenceProvider(CONFIG);
    const result = await provider.extractFields(
      {
        documentId: 'd-1',
        storagePath: 'x',
        mimeType: 'application/pdf',
        signedUrl: 'https://example.test/x',
      },
      'lease',
    );
    expect(result.tenantName?.value).toBe('Jane Doe');
    expect(result.rentAmount?.value).toBeCloseTo(8500, 2);
    expect(result.leaseStartDate).toBeUndefined();
  });

  it('rejects a document over the synchronous-API size limit rather than sending a truncated payload', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(6 * 1024 * 1024),
    }) as unknown as typeof fetch;
    const provider = new AWSTextractDocumentIntelligenceProvider(CONFIG);
    await expect(
      provider.extractText({
        documentId: 'd-1',
        storagePath: 'x',
        mimeType: 'application/pdf',
        signedUrl: 'https://example.test/x',
      }),
    ).rejects.toThrow(/synchronous-API limit/);
  });
});
