import { describe, expect, it } from 'vitest';
import type { AssembledOrgContext } from '@propvault/types';
import { MockLLMProvider } from '../llm';

const emptyContext: AssembledOrgContext = {
  orgId: 'org-1',
  generatedAt: new Date().toISOString(),
  rentOverdue: [],
  rentDueSoon: [],
  recentExpenses: [],
  openMaintenanceTickets: [],
  leasesExpiringSoon: [],
};

describe('MockLLMProvider', () => {
  it('never stages a change for a plain question', async () => {
    const provider = new MockLLMProvider();
    const result = await provider.converse({ context: emptyContext, history: [], userMessage: "How's my portfolio?" });
    expect(result.stagedChange).toBeUndefined();
  });

  it('reports zero overdue leases from an empty context', async () => {
    const provider = new MockLLMProvider();
    const result = await provider.converse({ context: emptyContext, history: [], userMessage: 'What is overdue?' });
    expect(result.replyText).toMatch(/nothing is overdue/i);
  });

  it('reports overdue count from a non-empty context', async () => {
    const provider = new MockLLMProvider();
    const context: AssembledOrgContext = {
      ...emptyContext,
      rentOverdue: [{ leaseId: 'lease-1', tenantName: 'Jane', amount: 1000, daysOverdue: 5 }],
    };
    const result = await provider.converse({ context, history: [], userMessage: 'What is overdue?' });
    expect(result.replyText).toMatch(/1 lease is overdue/i);
  });

  it('stages an expense-creation change, never applying it directly', async () => {
    const provider = new MockLLMProvider();
    const result = await provider.converse({ context: emptyContext, history: [], userMessage: 'Record an expense' });
    expect(result.stagedChange).toBeDefined();
    expect(result.stagedChange?.endpoint).toBe('/api/v1/expenses');
    expect(result.stagedChange?.method).toBe('POST');
  });
});
