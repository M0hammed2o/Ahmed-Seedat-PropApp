import 'server-only';
import type { NextResponse } from 'next/server';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { jsonError, requireUser } from '@/lib/smartUtility/http';
import { getCemeteryContext, type CemeteryContext } from '@/lib/cemetery/access';

// Route plumbing for /api/v1/cemetery/*: same {error:{code,message}} envelope and auth -> JSON -> zod -> permission
// order as the rest of /api/v1. The permission check here only gives a clear early answer; RLS (migration 184) is
// the enforcement and would refuse the same writes on its own.

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function requireCemeteryApi(
  need: 'manage' | 'payments',
): Promise<
  { supabase: SupabaseClient; user: User; ctx: CemeteryContext } | { response: NextResponse }
> {
  const auth = await requireUser();
  if ('response' in auth) return auth;
  const ctx = await getCemeteryContext();
  if (!ctx) {
    return {
      response: jsonError(
        403,
        'cemetery_unavailable',
        'Cemetery Management is not enabled for your organisation or your role.',
      ),
    };
  }
  if (need === 'manage' && !ctx.canManage) {
    return {
      response: jsonError(
        403,
        'forbidden',
        'Only a manager or principal can change cemetery records.',
      ),
    };
  }
  if (need === 'payments' && !ctx.canRecordPayments) {
    return {
      response: jsonError(
        403,
        'forbidden',
        'You do not have permission to record cemetery payments.',
      ),
    };
  }
  return { ...auth, ctx };
}

export const cemeteryNotFound = (what = 'Record') =>
  jsonError(404, 'not_found', `${what} not found.`);
