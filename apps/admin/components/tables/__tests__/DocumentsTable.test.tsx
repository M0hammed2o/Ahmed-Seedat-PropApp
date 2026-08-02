// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { DocumentRecord } from '@propvault/types';
import { DocumentsTable } from '../DocumentsTable';

afterEach(cleanup);

const DOCUMENT: DocumentRecord = {
  id: 'document-1',
  ownerUserId: null,
  orgId: 'org-1',
  propertyId: 'property-1',
  categoryId: 'category-1',
  documentType: 'lease',
  storagePath: 'org-1/property-1/file.pdf',
  originalFileName: 'Lease Agreement.pdf',
  mimeType: 'application/pdf',
  fileSizeBytes: 1048576,
  checksumSha256: 'abc',
  billingYear: null,
  billingMonth: null,
  deletedAt: null,
  createdAt: '2026-08-01T00:00:00Z',
  updatedAt: '2026-08-01T00:00:00Z',
};

describe('DocumentsTable', () => {
  it('renders document rows with type and formatted size', () => {
    render(<DocumentsTable data={[DOCUMENT]} />);
    expect(screen.getByText('Lease Agreement.pdf')).toBeTruthy();
    expect(screen.getByText('lease')).toBeTruthy();
    expect(screen.getByText('1.00 MB')).toBeTruthy();
  });

  it('renders the empty state with the custom action when there are no documents', () => {
    render(<DocumentsTable data={[]} emptyAction={<button>+ Upload document</button>} />);
    expect(screen.getByText('No documents yet')).toBeTruthy();
    expect(screen.getByText('+ Upload document')).toBeTruthy();
  });
});
