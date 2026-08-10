import Link from 'next/link';
import { Panel } from '@/components/ui/Panel';

// Shared-access architecture pass (WORKLOG.md this date), Phase 4: Property -> Category -> Year
// -> Month folder presentation over documents that already carry that structure
// (category_id/billing_year/billing_month, migrations 20260101000007/008/085) -- the folders are
// purely a grouping of already-queryable rows, never a real filesystem. Native <details>/<summary>
// disclosure widgets give real expand/collapse with zero client JS -- this stays a server
// component.

interface DocumentForFolders {
  id: string;
  originalFileName: string;
  documentType: string;
  categoryId: string;
  billingYear: number | null;
  billingMonth: number | null;
  updatedAt: string;
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export function PropertyDocumentFolders({
  documents,
  categoryLabelById,
}: {
  documents: DocumentForFolders[];
  categoryLabelById: Map<string, string>;
}) {
  const byCategory = new Map<string, DocumentForFolders[]>();
  for (const doc of documents) {
    const list = byCategory.get(doc.categoryId) ?? [];
    list.push(doc);
    byCategory.set(doc.categoryId, list);
  }

  const categories = [...byCategory.entries()].sort((a, b) => {
    const labelA = categoryLabelById.get(a[0]) ?? 'Other';
    const labelB = categoryLabelById.get(b[0]) ?? 'Other';
    return labelA.localeCompare(labelB);
  });

  return (
    <Panel bodyClassName="p-5">
      <div className="space-y-2">
        {categories.map(([categoryId, docs]) => (
          <details key={categoryId} className="group rounded-xl border border-border">
            <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-medium text-foreground">
              <span>{categoryLabelById.get(categoryId) ?? 'Other'}</span>
              <span className="text-xs text-muted-foreground">{docs.length}</span>
            </summary>
            <div className="border-t border-border px-4 py-3">
              <YearGroups docs={docs} />
            </div>
          </details>
        ))}
      </div>
      <Link
        href="/documents"
        className="mt-4 inline-block text-[12px] font-medium text-primary hover:underline"
      >
        View all documents →
      </Link>
    </Panel>
  );
}

function YearGroups({ docs }: { docs: DocumentForFolders[] }) {
  const byYear = new Map<string, DocumentForFolders[]>();
  for (const doc of docs) {
    const key = doc.billingYear ? String(doc.billingYear) : 'Undated';
    const list = byYear.get(key) ?? [];
    list.push(doc);
    byYear.set(key, list);
  }
  const years = [...byYear.entries()].sort((a, b) => b[0].localeCompare(a[0]));

  return (
    <div className="space-y-2">
      {years.map(([year, yearDocs]) => (
        <details key={year} className="rounded-lg border border-border/60">
          <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-[13px] font-medium text-foreground">
            <span>{year}</span>
            <span className="text-xs text-muted-foreground">{yearDocs.length}</span>
          </summary>
          <div className="border-t border-border/60 px-3 py-2">
            <MonthGroups docs={yearDocs} />
          </div>
        </details>
      ))}
    </div>
  );
}

function MonthGroups({ docs }: { docs: DocumentForFolders[] }) {
  const byMonth = new Map<string, DocumentForFolders[]>();
  for (const doc of docs) {
    const key = doc.billingMonth ? MONTH_NAMES[doc.billingMonth - 1]! : 'Unspecified';
    const list = byMonth.get(key) ?? [];
    list.push(doc);
    byMonth.set(key, list);
  }
  const months = [...byMonth.entries()];

  return (
    <div className="space-y-2">
      {months.map(([month, monthDocs]) => (
        <div key={month}>
          <p className="mb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            {month}
          </p>
          <ul className="space-y-1.5">
            {monthDocs.map((d) => (
              <li key={d.id}>
                <Link
                  href={`/documents/${d.id}`}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-foreground hover:bg-surface"
                >
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded bg-primary-soft text-[9px] font-bold text-primary">
                    {d.originalFileName.split('.').pop()?.toUpperCase() ?? 'DOC'}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{d.originalFileName}</span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {new Date(d.updatedAt).toLocaleDateString('en-ZA')}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
