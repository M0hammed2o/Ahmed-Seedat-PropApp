import 'server-only';

// Vendor-agnostic screening provider (ADR-014's mock-first pattern, same shape as
// DocumentIntelligenceProvider/SubscriptionProvider on the mobile side) -- no real screening
// vendor (credit/criminal-record check, e.g. TPN/ITC in the SA market) has been selected yet
// (RISK_REGISTER.md R-19 covers AI/OCR vendor selection; screening vendor selection is the same
// category of deferred decision, not yet separately tracked -- see TECHNICAL_DEBT_REGISTER.md).
// Every route calls this interface, never a vendor SDK directly, so swapping in a real provider
// later touches one file, not every call site.

export interface ScreeningResult {
  status: 'passed' | 'failed';
  reference: string;
}

export interface TenantScreeningProvider {
  runScreening(input: { applicantName: string; applicantEmail: string | null }): Promise<ScreeningResult>;
}

/**
 * Deterministic mock: always passes. There is no real screening logic to fake convincingly (unlike
 * the mobile MockDocumentIntelligenceProvider, which has real extraction heuristics to mirror) --
 * this exists purely so the API contract (POST /api/v1/applications/:id/screen) is real and
 * callable before a vendor is chosen, per ADR-014.
 */
export class MockTenantScreeningProvider implements TenantScreeningProvider {
  async runScreening(): Promise<ScreeningResult> {
    return { status: 'passed', reference: `mock-${crypto.randomUUID()}` };
  }
}

export function getTenantScreeningProvider(): TenantScreeningProvider {
  return new MockTenantScreeningProvider();
}
