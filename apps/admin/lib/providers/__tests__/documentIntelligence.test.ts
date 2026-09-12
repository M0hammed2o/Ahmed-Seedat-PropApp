import { afterEach, describe, expect, it } from 'vitest';
import {
  MockDocumentIntelligenceProvider,
  GoogleDocumentAIProvider,
  getDocumentIntelligenceProvider,
  isRealDocumentIntelligenceProviderConfigured,
} from '../documentIntelligence';

describe('MockDocumentIntelligenceProvider', () => {
  it('exposes providerName "mock", matching metadata.providerName on every result', async () => {
    const provider = new MockDocumentIntelligenceProvider();
    expect(provider.providerName).toBe('mock');
    const result = await provider.extractText({
      documentId: 'd-1',
      storagePath: 'x',
      mimeType: 'application/pdf',
    });
    expect(result.metadata.providerName).toBe('mock');
  });

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

  it('labels its extracted text as mock, so it can never read as a real OCR result', async () => {
    const result = await new MockDocumentIntelligenceProvider().extractText({
      documentId: 'd-1',
      storagePath: 'x',
      mimeType: 'application/pdf',
    });
    expect(result.rawText).toContain('MOCK');
  });
});

/**
 * Provider selection after the AWS Textract removal (12 September 2026).
 *
 * Proplyst supports exactly one real OCR provider: Google Cloud Document AI. Textract used to live
 * in the same module and, worse, was checked FIRST — so a stale `AWS_REGION` inherited from
 * anything else in the environment would silently route customer documents to a vendor the Privacy
 * Policy does not name. These tests pin the replacement contract: Google when configured, the mock
 * otherwise, and nothing else ever.
 */
describe('getDocumentIntelligenceProvider', () => {
  const GOOGLE_VARS = [
    'GOOGLE_CLOUD_PROJECT_ID',
    'GOOGLE_CLOUD_LOCATION',
    'GOOGLE_DOCUMENT_AI_PROCESSOR_ID',
    'GOOGLE_DOCUMENT_AI_CREDENTIALS_JSON',
  ] as const;
  const AWS_VARS = [
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'AWS_TEXTRACT_REGION',
    'AWS_REGION',
  ] as const;

  const saved = new Map<string, string | undefined>();
  function setEnv(key: string, value: string | undefined) {
    if (!saved.has(key)) saved.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  function configureGoogle() {
    setEnv('GOOGLE_CLOUD_PROJECT_ID', 'proj');
    setEnv('GOOGLE_CLOUD_LOCATION', 'eu');
    setEnv('GOOGLE_DOCUMENT_AI_PROCESSOR_ID', 'proc');
    setEnv(
      'GOOGLE_DOCUMENT_AI_CREDENTIALS_JSON',
      JSON.stringify({ client_email: 'svc@example.iam.gserviceaccount.com', private_key: 'k' }),
    );
  }

  afterEach(() => {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    saved.clear();
  });

  it('returns the Google provider when Document AI is fully configured', () => {
    configureGoogle();
    const provider = getDocumentIntelligenceProvider();
    expect(provider).toBeInstanceOf(GoogleDocumentAIProvider);
    expect(provider.providerName).toBe('google-document-ai');
    expect(isRealDocumentIntelligenceProviderConfigured()).toBe(true);
  });

  it('falls back to the mock when Document AI is not configured', () => {
    for (const v of GOOGLE_VARS) setEnv(v, undefined);
    const provider = getDocumentIntelligenceProvider();
    expect(provider).toBeInstanceOf(MockDocumentIntelligenceProvider);
    expect(provider.providerName).toBe('mock');
    expect(isRealDocumentIntelligenceProviderConfigured()).toBe(false);
  });

  it('falls back to the mock when Document AI is only PARTIALLY configured', () => {
    configureGoogle();
    setEnv('GOOGLE_DOCUMENT_AI_PROCESSOR_ID', undefined);
    // Incomplete credentials must fail safe, never half-run against Google.
    expect(getDocumentIntelligenceProvider()).toBeInstanceOf(MockDocumentIntelligenceProvider);
    expect(isRealDocumentIntelligenceProviderConfigured()).toBe(false);
  });

  it('AWS credentials in the environment have no effect whatsoever', () => {
    // The regression this whole removal exists to prevent. Before it, these four variables — even
    // a stray AWS_REGION set for an unrelated reason — selected Textract over Google.
    configureGoogle();
    for (const v of AWS_VARS) setEnv(v, 'should-be-ignored');
    const provider = getDocumentIntelligenceProvider();
    expect(provider).toBeInstanceOf(GoogleDocumentAIProvider);
    expect(provider.providerName).toBe('google-document-ai');
  });

  it('AWS credentials alone do not make a real provider available', () => {
    for (const v of GOOGLE_VARS) setEnv(v, undefined);
    for (const v of AWS_VARS) setEnv(v, 'should-be-ignored');
    expect(getDocumentIntelligenceProvider()).toBeInstanceOf(MockDocumentIntelligenceProvider);
    expect(isRealDocumentIntelligenceProviderConfigured()).toBe(false);
  });

  it('exposes no Textract export any more', async () => {
    const mod = (await import('../documentIntelligence')) as Record<string, unknown>;
    for (const name of [
      'AWSTextractDocumentIntelligenceProvider',
      'getTextractConfig',
      'TextractConfig',
    ]) {
      expect(mod[name], `${name} must no longer be exported`).toBeUndefined();
    }
  });
});
