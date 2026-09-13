import { describe, expect, it } from 'vitest';
import {
  REAL_DOCUMENT_INTELLIGENCE_PROVIDER_NAMES,
  isDeployedProductionRuntime,
  isMockDocumentIntelligencePermitted,
  isTrustedExtractionResult,
  DOCUMENT_EXTRACTION_UNAVAILABLE_MESSAGE,
  EXTRACTION_RESULT_NOT_TRUSTED_MESSAGE,
} from '../documentIntelligencePolicy';
import { GoogleDocumentAIProvider } from '../providers/documentIntelligence';

/**
 * The production-safety policy for document intelligence (13 September 2026).
 *
 * Every case passes an explicit environment object, so none of these tests reads or mutates the real
 * process.env -- the policy is a pure function of what it is handed.
 *
 * The rule under test: PRODUCTION NEVER USES THE MOCK PROVIDER. The mock returns an ID number of
 * 9001015800086 at 0.92 confidence and a gross income of R25,000; before this policy existed, an
 * incomplete Google configuration served those values in production as though a document had been
 * read.
 */

const PROD = { NODE_ENV: 'production' };
const RENDER_ONLY = { RENDER: 'true' };
const DEV = { NODE_ENV: 'development' };
const TEST = { NODE_ENV: 'test' };
const BOTH_DEMO_FLAGS = { NEXT_PUBLIC_DEMO_MODE: 'true', ALLOW_DEMO_MODE: 'true' };

describe('isDeployedProductionRuntime', () => {
  it('recognises a production build by NODE_ENV', () => {
    expect(isDeployedProductionRuntime(PROD)).toBe(true);
  });

  it('recognises a Render deploy even if NODE_ENV were misconfigured', () => {
    // Defence in depth: Render sets RENDER=true on every service independently of the build.
    expect(isDeployedProductionRuntime(RENDER_ONLY)).toBe(true);
    expect(isDeployedProductionRuntime({ NODE_ENV: 'development', RENDER: 'true' })).toBe(true);
  });

  it('does not treat development or test as production', () => {
    expect(isDeployedProductionRuntime(DEV)).toBe(false);
    expect(isDeployedProductionRuntime(TEST)).toBe(false);
    expect(isDeployedProductionRuntime({})).toBe(false);
  });

  it('only an exact RENDER=true counts, not any truthy-looking value', () => {
    expect(isDeployedProductionRuntime({ RENDER: 'false' })).toBe(false);
    expect(isDeployedProductionRuntime({ RENDER: '' })).toBe(false);
  });
});

describe('isMockDocumentIntelligencePermitted', () => {
  it('NEVER permits the mock in production', () => {
    expect(isMockDocumentIntelligencePermitted(PROD)).toBe(false);
    expect(isMockDocumentIntelligencePermitted(RENDER_ONLY)).toBe(false);
  });

  it('cannot be switched on in production even with both demo-mode flags set', () => {
    // The production check runs first and nothing after it is consulted. This is the case that
    // would matter if someone ever set the demo flags on the real production service.
    expect(isMockDocumentIntelligencePermitted({ ...PROD, ...BOTH_DEMO_FLAGS })).toBe(false);
    expect(isMockDocumentIntelligencePermitted({ ...RENDER_ONLY, ...BOTH_DEMO_FLAGS })).toBe(false);
  });

  it('permits the mock for local development and automated tests', () => {
    expect(isMockDocumentIntelligencePermitted(DEV)).toBe(true);
    expect(isMockDocumentIntelligencePermitted(TEST)).toBe(true);
  });

  it('otherwise requires the explicit, two-variable demo mode', () => {
    expect(isMockDocumentIntelligencePermitted({})).toBe(false);
    expect(isMockDocumentIntelligencePermitted({ NEXT_PUBLIC_DEMO_MODE: 'true' })).toBe(false);
    expect(isMockDocumentIntelligencePermitted({ ALLOW_DEMO_MODE: 'true' })).toBe(false);
    expect(isMockDocumentIntelligencePermitted(BOTH_DEMO_FLAGS)).toBe(true);
  });
});

describe('isTrustedExtractionResult', () => {
  it('trusts a result a real provider produced, in every runtime', () => {
    for (const env of [PROD, RENDER_ONLY, DEV, TEST, {}]) {
      expect(isTrustedExtractionResult('google-document-ai', env)).toBe(true);
    }
  });

  it('never trusts a mock result in production', () => {
    expect(isTrustedExtractionResult('mock', PROD)).toBe(false);
    expect(isTrustedExtractionResult('mock', RENDER_ONLY)).toBe(false);
    expect(isTrustedExtractionResult('mock', { ...PROD, ...BOTH_DEMO_FLAGS })).toBe(false);
  });

  it('does not trust a result with no provenance in production', () => {
    // provider_name was added in migration 20260101000100 and nothing wrote it before that, so an
    // old row cannot prove a real read produced it.
    expect(isTrustedExtractionResult(null, PROD)).toBe(false);
    expect(isTrustedExtractionResult(undefined, PROD)).toBe(false);
    expect(isTrustedExtractionResult('', PROD)).toBe(false);
  });

  it('does not trust an unrecognised provider name in production', () => {
    expect(isTrustedExtractionResult('aws-textract', PROD)).toBe(false);
    expect(isTrustedExtractionResult('some-future-vendor', PROD)).toBe(false);
  });

  it('keeps mock results usable where the mock itself is permitted', () => {
    expect(isTrustedExtractionResult('mock', DEV)).toBe(true);
    expect(isTrustedExtractionResult('mock', TEST)).toBe(true);
    expect(isTrustedExtractionResult(null, TEST)).toBe(true);
  });
});

describe('REAL_DOCUMENT_INTELLIGENCE_PROVIDER_NAMES', () => {
  it('stays in step with the real Google provider identity', () => {
    // If GoogleDocumentAIProvider.providerName ever changed, every genuine Google result would
    // silently become "untrusted" in production. This makes that drift a failing test instead.
    const provider = new GoogleDocumentAIProvider({
      projectId: 'p',
      location: 'eu',
      processorId: 'x',
      invoiceProcessorId: null,
      clientEmail: 'svc@example.iam.gserviceaccount.com',
      privateKey: 'unused',
    });
    expect(REAL_DOCUMENT_INTELLIGENCE_PROVIDER_NAMES.has(provider.providerName)).toBe(true);
  });

  it('contains no mock identity', () => {
    expect(REAL_DOCUMENT_INTELLIGENCE_PROVIDER_NAMES.has('mock')).toBe(false);
  });
});

describe('user-facing messages', () => {
  it('name no environment variable, credential, vendor or infrastructure detail', () => {
    for (const message of [DOCUMENT_EXTRACTION_UNAVAILABLE_MESSAGE, EXTRACTION_RESULT_NOT_TRUSTED_MESSAGE]) {
      expect(message).not.toMatch(/GOOGLE_|AWS_|NODE_ENV|RENDER|credential|Document AI|Google|mock|provider/i);
    }
  });

  it('tells the user what they can do instead', () => {
    expect(DOCUMENT_EXTRACTION_UNAVAILABLE_MESSAGE).toMatch(/enter the information manually/i);
    expect(EXTRACTION_RESULT_NOT_TRUSTED_MESSAGE).toMatch(/enter the information manually/i);
  });
});
