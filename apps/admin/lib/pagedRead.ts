// PostgREST answers every request with at most `max_rows` rows (1000 on this Supabase project) and
// says nothing when it truncates. An unpaged `select` over a table that grows with time --
// rent_schedules, invoices, invoice_payments, expenses -- therefore silently loses rows once an
// organisation passes 1000 of them. Found 2026-11-03: a demo org with 1,155 rent schedules showed
// R0 expected/collected/outstanding for the current month on the dashboard, because the newest
// months were the ones cut off.
//
// Use fetchAllPages for any list read whose size is not bounded by the query itself. The `page`
// callback MUST order by a unique key (add `.order('id')` as the final tie-break) so consecutive
// pages neither overlap nor skip rows when many rows share the same sort value.

/** Rows per request. Must not exceed the server's `max_rows`, or a full page looks like the last one. */
export const PAGE_SIZE = 1000;

type PageResult<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

/**
 * Every row of a query, one page at a time. Any error throws -- a failed read is never reported as
 * "no rows", which would show a false R0 on a financial screen.
 */
export async function fetchAllPages<T>(
  label: string,
  page: (from: number, to: number) => PageResult<T>,
  pageSize: number = PAGE_SIZE,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await page(from, from + pageSize - 1);
    if (error) throw new Error(`Failed to load ${label}: ${error.message}`);
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < pageSize) return rows;
  }
}

/**
 * fetchAllPages shaped like a Supabase response, for drop-in use inside an existing Promise.all.
 * `error` is always null (a failed page throws); it is typed like Supabase's so the caller's
 * existing `if (result.error)` checks still compile.
 */
export function fetchAllPagesResult<T>(
  label: string,
  page: (from: number, to: number) => PageResult<T>,
): Promise<{ data: T[]; error: { message: string } | null }> {
  return fetchAllPages(label, page).then((data) => ({ data, error: null }));
}
