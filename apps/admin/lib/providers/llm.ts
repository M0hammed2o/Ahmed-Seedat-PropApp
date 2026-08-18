import 'server-only';
import type {
  AssembledAssistantContext,
  AssembledOrgContext,
  AssembledTenantContext,
  LLMConverseInput,
  LLMConverseResult,
  LLMProvider,
} from '@propvault/types';

/**
 * Mock-first LLMProvider (AI_ARCHITECTURE.md §3) -- no real LLM vendor has been selected (§3, open
 * decision, not attempted by this pass). Deterministic, keyword-matched responses only.
 *
 * Final pre-UAT engineering pass (WORKLOG.md this date), Part 6: this is the smallest useful V1
 * assistant -- READ-ONLY questions + safe navigation only. The prior version of this file had a
 * "record an expense" branch that produced a `stagedChange` (a proposed write) -- deliberately
 * REMOVED here, not merely unused: this pass's own hard requirement is that the assistant must
 * never propose or apply a write of any kind in V1 (confirmed payments, leases, accounting,
 * subscriptions, messages -- see the enumerated prohibition list in this pass's own task
 * description). `LLMConverseResult.stagedChange` stays in the type (packages/types/src/ai.ts) for
 * a future, deliberately-scoped pass to re-enable; nothing in this file ever populates it, and
 * POST /api/v1/ai/messages/:id/confirm independently refuses to act on one even if it somehow
 * existed (defense in depth, not reliance on this file alone).
 *
 * Every reply below is built ONLY from fields already present on `input.context` -- the
 * already-assembled, RLS-scoped tool results (AI_ARCHITECTURE.md §1.4) -- never a number, date, or
 * name invented by this function. When a question doesn't match a known intent, or the matched
 * data is empty, the reply says so plainly rather than guessing.
 */
export class MockLLMProvider implements LLMProvider {
  async converse(input: LLMConverseInput): Promise<LLMConverseResult> {
    console.warn('[MockLLMProvider] converse', {
      contextKind: input.context.kind,
      orgId: input.context.orgId,
    });

    const text = input.userMessage.toLowerCase();
    const replyText =
      input.context.kind === 'owner'
        ? answerOwnerQuestion(text, input.context)
        : answerTenantQuestion(text, input.context);

    return { replyText, costMetadata: mockCost() };
  }
}

function money(n: number): string {
  return `R${n.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// === Owner/staff intents (Part 11's owner examples -> Part 8's owner tool registry) ===
function answerOwnerQuestion(text: string, ctx: AssembledOrgContext): string {
  const wantsOverdue =
    text.includes('overdue') || text.includes('not paid') || text.includes("haven't paid");
  const wantsOutstanding = text.includes('outstanding') || text.includes('how much rent');
  const wantsPending =
    text.includes('waiting for confirmation') ||
    text.includes('pending payment') ||
    text.includes('payment report');
  const wantsLeases = text.includes('lease') && (text.includes('expir') || text.includes('renew'));
  const wantsMaintenance = text.includes('maintenance') || text.includes('urgent');
  const wantsOccupancy =
    text.includes('occupan') || text.includes('vacant') || text.includes('vacancy');
  const wantsRecentPayments = text.includes('confirmed') && text.includes('paid');
  const wantsAttention =
    text.includes('attention') ||
    text.includes('today') ||
    text.includes('important') ||
    text.includes("how's my portfolio") ||
    text.includes('how is my portfolio');

  if (wantsOverdue || wantsOutstanding) {
    if (ctx.rentOverdue.length === 0) {
      return 'Nothing is overdue right now -- every active lease is current.';
    }
    const total = ctx.rentOverdue.reduce((sum, r) => sum + r.amount, 0);
    const list = ctx.rentOverdue
      .slice(0, 5)
      .map((r) => `${r.tenantName} (${money(r.amount)}, ${r.daysOverdue}d overdue)`)
      .join('; ');
    return `${ctx.rentOverdue.length} lease${ctx.rentOverdue.length === 1 ? ' is' : 's are'} overdue on rent, totalling ${money(total)}. ${list}.`;
  }

  if (wantsPending) {
    if (ctx.pendingPaymentReports.length === 0) {
      return 'No payments are currently waiting for confirmation.';
    }
    const list = ctx.pendingPaymentReports
      .slice(0, 5)
      .map((r) => `${r.tenantName} reported ${money(r.amount)} on ${r.paymentDate}`)
      .join('; ');
    return `${ctx.pendingPaymentReports.length} payment report${ctx.pendingPaymentReports.length === 1 ? ' is' : 's are'} awaiting confirmation: ${list}.`;
  }

  if (wantsLeases) {
    if (ctx.leasesExpiringSoon.length === 0) {
      return 'No leases are expiring in the next 60 days.';
    }
    const list = ctx.leasesExpiringSoon
      .slice(0, 5)
      .map((l) => `${l.tenantName} (ends ${l.endDate})`)
      .join('; ');
    return `${ctx.leasesExpiringSoon.length} lease${ctx.leasesExpiringSoon.length === 1 ? ' is' : 's are'} expiring soon: ${list}.`;
  }

  if (wantsMaintenance) {
    if (ctx.openMaintenanceTickets.length === 0) {
      return 'No open maintenance tickets right now.';
    }
    const urgent = ctx.openMaintenanceTickets.filter((t) => t.priority === 'urgent');
    if (text.includes('urgent')) {
      if (urgent.length === 0) return 'No urgent-priority maintenance tickets right now.';
      return `${urgent.length} urgent maintenance ticket${urgent.length === 1 ? '' : 's'}: ${urgent.map((t) => t.title).join('; ')}.`;
    }
    return `${ctx.openMaintenanceTickets.length} open maintenance ticket${ctx.openMaintenanceTickets.length === 1 ? '' : 's'} (${urgent.length} urgent).`;
  }

  if (wantsOccupancy) {
    const { occupied, vacant, maintenance, total } = ctx.occupancySummary;
    if (total === 0) return "You don't have any units on record yet.";
    return `${occupied} occupied, ${vacant} vacant, ${maintenance} under maintenance -- ${total} units total.`;
  }

  if (wantsRecentPayments) {
    if (ctx.recentPayments.length === 0) return 'No payments have been confirmed as paid yet.';
    const list = ctx.recentPayments
      .slice(0, 5)
      .map((p) => `${p.tenantName} (${money(p.amount)}, ${p.paidDate})`)
      .join('; ');
    return `Most recently confirmed payments: ${list}.`;
  }

  if (wantsAttention || text.includes('portfolio')) {
    const parts: string[] = [];
    if (ctx.rentOverdue.length > 0)
      parts.push(
        `${ctx.rentOverdue.length} overdue rent payment${ctx.rentOverdue.length === 1 ? '' : 's'}`,
      );
    if (ctx.pendingPaymentReports.length > 0)
      parts.push(
        `${ctx.pendingPaymentReports.length} payment report${ctx.pendingPaymentReports.length === 1 ? '' : 's'} awaiting confirmation`,
      );
    const urgentTickets = ctx.openMaintenanceTickets.filter((t) => t.priority === 'urgent').length;
    if (urgentTickets > 0)
      parts.push(`${urgentTickets} urgent maintenance ticket${urgentTickets === 1 ? '' : 's'}`);
    if (ctx.leasesExpiringSoon.length > 0)
      parts.push(
        `${ctx.leasesExpiringSoon.length} lease${ctx.leasesExpiringSoon.length === 1 ? '' : 's'} expiring soon`,
      );
    if (ctx.portfolioInsights.length > 0) {
      const urgentInsights = ctx.portfolioInsights.filter((i) => i.severity === 'urgent');
      if (urgentInsights.length > 0)
        parts.push(
          `${urgentInsights.length} urgent portfolio insight${urgentInsights.length === 1 ? '' : 's'}`,
        );
    }
    if (parts.length === 0) {
      return 'Nothing needs your attention right now -- rent is current, no urgent maintenance, and no leases expiring soon.';
    }
    return `Here's what needs attention: ${parts.join('; ')}.`;
  }

  return (
    'I can answer questions about your portfolio -- try "What\'s overdue?", "Which payments are waiting for confirmation?", ' +
    '"Which leases expire soon?", "What maintenance is open?", "What is my occupancy?", or "What should I pay attention to today?".'
  );
}

// === Tenant intents (Part 11's tenant examples -> Part 8's tenant tool registry) ===
function answerTenantQuestion(text: string, ctx: AssembledTenantContext): string {
  const wantsBalance =
    text.includes('owe') || text.includes('balance') || text.includes('outstanding');
  const wantsNextDue = text.includes('next') && (text.includes('rent') || text.includes('due'));
  const wantsPaymentStatus =
    text.includes('confirmed') || text.includes('payment') || text.includes('report');
  const wantsMaintenance =
    text.includes('maintenance') || text.includes('repair') || text.includes('ticket');
  const wantsLease =
    text.includes('lease') &&
    (text.includes('expir') || text.includes('end') || text.includes('when'));
  const wantsLeaseDoc =
    text.includes('lease') &&
    (text.includes('find') || text.includes('document') || text.includes('where'));
  const wantsNotices = text.includes('notice');

  if (wantsBalance) {
    return ctx.outstandingBalance > 0
      ? `You currently owe ${money(ctx.outstandingBalance)}.`
      : "You don't owe anything right now -- your account is up to date.";
  }

  if (wantsNextDue) {
    if (ctx.rentSchedule.length === 0)
      return 'Proplyst could not find an upcoming rent charge for your lease.';
    const next = ctx.rentSchedule[0]!;
    return `Your next rent charge is ${money(next.amount)}, due ${next.dueDate} (currently ${next.status}).`;
  }

  if (wantsPaymentStatus) {
    if (ctx.recentPaymentReports.length === 0) return "You haven't reported any payments yet.";
    const latest = ctx.recentPaymentReports[0]!;
    const statusText =
      latest.status === 'confirmed'
        ? 'has been confirmed'
        : latest.status === 'rejected'
          ? 'was rejected'
          : 'is still awaiting confirmation';
    return `Your most recent payment report (${money(latest.amount)} on ${latest.paymentDate}) ${statusText}.`;
  }

  if (wantsMaintenance) {
    if (ctx.maintenanceTickets.length === 0)
      return "You don't have any maintenance requests on record.";
    const latest = ctx.maintenanceTickets[0]!;
    return `Your most recent maintenance request "${latest.title}" is currently ${latest.status.replace('_', ' ')}.`;
  }

  if (wantsLeaseDoc) {
    return 'Proplyst could not find a lease document in this conversation -- check the My Documents section of your portal for your lease.';
  }

  if (wantsLease) {
    if (!ctx.lease) return 'Proplyst could not find lease details for your account.';
    return ctx.lease.endDate
      ? `Your lease at ${ctx.lease.propertyLabel}${ctx.lease.unitLabel ? ` (${ctx.lease.unitLabel})` : ''} ends on ${ctx.lease.endDate}.`
      : `Your lease at ${ctx.lease.propertyLabel}${ctx.lease.unitLabel ? ` (${ctx.lease.unitLabel})` : ''} has no fixed end date on record.`;
  }

  if (wantsNotices) {
    if (ctx.notices.length === 0) return 'There are no notices for you right now.';
    const list = ctx.notices
      .slice(0, 3)
      .map((n) => n.title)
      .join('; ');
    return `Recent notices: ${list}.`;
  }

  return (
    'I can answer questions about your tenancy -- try "How much do I owe?", "When is my next rent due?", ' +
    '"Has my payment been confirmed?", "What is the status of my maintenance request?", "When does my lease expire?", or "Are there any notices for me?".'
  );
}

function mockCost(): { inputTokens: number; outputTokens: number; costUsd: number } {
  return { inputTokens: 0, outputTokens: 0, costUsd: 0 };
}

export function getLLMProvider(): LLMProvider {
  return new MockLLMProvider();
}

export type { AssembledAssistantContext };
