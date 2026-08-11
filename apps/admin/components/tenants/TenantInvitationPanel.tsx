'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { TenantInvitation, TenantInvitationDeliveryChannel } from '@propvault/types';
import { Button } from '@/components/ui/Button';
import { Panel } from '@/components/ui/Panel';

interface CreatedInvitation {
  token: string;
  shortCode: string | null;
  acceptUrl: string;
  expiresAt: string;
}

// React #418 fix (WORKLOG.md this date): `invitations` is a server-fetched prop present on this
// component's very first render, so comparing invite.expiresAt against "now" unconditionally
// here meant SSR and the client's hydration pass could genuinely disagree right at the exact
// expiry moment -- the same hydration-mismatch shape already found and fixed in AppShell.tsx's
// relativeTime(). `mounted` stays false through hydration (so both passes treat every invite as
// not-yet-expired, deterministically), and only checks the real expiry once mounted, in a
// post-hydration render.
function statusFor(invite: TenantInvitation, mounted: boolean): { label: string; tone: string } {
  if (invite.acceptedAt)
    return { label: 'Accepted', tone: 'text-light-statusPaid dark:text-dark-statusPaid' };
  if (invite.revokedAt)
    return { label: 'Revoked', tone: 'text-light-textMuted dark:text-dark-textMuted' };
  if (mounted && new Date(invite.expiresAt) <= new Date())
    return { label: 'Expired', tone: 'text-light-statusOverdue dark:text-dark-statusOverdue' };
  return { label: 'Pending', tone: 'text-light-accent dark:text-dark-accent' };
}

/** Deterministic, obviously-fake fixture -- never a real token/code, matching TaxPackClient's
 * demoTaxPackResponse() pattern (no live API call, no persisted state, PWA_V1_COMPLETION_PLAN.md
 * demo-mode discipline). */
function demoCreatedInvitation(
  channel: TenantInvitationDeliveryChannel,
  includeShortCode: boolean,
): CreatedInvitation {
  return {
    token: 'demo-mode-token-not-real',
    shortCode: channel === 'manual' || includeShortCode ? 'DEMO1234' : null,
    acceptUrl: 'http://localhost:3090/activate?token=demo-mode-token-not-real',
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  };
}

/**
 * LANDLORD AND STAFF UI (PRODUCT DECISION 2, 2026-08-03). Reachable only where `canWrite` is
 * already true (agent+, same floor tenant-edit itself uses) -- the page passing that down is the
 * UI-layer gate; PATCH.../invitations' own requireOrgRole('agent') is the real one.
 */
export function TenantInvitationPanel({
  tenantId,
  hasEmail,
  hasPhone,
  invitations,
  demoMode = false,
}: {
  tenantId: string;
  hasEmail: boolean;
  hasPhone: boolean;
  invitations: TenantInvitation[];
  demoMode?: boolean;
}) {
  const router = useRouter();
  const [channel, setChannel] = useState<TenantInvitationDeliveryChannel>(
    hasEmail ? 'email' : hasPhone ? 'whatsapp' : 'manual',
  );
  const [includeShortCode, setIncludeShortCode] = useState(!hasEmail && !hasPhone);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedInvitation | null>(null);
  const [copied, setCopied] = useState<'token' | 'code' | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Demo mode never calls the live API (SECURITY.md/PWA_V1_COMPLETION_PLAN.md demo-mode
  // discipline) -- this local list stands in for router.refresh() re-fetching from Supabase, so
  // "Send"/"Revoke" still visibly update the panel exactly as they would live.
  const [demoInvitations, setDemoInvitations] = useState<TenantInvitation[]>(invitations);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const effectiveInvitations = demoMode ? demoInvitations : invitations;
  const active = effectiveInvitations.find(
    (i) => !i.acceptedAt && !i.revokedAt && (!mounted || new Date(i.expiresAt) > new Date()),
  );

  async function send() {
    setSubmitting(true);
    setError(null);
    setCreated(null);
    try {
      if (demoMode) {
        await new Promise((r) => setTimeout(r, 400)); // feels like a real round trip
        const fake = demoCreatedInvitation(channel, includeShortCode);
        setCreated(fake);
        setDemoInvitations((prev) => [
          {
            id: `demo-invite-${prev.length + 1}`,
            orgId: 'demo-org-1',
            tenantId,
            deliveryChannel: channel,
            destinationHint:
              channel === 'email'
                ? 'n***@example.com'
                : channel === 'whatsapp'
                  ? '+27 ** *** *134'
                  : null,
            expiresAt: fake.expiresAt,
            acceptedAt: null,
            acceptedByUserId: null,
            revokedAt: null,
            createdByUserId: 'demo-user-1',
            failedAttemptCount: 0,
            resendCount: 0,
            createdAt: new Date().toISOString(),
          },
          ...prev,
        ]);
        return;
      }
      const response = await fetch(`/api/v1/tenants/${tenantId}/invitations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deliveryChannel: channel, includeShortCode }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error?.message ?? 'Failed to send invitation.');
        return;
      }
      setCreated({
        token: body.token,
        shortCode: body.shortCode,
        acceptUrl: body.acceptUrl,
        expiresAt: body.expiresAt,
      });
      router.refresh();
    } catch {
      setError('Failed to send invitation — check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function revoke(invitationId: string) {
    setBusyId(invitationId);
    setError(null);
    try {
      if (demoMode) {
        await new Promise((r) => setTimeout(r, 300));
        setDemoInvitations((prev) =>
          prev.map((i) =>
            i.id === invitationId ? { ...i, revokedAt: new Date().toISOString() } : i,
          ),
        );
        return;
      }
      const response = await fetch(
        `/api/v1/tenants/${tenantId}/invitations/${invitationId}/revoke`,
        { method: 'POST' },
      );
      if (!response.ok) {
        const body = await response.json();
        setError(body.error?.message ?? 'Failed to revoke invitation.');
        return;
      }
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  function copy(value: string, which: 'token' | 'code') {
    navigator.clipboard.writeText(value);
    setCopied(which);
    setTimeout(() => setCopied(null), 2000);
  }

  return (
    <Panel className="max-w-xl">
      <h2 className="text-sm font-semibold text-light-textPrimary dark:text-dark-textPrimary">
        Portal invitation
      </h2>
      <p className="mt-1 text-xs text-light-textMuted dark:text-dark-textMuted">
        Give this tenant access to their own lease, payments, documents, and maintenance history.
      </p>

      {error ? (
        <p className="mt-2 text-xs text-light-danger dark:text-dark-danger">{error}</p>
      ) : null}

      {created ? (
        <div className="mt-3 space-y-2 rounded-lg border border-light-accent/30 bg-light-accent/5 p-3 dark:border-dark-accent/30 dark:bg-dark-accent/5">
          <p className="text-xs font-medium text-light-textPrimary dark:text-dark-textPrimary">
            Invitation sent — save this now, it won't be shown again.
          </p>
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={created.acceptUrl}
              className="min-w-0 flex-1 rounded-md border border-light-border bg-transparent px-2 py-1 text-xs text-light-textPrimary dark:border-dark-border dark:text-dark-textPrimary"
            />
            <Button size="sm" onClick={() => copy(created.acceptUrl, 'token')}>
              {copied === 'token' ? 'Copied' : 'Copy link'}
            </Button>
          </div>
          {created.shortCode ? (
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={created.shortCode}
                className="min-w-0 flex-1 rounded-md border border-light-border bg-transparent px-2 py-1 text-xs font-mono text-light-textPrimary dark:border-dark-border dark:text-dark-textPrimary"
              />
              <Button size="sm" onClick={() => copy(created.shortCode!, 'code')}>
                {copied === 'code' ? 'Copied' : 'Copy code'}
              </Button>
            </div>
          ) : null}
          <p className="text-[11px] text-light-textMuted dark:text-dark-textMuted">
            Expires {new Date(created.expiresAt).toLocaleString('en-ZA')}.
          </p>
        </div>
      ) : null}

      {active ? (
        <div className="mt-3 flex items-center justify-between rounded-lg border border-light-border px-3 py-2 dark:border-dark-border">
          <div>
            <p className="text-xs text-light-textPrimary dark:text-dark-textPrimary">
              Pending via {active.deliveryChannel}
              {active.destinationHint ? ` (${active.destinationHint})` : ''}
            </p>
            <p className="text-[11px] text-light-textMuted dark:text-dark-textMuted">
              Expires {new Date(active.expiresAt).toLocaleString('en-ZA')}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* create_tenant_invitation() already revokes-then-recreates on every call (its own
                migration comment: "there is no separate resend endpoint, deliberately"), so
                Resend reuses the exact same send() -> POST .../invitations call as the initial
                send -- this button existed nowhere in the UI before, forcing an explicit Revoke
                click first to achieve the same result. */}
            <Button size="sm" variant="primary" disabled={submitting} onClick={send}>
              {submitting ? 'Resending…' : 'Resend'}
            </Button>
            <Button size="sm" disabled={busyId === active.id} onClick={() => revoke(active.id)}>
              {busyId === active.id ? 'Revoking…' : 'Revoke'}
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          <label className="block text-xs">
            <span className="text-light-textMuted dark:text-dark-textMuted">Delivery</span>
            <select
              value={channel}
              onChange={(e) => setChannel(e.target.value as TenantInvitationDeliveryChannel)}
              className="mt-1 block w-full rounded-md border border-light-border bg-transparent px-3 py-2 text-sm text-light-textPrimary dark:border-dark-border dark:text-dark-textPrimary"
            >
              <option value="email" disabled={!hasEmail}>
                Email {hasEmail ? '' : '(no email on file)'}
              </option>
              <option value="whatsapp" disabled={!hasPhone}>
                WhatsApp {hasPhone ? '' : '(no phone on file)'}
              </option>
              <option value="manual">Manual code (hand to tenant directly)</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs text-light-textSecondary dark:text-dark-textSecondary">
            <input
              type="checkbox"
              checked={includeShortCode || channel === 'manual'}
              disabled={channel === 'manual'}
              onChange={(e) => setIncludeShortCode(e.target.checked)}
            />
            Also generate a short activation code
          </label>
          <Button variant="primary" size="sm" disabled={submitting} onClick={send}>
            {submitting ? 'Sending…' : 'Send invitation'}
          </Button>
        </div>
      )}

      {effectiveInvitations.length > 0 ? (
        <div className="mt-4">
          <p className="text-xs font-medium text-light-textSecondary dark:text-dark-textSecondary">
            History
          </p>
          <ul className="mt-1 space-y-1">
            {effectiveInvitations.map((invite) => {
              const status = statusFor(invite, mounted);
              return (
                <li
                  key={invite.id}
                  className="flex items-center justify-between text-[11px] text-light-textMuted dark:text-dark-textMuted"
                >
                  <span>
                    {new Date(invite.createdAt).toLocaleDateString('en-ZA')} via{' '}
                    {invite.deliveryChannel}
                  </span>
                  <span className={status.tone}>{status.label}</span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </Panel>
  );
}
