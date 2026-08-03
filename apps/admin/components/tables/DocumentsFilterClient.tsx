'use client';

import type { ReactNode } from 'react';
import type { DocumentRecord } from '@propvault/types';
import { useListSearch } from '@/lib/useListSearch';
import { SearchBar } from '@/components/ui/SearchBar';
import { DocumentsTable } from './DocumentsTable';

export function DocumentsFilterClient({
  documents,
  emptyAction,
}: {
  documents: DocumentRecord[];
  emptyAction?: ReactNode;
}) {
  const { query, setQuery, filtered } = useListSearch(
    documents,
    (d) => `${d.originalFileName} ${d.documentType}`,
  );

  return (
    <div className="space-y-4">
      <SearchBar value={query} onChange={setQuery} placeholder="Search documents by file name or type" />
      <DocumentsTable data={filtered} emptyAction={emptyAction} />
    </div>
  );
}
