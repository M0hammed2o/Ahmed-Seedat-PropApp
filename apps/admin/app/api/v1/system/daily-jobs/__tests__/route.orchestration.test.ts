import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// Orchestration-only tests: mocks lib/systemJobs entirely so execution ORDER and PARTIAL-FAILURE
// handling can be asserted deterministically, without depending on real database state (that's
// what route.test.ts, the real-Supabase integration file, is for). Auth is bypassed via a valid
// CRON_JOB_SECRET -- the auth branch itself is covered by route.test.ts.

process.env.CRON_JOB_SECRET = 'orchestration-test-secret';
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
process.env.SUPABASE_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

let callOrder: string[] = [];
let subscriptionsShouldFail = false;
let rentSchedulesShouldFail = false;

vi.mock('@/lib/systemJobs', () => ({
  runSubscriptionLifecycleJob: vi.fn(async () => {
    callOrder.push('subscriptions');
    if (subscriptionsShouldFail) throw new Error('simulated subscriptions failure');
    return { transitioned: 0, transitions: [], remindersSent: 0, scheduledPlanChangesApplied: 0 };
  }),
  runRentScheduleJob: vi.fn(async () => {
    callOrder.push('rentSchedules');
    if (rentSchedulesShouldFail) throw new Error('simulated rentSchedules failure');
    return {
      through: '2026-01-01',
      leasesProcessed: 0,
      leasesWithNewRows: 0,
      totalCreated: 0,
      createdByOrg: {},
    };
  }),
  runComplianceReminderJob: vi.fn(async () => {
    callOrder.push('compliance');
    return { dueSoonRemindersSent: 0, overdueRemindersSent: 0 };
  }),
}));

vi.mock('@/lib/audit', () => ({
  writeAuditEvent: vi.fn(async () => {}),
}));

const { POST } = await import('../route');
const ROUTE_URL = 'http://localhost/api/v1/system/daily-jobs';

function cronRequest(): NextRequest {
  return new NextRequest(ROUTE_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.CRON_JOB_SECRET}` },
  });
}

describe('POST /api/v1/system/daily-jobs (orchestration, mocked systemJobs)', () => {
  beforeEach(() => {
    callOrder = [];
    subscriptionsShouldFail = false;
    rentSchedulesShouldFail = false;
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('runs subscriptions, then rentSchedules, then compliance, in that exact deterministic order', async () => {
    await POST(cronRequest());
    expect(callOrder).toEqual(['subscriptions', 'rentSchedules', 'compliance']);
  });

  it('returns a structured result including every job, with 200 when all succeed', async () => {
    const response = await POST(cronRequest());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.jobs.subscriptions.success).toBe(true);
    expect(body.jobs.rentSchedules.success).toBe(true);
    expect(body.jobs.compliance.success).toBe(true);
    expect(typeof body.jobs.subscriptions.durationMs).toBe('number');
    expect(typeof body.jobs.rentSchedules.durationMs).toBe('number');
    expect(typeof body.jobs.compliance.durationMs).toBe('number');
  });

  it('a subscriptions-job failure does not stop rentSchedules/compliance from running, and the overall response reports failure', async () => {
    subscriptionsShouldFail = true;
    const response = await POST(cronRequest());
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.jobs.subscriptions.success).toBe(false);
    expect(typeof body.jobs.subscriptions.error).toBe('string');
    // The other two jobs still ran despite the first one failing -- they are independent.
    expect(body.jobs.rentSchedules.success).toBe(true);
    expect(body.jobs.compliance.success).toBe(true);
    expect(callOrder).toEqual(['subscriptions', 'rentSchedules', 'compliance']);
  });

  it('a rentSchedules-job failure is isolated -- subscriptions still reports success, compliance still runs, overall response reports failure', async () => {
    rentSchedulesShouldFail = true;
    const response = await POST(cronRequest());
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.jobs.subscriptions.success).toBe(true);
    expect(body.jobs.rentSchedules.success).toBe(false);
    expect(body.jobs.compliance.success).toBe(true);
  });

  it('never returns HTTP 200 when any job failed', async () => {
    subscriptionsShouldFail = true;
    const response = await POST(cronRequest());
    expect(response.status).not.toBe(200);
  });

  it('does not leak a raw stack trace -- only a plain error message string', async () => {
    subscriptionsShouldFail = true;
    const response = await POST(cronRequest());
    const body = await response.json();
    expect(body.jobs.subscriptions.error).toBe('simulated subscriptions failure');
    expect(body.jobs.subscriptions.error).not.toMatch(/at .*\.ts:\d+/);
  });
});
