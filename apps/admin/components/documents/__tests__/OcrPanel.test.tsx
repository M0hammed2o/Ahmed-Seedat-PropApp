// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { ExtractionResult } from '@propvault/types';
import { OcrPanel } from '../OcrPanel';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

afterEach(cleanup);

const RESULT: ExtractionResult = {
  id: 'result-1',
  extractionJobId: 'job-1',
  ownerUserId: null,
  orgId: 'org-1',
  rawProviderOutput: {
    tenantName: { value: 'Mock Tenant', confidence: 0.7 },
    rentAmount: { value: 8500, confidence: 0.65 },
    overallConfidence: 0.62,
    metadata: {
      providerName: 'mock',
      providerVersion: '1.0.0',
      processingDurationMs: 100,
      estimatedCostUsd: 0,
    },
  },
  overallConfidence: 0.62,
  providerName: 'mock',
  reviewedAt: null,
  reviewedBy: null,
  createdAt: '2026-08-01T00:00:00Z',
};

describe('OcrPanel', () => {
  it('renders nothing for a document type the provider does not support', () => {
    const { container } = render(
      <OcrPanel
        documentId="document-1"
        documentType="statement"
        extractionResult={null}
        canAct
        ocrEnabled
      />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('shows an "Extract fields" button when no extraction exists yet and the caller can act', () => {
    render(
      <OcrPanel
        documentId="document-1"
        documentType="lease"
        extractionResult={null}
        canAct
        ocrEnabled
      />,
    );
    expect(screen.getByText('Extract fields')).toBeTruthy();
  });

  it('shows extracted field values and a "Confirm reviewed" button once extraction exists but is unreviewed', () => {
    render(
      <OcrPanel
        documentId="document-1"
        documentType="lease"
        extractionResult={RESULT}
        canAct
        ocrEnabled
      />,
    );
    expect(screen.getByText('Mock Tenant')).toBeTruthy();
    expect(screen.getByText('Confirm reviewed')).toBeTruthy();
  });

  it('shows the reviewed timestamp instead of the confirm button once reviewed', () => {
    render(
      <OcrPanel
        documentId="document-1"
        documentType="lease"
        extractionResult={{ ...RESULT, reviewedAt: '2026-08-02T00:00:00Z' }}
        canAct
        ocrEnabled
      />,
    );
    expect(screen.getByText(/Reviewed/)).toBeTruthy();
    expect(screen.queryByText('Confirm reviewed')).toBeNull();
  });

  it('hides Extract/Confirm actions for a read-only caller', () => {
    render(
      <OcrPanel
        documentId="document-1"
        documentType="lease"
        extractionResult={null}
        canAct={false}
        ocrEnabled
      />,
    );
    expect(screen.queryByText('Extract fields')).toBeNull();
    expect(screen.getByText('No extraction yet.')).toBeTruthy();
  });

  it('shows a feature-lock notice instead of Extract fields when the org plan does not include OCR, even for a caller who can act', () => {
    render(
      <OcrPanel
        documentId="document-1"
        documentType="lease"
        extractionResult={null}
        canAct
        ocrEnabled={false}
      />,
    );
    expect(screen.queryByText('Extract fields')).toBeNull();
    expect(screen.getByText(/OCR extraction is available on Professional/)).toBeTruthy();
  });
});
