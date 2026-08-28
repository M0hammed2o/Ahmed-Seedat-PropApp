'use client';

// Shared multipart-upload helper (V1 launch-completion pass) -- both ExpenseForm.tsx's
// upload-at-creation flow and ExpenseEvidenceUpload.tsx's attach-after-the-fact flow on the
// expense detail page need to POST a file to the existing, unmodified POST /api/v1/documents
// route and get back a document id. Factored out once here rather than duplicated in both
// components (Coding.md: reuse existing services, don't duplicate). Always tags the upload with
// documentType 'receipt' and the org's 'receipt' document category -- the fitting existing
// category/type pair for "evidence supporting an expense," not a new category.

export interface UploadEvidenceParams {
  orgId: string;
  propertyId: string;
  categoryId: string;
  file: File;
}

export interface UploadEvidenceResult {
  documentId: string | null;
  error: string | null;
}

export async function uploadEvidenceDocument({
  orgId,
  propertyId,
  categoryId,
  file,
}: UploadEvidenceParams): Promise<UploadEvidenceResult> {
  try {
    const form = new FormData();
    form.set('file', file);
    form.set('orgId', orgId);
    form.set('propertyId', propertyId);
    form.set('categoryId', categoryId);
    form.set('documentType', 'receipt');

    const response = await fetch('/api/v1/documents', { method: 'POST', body: form });
    const body = await response.json();
    if (!response.ok) {
      return { documentId: null, error: body.error?.message ?? 'Failed to upload evidence.' };
    }
    return { documentId: body.document.id as string, error: null };
  } catch {
    return { documentId: null, error: 'Failed to upload evidence — check your connection and try again.' };
  }
}
