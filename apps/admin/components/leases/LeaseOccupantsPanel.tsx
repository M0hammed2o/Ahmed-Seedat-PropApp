'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Panel } from '@/components/ui/Panel';
import { Pill } from '@/components/ui/Pill';

// Occupants UI (PHASE 8, WORKLOG.md this date -- follow-up completing the schema+API-only pass
// from the prior session). Placed on the lease detail page, directly below "Tenants" -- the least
// disruptive location per the existing lease/unit/property information architecture, and the one
// that makes the primary-tenant/co-tenant/additional-occupant distinction visible in one place.
// Self-contained client panel, same pattern as PropertyPhotosPanel/PropertyCompliancePanel.

interface Occupant {
  id: string;
  fullName: string;
  occupantType: 'spouse_partner' | 'child_dependant' | 'other_approved_occupant';
  relationship: string | null;
  moveInDate: string | null;
  moveOutDate: string | null;
  isActive: boolean;
  contactPhone: string | null;
  contactEmail: string | null;
  complianceApplicable: boolean;
  notes: string | null;
}

const TYPE_LABELS: Record<Occupant['occupantType'], string> = {
  spouse_partner: 'Spouse / Partner',
  child_dependant: 'Child / Dependant',
  other_approved_occupant: 'Other approved occupant',
};

export function LeaseOccupantsPanel({
  leaseId,
  canManage,
}: {
  leaseId: string;
  canManage: boolean;
}) {
  const [occupants, setOccupants] = useState<Occupant[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [fullName, setFullName] = useState('');
  const [occupantType, setOccupantType] =
    useState<Occupant['occupantType']>('other_approved_occupant');
  const [relationship, setRelationship] = useState('');
  const [moveInDate, setMoveInDate] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [complianceApplicable, setComplianceApplicable] = useState(false);
  const [notes, setNotes] = useState('');

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/v1/leases/${leaseId}/occupants`);
      const body = await response.json();
      setOccupants(body.occupants ?? []);
    } catch {
      setError('Could not load occupants.');
    } finally {
      setLoaded(true);
    }
  }, [leaseId]);

  useEffect(() => {
    load();
  }, [load]);

  function resetForm() {
    setFullName('');
    setOccupantType('other_approved_occupant');
    setRelationship('');
    setMoveInDate('');
    setContactPhone('');
    setContactEmail('');
    setComplianceApplicable(false);
    setNotes('');
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!fullName.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/leases/${leaseId}/occupants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: fullName.trim(),
          occupantType,
          relationship: relationship.trim() || null,
          moveInDate: moveInDate || null,
          contactPhone: contactPhone.trim() || null,
          contactEmail: contactEmail.trim() || null,
          complianceApplicable,
          notes: notes.trim() || null,
        }),
      });
      if (!response.ok) {
        const body = await response.json();
        setError(body.error?.message ?? 'Could not add this occupant.');
        return;
      }
      setShowForm(false);
      resetForm();
      await load();
    } finally {
      setSubmitting(false);
    }
  }

  async function markMovedOut(occupant: Occupant) {
    const moveOutDate = window.prompt(
      'Move-out date (YYYY-MM-DD):',
      new Date().toISOString().slice(0, 10),
    );
    if (!moveOutDate) return;
    setError(null);
    const response = await fetch(`/api/v1/lease-occupants/${occupant.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: false, moveOutDate }),
    });
    if (!response.ok) {
      const body = await response.json();
      setError(body.error?.message ?? 'Could not update this occupant.');
      return;
    }
    await load();
  }

  async function remove(occupant: Occupant) {
    if (!window.confirm(`Remove ${occupant.fullName} from this lease's occupant record?`)) return;
    setError(null);
    const response = await fetch(`/api/v1/lease-occupants/${occupant.id}`, { method: 'DELETE' });
    if (!response.ok) {
      const body = await response.json();
      setError(body.error?.message ?? 'Could not remove this occupant.');
      return;
    }
    await load();
  }

  if (!loaded) {
    return (
      <Panel title="Additional occupants">
        <p className="py-4 text-center text-sm text-muted-foreground">Loading occupants…</p>
      </Panel>
    );
  }

  return (
    <Panel title="Additional occupants">
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">
          People recorded as living in this unit who are not a primary tenant or co-tenant on the
          lease (e.g. a spouse, child, or other approved occupant). Additional occupants do not
          automatically receive a Proplyst account.
        </p>

        {error ? (
          <p className="rounded-md border border-light-danger bg-light-danger/10 px-3 py-2 text-xs text-light-danger dark:border-dark-danger dark:bg-dark-danger/10 dark:text-dark-danger">
            {error}
          </p>
        ) : null}

        {occupants.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">No additional occupants on file.</p>
        ) : (
          <ul className="divide-y divide-border">
            {occupants.map((o) => (
              <li key={o.id} className="py-3 first:pt-0 last:pb-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">
                      {o.fullName}{' '}
                      {!o.isActive ? (
                        <Pill tone="neutral" className="ml-1">
                          Moved out
                        </Pill>
                      ) : null}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {TYPE_LABELS[o.occupantType]}
                      {o.relationship ? ` · ${o.relationship}` : ''}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {o.moveInDate ? `Moved in ${o.moveInDate}` : 'Move-in date not recorded'}
                      {o.moveOutDate ? ` · Moved out ${o.moveOutDate}` : ''}
                    </p>
                    {o.contactPhone || o.contactEmail ? (
                      <p className="text-[11px] text-muted-foreground">
                        {[o.contactPhone, o.contactEmail].filter(Boolean).join(' · ')}
                      </p>
                    ) : null}
                    {o.notes ? (
                      <p className="mt-1 text-[11px] text-muted-foreground">{o.notes}</p>
                    ) : null}
                  </div>
                  {canManage ? (
                    <div className="flex shrink-0 gap-2">
                      {o.isActive ? (
                        <Button size="sm" variant="secondary" onClick={() => markMovedOut(o)}>
                          Mark moved out
                        </Button>
                      ) : null}
                      <Button size="sm" variant="destructive" onClick={() => remove(o)}>
                        Remove
                      </Button>
                    </div>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}

        {canManage ? (
          showForm ? (
            <form onSubmit={submit} className="space-y-2 border-t border-border pt-3">
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="text-xs text-muted-foreground">
                  Full name
                  <input
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="mt-1 block w-full rounded-md border border-border bg-transparent px-2 py-1.5 text-sm text-foreground"
                  />
                </label>
                <label className="text-xs text-muted-foreground">
                  Occupant type
                  <select
                    value={occupantType}
                    onChange={(e) => setOccupantType(e.target.value as Occupant['occupantType'])}
                    className="mt-1 block w-full rounded-md border border-border bg-transparent px-2 py-1.5 text-sm text-foreground"
                  >
                    {Object.entries(TYPE_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-muted-foreground">
                  Relationship
                  <input
                    value={relationship}
                    onChange={(e) => setRelationship(e.target.value)}
                    className="mt-1 block w-full rounded-md border border-border bg-transparent px-2 py-1.5 text-sm text-foreground"
                  />
                </label>
                <label className="text-xs text-muted-foreground">
                  Move-in date
                  <input
                    type="date"
                    value={moveInDate}
                    onChange={(e) => setMoveInDate(e.target.value)}
                    className="mt-1 block w-full rounded-md border border-border bg-transparent px-2 py-1.5 text-sm text-foreground"
                  />
                </label>
                <label className="text-xs text-muted-foreground">
                  Contact phone
                  <input
                    value={contactPhone}
                    onChange={(e) => setContactPhone(e.target.value)}
                    className="mt-1 block w-full rounded-md border border-border bg-transparent px-2 py-1.5 text-sm text-foreground"
                  />
                </label>
                <label className="text-xs text-muted-foreground">
                  Contact email
                  <input
                    type="email"
                    value={contactEmail}
                    onChange={(e) => setContactEmail(e.target.value)}
                    className="mt-1 block w-full rounded-md border border-border bg-transparent px-2 py-1.5 text-sm text-foreground"
                  />
                </label>
              </div>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={complianceApplicable}
                  onChange={(e) => setComplianceApplicable(e.target.checked)}
                />
                Subject to property compliance rules (e.g. conduct rules apply to this occupant too)
              </label>
              <label className="block text-xs text-muted-foreground">
                Notes
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  className="mt-1 block w-full rounded-md border border-border bg-transparent px-2 py-1.5 text-sm text-foreground"
                />
              </label>
              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={submitting || !fullName.trim()}>
                  {submitting ? 'Saving…' : 'Add occupant'}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setShowForm(false);
                    resetForm();
                  }}
                >
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <Button size="sm" variant="secondary" onClick={() => setShowForm(true)}>
              Add occupant
            </Button>
          )
        ) : null}
      </div>
    </Panel>
  );
}
