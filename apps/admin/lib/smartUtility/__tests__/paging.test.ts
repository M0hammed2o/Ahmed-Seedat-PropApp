import { describe, expect, it, vi } from 'vitest';

// The API returns at most 1 000 rows per request. fetchAll/fetchAllIn must page until a short page (found by the
// scale benchmark: unpaged job queries silently processed 1 000 of 6 601 meters).
vi.mock('server-only', () => ({}));
const { API_PAGE, fetchAll, fetchAllIn } = await import('../data');

const table = Array.from({ length: 2_345 }, (_, i) => ({ id: i }));
const page = (rows: { id: number }[]) => (from: number, to: number) => Promise.resolve({ data: rows.slice(from, Math.min(to + 1, from + API_PAGE)), error: null });

describe('API paging helpers', () => {
  it('fetchAll returns every row across pages, in order, with the 1 000-row cap respected per request', async () => {
    const spy = vi.fn(page(table));
    const rows = await fetchAll(spy);
    expect(rows).toHaveLength(2_345);
    expect(rows[2_344]).toEqual({ id: 2_344 });
    expect(spy.mock.calls.map(([f, t]) => [f, t])).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it('fetchAll stops after one request when the first page is short, and on an exact multiple fetches one empty page', async () => {
    expect(await fetchAll(page(table.slice(0, 10)))).toHaveLength(10);
    const exact = vi.fn(page(table.slice(0, 2000)));
    expect(await fetchAll(exact)).toHaveLength(2000);
    expect(exact).toHaveBeenCalledTimes(3);
  });

  it('fetchAll throws on an error instead of returning a partial list', async () => {
    let n = 0;
    await expect(fetchAll(() => Promise.resolve(n++ === 0 ? { data: table.slice(0, 1000), error: null } : { data: null, error: { message: 'boom' } }))).rejects.toThrow('boom');
  });

  it('fetchAllIn chunks ids (URL length) and pages each chunk', async () => {
    const ids = Array.from({ length: 250 }, (_, i) => `id-${i}`);
    const chunks: number[] = [];
    const rows = await fetchAllIn(ids, (chunk, from, to) => {
      if (from === 0) chunks.push(chunk.length);
      const perChunk = chunk.flatMap((id) => Array.from({ length: 15 }, (_, k) => ({ id, k }))); // 1 500 rows per 100 ids
      return Promise.resolve({ data: perChunk.slice(from, to + 1), error: null });
    });
    expect(chunks).toEqual([100, 100, 50]);
    expect(rows).toHaveLength(250 * 15);
  });
});
