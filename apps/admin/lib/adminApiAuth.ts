import 'server-only';
import { NextResponse } from 'next/server';
import type { AdminRole } from '@propvault/types';
import { requireRole, type AdminSession } from './auth';

// Shared guard for /api/v1/admin/** route handlers (TASKS.md M19) -- the first place
// requireRole() is called from a route handler rather than a page component, so this wraps its
// single FORBIDDEN throw into the route-handler early-return pattern every other endpoint in this
// codebase uses. Deliberately returns the same 403 for "not signed in" and "signed in but role
// too low" -- these are platform-internal admin routes, not customer-facing ones, so there's no
// PERMISSIONS.md-style reason to distinguish 401 from 403 here the way client-org routes do.
export async function requireAdminRoleOrRespond(
  minRole: AdminRole,
): Promise<{ session: AdminSession } | { response: NextResponse }> {
  try {
    const session = await requireRole(minRole);
    return { session };
  } catch {
    return {
      response: NextResponse.json(
        {
          error: {
            code: 'forbidden',
            message: 'You do not have permission to perform this action.',
          },
        },
        { status: 403 },
      ),
    };
  }
}
