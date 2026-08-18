import { describe, expect, it } from 'vitest';
import type { AssembledOrgContext, AssembledTenantContext } from '@propvault/types';
import { MockLLMProvider } from '../llm';

const emptyOwnerContext: AssembledOrgContext = {
  kind: 'owner',
  orgId: 'org-1',
  generatedAt: new Date().toISOString(),
  rentOverdue: [],
  rentDueSoon: [],
  recentExpenses: [],
  openMaintenanceTickets: [],
  leasesExpiringSoon: [],
  pendingPaymentReports: [],
  portfolioInsights: [],
  recentPayments: [],
  occupancySummary: { occupied: 0, vacant: 0, maintenance: 0, total: 0 },
};

const emptyTenantContext: AssembledTenantContext = {
  kind: 'tenant',
  tenantId: 'tenant-1',
  orgId: 'org-1',
  generatedAt: new Date().toISOString(),
  outstandingBalance: 0,
  recentPaymentReports: [],
  rentSchedule: [],
  lease: null,
  maintenanceTickets: [],
  notices: [],
};

describe('MockLLMProvider', () => {
  // Final pre-UAT engineering pass (WORKLOG.md this date), Part 6: V1 is read-only -- the
  // write-staging capability (formerly exercised by a "record an expense" test here) is
  // deliberately removed from this provider, not merely untested.
  it('never stages a change for any question -- V1 write-staging is disabled', async () => {
    const provider = new MockLLMProvider();
    const result = await provider.converse({
      context: emptyOwnerContext,
      history: [],
      userMessage: "How's my portfolio? Also, record an expense for me.",
    });
    expect(result.stagedChange).toBeUndefined();
  });

  describe('owner context', () => {
    it('reports zero overdue leases from an empty context', async () => {
      const provider = new MockLLMProvider();
      const result = await provider.converse({
        context: emptyOwnerContext,
        history: [],
        userMessage: 'What is overdue?',
      });
      expect(result.replyText).toMatch(/nothing is overdue/i);
    });

    it('reports overdue count and amount from a non-empty context, never inventing a value', async () => {
      const provider = new MockLLMProvider();
      const context: AssembledOrgContext = {
        ...emptyOwnerContext,
        rentOverdue: [{ leaseId: 'lease-1', tenantName: 'Jane', amount: 1000, daysOverdue: 5 }],
      };
      const result = await provider.converse({
        context,
        history: [],
        userMessage: 'What is overdue?',
      });
      expect(result.replyText).toContain('1 lease is overdue');
      expect(result.replyText).toContain('Jane');
      expect(result.replyText).toContain('R1');
    });

    it('reports pending payment reports awaiting confirmation', async () => {
      const provider = new MockLLMProvider();
      const context: AssembledOrgContext = {
        ...emptyOwnerContext,
        pendingPaymentReports: [
          { reportId: 'r1', tenantName: 'Sipho', amount: 500, paymentDate: '2026-08-01' },
        ],
      };
      const result = await provider.converse({
        context,
        history: [],
        userMessage: 'Which payments are waiting for confirmation?',
      });
      expect(result.replyText).toContain('Sipho');
      expect(result.replyText).toMatch(/awaiting confirmation/i);
    });

    it('reports occupancy summary from real unit counts', async () => {
      const provider = new MockLLMProvider();
      const context: AssembledOrgContext = {
        ...emptyOwnerContext,
        occupancySummary: { occupied: 8, vacant: 2, maintenance: 1, total: 11 },
      };
      const result = await provider.converse({
        context,
        history: [],
        userMessage: 'What is my occupancy?',
      });
      expect(result.replyText).toContain('8 occupied');
      expect(result.replyText).toContain('2 vacant');
    });

    it('falls back to a plain help message for an unrecognised question, never inventing an answer', async () => {
      const provider = new MockLLMProvider();
      const result = await provider.converse({
        context: emptyOwnerContext,
        history: [],
        userMessage: 'What is the meaning of life?',
      });
      expect(result.replyText).toMatch(/i can answer questions about your portfolio/i);
    });
  });

  describe('tenant context', () => {
    it('reports the tenant owes nothing when the balance is zero', async () => {
      const provider = new MockLLMProvider();
      const result = await provider.converse({
        context: emptyTenantContext,
        history: [],
        userMessage: 'How much do I owe?',
      });
      expect(result.replyText).toMatch(/don't owe anything/i);
    });

    it('reports a real outstanding balance, never inventing an amount', async () => {
      const provider = new MockLLMProvider();
      const context: AssembledTenantContext = { ...emptyTenantContext, outstandingBalance: 4500 };
      const result = await provider.converse({
        context,
        history: [],
        userMessage: 'How much do I owe?',
      });
      expect(result.replyText).toContain('R4');
      expect(result.replyText).toContain('500');
    });

    it('reports maintenance ticket status from real data', async () => {
      const provider = new MockLLMProvider();
      const context: AssembledTenantContext = {
        ...emptyTenantContext,
        maintenanceTickets: [
          { ticketId: 't1', title: 'Leaking tap', status: 'in_progress', priority: 'medium' },
        ],
      };
      const result = await provider.converse({
        context,
        history: [],
        userMessage: 'What is the status of my maintenance request?',
      });
      expect(result.replyText).toContain('Leaking tap');
      expect(result.replyText).toMatch(/in progress/i);
    });

    it('answers a lease-expiry question only from real lease data', async () => {
      const provider = new MockLLMProvider();
      const context: AssembledTenantContext = {
        ...emptyTenantContext,
        lease: {
          leaseId: 'l1',
          propertyLabel: 'Oakwood Apartments',
          unitLabel: 'Unit 4B',
          rentAmount: 9000,
          startDate: '2026-01-01',
          endDate: '2026-12-31',
          status: 'active',
        },
      };
      const result = await provider.converse({
        context,
        history: [],
        userMessage: 'When does my lease expire?',
      });
      expect(result.replyText).toContain('2026-12-31');
      expect(result.replyText).toContain('Oakwood Apartments');
    });

    it('says clearly when no lease is found, never inventing one', async () => {
      const provider = new MockLLMProvider();
      const result = await provider.converse({
        context: emptyTenantContext,
        history: [],
        userMessage: 'When does my lease expire?',
      });
      expect(result.replyText).toMatch(/could not find lease details/i);
    });
  });
});
