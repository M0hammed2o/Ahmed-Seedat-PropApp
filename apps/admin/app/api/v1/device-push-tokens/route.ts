import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { devicePushTokenCreateSchema } from '@propvault/validation';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapDevicePushTokenRow } from '@/lib/notifications';

/**
 * POST/DELETE /api/v1/device-push-tokens -- not in API_SPEC.md's literal route list, but push
 * registration needs a real endpoint somewhere and RLS (device_push_tokens_all_own) already
 * supports it fully scoped to the caller. DELETE takes the token in the body/query rather than a
 * path param, since a device unregisters itself by the token value it holds, not a server-issued id.
 */
export async function POST(request: NextRequest) {
  const supabase = await getServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: { code: 'unauthenticated', message: 'Sign in required.' } },
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: 'invalid_json', message: 'Request body must be valid JSON.' } },
      { status: 400 },
    );
  }

  const parsed = devicePushTokenCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: 'validation_failed',
          message: 'Check the highlighted fields.',
          field_errors: parsed.error.flatten().fieldErrors,
        },
      },
      { status: 400 },
    );
  }

  const { data, error } = await supabase
    .from('device_push_tokens')
    .upsert(
      {
        user_id: user.id,
        platform: parsed.data.platform,
        token: parsed.data.token,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,token' },
    )
    .select('*')
    .single();

  if (error) {
    return NextResponse.json(
      { error: { code: 'device_push_token_create_failed', message: error.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({ devicePushToken: mapDevicePushTokenRow(data) }, { status: 201 });
}

const deleteSchema = z.object({ token: z.string().min(1) });

export async function DELETE(request: NextRequest) {
  const supabase = await getServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: { code: 'unauthenticated', message: 'Sign in required.' } },
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: 'invalid_json', message: 'Request body must be valid JSON.' } },
      { status: 400 },
    );
  }

  const parsed = deleteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'validation_failed', message: 'token is required.' } },
      { status: 400 },
    );
  }

  const { error } = await supabase
    .from('device_push_tokens')
    .delete()
    .eq('user_id', user.id)
    .eq('token', parsed.data.token);

  if (error) {
    return NextResponse.json(
      { error: { code: 'device_push_token_delete_failed', message: error.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({ deleted: true });
}
