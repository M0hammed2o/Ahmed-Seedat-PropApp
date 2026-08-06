import 'server-only';
import type { LLMConverseInput, LLMConverseResult, LLMProvider } from '@propvault/types';

// Mock-first LLMProvider (AI_ARCHITECTURE.md §3) -- no real LLM vendor has been selected (§3,
// open decision, not attempted by this session). Deterministic, keyword-matched responses only,
// matching the evidenced prompt chips ("How's my portfolio?", "What's overdue?", "Record an
// expense") -- enough to build and test the staging/confirm pipeline (§1.5-1.7) end-to-end
// without a real model. A real provider must never receive anything but the already-assembled
// AssembledOrgContext (§1.4) -- this mock only ever reads `input.context`/`input.userMessage`,
// never fetches anything itself, so swapping it for a real vendor later changes nothing about
// how it's called.
export class MockLLMProvider implements LLMProvider {
  async converse(input: LLMConverseInput): Promise<LLMConverseResult> {
    console.warn('[MockLLMProvider] converse', { orgId: input.context.orgId });

    const text = input.userMessage.toLowerCase();

    if (text.includes('overdue')) {
      const count = input.context.rentOverdue.length;
      return {
        replyText:
          count === 0
            ? 'Nothing is overdue right now -- every active lease is current.'
            : `${count} lease${count === 1 ? ' is' : 's are'} overdue on rent right now.`,
        costMetadata: mockCost(),
      };
    }

    if (text.includes('portfolio') || text.includes("how's")) {
      const { rentOverdue, rentDueSoon, openMaintenanceTickets, leasesExpiringSoon } =
        input.context;
      return {
        replyText: `Overdue rent: ${rentOverdue.length}. Rent due soon: ${rentDueSoon.length}. Open maintenance tickets: ${openMaintenanceTickets.length}. Leases expiring soon: ${leasesExpiringSoon.length}.`,
        costMetadata: mockCost(),
      };
    }

    if (text.includes('record') && text.includes('expense')) {
      return {
        replyText:
          "I've drafted an expense entry -- review the details below and confirm to save it.",
        stagedChange: {
          endpoint: '/api/v1/expenses',
          method: 'POST',
          body: { orgId: input.context.orgId, category: 'general', amount: 0 },
          summary: 'Record a new expense (category: general, amount: 0 -- edit before confirming)',
        },
        costMetadata: mockCost(),
      };
    }

    return {
      replyText:
        'I can answer questions about your portfolio (try "What\'s overdue?") or help you record an expense -- what would you like to do?',
      costMetadata: mockCost(),
    };
  }
}

function mockCost(): { inputTokens: number; outputTokens: number; costUsd: number } {
  return { inputTokens: 0, outputTokens: 0, costUsd: 0 };
}

export function getLLMProvider(): LLMProvider {
  return new MockLLMProvider();
}
