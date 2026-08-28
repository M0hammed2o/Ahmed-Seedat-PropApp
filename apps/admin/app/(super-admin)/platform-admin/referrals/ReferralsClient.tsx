'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';

export interface ReferralPartnerRow {
  id: string;
  name: string;
  referralCode: string;
  active: boolean;
  createdAt: string;
  referredOrganizationsCount: number;
}

export interface ReferralAttributionRow {
  orgId: string;
  orgLegalName: string;
  referralPartnerName: string | null;
  fallbackReferrerName: string | null;
  referralCodeUsed: string | null;
  attributedAt: string;
  planName: string | null;
  subscriptionStatus: string | null;
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString('en-ZA', { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * Referrals admin UI (V1 launch-completion pass) -- create/toggle referral partners, and view
 * which organizations were attributed to which partner (or a fallback name, or neither) at
 * signup. No commission/payout/rate UI anywhere here -- deliberately V1.1 scope, not built.
 */
export function ReferralsClient({
  initialPartners,
  initialOrganizations,
}: {
  initialPartners: ReferralPartnerRow[];
  initialOrganizations: ReferralAttributionRow[];
}) {
  const [partners, setPartners] = useState(initialPartners);
  const [name, setName] = useState('');
  const [referralCode, setReferralCode] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    setCreateError(null);
    setCreating(true);
    try {
      const response = await fetch('/api/v1/admin/referral-partners', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, referralCode }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setCreateError(body?.error?.message ?? 'Could not create referral partner.');
        return;
      }
      setPartners((prev) => [body.referralPartner, ...prev]);
      setName('');
      setReferralCode('');
    } finally {
      setCreating(false);
    }
  };

  const handleToggleActive = async (partner: ReferralPartnerRow) => {
    setTogglingId(partner.id);
    try {
      const response = await fetch(`/api/v1/admin/referral-partners/${partner.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !partner.active }),
      });
      if (!response.ok) return;
      const body = await response.json();
      setPartners((prev) =>
        prev.map((p) => (p.id === partner.id ? { ...p, active: body.referralPartner.active } : p)),
      );
    } finally {
      setTogglingId(null);
    }
  };

  return (
    <div className="space-y-8">
      <section className="rounded-lg border border-light-border bg-light-surfaceRaised p-4 dark:border-dark-border dark:bg-dark-surfaceRaised">
        <h2 className="text-sm font-medium text-light-textPrimary dark:text-dark-textPrimary">
          Referral partners
        </h2>

        <form onSubmit={handleCreate} className="mt-3 flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs text-light-textSecondary dark:text-dark-textSecondary">
              Partner name
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-56 rounded-lg border border-light-border bg-transparent px-3 py-2 text-sm text-light-textPrimary outline-none focus:border-light-accent/40 focus:ring-4 focus:ring-light-accent/10 dark:border-dark-border dark:text-dark-textPrimary"
            />
          </div>
          <div>
            <label className="block text-xs text-light-textSecondary dark:text-dark-textSecondary">
              Referral code
            </label>
            <input
              type="text"
              required
              value={referralCode}
              onChange={(e) => setReferralCode(e.target.value)}
              className="mt-1 w-40 rounded-lg border border-light-border bg-transparent px-3 py-2 text-sm text-light-textPrimary outline-none focus:border-light-accent/40 focus:ring-4 focus:ring-light-accent/10 dark:border-dark-border dark:text-dark-textPrimary"
            />
          </div>
          <Button type="submit" variant="primary" disabled={creating || !name.trim() || !referralCode.trim()}>
            {creating ? 'Adding…' : 'Add partner'}
          </Button>
        </form>
        {createError ? (
          <p className="mt-2 text-sm text-light-danger dark:text-dark-danger">{createError}</p>
        ) : null}

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-light-border text-xs text-light-textMuted dark:border-dark-border dark:text-dark-textMuted">
                <th className="py-2 pr-4 font-medium">Name</th>
                <th className="py-2 pr-4 font-medium">Code</th>
                <th className="py-2 pr-4 font-medium">Referred orgs</th>
                <th className="py-2 pr-4 font-medium">Created</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 pr-0 font-medium" />
              </tr>
            </thead>
            <tbody>
              {partners.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-4 text-sm text-light-textMuted dark:text-dark-textMuted">
                    No referral partners yet.
                  </td>
                </tr>
              ) : (
                partners.map((partner) => (
                  <tr
                    key={partner.id}
                    className="border-b border-light-border/60 dark:border-dark-border/60"
                  >
                    <td className="py-2 pr-4 text-light-textPrimary dark:text-dark-textPrimary">
                      {partner.name}
                    </td>
                    <td className="py-2 pr-4 font-mono text-xs text-light-textSecondary dark:text-dark-textSecondary">
                      {partner.referralCode}
                    </td>
                    <td className="py-2 pr-4">{partner.referredOrganizationsCount}</td>
                    <td className="py-2 pr-4 text-light-textSecondary dark:text-dark-textSecondary">
                      {formatDate(partner.createdAt)}
                    </td>
                    <td className="py-2 pr-4">
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-semibold ${
                          partner.active
                            ? 'bg-light-statusPaid/10 text-light-statusPaid dark:bg-dark-statusPaid/10 dark:text-dark-statusPaid'
                            : 'bg-light-border/60 text-light-textMuted dark:bg-dark-border/60 dark:text-dark-textMuted'
                        }`}
                      >
                        {partner.active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="py-2 pr-0 text-right">
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={togglingId === partner.id}
                        onClick={() => handleToggleActive(partner)}
                      >
                        {partner.active ? 'Deactivate' : 'Activate'}
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg border border-light-border bg-light-surfaceRaised p-4 dark:border-dark-border dark:bg-dark-surfaceRaised">
        <h2 className="text-sm font-medium text-light-textPrimary dark:text-dark-textPrimary">
          Referred organizations
        </h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-light-border text-xs text-light-textMuted dark:border-dark-border dark:text-dark-textMuted">
                <th className="py-2 pr-4 font-medium">Organization</th>
                <th className="py-2 pr-4 font-medium">Referred by</th>
                <th className="py-2 pr-4 font-medium">Code used</th>
                <th className="py-2 pr-4 font-medium">Attributed</th>
                <th className="py-2 pr-0 font-medium">Plan / status</th>
              </tr>
            </thead>
            <tbody>
              {initialOrganizations.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-4 text-sm text-light-textMuted dark:text-dark-textMuted">
                    No organizations have a referral attribution yet.
                  </td>
                </tr>
              ) : (
                initialOrganizations.map((row) => (
                  <tr key={row.orgId} className="border-b border-light-border/60 dark:border-dark-border/60">
                    <td className="py-2 pr-4 text-light-textPrimary dark:text-dark-textPrimary">
                      {row.orgLegalName}
                    </td>
                    <td className="py-2 pr-4 text-light-textSecondary dark:text-dark-textSecondary">
                      {row.referralPartnerName ?? row.fallbackReferrerName ?? '—'}
                    </td>
                    <td className="py-2 pr-4 font-mono text-xs text-light-textSecondary dark:text-dark-textSecondary">
                      {row.referralCodeUsed ?? '—'}
                    </td>
                    <td className="py-2 pr-4 text-light-textSecondary dark:text-dark-textSecondary">
                      {formatDate(row.attributedAt)}
                    </td>
                    <td className="py-2 pr-0 text-light-textSecondary dark:text-dark-textSecondary">
                      {row.planName ? `${row.planName} (${row.subscriptionStatus ?? 'unknown'})` : '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
