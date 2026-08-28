'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { FileText, Grid2x2, List, Search, X } from 'lucide-react';
import { DOCUMENT_TYPES, type DocumentType } from '@propvault/types';
import type { DocumentRecord } from '@propvault/types';
import { Pill } from '@/components/ui/Pill';
import { DocumentsTable } from './DocumentsTable';

export interface PropertyOption {
  id: string;
  nickname: string;
}

export interface CategoryOption {
  id: string;
  label: string;
}

// Renamed from CATEGORY_LABELS (property/category filtering pass, V1 launch-completion, this
// date): these are keyed on the document_type ENUM (bill/statement/proof_of_payment/...), not
// public.document_categories -- the new Category dropdown below is what's genuinely category-based.
// Pure rename, values/behavior unchanged.
const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  bill: 'Bill',
  statement: 'Statement',
  proof_of_payment: 'Proof of payment',
  receipt: 'Receipt',
  supporting_document: 'Supporting document',
  lease: 'Lease',
  other: 'Other',
  id_document: 'ID document',
  proof_of_address: 'Proof of address',
  payslip: 'Payslip',
  bank_statement: 'Bank statement',
};

function currency(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

const selectClass =
  'h-9 rounded-xl border border-border bg-card px-3 text-[13px] text-foreground outline-none focus:border-primary/40';

// Adapted from reference/lovable-ui-reference's documents/index.tsx category-tab bar + grid/list
// toggle (2026-08-04 Lovable-adoption batch, UI_INTEGRATION_PLAN.md). Lovable's own category set
// (Leases/Invoices/Compliance/Inspections/Statements/Contracts) has no real backing enum -- this
// uses public.document_type's actual 11 values instead (DOCUMENT_TYPES). Lovable's
// "Preview" + "Extracted by OCR" side panel is not reproduced here: PropertyVault already has a
// real, deep-linkable document detail page with a real, already-shipped OCR extraction panel
// (extraction_jobs/extraction_results tables, components/documents/OcrPanel.tsx) -- the same
// "keep the real two-page pattern, don't collapse into a client-side preview pane" call already
// made for Property/Tenant detail. Lovable's hardcoded "Uploading Lease_RH311_Draft.pdf 68%... OCR
// queued" progress banner is omitted entirely: no real in-flight-upload-progress tracking exists
// (uploads are a synchronous form submit, not chunked), so it would be a fabricated, permanently
// -stuck status.
//
// Property/category filtering pass (V1 launch-completion, this date): propertyId/categoryId are
// now real, server-applied Supabase filters (documents/page.tsx already scoped the `documents`
// prop to them) whose state lives in the URL query string (?propertyId=&categoryId=) via
// useSearchParams/useRouter, so the filtered view is shareable/bookmarkable and survives the back
// button -- matching how a property's "View all documents ->" link now arrives here with
// ?propertyId=<id> set. Document-type tabs and the file-name search stay local useState, cheap
// in-memory refinement on top of an already-server-scoped list, same as before.
export function DocumentsFilterClient({
  documents,
  properties,
  categories,
  emptyAction,
}: {
  documents: DocumentRecord[];
  properties: PropertyOption[];
  categories: CategoryOption[];
  emptyAction?: ReactNode;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const propertyId = searchParams.get('propertyId') ?? '';
  const categoryId = searchParams.get('categoryId') ?? '';

  const [type, setType] = useState<DocumentType | 'all'>('all');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [query, setQuery] = useState('');

  function updateParams(next: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    const qs = params.toString();
    router.push(qs ? `/documents?${qs}` : '/documents');
  }

  function clearAllFilters() {
    setType('all');
    setQuery('');
    router.push('/documents');
  }

  const selectedProperty = properties.find((p) => p.id === propertyId);
  const hasActiveFilters = Boolean(propertyId || categoryId || type !== 'all' || query);

  const counts = useMemo(() => {
    const byType: Record<string, number> = { all: documents.length };
    for (const t of DOCUMENT_TYPES)
      byType[t] = documents.filter((d) => d.documentType === t).length;
    return byType;
  }, [documents]);

  const filtered = useMemo(
    () =>
      documents.filter(
        (d) =>
          (type === 'all' || d.documentType === type) &&
          d.originalFileName.toLowerCase().includes(query.toLowerCase()),
      ),
    [documents, type, query],
  );

  return (
    <div className="space-y-4">
      {propertyId && selectedProperty ? (
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-pill bg-primary-soft px-3 py-1 text-[12px] font-medium text-primary">
            Filtered to: {selectedProperty.nickname}
            <button
              type="button"
              onClick={() => updateParams({ propertyId: null })}
              aria-label="Clear property filter"
              className="grid h-4 w-4 place-items-center rounded-full hover:bg-primary/20"
            >
              <X className="h-3 w-3" aria-hidden="true" />
            </button>
          </span>
        </div>
      ) : null}

      <div className="panel flex flex-wrap items-center gap-3 px-4 py-3">
        <label className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
          Property
          <select
            value={propertyId}
            onChange={(e) => updateParams({ propertyId: e.target.value || null })}
            className={selectClass}
          >
            <option value="">All properties</option>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nickname}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
          Category
          <select
            value={categoryId}
            onChange={(e) => updateParams({ categoryId: e.target.value || null })}
            className={selectClass}
          >
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>

        {hasActiveFilters ? (
          <button
            type="button"
            onClick={clearAllFilters}
            className="text-[12px] font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            Clear filters
          </button>
        ) : null}
      </div>

      {documents.length === 0 ? (
        <DocumentsTable data={[]} emptyAction={emptyAction} />
      ) : (
        <div className="space-y-4">
          <div className="panel grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 sm:flex sm:flex-wrap sm:justify-between">
            <div className="scrollbar-slim flex min-w-0 items-center gap-1 overflow-x-auto rounded-xl bg-surface p-1">
              {(['all', ...DOCUMENT_TYPES] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium whitespace-nowrap transition-colors ${
                    type === t
                      ? 'bg-card text-foreground shadow-card'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {t === 'all' ? 'All' : DOCUMENT_TYPE_LABELS[t]}
                  <span className="tabular rounded-md bg-surface-strong px-1.5 text-[10px]">
                    {counts[t] ?? 0}
                  </span>
                </button>
              ))}
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <div className="relative hidden sm:block">
                <Search
                  className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search by file name"
                  className="h-9 w-[180px] rounded-xl border border-border bg-card pr-3 pl-9 text-[13px] text-foreground outline-none focus:border-primary/40"
                />
              </div>
              <div className="flex items-center gap-1 rounded-xl border border-border p-1">
                <button
                  type="button"
                  onClick={() => setView('grid')}
                  aria-label="Grid view"
                  className={`grid h-7 w-7 place-items-center rounded-lg ${view === 'grid' ? 'bg-primary-soft text-primary' : 'text-muted-foreground'}`}
                >
                  <Grid2x2 className="h-4 w-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => setView('list')}
                  aria-label="List view"
                  className={`grid h-7 w-7 place-items-center rounded-lg ${view === 'list' ? 'bg-primary-soft text-primary' : 'text-muted-foreground'}`}
                >
                  <List className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>

          {view === 'grid' ? (
            filtered.length === 0 ? (
              <p className="panel px-5 py-8 text-center text-sm text-muted-foreground">
                No documents match this filter
              </p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {filtered.map((d) => (
                  <Link
                    key={d.id}
                    href={`/documents/${d.id}`}
                    className="panel group p-4 text-left transition-all hover:-translate-y-px hover:shadow-lift"
                  >
                    <div className="mb-3 grid h-24 place-items-center rounded-xl bg-surface">
                      <FileText className="h-7 w-7 text-muted-foreground" aria-hidden="true" />
                    </div>
                    <p className="truncate text-[13px] font-medium text-foreground">
                      {d.originalFileName}
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {currency(d.fileSizeBytes)} ·{' '}
                      {new Date(d.createdAt).toLocaleDateString('en-ZA')}
                    </p>
                    <div className="mt-3">
                      <Pill>{DOCUMENT_TYPE_LABELS[d.documentType]}</Pill>
                    </div>
                  </Link>
                ))}
              </div>
            )
          ) : (
            <DocumentsTable
              data={filtered}
              emptyAction={filtered.length === 0 ? emptyAction : undefined}
            />
          )}
        </div>
      )}
    </div>
  );
}
