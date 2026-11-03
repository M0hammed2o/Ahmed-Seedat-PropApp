import { describe, expect, it, vi } from 'vitest';
import { fetchAllPages, fetchAllPagesResult, PAGE_SIZE } from '../pagedRead';

// A stand-in for PostgREST: sorts by the caller's keys, then answers `range(from, to)` with at most
// `maxRows` rows -- the silent truncation that hid November's rent on the 2026-11-03 dashboard.
interface Row {
  id: string;
  due_date: string;
}

function server(rows: Row[], maxRows = 1000) {
  const calls: [number, number][] = [];
  const sorted = [...rows].sort(
    (a, b) => a.due_date.localeCompare(b.due_date) || a.id.localeCompare(b.id),
  );
  const page = (from: number, to: number) => {
    calls.push([from, to]);
    const end = Math.min(to + 1, from + maxRows);
    return Promise.resolve({ data: sorted.slice(from, end), error: null });
  };
  return { page, calls, sorted };
}

/** n schedules over 24 due dates, so many rows share each sort value (ties across page edges). */
function schedules(n: number): Row[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `id-${String(i).padStart(6, '0')}`,
    due_date: `2026-${String((i % 12) + 1).padStart(2, '0')}-0${(i % 2) + 1}`,
  }));
}

describe('fetchAllPages', () => {
  it('returns every row of a table larger than the 1000-row cap, in order, with no duplicates', async () => {
    const { page, calls, sorted } = server(schedules(2345));
    const rows = await fetchAllPages('rent schedule', page);
    expect(rows).toHaveLength(2345);
    expect(new Set(rows.map((r) => r.id)).size).toBe(2345);
    expect(rows).toEqual(sorted); // order holds across page boundaries, ties broken by id
    expect(calls).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it('the unpaged read it replaces loses everything after row 1000 (the newest months)', async () => {
    const { page, sorted } = server(schedules(1155));
    const truncated = (await page(0, 1_000_000)).data;
    expect(truncated).toHaveLength(1000);
    const all = await fetchAllPages('rent schedule', page);
    const lastDue = sorted[sorted.length - 1]!.due_date;
    expect(truncated.some((r) => r.due_date === lastDue && r.id === sorted.at(-1)!.id)).toBe(false);
    expect(all.at(-1)).toEqual(sorted.at(-1));
  });

  it('makes one request for a small organisation (fewer than 1000 rows)', async () => {
    const { page, calls } = server(schedules(431));
    expect(await fetchAllPages('rent schedule', page)).toHaveLength(431);
    expect(calls).toHaveLength(1);
  });

  it('asks once more after an exactly-full page, then stops on the empty page', async () => {
    const { page, calls } = server(schedules(PAGE_SIZE));
    expect(await fetchAllPages('rent schedule', page)).toHaveLength(PAGE_SIZE);
    expect(calls).toHaveLength(2);
  });

  it('returns an empty list for an empty table', async () => {
    const { page } = server([]);
    expect(await fetchAllPages('rent schedule', page)).toEqual([]);
  });

  it('throws on an error on any page -- never a partial list that would read as a smaller total', async () => {
    const page = vi
      .fn()
      .mockResolvedValueOnce({ data: schedules(1000), error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    await expect(fetchAllPages('rent schedule', page)).rejects.toThrow(
      'Failed to load rent schedule: boom',
    );
  });

  it('fetchAllPagesResult wraps the rows in a Supabase-shaped response', async () => {
    const { page } = server(schedules(1500));
    const result = await fetchAllPagesResult('rent schedule', page);
    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(1500);
  });
});
