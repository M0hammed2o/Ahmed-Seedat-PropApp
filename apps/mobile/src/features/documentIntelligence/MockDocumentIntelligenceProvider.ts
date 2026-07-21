import type {
  ClassificationResult,
  DocumentIntelligenceProvider,
  FieldExtractionResult,
  OcrResult,
  ProcessingInput,
} from '@propvault/types';
import type { DocumentType } from '@propvault/types';

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Deterministic fake responses so the extraction-confirmation UI can be built and tested
 * without any OCR vendor account (brief: "Create MockDocumentIntelligenceProvider for local
 * development"). Never used in a production build — see DOCUMENT_INTELLIGENCE.md.
 */
export class MockDocumentIntelligenceProvider implements DocumentIntelligenceProvider {
  async classify(input: ProcessingInput): Promise<ClassificationResult> {
    await delay(300);
    const documentType: DocumentType = input.mimeType === 'application/pdf' ? 'bill' : 'other';
    return {
      documentType,
      confidence: 0.82,
      metadata: {
        providerName: 'mock',
        providerVersion: '1.0.0',
        processingDurationMs: 300,
        estimatedCostUsd: 0,
      },
    };
  }

  async extractText(_input: ProcessingInput): Promise<OcrResult> {
    await delay(400);
    return {
      rawText: 'MOCK EXTRACTED TEXT — no real OCR has run against this document.',
      confidence: 0.75,
      metadata: {
        providerName: 'mock',
        providerVersion: '1.0.0',
        processingDurationMs: 400,
        estimatedCostUsd: 0,
      },
    };
  }

  async extractFields(
    _input: ProcessingInput,
    _documentType: DocumentType,
  ): Promise<FieldExtractionResult> {
    await delay(500);
    return {
      supplierName: { value: 'City of Cape Town (mock)', confidence: 0.7 },
      accountNumber: { value: '000000000', confidence: 0.65 },
      amountDue: { value: 0, confidence: 0.5 },
      dueDate: { value: new Date().toISOString(), confidence: 0.6 },
      overallConfidence: 0.62,
      metadata: {
        providerName: 'mock',
        providerVersion: '1.0.0',
        processingDurationMs: 500,
        estimatedCostUsd: 0,
      },
    };
  }
}
