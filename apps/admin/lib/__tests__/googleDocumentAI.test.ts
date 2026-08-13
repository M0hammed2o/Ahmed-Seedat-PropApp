import { generateKeyPairSync } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderError } from '@propvault/types';
import {
  getGoogleDocumentAIConfig,
  GoogleDocumentAIProvider,
} from '../providers/documentIntelligence';

// Unit tests only -- never a real network call to Google (Phase 16's "mocked, never real paid
// calls in normal tests" rule, same as this codebase's WhatsApp/email test discipline for other
// vendors). `fetch` is stubbed for both legs the provider makes: the OAuth2 token exchange and
// the Document AI `:process` call. A real RSA keypair is generated locally purely so
// node:crypto.createSign() has a structurally valid PEM to sign with -- it never leaves this
// process and is never sent anywhere (the token endpoint itself is mocked, not real Google).

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const TEST_PRIVATE_KEY_PEM = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();

const ENV_KEYS = [
  'GOOGLE_CLOUD_PROJECT_ID',
  'GOOGLE_CLOUD_LOCATION',
  'GOOGLE_DOCUMENT_AI_PROCESSOR_ID',
  'GOOGLE_DOCUMENT_AI_INVOICE_PROCESSOR_ID',
  'GOOGLE_DOCUMENT_AI_CREDENTIALS_JSON',
] as const;

function clearEnv() {
  for (const key of ENV_KEYS) delete process.env[key];
}

describe('getGoogleDocumentAIConfig', () => {
  afterEach(clearEnv);

  it('returns null when required env vars are absent', () => {
    clearEnv();
    expect(getGoogleDocumentAIConfig()).toBeNull();
  });

  it('returns null when GOOGLE_DOCUMENT_AI_CREDENTIALS_JSON is not valid JSON', () => {
    process.env.GOOGLE_CLOUD_PROJECT_ID = 'proj';
    process.env.GOOGLE_CLOUD_LOCATION = 'us';
    process.env.GOOGLE_DOCUMENT_AI_PROCESSOR_ID = 'proc-1';
    process.env.GOOGLE_DOCUMENT_AI_CREDENTIALS_JSON = 'not-json';
    expect(getGoogleDocumentAIConfig()).toBeNull();
  });

  it('returns null when the credentials JSON is missing client_email/private_key', () => {
    process.env.GOOGLE_CLOUD_PROJECT_ID = 'proj';
    process.env.GOOGLE_CLOUD_LOCATION = 'us';
    process.env.GOOGLE_DOCUMENT_AI_PROCESSOR_ID = 'proc-1';
    process.env.GOOGLE_DOCUMENT_AI_CREDENTIALS_JSON = JSON.stringify({ client_email: 'a@b.com' });
    expect(getGoogleDocumentAIConfig()).toBeNull();
  });

  it('parses a complete, valid configuration and un-escapes \\n in the private key', () => {
    process.env.GOOGLE_CLOUD_PROJECT_ID = 'proj';
    process.env.GOOGLE_CLOUD_LOCATION = 'us';
    process.env.GOOGLE_DOCUMENT_AI_PROCESSOR_ID = 'proc-1';
    process.env.GOOGLE_DOCUMENT_AI_INVOICE_PROCESSOR_ID = 'proc-invoice';
    process.env.GOOGLE_DOCUMENT_AI_CREDENTIALS_JSON = JSON.stringify({
      client_email: 'svc@proj.iam.gserviceaccount.com',
      private_key: 'line1\\nline2',
    });

    const config = getGoogleDocumentAIConfig();
    expect(config).not.toBeNull();
    expect(config?.projectId).toBe('proj');
    expect(config?.location).toBe('us');
    expect(config?.processorId).toBe('proc-1');
    expect(config?.invoiceProcessorId).toBe('proc-invoice');
    expect(config?.clientEmail).toBe('svc@proj.iam.gserviceaccount.com');
    expect(config?.privateKey).toBe('line1\nline2');
  });
});

describe('GoogleDocumentAIProvider (mocked fetch, no real Google call)', () => {
  const config = {
    projectId: 'proj',
    location: 'us',
    processorId: 'proc-generic',
    invoiceProcessorId: 'proc-invoice',
    clientEmail: 'svc@proj.iam.gserviceaccount.com',
    privateKey: TEST_PRIVATE_KEY_PEM,
  };

  let fetchMock: ReturnType<typeof vi.fn>;

  function mockDocumentResponse(document: Record<string, unknown>) {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('oauth2.googleapis.com/token')) {
        return Promise.resolve(
          new Response(JSON.stringify({ access_token: 'fake-token', expires_in: 3600 }), {
            status: 200,
          }),
        );
      }
      if (url.includes(':process')) {
        return Promise.resolve(new Response(JSON.stringify({ document }), { status: 200 }));
      }
      // The provider downloads the document's bytes from `input.signedUrl` first.
      return Promise.resolve(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    });
  }

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('exposes providerName "google-document-ai", distinct from "aws-textract" and "mock"', () => {
    const provider = new GoogleDocumentAIProvider(config);
    expect(provider.providerName).toBe('google-document-ai');
    expect(provider.providerName).not.toBe('aws-textract');
    expect(provider.providerName).not.toBe('mock');
  });

  it('extractText() returns the document text and average token confidence', async () => {
    mockDocumentResponse({
      text: 'INVOICE Amount Due: 500',
      pages: [{ tokens: [{ layout: { confidence: 0.9 } }, { layout: { confidence: 0.7 } }] }],
    });
    const provider = new GoogleDocumentAIProvider(config);

    const result = await provider.extractText({
      documentId: 'doc-1',
      storagePath: 'x',
      mimeType: 'application/pdf',
      signedUrl: 'https://example.test/signed',
    });

    expect(result.rawText).toBe('INVOICE Amount Due: 500');
    expect(result.confidence).toBeCloseTo(0.8, 5);
    // Two real fetch calls: OAuth2 token exchange + document bytes download + :process call --
    // asserting at least the token + process legs happened confirms the auth flow actually ran.
    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls.some((u) => u.includes('oauth2.googleapis.com/token'))).toBe(true);
    expect(urls.some((u) => u.includes(':process'))).toBe(true);
  });

  it('classify() applies the shared keyword heuristic to the returned text', async () => {
    mockDocumentResponse({ text: 'This is a Lease Agreement between landlord and tenant.' });
    const provider = new GoogleDocumentAIProvider(config);

    const result = await provider.classify({
      documentId: 'doc-1',
      storagePath: 'x',
      mimeType: 'application/pdf',
      signedUrl: 'https://example.test/signed',
    });

    expect(result.documentType).toBe('lease');
  });

  it('extractFields("bill") maps known invoice-parser entity types and calls the invoice processor', async () => {
    mockDocumentResponse({
      text: 'invoice',
      entities: [
        { type: 'supplier_name', mentionText: 'City of Cape Town', confidence: 0.92 },
        { type: 'total_amount', mentionText: 'R 1,250.00', confidence: 0.88 },
        { type: 'due_date', mentionText: '2026-09-01', confidence: 0.81 },
      ],
    });
    const provider = new GoogleDocumentAIProvider(config);

    const result = await provider.extractFields(
      {
        documentId: 'doc-1',
        storagePath: 'x',
        mimeType: 'application/pdf',
        signedUrl: 'https://example.test/signed',
      },
      'bill',
    );

    expect(result.supplierName?.value).toBe('City of Cape Town');
    expect(result.amountDue?.value).toBe(1250);
    expect(result.dueDate?.value).toBe('2026-09-01');
    expect(result.accountNumber).toBeUndefined();

    const processUrl = fetchMock.mock.calls
      .map((c) => String(c[0]))
      .find((u) => u.includes(':process'));
    expect(processUrl).toContain('proc-invoice');
  });

  it('extractFields("lease") reads custom-extractor entity types by the codebase field names', async () => {
    mockDocumentResponse({
      text: 'lease',
      entities: [
        { type: 'tenantName', mentionText: 'Jane Tenant', confidence: 0.7 },
        { type: 'rentAmount', mentionText: 'R 8500', confidence: 0.65 },
      ],
    });
    const provider = new GoogleDocumentAIProvider(config);

    const result = await provider.extractFields(
      {
        documentId: 'doc-1',
        storagePath: 'x',
        mimeType: 'application/pdf',
        signedUrl: 'https://example.test/signed',
      },
      'lease',
    );

    expect(result.tenantName?.value).toBe('Jane Tenant');
    expect(result.rentAmount?.value).toBe(8500);

    const processUrl = fetchMock.mock.calls
      .map((c) => String(c[0]))
      .find((u) => u.includes(':process'));
    expect(processUrl).toContain('proc-generic');
  });

  it('reuses a cached access token across two calls instead of re-authenticating', async () => {
    mockDocumentResponse({ text: 'hello' });
    const provider = new GoogleDocumentAIProvider(config);
    const input = {
      documentId: 'doc-1',
      storagePath: 'x',
      mimeType: 'application/pdf',
      signedUrl: 'https://example.test/signed',
    };

    await provider.extractText(input);
    await provider.extractText(input);

    const tokenCalls = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes('oauth2.googleapis.com/token'),
    );
    expect(tokenCalls.length).toBe(1);
  });

  it('throws a retryable ProviderError on a 503 from the :process endpoint', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('oauth2.googleapis.com/token')) {
        return Promise.resolve(
          new Response(JSON.stringify({ access_token: 'fake-token', expires_in: 3600 }), {
            status: 200,
          }),
        );
      }
      if (url.includes(':process')) {
        return Promise.resolve(new Response('server error', { status: 503 }));
      }
      return Promise.resolve(new Response(new Uint8Array([1]), { status: 200 }));
    });
    const provider = new GoogleDocumentAIProvider(config);

    await expect(
      provider.extractText({
        documentId: 'doc-1',
        storagePath: 'x',
        mimeType: 'application/pdf',
        signedUrl: 'https://example.test/signed',
      }),
    ).rejects.toMatchObject({ kind: 'retryable' } satisfies Partial<ProviderError>);
  });
});
