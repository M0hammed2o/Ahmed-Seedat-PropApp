'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Panel } from '@/components/ui/Panel';

// Body corporate / managing agent contacts (PHASE 9, WORKLOG.md this date). Staff/owner-only --
// property_management_contacts has no tenant RLS policy at all (deliberate scoping decision, see
// the migration's own comment). Same self-contained-client-panel pattern as PropertyPhotosPanel/
// PropertyCompliancePanel.

interface Contact {
  id: string;
  contactType: string;
  name: string;
  companyName: string | null;
  contactPerson: string | null;
  email: string | null;
  phone: string | null;
  emergencyPhone: string | null;
  accountReference: string | null;
}

const TYPE_LABELS: Record<string, string> = {
  body_corporate: 'Body Corporate',
  managing_agent: 'Managing Agent',
  hoa: 'HOA',
  estate_management: 'Estate Management',
  other: 'Other',
};

export function PropertyManagementPanel({
  propertyId,
  canManage,
}: {
  propertyId: string;
  canManage: boolean;
}) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [contactType, setContactType] = useState('managing_agent');
  const [name, setName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [emergencyPhone, setEmergencyPhone] = useState('');
  const [accountReference, setAccountReference] = useState('');

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/v1/properties/${propertyId}/management-contacts`);
      const body = await response.json();
      setContacts(body.contacts ?? []);
    } catch {
      setError('Could not load management contacts.');
    } finally {
      setLoaded(true);
    }
  }, [propertyId]);

  useEffect(() => {
    load();
  }, [load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/properties/${propertyId}/management-contacts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contactType,
          name: name.trim(),
          companyName: companyName.trim() || null,
          contactPerson: contactPerson.trim() || null,
          email: email.trim() || null,
          phone: phone.trim() || null,
          emergencyPhone: emergencyPhone.trim() || null,
          accountReference: accountReference.trim() || null,
        }),
      });
      if (!response.ok) {
        const body = await response.json();
        setError(body.error?.message ?? 'Could not save this contact.');
        return;
      }
      setShowForm(false);
      setName('');
      setCompanyName('');
      setContactPerson('');
      setEmail('');
      setPhone('');
      setEmergencyPhone('');
      setAccountReference('');
      await load();
    } finally {
      setSubmitting(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm('Remove this management contact?')) return;
    setError(null);
    const response = await fetch(`/api/v1/management-contacts/${id}`, { method: 'DELETE' });
    if (!response.ok) {
      const body = await response.json();
      setError(body.error?.message ?? 'Could not remove this contact.');
      return;
    }
    await load();
  }

  if (!loaded) {
    return (
      <p className="panel py-8 text-center text-sm text-muted-foreground">
        Loading management information…
      </p>
    );
  }

  return (
    <Panel title="Management">
      <div className="space-y-3">
        {error ? (
          <p className="rounded-md border border-light-danger bg-light-danger/10 px-3 py-2 text-xs text-light-danger dark:border-dark-danger dark:bg-dark-danger/10 dark:text-dark-danger">
            {error}
          </p>
        ) : null}

        {contacts.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            No body corporate, managing agent, or scheme management on file for this property.
          </p>
        ) : (
          <ul className="space-y-3">
            {contacts.map((c) => (
              <li key={c.id} className="rounded-lg border border-border p-3 text-sm">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-medium text-foreground">
                      {TYPE_LABELS[c.contactType] ?? c.contactType}: {c.name}
                    </p>
                    {c.companyName ? (
                      <p className="text-xs text-muted-foreground">{c.companyName}</p>
                    ) : null}
                  </div>
                  {canManage ? (
                    <Button size="sm" variant="destructive" onClick={() => remove(c.id)}>
                      Remove
                    </Button>
                  ) : null}
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  {c.contactPerson ? (
                    <div>
                      <dt className="inline">Contact: </dt>
                      <dd className="inline">{c.contactPerson}</dd>
                    </div>
                  ) : null}
                  {c.email ? (
                    <div>
                      <dt className="inline">Email: </dt>
                      <dd className="inline">{c.email}</dd>
                    </div>
                  ) : null}
                  {c.phone ? (
                    <div>
                      <dt className="inline">Phone: </dt>
                      <dd className="inline">{c.phone}</dd>
                    </div>
                  ) : null}
                  {c.emergencyPhone ? (
                    <div>
                      <dt className="inline">Emergency: </dt>
                      <dd className="inline">{c.emergencyPhone}</dd>
                    </div>
                  ) : null}
                  {c.accountReference ? (
                    <div>
                      <dt className="inline">Account ref: </dt>
                      <dd className="inline">{c.accountReference}</dd>
                    </div>
                  ) : null}
                </dl>
              </li>
            ))}
          </ul>
        )}

        {canManage ? (
          showForm ? (
            <form onSubmit={submit} className="space-y-2 border-t border-border pt-3">
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="text-xs text-muted-foreground">
                  Type
                  <select
                    value={contactType}
                    onChange={(e) => setContactType(e.target.value)}
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
                  Name
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="mt-1 block w-full rounded-md border border-border bg-transparent px-2 py-1.5 text-sm text-foreground"
                  />
                </label>
                <label className="text-xs text-muted-foreground">
                  Company name
                  <input
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    className="mt-1 block w-full rounded-md border border-border bg-transparent px-2 py-1.5 text-sm text-foreground"
                  />
                </label>
                <label className="text-xs text-muted-foreground">
                  Contact person
                  <input
                    value={contactPerson}
                    onChange={(e) => setContactPerson(e.target.value)}
                    className="mt-1 block w-full rounded-md border border-border bg-transparent px-2 py-1.5 text-sm text-foreground"
                  />
                </label>
                <label className="text-xs text-muted-foreground">
                  Email
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="mt-1 block w-full rounded-md border border-border bg-transparent px-2 py-1.5 text-sm text-foreground"
                  />
                </label>
                <label className="text-xs text-muted-foreground">
                  Phone
                  <input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="mt-1 block w-full rounded-md border border-border bg-transparent px-2 py-1.5 text-sm text-foreground"
                  />
                </label>
                <label className="text-xs text-muted-foreground">
                  Emergency contact
                  <input
                    value={emergencyPhone}
                    onChange={(e) => setEmergencyPhone(e.target.value)}
                    className="mt-1 block w-full rounded-md border border-border bg-transparent px-2 py-1.5 text-sm text-foreground"
                  />
                </label>
                <label className="text-xs text-muted-foreground">
                  Account reference
                  <input
                    value={accountReference}
                    onChange={(e) => setAccountReference(e.target.value)}
                    className="mt-1 block w-full rounded-md border border-border bg-transparent px-2 py-1.5 text-sm text-foreground"
                  />
                </label>
              </div>
              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={submitting || !name.trim()}>
                  {submitting ? 'Saving…' : 'Save contact'}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => setShowForm(false)}
                >
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <Button size="sm" variant="secondary" onClick={() => setShowForm(true)}>
              Add management contact
            </Button>
          )
        ) : null}
      </div>
    </Panel>
  );
}
