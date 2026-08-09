import { test, expect } from '@playwright/test';
import { BASE_URL } from '../playwright.config';
import { setUpOrg, createProperty, createUnit, getUnitStatus } from './fixtures/orgWorkflow';

// Workflow-integration pass (WORKLOG.md this date). Full-stack E2E coverage (real API, real local
// Supabase, real RLS) for the property -> ownership -> unit -> application -> tenant -> lease ->
// activation -> occupancy -> rent schedule -> deposit -> inspection chain this task rebuilt, and
// the specific invariants the task brief called out by name. Same posture as onboarding.spec.ts:
// API-driven (page.request/request), not UI-click-driven, for setup and assertions -- this proves
// the real backend behaviour end-to-end without the slowness/flakiness of driving every step
// through forms; the handful of things that are genuinely UI-only (dashboard empty state, setup
// guidance panel, photo upload) are covered separately in property-workflow-ui.spec.ts.

test.describe('property -> unit -> application -> tenant -> lease -> occupancy -> deposit -> inspection', () => {
  test('the full happy-path chain works end to end, and occupancy/rent-schedule/deposit are correct at each step', async ({
    request,
  }) => {
    const { orgId } = await setUpOrg(request, 'workflow-happy');
    const propertyId = await createProperty(request, orgId, 'Workflow Property');

    // === Ownership (Stage 5) ===
    const ownerResponse = await request.post('/api/v1/owners', {
      headers: { Origin: BASE_URL },
      data: { orgId, ownerType: 'individual', name: 'Real Owner' },
    });
    expect(ownerResponse.ok()).toBe(true);
    const owner = await ownerResponse.json();

    const attachResponse = await request.post(`/api/v1/properties/${propertyId}/owners`, {
      headers: { Origin: BASE_URL },
      data: { ownerId: owner.owner.id, ownershipPct: 100 },
    });
    expect(attachResponse.ok()).toBe(true);

    const ownersListResponse = await request.get(`/api/v1/properties/${propertyId}/owners`);
    const ownersList = await ownersListResponse.json();
    expect(ownersList.propertyOwners).toHaveLength(1);
    expect(ownersList.propertyOwners[0].ownershipPct).toBe(100);

    // === Unit (Stage 7/8) ===
    const unitId = await createUnit(request, propertyId, 'Unit A');
    expect(await getUnitStatus(request, unitId)).toBe('vacant');

    // === Application (Stage 9) -> approval creates tenant + active lease + rent schedule ===
    const applicationResponse = await request.post('/api/v1/applications', {
      headers: { Origin: BASE_URL },
      data: {
        orgId,
        propertyId,
        unitId,
        applicantName: 'Happy Path Applicant',
        applicantEmail: 'happy-path@example.com',
      },
    });
    expect(applicationResponse.ok()).toBe(true);
    const application = await applicationResponse.json();

    const decideResponse = await request.post(
      `/api/v1/applications/${application.application.id}/decide`,
      {
        headers: { Origin: BASE_URL },
        data: {
          decision: 'approved',
          rentAmount: 10000,
          depositAmount: 10000,
          startDate: '2026-01-01',
        },
      },
    );
    expect(decideResponse.ok()).toBe(true);
    const decided = await decideResponse.json();
    const leaseId = decided.leaseId as string;

    // Occupancy (Stage 18): approval's lease is created directly 'active' -- the unit must be
    // occupied immediately, not left vacant/stale.
    expect(await getUnitStatus(request, unitId)).toBe('occupied');

    const leaseResponse = await request.get(`/api/v1/leases/${leaseId}`);
    const lease = await leaseResponse.json();
    expect(lease.lease.status).toBe('active');

    // Rent schedule (Stage 12): activation/approval must have generated at least one row.
    const rentScheduleResponse = await request.get(`/api/v1/leases/${leaseId}/rent-schedule`);
    expect(rentScheduleResponse.ok()).toBe(true);
    const rentSchedule = await rentScheduleResponse.json();
    expect((rentSchedule.rentSchedule ?? rentSchedule.data ?? []).length).toBeGreaterThan(0);

    // === Deposit (Stage 13) ===
    const postDepositResponse = await request.post(`/api/v1/leases/${leaseId}/post-deposit`, {
      headers: { Origin: BASE_URL },
    });
    expect(postDepositResponse.ok()).toBe(true);
    const trustLedger = await postDepositResponse.json();
    expect(trustLedger.trustLedger.status).toBe('active');
    expect(trustLedger.trustLedger.currentBalance).toBe(10000);

    // Release must be rejected before a completed move-out inspection exists.
    const earlyReleaseResponse = await request.post(
      `/api/v1/trust-ledgers/${trustLedger.trustLedger.id}/release`,
      {
        headers: { Origin: BASE_URL },
        data: { refundAmount: 10000, deductionAmount: 0 },
      },
    );
    expect(earlyReleaseResponse.status()).toBe(422);
    const earlyReleaseBody = await earlyReleaseResponse.json();
    expect(earlyReleaseBody.error.message).toContain('move-out inspection');

    // === Inspection (Stage 14): move-in, then move-out through to completed ===
    const moveInResponse = await request.post('/api/v1/inspections', {
      headers: { Origin: BASE_URL },
      data: {
        orgId,
        propertyId,
        unitId,
        leaseId,
        inspectionType: 'move_in',
        scheduledAt: new Date().toISOString(),
      },
    });
    expect(moveInResponse.ok()).toBe(true);
    const moveIn = await moveInResponse.json();
    expect(moveIn.inspection.inspectionType).toBe('move_in');
    expect(moveIn.inspection.status).toBe('scheduled');

    const moveOutResponse = await request.post('/api/v1/inspections', {
      headers: { Origin: BASE_URL },
      data: {
        orgId,
        propertyId,
        unitId,
        leaseId,
        inspectionType: 'move_out',
        scheduledAt: new Date().toISOString(),
      },
    });
    expect(moveOutResponse.ok()).toBe(true);
    const moveOut = await moveOutResponse.json();

    // Cannot complete before both signatures (or a logged refusal) exist.
    const earlyCompleteResponse = await request.post(
      `/api/v1/inspections/${moveOut.inspection.id}/complete`,
      { headers: { Origin: BASE_URL } },
    );
    expect(earlyCompleteResponse.status()).toBe(400);

    await request.post(`/api/v1/inspections/${moveOut.inspection.id}/sign`, {
      headers: { Origin: BASE_URL },
      data: { signer: 'landlord' },
    });
    await request.post(`/api/v1/inspections/${moveOut.inspection.id}/sign`, {
      headers: { Origin: BASE_URL },
      data: { signer: 'tenant' },
    });
    const completeResponse = await request.post(
      `/api/v1/inspections/${moveOut.inspection.id}/complete`,
      { headers: { Origin: BASE_URL } },
    );
    expect(completeResponse.ok()).toBe(true);
    const completed = await completeResponse.json();
    expect(completed.inspection.status).toBe('completed');

    // Now the deposit can actually be released.
    const releaseResponse = await request.post(
      `/api/v1/trust-ledgers/${trustLedger.trustLedger.id}/release`,
      {
        headers: { Origin: BASE_URL },
        data: { refundAmount: 10000, deductionAmount: 0 },
      },
    );
    expect(releaseResponse.ok()).toBe(true);
    const released = await releaseResponse.json();
    expect(released.trustLedger.status).toBe('released');

    // === Ending the lease (Stage 11/18): unit must revert to vacant ===
    const endResponse = await request.post(`/api/v1/leases/${leaseId}/end`, {
      headers: { Origin: BASE_URL },
      data: { status: 'terminated' },
    });
    expect(endResponse.ok()).toBe(true);
    expect(await getUnitStatus(request, unitId)).toBe('vacant');
  });

  test('application approval never creates a duplicate tenant for a matching email', async ({
    request,
  }) => {
    const { orgId } = await setUpOrg(request, 'workflow-dedup');
    const propertyId = await createProperty(request, orgId, 'Dedup Property');
    const unit1 = await createUnit(request, propertyId, 'Unit A');
    const unit2 = await createUnit(request, propertyId, 'Unit B');

    const applicant = { applicantName: 'Repeat Applicant', applicantEmail: 'repeat@example.com' };

    for (const unitId of [unit1, unit2]) {
      const applicationResponse = await request.post('/api/v1/applications', {
        headers: { Origin: BASE_URL },
        data: { orgId, propertyId, unitId, ...applicant },
      });
      const application = await applicationResponse.json();
      const decideResponse = await request.post(
        `/api/v1/applications/${application.application.id}/decide`,
        {
          headers: { Origin: BASE_URL },
          data: {
            decision: 'approved',
            rentAmount: 8000,
            depositAmount: 8000,
            startDate: '2026-01-01',
          },
        },
      );
      expect(decideResponse.ok()).toBe(true);
    }

    const tenantsResponse = await request.get(`/api/v1/tenants?filter[org_id]=${orgId}`);
    const tenants = await tenantsResponse.json();
    const matching = tenants.tenants.filter(
      (t: { fullName: string }) => t.fullName === 'Repeat Applicant',
    );
    expect(matching).toHaveLength(1);
  });

  test('a manual draft lease cannot activate without a tenant assigned', async ({ request }) => {
    const { orgId } = await setUpOrg(request, 'workflow-no-tenant');
    const propertyId = await createProperty(request, orgId, 'No Tenant Property');
    const unitId = await createUnit(request, propertyId, 'Unit A');

    const leaseResponse = await request.post('/api/v1/leases', {
      headers: { Origin: BASE_URL },
      data: { orgId, unitId, startDate: '2026-01-01', rentAmount: 9000, depositAmount: 9000 },
    });
    expect(leaseResponse.ok()).toBe(true);
    const lease = await leaseResponse.json();
    expect(lease.lease.status).toBe('draft');

    // A draft lease must never mark the unit occupied.
    expect(await getUnitStatus(request, unitId)).toBe('vacant');

    const activateResponse = await request.post(`/api/v1/leases/${lease.lease.id}/activate`, {
      headers: { Origin: BASE_URL },
    });
    expect(activateResponse.status()).toBe(400);
    const activateBody = await activateResponse.json();
    expect(activateBody.error.message).toContain('tenant');

    // Still vacant after the rejected activation attempt.
    expect(await getUnitStatus(request, unitId)).toBe('vacant');
  });

  test('assigning a tenant then activating works, and a second overlapping active lease on the same unit is rejected', async ({
    request,
  }) => {
    const { orgId } = await setUpOrg(request, 'workflow-overlap');
    const propertyId = await createProperty(request, orgId, 'Overlap Property');
    const unitId = await createUnit(request, propertyId, 'Unit A');

    const tenantResponse = await request.post('/api/v1/tenants', {
      headers: { Origin: BASE_URL },
      data: { orgId, fullName: 'Manual Tenant' },
    });
    const tenant = await tenantResponse.json();

    const lease1Response = await request.post('/api/v1/leases', {
      headers: { Origin: BASE_URL },
      data: { orgId, unitId, startDate: '2026-01-01', rentAmount: 9500, depositAmount: 0 },
    });
    const lease1 = await lease1Response.json();

    await request.post(`/api/v1/leases/${lease1.lease.id}/tenants`, {
      headers: { Origin: BASE_URL },
      data: { tenantId: tenant.tenant.id, isPrimary: true },
    });

    const activate1Response = await request.post(`/api/v1/leases/${lease1.lease.id}/activate`, {
      headers: { Origin: BASE_URL },
    });
    expect(activate1Response.ok()).toBe(true);
    expect(await getUnitStatus(request, unitId)).toBe('occupied');

    // Activating an already-active lease again is idempotent, not an error.
    const reactivateResponse = await request.post(`/api/v1/leases/${lease1.lease.id}/activate`, {
      headers: { Origin: BASE_URL },
    });
    expect(reactivateResponse.ok()).toBe(true);

    // A second lease on the same unit, also assigned a tenant, must be rejected on activation.
    const lease2Response = await request.post('/api/v1/leases', {
      headers: { Origin: BASE_URL },
      data: { orgId, unitId, startDate: '2026-02-01', rentAmount: 9500, depositAmount: 0 },
    });
    const lease2 = await lease2Response.json();
    await request.post(`/api/v1/leases/${lease2.lease.id}/tenants`, {
      headers: { Origin: BASE_URL },
      data: { tenantId: tenant.tenant.id, isPrimary: true },
    });
    const activate2Response = await request.post(`/api/v1/leases/${lease2.lease.id}/activate`, {
      headers: { Origin: BASE_URL },
    });
    expect(activate2Response.status()).toBe(400);
    const activate2Body = await activate2Response.json();
    expect(activate2Body.error.message).toContain('already has another active lease');
  });

  test('maintenance can be set on a vacant unit but not on one with an active lease, and occupied can never be set directly', async ({
    request,
  }) => {
    const { orgId } = await setUpOrg(request, 'workflow-maintenance');
    const propertyId = await createProperty(request, orgId, 'Maintenance Property');
    const vacantUnitId = await createUnit(request, propertyId, 'Unit Vacant');
    const occupiedUnitId = await createUnit(request, propertyId, 'Unit Occupied');

    // Occupy the second unit via a real approved application (the only legitimate path).
    const applicationResponse = await request.post('/api/v1/applications', {
      headers: { Origin: BASE_URL },
      data: {
        orgId,
        propertyId,
        unitId: occupiedUnitId,
        applicantName: 'Maintenance Test Tenant',
      },
    });
    const application = await applicationResponse.json();
    await request.post(`/api/v1/applications/${application.application.id}/decide`, {
      headers: { Origin: BASE_URL },
      data: {
        decision: 'approved',
        rentAmount: 7000,
        depositAmount: 0,
        startDate: '2026-01-01',
      },
    });
    expect(await getUnitStatus(request, occupiedUnitId)).toBe('occupied');

    // Maintenance is a legitimate manual override on a vacant unit.
    const maintenanceOkResponse = await request.patch(`/api/v1/units/${vacantUnitId}`, {
      headers: { Origin: BASE_URL },
      data: { status: 'maintenance' },
    });
    expect(maintenanceOkResponse.ok()).toBe(true);
    expect(await getUnitStatus(request, vacantUnitId)).toBe('maintenance');

    // Clearing maintenance back to vacant is allowed.
    const clearResponse = await request.patch(`/api/v1/units/${vacantUnitId}`, {
      headers: { Origin: BASE_URL },
      data: { status: 'vacant' },
    });
    expect(clearResponse.ok()).toBe(true);
    expect(await getUnitStatus(request, vacantUnitId)).toBe('vacant');

    // Maintenance is rejected on a unit that currently has an active lease.
    const maintenanceBlockedResponse = await request.patch(`/api/v1/units/${occupiedUnitId}`, {
      headers: { Origin: BASE_URL },
      data: { status: 'maintenance' },
    });
    expect(maintenanceBlockedResponse.status()).toBe(400);

    // 'occupied' can never be set directly through the API, on any unit.
    const directOccupyResponse = await request.patch(`/api/v1/units/${vacantUnitId}`, {
      headers: { Origin: BASE_URL },
      data: { status: 'occupied' },
    });
    expect(directOccupyResponse.status()).toBe(400);
  });
});

test.describe('cross-organisation isolation', () => {
  test("a member of org B cannot read org A's property, unit, or lease", async ({ request }) => {
    const orgA = await setUpOrg(request, 'iso-org-a');
    const propertyId = await createProperty(request, orgA.orgId, 'Org A Property');
    const unitId = await createUnit(request, propertyId, 'Unit A');
    const leaseResponse = await request.post('/api/v1/leases', {
      headers: { Origin: BASE_URL },
      data: {
        orgId: orgA.orgId,
        unitId,
        startDate: '2026-01-01',
        rentAmount: 5000,
        depositAmount: 0,
      },
    });
    const lease = await leaseResponse.json();

    // Switch sessions to a brand-new, unrelated org/user.
    await setUpOrg(request, 'iso-org-b');

    const propertyResponse = await request.get(`/api/v1/properties/${propertyId}`);
    expect(propertyResponse.status()).toBe(404);

    const unitResponse = await request.get(`/api/v1/units/${unitId}`);
    expect(unitResponse.status()).toBe(404);

    const leaseResponse2 = await request.get(`/api/v1/leases/${lease.lease.id}`);
    expect(leaseResponse2.status()).toBe(404);

    // Nor can org B's member act on org A's resources even if they somehow knew the ids.
    const activateResponse = await request.post(`/api/v1/leases/${lease.lease.id}/activate`, {
      headers: { Origin: BASE_URL },
    });
    expect(activateResponse.ok()).toBe(false);
  });
});
