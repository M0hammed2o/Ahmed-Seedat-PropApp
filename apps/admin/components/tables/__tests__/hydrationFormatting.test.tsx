import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { renderToString } from 'react-dom/server';
import type { DocumentRecord } from '@propvault/types';
import type { TenantWithTenancy } from '@/app/(dashboard)/tenants/page';
import { DocumentsTable } from '../DocumentsTable';
import { TenantsTable } from '../TenantsTable';

// Regression for React error #418 on /documents and /tenants (2026-11-04). A client component's
// markup must not depend on where it renders: production renders on Render (UTC, Node 20's ICU,
// which formats en-ZA amounts as "R452,300") and hydrates in the browser (Africa/Johannesburg or
// anywhere else, with its own locale data -- "R 452 300"). Render the same props under several
// time zones and with the runtime's locale formatting sabotaged; the HTML must be identical.

const ORIGINAL_TZ = process.env.TZ;
afterEach(() => {
  process.env.TZ = ORIGINAL_TZ;
  vi.restoreAllMocks();
});

function doc(id: string, createdAt: string): DocumentRecord {
  return {
    id,
    ownerUserId: null,
    orgId: 'org-1',
    propertyId: 'property-1',
    categoryId: 'category-1',
    documentType: 'lease',
    storagePath: `org-1/property-1/${id}.pdf`,
    originalFileName: `${id}.pdf`,
    mimeType: 'application/pdf',
    fileSizeBytes: 1048576,
    checksumSha256: 'abc',
    billingYear: null,
    billingMonth: null,
    leaseId: null,
    unitId: null,
    tenantId: null,
    maintenanceTicketId: null,
    uploadedBy: null,
    deletedAt: null,
    createdAt,
    updatedAt: createdAt,
  };
}

// Either side of South African midnight (22:00 UTC), and of the UTC date line.
const DOCUMENTS = [
  doc('before-sa-midnight', '2026-11-03T21:59:59+00:00'),
  doc('after-sa-midnight', '2026-11-03T22:00:00+00:00'),
  doc('late-utc', '2026-11-03T23:45:00Z'),
  doc('year-end', '2026-12-31T22:30:00Z'),
];

const TENANT: TenantWithTenancy = {
  id: 'tenant-1',
  orgId: 'org-1',
  userId: null,
  fullName: 'Naledi Khumalo',
  email: 'naledi@example.com',
  phone: null,
  idNumberRef: null,
  status: 'active',
  emergencyContactName: null,
  emergencyContactPhone: null,
  emergencyContactRelationship: null,
  createdAt: '2026-06-05T00:00:00Z',
  updatedAt: '2026-06-05T00:00:00Z',
  tenancy: {
    leaseId: 'lease-1',
    leaseStatus: 'active',
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    rentAmount: 452300.4,
    rentFrequency: 'monthly',
    unitId: 'unit-601',
    unitLabel: 'Unit 601',
    propertyId: 'property-1',
    propertyNickname: 'Musgrave Heights',
  },
  portalStatus: { status: 'not_invited', label: 'Not invited' },
};

const ZONES = ['UTC', 'Africa/Johannesburg', 'America/New_York', 'Pacific/Kiritimati'];

function renderIn(zone: string, element: ReactElement) {
  process.env.TZ = zone;
  return renderToString(element);
}

describe('client tables render identically on the server and in any browser', () => {
  it('the test really switches time zones (the old toLocaleDateString differed)', () => {
    const at = new Date('2026-11-03T23:45:00Z');
    process.env.TZ = 'UTC';
    const utc = at.toLocaleDateString('en-ZA');
    process.env.TZ = 'Africa/Johannesburg';
    expect(at.toLocaleDateString('en-ZA')).not.toBe(utc);
  });

  it('DocumentsTable shows South African upload dates in every time zone', () => {
    const html = ZONES.map((z) => renderIn(z, <DocumentsTable data={DOCUMENTS} />));
    const [first] = html as [string, ...string[]];
    for (const h of html) expect(h).toBe(first);
    expect(first).toContain('2026/11/03'); // 21:59:59 UTC = 23:59:59 SAST
    expect(first).toContain('2026/11/04'); // 22:00 and 23:45 UTC = the next SA day
    expect(first).toContain('2027/01/01'); // 22:30 UTC on 31 December = SA new year
    expect(first.match(/2026\/11\/04/g)).toHaveLength(2);
  });

  it('TenantsTable rent does not depend on the runtime locale data (Render vs browser ICU)', () => {
    const reference = renderToString(<TenantsTable data={[TENANT]} />);
    // Simulate a runtime whose locale formatting differs (another ICU / browser locale).
    vi.spyOn(Number.prototype, 'toLocaleString').mockReturnValue('LOCALE-DEPENDENT');
    vi.spyOn(Date.prototype, 'toLocaleDateString').mockReturnValue('LOCALE-DEPENDENT');
    for (const z of ZONES) expect(renderIn(z, <TenantsTable data={[TENANT]} />)).toBe(reference);
    expect(reference).toContain('R452 300');
    expect(reference).not.toContain('LOCALE-DEPENDENT');
  });

  it('DocumentsTable dates do not depend on the runtime locale data either', () => {
    const reference = renderToString(<DocumentsTable data={DOCUMENTS} />);
    vi.spyOn(Date.prototype, 'toLocaleDateString').mockReturnValue('LOCALE-DEPENDENT');
    vi.spyOn(Date.prototype, 'toLocaleString').mockReturnValue('LOCALE-DEPENDENT');
    expect(renderToString(<DocumentsTable data={DOCUMENTS} />)).toBe(reference);
  });
});
