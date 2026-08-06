'use client';

import { useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { FileText, Grid2x2, List, Search } from 'lucide-react';
import { DOCUMENT_TYPES, type DocumentType } from '@propvault/types';
import type { DocumentRecord } from '@propvault/types';
import { Pill } from '@/components/ui/Pill';
import { DocumentsTable } from './DocumentsTable';

const CATEGORY_LABELS: Record<DocumentType, string> = {
  bill: 'Bill',
  statement: 'Statement',
  proof_of_payment: 'Proof of payment',
  receipt: 'Receipt',
  supporting_document: 'Supporting document',
  lease: 'Lease',
  other: 'Other',
};

function currency(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

// Adapted from reference/lovable-ui-reference's documents/index.tsx category-tab bar + grid/list
// toggle (2026-08-04 Lovable-adoption batch, UI_INTEGRATION_PLAN.md). Lovable's own category set
// (Leases/Invoices/Compliance/Inspections/Statements/Contracts) has no real backing enum -- this
// uses public.document_type's actual 7 values instead (DOCUMENT_TYPES, extended with 'lease' by
// migration 20260101000033). Lovable's "Preview" + "Extracted by OCR" side panel is not
// reproduced here: PropertyVault already has a real, deep-linkable document detail page with a
// real, already-shipped OCR extraction panel (extraction_jobs/extraction_results tables,
// components/documents/OcrPanel.tsx) -- the same "keep the real two-page pattern, don't collapse
// into a client-side preview pane" call already made for Property/Tenant detail. Lovable's
// hardcoded "Uploading Lease_RH311_Draft.pdf 68%... OCR queued" progress banner is omitted
// entirely: no real in-flight-upload-progress tracking exists (uploads are a synchronous form
// submit, not chunked), so it would be a fabricated, permanently-stuck status.
export function DocumentsFilterClient({
  documents,
  emptyAction,
}: {
  documents: DocumentRecord[];
  emptyAction?: ReactNode;
}) {
  const [category, setCategory] = useState<DocumentType | 'all'>('all');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [query, setQuery] = useState('');

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
          (category === 'all' || d.documentType === category) &&
          d.originalFileName.toLowerCase().includes(query.toLowerCase()),
      ),
    [documents, category, query],
  );

  if (documents.length === 0) {
    return <DocumentsTable data={[]} emptyAction={emptyAction} />;
  }

  return (
    <div className="space-y-4">
      <div className="panel grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 sm:flex sm:flex-wrap sm:justify-between">
        <div className="scrollbar-slim flex min-w-0 items-center gap-1 overflow-x-auto rounded-xl bg-surface p-1">
          {(['all', ...DOCUMENT_TYPES] as const).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium whitespace-nowrap transition-colors ${
                category === c
                  ? 'bg-card text-foreground shadow-card'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {c === 'all' ? 'All' : CATEGORY_LABELS[c]}
              <span className="tabular rounded-md bg-surface-strong px-1.5 text-[10px]">
                {counts[c] ?? 0}
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
                  {currency(d.fileSizeBytes)} · {new Date(d.createdAt).toLocaleDateString('en-ZA')}
                </p>
                <div className="mt-3">
                  <Pill>{CATEGORY_LABELS[d.documentType]}</Pill>
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
  );
}
