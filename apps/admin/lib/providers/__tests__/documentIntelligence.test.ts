import { afterEach, describe, expect, it } from 'vitest';
import {
  MockDocumentIntelligenceProvider,
  GoogleDocumentAIProvider,
  DocumentIntelligenceUnavailableError,
  describeDocumentIntelligenceStatus,
  getDocumentIntelligenceProvider,
  isRealDocumentIntelligenceProviderConfigured,
  resolveDocumentIntelligence,
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

/**
 * Production must never execute the mock provider (13 September 2026).
 *
 * resolveDocumentIntelligence() takes the environment as an argument, so these cases describe
 * production, development and demo runtimes precisely without mutating process.env.
 */
describe('resolveDocumentIntelligence', () => {
  const GOOGLE_COMPLETE = {
    GOOGLE_CLOUD_PROJECT_ID: 'proj',
    GOOGLE_CLOUD_LOCATION: 'eu',
    GOOGLE_DOCUMENT_AI_PROCESSOR_ID: 'proc',
    GOOGLE_DOCUMENT_AI_CREDENTIALS_JSON: JSON.stringify({
      client_email: 'svc@example.iam.gserviceaccount.com',
      private_key: 'k',
    }),
  };
  const PROD = { NODE_ENV: 'production' };

  it('production + complete Google config -> real Google Document AI', () => {
    const r = resolveDocumentIntelligence({ ...PROD, ...GOOGLE_COMPLETE });
    expect(r.status).toBe('real');
    if (r.status === 'unavailable') throw new Error('unreachable');
    expect(r.provider).toBeInstanceOf(GoogleDocumentAIProvider);
    expect(r.provider.providerName).toBe('google-document-ai');
  });

  it('production + NO Google config -> unavailable, never the mock', () => {
    const r = resolveDocumentIntelligence(PROD);
    expect(r.status).toBe('unavailable');
    expect(r).not.toHaveProperty('provider');
  });

  it.each([
    'GOOGLE_CLOUD_PROJECT_ID',
    'GOOGLE_CLOUD_LOCATION',
    'GOOGLE_DOCUMENT_AI_PROCESSOR_ID',
    'GOOGLE_DOCUMENT_AI_CREDENTIALS_JSON',
  ])('production + PARTIAL Google config (missing %s) -> unavailable, never the mock', (missing) => {
    const env: Record<string, string | undefined> = { ...PROD, ...GOOGLE_COMPLETE };
    delete env[missing];
    expect(resolveDocumentIntelligence(env).status).toBe('unavailable');
  });

  it('production + malformed credentials JSON -> unavailable, never the mock', () => {
    const env = { ...PROD, ...GOOGLE_COMPLETE, GOOGLE_DOCUMENT_AI_CREDENTIALS_JSON: '{not json' };
    expect(resolveDocumentIntelligence(env).status).toBe('unavailable');
  });

  it('a Render deploy with NODE_ENV unset is still production -> unavailable', () => {
    expect(resolveDocumentIntelligence({ RENDER: 'true' }).status).toBe('unavailable');
  });

  it('production + demo-mode flags still cannot produce the mock', () => {
    const env = { ...PROD, NEXT_PUBLIC_DEMO_MODE: 'true', ALLOW_DEMO_MODE: 'true' };
    expect(resolveDocumentIntelligence(env).status).toBe('unavailable');
  });

  it('development + no Google config -> mock, so local work needs no credentials', () => {
    const r = resolveDocumentIntelligence({ NODE_ENV: 'development' });
    expect(r.status).toBe('mock');
    if (r.status === 'unavailable') throw new Error('unreachable');
    expect(r.provider).toBeInstanceOf(MockDocumentIntelligenceProvider);
  });

  it('test + no Google config -> mock, so automated tests need no credentials', () => {
    expect(resolveDocumentIntelligence({ NODE_ENV: 'test' }).status).toBe('mock');
  });

  it('an explicit demo environment (both demo flags, non-production) -> mock', () => {
    const env = { NEXT_PUBLIC_DEMO_MODE: 'true', ALLOW_DEMO_MODE: 'true' };
    expect(resolveDocumentIntelligence(env).status).toBe('mock');
  });

  it('an unknown runtime with no explicit permission -> unavailable', () => {
    expect(resolveDocumentIntelligence({}).status).toBe('unavailable');
  });

  it('Google wins over the mock wherever it is configured', () => {
    for (const base of [{ NODE_ENV: 'development' }, { NODE_ENV: 'test' }, PROD]) {
      expect(resolveDocumentIntelligence({ ...base, ...GOOGLE_COMPLETE }).status).toBe('real');
    }
  });
});

describe('getDocumentIntelligenceProvider fails closed', () => {
  const saved = new Map<string, string | undefined>();
  function setEnv(key: string, value: string | undefined) {
    if (!saved.has(key)) saved.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  afterEach(() => {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    saved.clear();
  });

  it('throws in production without Google, instead of handing back the mock', () => {
    setEnv('NODE_ENV', 'production');
    for (const v of [
      'GOOGLE_CLOUD_PROJECT_ID',
      'GOOGLE_CLOUD_LOCATION',
      'GOOGLE_DOCUMENT_AI_PROCESSOR_ID',
      'GOOGLE_DOCUMENT_AI_CREDENTIALS_JSON',
    ]) {
      setEnv(v, undefined);
    }
    // A future caller that forgets the availability check gets an error, never fabricated fields.
    expect(() => getDocumentIntelligenceProvider()).toThrow(DocumentIntelligenceUnavailableError);
  });
});

describe('describeDocumentIntelligenceStatus', () => {
  const GOOGLE_COMPLETE = {
    GOOGLE_CLOUD_PROJECT_ID: 'proj',
    GOOGLE_CLOUD_LOCATION: 'eu',
    GOOGLE_DOCUMENT_AI_PROCESSOR_ID: 'proc',
    GOOGLE_DOCUMENT_AI_CREDENTIALS_JSON: JSON.stringify({ client_email: 'a@b.c', private_key: 'k' }),
  };

  it('reports Google as connected when it is configured', () => {
    const s = describeDocumentIntelligenceStatus({ NODE_ENV: 'production', ...GOOGLE_COMPLETE });
    expect(s).toEqual({ connected: true, detail: 'google-document-ai' });
  });

  it('in production without Google, says extraction is refused -- not merely "not connected"', () => {
    const s = describeDocumentIntelligenceStatus({ NODE_ENV: 'production' });
    expect(s.connected).toBe(false);
    expect(s.detail).toMatch(/unavailable/i);
    expect(s.detail).toMatch(/refused/i);
    expect(s.detail).not.toMatch(/^mock/i);
  });

  it('never reports the mock as a connected provider', () => {
    const s = describeDocumentIntelligenceStatus({ NODE_ENV: 'development' });
    expect(s.connected).toBe(false);
    expect(s.detail).toMatch(/never used in production/i);
  });

  it('never includes a credential value', () => {
    const s = describeDocumentIntelligenceStatus({ NODE_ENV: 'production', ...GOOGLE_COMPLETE });
    expect(JSON.stringify(s)).not.toContain('a@b.c');
    expect(JSON.stringify(s)).not.toContain('proj');
  });
});
