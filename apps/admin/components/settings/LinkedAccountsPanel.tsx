'use client';

import { useEffect, useState } from 'react';
import type { UserIdentity } from '@supabase/supabase-js';
import { getBrowserSupabaseClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/Button';
import { Panel } from '@/components/ui/Panel';

const PROVIDERS = ['google', 'apple'] as const;
type Provider = (typeof PROVIDERS)[number];

/**
 * ACCOUNT IDENTITY RULES (PRODUCT DECISION 1, 2026-08-03): "if automatic linking is unsafe or
 * unsupported, require the user to authenticate with the existing method before linking another
 * provider." This panel IS that sanctioned path -- supabase.auth.linkIdentity(), called from an
 * already-authenticated session, adds a second sign-in method to the SAME auth.users.id (never
 * creates a new one), so every org membership/tenant link/owner link/audit row tied to that id
 * is automatically preserved -- there is nothing to migrate, because the id never changes.
 *
 * Requires the Supabase project's "Enable Manual Linking" auth setting -- see AUTHENTICATION.md's
 * external setup section. Without it, linkIdentity()/unlinkIdentity() return a real error, shown
 * as-is rather than a generic failure, since the fix is a real, documented config step, not a bug.
 */
export function LinkedAccountsPanel() {
  const [identities, setIdentities] = useState<UserIdentity[] | null>(null);
  const [pending, setPending] = useState<Provider | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (process.env.NEXT_PUBLIC_DEMO_MODE === 'true') {
      setIdentities([]);
      return;
    }
    const supabase = getBrowserSupabaseClient();
    supabase.auth.getUserIdentities().then(({ data, error: fetchError }) => {
      if (fetchError) {
        setError(fetchError.message);
        return;
      }
      setIdentities(data?.identities ?? []);
    });
  }, []);

  async function link(provider: Provider) {
    setError(null);
    setPending(provider);
    const supabase = getBrowserSupabaseClient();
    const { error: linkError } = await supabase.auth.linkIdentity({
      provider,
      options: { redirectTo: `${window.location.origin}/auth/callback?next=/settings` },
    });
    if (linkError) {
      setError(linkError.message);
      setPending(null);
    }
    // On success this navigates away via OAuth redirect -- nothing else to do here.
  }

  async function unlink(identity: UserIdentity) {
    setError(null);
    setPending(identity.provider as Provider);
    const supabase = getBrowserSupabaseClient();
    const { error: unlinkError } = await supabase.auth.unlinkIdentity(identity);
    if (unlinkError) {
      setError(unlinkError.message);
    } else {
      setIdentities((prev) => (prev ?? []).filter((i) => i.identity_id !== identity.identity_id));
    }
    setPending(null);
  }

  if (identities === null) return null;

  return (
    <Panel className="max-w-xl">
      <h2 className="text-sm font-semibold text-light-textPrimary dark:text-dark-textPrimary">
        Linked sign-in methods
      </h2>
      {error ? (
        <p className="mt-2 text-xs text-light-danger dark:text-dark-danger">{error}</p>
      ) : null}
      <div className="mt-3 space-y-2">
        {PROVIDERS.map((provider) => {
          const identity = identities.find((i) => i.provider === provider);
          return (
            <div
              key={provider}
              className="flex items-center justify-between rounded-lg border border-light-border px-3 py-2 dark:border-dark-border"
            >
              <span className="text-sm capitalize text-light-textPrimary dark:text-dark-textPrimary">
                {provider}
              </span>
              {identity ? (
                <Button
                  size="sm"
                  disabled={pending === provider || identities.length < 2}
                  onClick={() => unlink(identity)}
                >
                  {pending === provider ? 'Unlinking…' : 'Unlink'}
                </Button>
              ) : (
                <Button size="sm" disabled={pending === provider} onClick={() => link(provider)}>
                  {pending === provider ? 'Redirecting…' : 'Link account'}
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}
