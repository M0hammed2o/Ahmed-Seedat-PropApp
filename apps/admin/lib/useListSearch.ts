import { useMemo, useState } from 'react';

// Shared client-side search filter (PWA_V1_COMPLETION_PLAN.md #6) -- filters an already
// server-fetched array in memory, same approach as UnitsFilterClient. Only usable from a 'use
// client' component: a Server Component page can't pass the `searchText` function as a prop
// across the RSC boundary (functions aren't serializable -- see CustomersTable.tsx's note on the
// same constraint), so every list needing this still owns a small client wrapper that calls this
// hook directly rather than a render-prop component.
export function useListSearch<T>(items: T[], searchText: (item: T) => string) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => searchText(item).toLowerCase().includes(q));
  }, [items, query, searchText]);

  return { query, setQuery, filtered };
}
