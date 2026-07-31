import 'server-only';
import type {
  ClassificationResult,
  DocumentIntelligenceProvider,
  DocumentType,
  FieldExtractionResult,
  OcrResult,
  ProcessingInput,
} from '@propvault/types';

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

  async extractFields(_input: ProcessingInput, documentType: DocumentType): Promise<FieldExtractionResult> {
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

export function getDocumentIntelligenceProvider(): DocumentIntelligenceProvider {
  return new MockDocumentIntelligenceProvider();
}
