import type { NextRequest } from 'next/server';

// Shared cursor-pagination helper for `/api/v1/**` list endpoints (API_SPEC.md §0: "Pagination:
// cursor-based ... Offset pagination is not used — it degrades under concurrent writes"). First
// used by properties/units (TASKS.md M5/M6); later list endpoints (owners, tenants, leases, ...)
// should reuse this rather than growing their own offset-based paging.

export interface CursorPage {
  createdAt: string;
  id: string;
}

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

export function parseListQuery(request: NextRequest): { limit: number; cursor: CursorPage | null } {
  const url = new URL(request.url);
  const limitRaw = Number(url.searchParams.get('limit'));
  const limit =
    Number.isFinite(limitRaw) && limitRaw > 0
      ? Math.min(MAX_LIMIT, Math.floor(limitRaw))
      : DEFAULT_LIMIT;

  const cursorRaw = url.searchParams.get('cursor');
  let cursor: CursorPage | null = null;
  if (cursorRaw) {
    try {
      const decoded = JSON.parse(Buffer.from(cursorRaw, 'base64url').toString('utf8')) as unknown;
      if (
        decoded !== null &&
        typeof decoded === 'object' &&
        typeof (decoded as CursorPage).createdAt === 'string' &&
        typeof (decoded as CursorPage).id === 'string'
      ) {
        cursor = decoded as CursorPage;
      }
    } catch {
      // Malformed/tampered cursor degrades to "first page" rather than a 500 — an opaque cursor
      // is a convenience token, not something a client request should ever hard-fail on.
    }
  }
  return { limit, cursor };
}

export function encodeCursor(page: CursorPage): string {
  return Buffer.from(JSON.stringify(page), 'utf8').toString('base64url');
}

/**
 * PostgREST `.or()` filter expressing "strictly before this (created_at, id) pair" for a query
 * ordered `created_at desc, id desc` — the composite tiebreak is required because `created_at`
 * alone is not unique (two rows can share a timestamp).
 */
export function beforeCursorFilter(cursor: CursorPage): string {
  return `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`;
}
