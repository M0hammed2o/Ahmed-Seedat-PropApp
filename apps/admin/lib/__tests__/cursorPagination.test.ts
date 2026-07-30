import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { parseListQuery, encodeCursor, beforeCursorFilter } from '../cursorPagination';

describe('parseListQuery', () => {
  it('defaults to limit 25 and no cursor when the query string is empty', () => {
    const { limit, cursor } = parseListQuery(new NextRequest('http://test.local/api/v1/units'));
    expect(limit).toBe(25);
    expect(cursor).toBeNull();
  });

  it('clamps an over-large limit to the documented max of 100', () => {
    const { limit } = parseListQuery(new NextRequest('http://test.local/api/v1/units?limit=99999'));
    expect(limit).toBe(100);
  });

  it('ignores a non-numeric or non-positive limit and falls back to the default', () => {
    expect(parseListQuery(new NextRequest('http://test.local/api/v1/units?limit=abc')).limit).toBe(25);
    expect(parseListQuery(new NextRequest('http://test.local/api/v1/units?limit=-5')).limit).toBe(25);
    expect(parseListQuery(new NextRequest('http://test.local/api/v1/units?limit=0')).limit).toBe(25);
  });

  it('round-trips a cursor produced by encodeCursor', () => {
    const page = { createdAt: '2026-07-30T00:00:00.000Z', id: 'ffffffff-0000-0000-0000-000000000001' };
    const encoded = encodeCursor(page);
    const { cursor } = parseListQuery(
      new NextRequest(`http://test.local/api/v1/units?cursor=${encoded}`),
    );
    expect(cursor).toEqual(page);
  });

  it('degrades a malformed cursor to "no cursor" instead of throwing', () => {
    const { cursor } = parseListQuery(
      new NextRequest('http://test.local/api/v1/units?cursor=not-valid-base64url-json'),
    );
    expect(cursor).toBeNull();
  });

  it('degrades a well-formed-but-wrong-shape cursor payload to "no cursor"', () => {
    const encoded = Buffer.from(JSON.stringify({ foo: 'bar' }), 'utf8').toString('base64url');
    const { cursor } = parseListQuery(
      new NextRequest(`http://test.local/api/v1/units?cursor=${encoded}`),
    );
    expect(cursor).toBeNull();
  });
});

describe('beforeCursorFilter', () => {
  it('produces a PostgREST or-filter expressing strictly-before with a composite tiebreak', () => {
    const filter = beforeCursorFilter({
      createdAt: '2026-07-30T00:00:00.000Z',
      id: 'ffffffff-0000-0000-0000-000000000001',
    });
    expect(filter).toBe(
      'created_at.lt.2026-07-30T00:00:00.000Z,and(created_at.eq.2026-07-30T00:00:00.000Z,id.lt.ffffffff-0000-0000-0000-000000000001)',
    );
  });
});
