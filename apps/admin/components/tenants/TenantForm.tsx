'use client';

import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { Tenant } from '@propvault/types';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { Panel } from '@/components/ui/Panel';

// Same DESIGN_SYSTEM.md "Forms" conventions as NewPropertyForm.tsx/UnitForm.tsx. No `status`
// field -- tenantSchema (packages/validation) deliberately excludes it from client input, it's
// server-set only (defaults 'pending', transitions on lease approval/expiry).
//
// Tenant/occupancy V1 pass: this form now has three logical sections in CREATE mode only --
// "Tenancy location" (property/unit, purely for routing to the existing lease-creation flow
// afterward -- never stored on the tenant, no tenant.property_id/unit_id, see tenants/new/page.tsx's
// own comment), the original tenant-detail fields (unchanged), and "Tenant access" (the explicit
// internal-vs-invite choice the product spec requires -- default "Manage internally only", matching
// what POST /api/v1/tenants already did with zero UI for it before this pass: tenant creation has
// NEVER auto-sent an invitation, confirmed against that route's own code). EDIT mode is completely
// unchanged -- no location/access sections, since neither makes sense for an already-existing
// tenant record (changing tenancy location is a lease action, not a tenant-identity edit).

interface FormState {
  fullName: string;
  email: string;
  phone: string;
}

function toFormState(tenant?: Tenant): FormState {
  return {
    fullName: tenant?.fullName ?? '',
    email: tenant?.email ?? '',
    phone: tenant?.phone ?? '',
  };
}

export interface PropertyOption {
  id: string;
  nickname: string;
}

export interface UnitOption {
  id: string;
  propertyId: string;
  unitLabel: string;
  status: 'vacant' | 'occupied' | 'maintenance';
}

interface TenantFormProps {
  mode: 'create' | 'edit';
  orgId: string;
  tenant?: Tenant;
  properties?: PropertyOption[];
  units?: UnitOption[];
}

const UNIT_STATUS_HINT: Record<UnitOption['status'], string> = {
  vacant: 'vacant',
  occupied: 'occupied',
  maintenance: 'under maintenance',
};

export function TenantForm({ mode, orgId, tenant, properties = [], units = [] }: TenantFormProps) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(() => toFormState(tenant));
  const [propertyId, setPropertyId] = useState('');
  const [unitId, setUnitId] = useState('');
  const [accessMode, setAccessMode] = useState<'internal' | 'invite'>('internal');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  const isCreate = mode === 'create';
  const unitsForProperty = useMemo(
    () => units.filter((u) => u.propertyId === propertyId),
    [units, propertyId],
  );
  const selectedUnit = unitsForProperty.find((u) => u.id === unitId);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setWarning(null);
    setFieldErrors({});

    if (isCreate && accessMode === 'invite' && !form.email && !form.phone) {
      setError('Add an email or phone number to invite this tenant to Proplyst.');
      setSubmitting(false);
      return;
    }

    try {
      const url = mode === 'create' ? '/api/v1/tenants' : `/api/v1/tenants/${tenant!.id}`;
      const payload =
        mode === 'create'
          ? {
              orgId,
              fullName: form.fullName,
              email: form.email || null,
              phone: form.phone || null,
            }
          : {
              fullName: form.fullName,
              email: form.email || null,
              phone: form.phone || null,
            };
      const response = await fetch(url, {
        method: mode === 'create' ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await response.json();
      if (!response.ok) {
        setFieldErrors(body.error?.field_errors ?? {});
        setError(
          body.error?.message ?? `Failed to ${mode === 'create' ? 'create' : 'update'} tenant.`,
        );
        return;
      }

      const tenantId = body.tenant.id as string;

      // Explicit, opt-in only -- creating a tenant never implies "contact this tenant" on its
      // own (the critical communication rule). This is the ONE new place a tenant-creation flow
      // can trigger an invitation, and only because the landlord just explicitly chose "Invite
      // tenant to Proplyst" above -- the underlying call is the exact same
      // POST .../invitations endpoint TenantInvitationPanel already uses for an existing tenant,
      // not a new/duplicated send path.
      if (isCreate && accessMode === 'invite') {
        try {
          const inviteResponse = await fetch(`/api/v1/tenants/${tenantId}/invitations`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              deliveryChannel: form.email ? 'email' : 'whatsapp',
              includeShortCode: false,
            }),
          });
          if (!inviteResponse.ok) {
            const inviteBody = await inviteResponse.json();
            setWarning(
              `Tenant created, but the invitation couldn't be sent (${inviteBody.error?.message ?? 'unknown error'}). You can send it from the tenant page.`,
            );
          }
        } catch {
          setWarning(
            "Tenant created, but the invitation couldn't be sent — you can send it from the tenant page.",
          );
        }
      }

      if (isCreate && propertyId && unitId) {
        router.push(`/properties/${propertyId}/units/${unitId}/leases/new?tenantId=${tenantId}`);
        return;
      }
      router.push(`/tenants/${tenantId}`);
      router.refresh();
    } catch {
      setError('Failed to save tenant — check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6 animate-rise">
      <PageHeader title={mode === 'create' ? 'Add tenant' : `Edit ${tenant?.fullName}`} />

      <Panel className="max-w-xl">
        <form onSubmit={handleSubmit} className="space-y-6">
          {error ? (
            <p className="rounded-md border border-light-danger bg-light-danger/10 px-3 py-2 text-xs text-light-danger dark:border-dark-danger dark:bg-dark-danger/10 dark:text-dark-danger">
              {error}
            </p>
          ) : null}
          {warning ? (
            <p className="rounded-md border border-light-statusNeedsReview/40 bg-light-statusNeedsReview/10 px-3 py-2 text-xs text-light-statusNeedsReview dark:border-dark-statusNeedsReview/40 dark:bg-dark-statusNeedsReview/10 dark:text-dark-statusNeedsReview">
              {warning}
            </p>
          ) : null}

          {isCreate ? (
            <FormSection
              title="Tenancy location"
              description="Optional — pick where this tenant will live and we'll take you straight to creating or recording their lease afterward. You can also add a lease later from the property or unit page."
            >
              <div className="grid grid-cols-2 gap-4">
                <Field label="Property">
                  <select
                    value={propertyId}
                    onChange={(e) => {
                      setPropertyId(e.target.value);
                      setUnitId('');
                    }}
                    className={inputClass}
                  >
                    <option value="">Not sure yet / decide later</option>
                    {properties.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nickname}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Unit">
                  <select
                    value={unitId}
                    onChange={(e) => setUnitId(e.target.value)}
                    disabled={!propertyId}
                    className={inputClass}
                  >
                    <option value="">{propertyId ? 'Select a unit…' : 'Choose a property first'}</option>
                    {unitsForProperty.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.unitLabel} ({UNIT_STATUS_HINT[u.status]})
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              {selectedUnit && selectedUnit.status === 'occupied' ? (
                <p className="mt-2 text-[11px] text-light-statusNeedsReview dark:text-dark-statusNeedsReview">
                  This unit already shows as occupied — recording a new active lease here will be
                  blocked unless the existing tenancy is ended first.
                </p>
              ) : null}
            </FormSection>
          ) : null}

          <FormSection title={isCreate ? 'Tenant details' : undefined}>
            <div className="space-y-4">
              <Field label="Full name" error={fieldErrors.fullName}>
                <input
                  required
                  maxLength={200}
                  value={form.fullName}
                  onChange={(e) => set('fullName', e.target.value)}
                  className={inputClass}
                />
              </Field>

              <Field label="Email" error={fieldErrors.email}>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => set('email', e.target.value)}
                  className={inputClass}
                />
              </Field>

              <Field label="Phone" error={fieldErrors.phone}>
                <input
                  maxLength={30}
                  value={form.phone}
                  onChange={(e) => set('phone', e.target.value)}
                  className={inputClass}
                />
              </Field>
              {isCreate ? (
                <p className="text-[11px] text-light-textMuted dark:text-dark-textMuted">
                  Email and phone are optional for a tenant you manage internally — add them
                  whenever you're ready to invite this tenant to Proplyst.
                </p>
              ) : null}
            </div>
          </FormSection>

          {isCreate ? (
            <FormSection
              title="Tenant access"
              description="Choose how this tenant engages with Proplyst. You can change this later from the tenant's page."
            >
              <div className="space-y-3">
                <label className="flex items-start gap-2.5 rounded-lg border border-light-border p-3 text-sm dark:border-dark-border">
                  <input
                    type="radio"
                    className="mt-0.5"
                    checked={accessMode === 'internal'}
                    onChange={() => setAccessMode('internal')}
                  />
                  <span>
                    <span className="block font-medium text-light-textPrimary dark:text-dark-textPrimary">
                      Manage internally only
                    </span>
                    <span className="block text-[13px] text-light-textMuted dark:text-dark-textMuted">
                      Keep this tenant inside Proplyst for your own property management. No
                      invitation will be sent and the tenant does not need a Proplyst account.
                    </span>
                  </span>
                </label>
                <label className="flex items-start gap-2.5 rounded-lg border border-light-border p-3 text-sm dark:border-dark-border">
                  <input
                    type="radio"
                    className="mt-0.5"
                    checked={accessMode === 'invite'}
                    onChange={() => setAccessMode('invite')}
                  />
                  <span>
                    <span className="block font-medium text-light-textPrimary dark:text-dark-textPrimary">
                      Invite tenant to Proplyst
                    </span>
                    <span className="block text-[13px] text-light-textMuted dark:text-dark-textMuted">
                      Send the tenant a secure invitation so they can access their tenant portal.
                      Requires an email or phone number above.
                    </span>
                  </span>
                </label>
              </div>
            </FormSection>
          ) : null}

          <div className="flex gap-2 pt-2">
            <Button type="submit" variant="primary" disabled={submitting}>
              {submitting ? 'Saving…' : mode === 'create' ? 'Create tenant' : 'Save changes'}
            </Button>
            <Button
              type="button"
              onClick={() => router.push(mode === 'create' ? '/tenants' : `/tenants/${tenant!.id}`)}
            >
              Cancel
            </Button>
          </div>
        </form>
      </Panel>
    </div>
  );
}

function FormSection({
  title,
  description,
  children,
}: {
  title?: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="border-t border-light-border pt-5 first:border-t-0 first:pt-0 dark:border-dark-border">
      {title ? (
        <h2 className="text-xs font-semibold uppercase tracking-wide text-light-textMuted dark:text-dark-textMuted">
          {title}
        </h2>
      ) : null}
      {description ? (
        <p className="mt-1 text-[13px] text-light-textSecondary dark:text-dark-textSecondary">
          {description}
        </p>
      ) : null}
      <div className={title || description ? 'mt-3' : ''}>{children}</div>
    </div>
  );
}

const inputClass =
  'mt-1 block w-full rounded-md border border-light-border bg-transparent px-3 py-2 text-sm text-light-textPrimary dark:border-dark-border dark:text-dark-textPrimary';

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string[];
  children: ReactNode;
}) {
  return (
    <label className="block text-xs">
      <span className="text-light-textMuted dark:text-dark-textMuted">{label}</span>
      {children}
      {error?.length ? (
        <p className="mt-1 text-xs text-light-statusOverdue dark:text-dark-statusOverdue">
          {error[0]}
        </p>
      ) : null}
    </label>
  );
}
