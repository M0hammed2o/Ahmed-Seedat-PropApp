'use client';

import type { ReactNode } from 'react';
import type { Expense } from '@propvault/types';
import { useListSearch } from '@/lib/useListSearch';
import { SearchBar } from '@/components/ui/SearchBar';
import { ExpensesTable } from './ExpensesTable';

export function ExpensesFilterClient({
  expenses,
  emptyAction,
}: {
  expenses: Expense[];
  emptyAction?: ReactNode;
}) {
  const { query, setQuery, filtered } = useListSearch(expenses, (e) => `${e.category} ${e.status}`);

  return (
    <div className="space-y-4">
      <SearchBar
        value={query}
        onChange={setQuery}
        placeholder="Search expenses by category or status"
      />
      <ExpensesTable data={filtered} emptyAction={emptyAction} />
    </div>
  );
}
