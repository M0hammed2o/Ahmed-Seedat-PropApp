'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Panel } from '@/components/ui/Panel';
import { Pill } from '@/components/ui/Pill';

// Property rules / compliance workflow (WORKLOG.md this date), PHASE 7 owner/staff view.
// Self-contained client panel, same pattern PropertyPhotosPanel already established: its own
// fetch/mutate cycle against the new REST routes, added as one SimpleTabs entry on the property
// detail page rather than reworking that already-large server component.

interface RuleVersion {
  id: string;
  versionNumber: number;
  status: 'draft' | 'active' | 'superseded' | 'archived';
  effectiveDate: string;
  expiryDate: string | null;
}
interface Rule {
  id: string;
  category: string;
  title: string;
  versions: RuleVersion[];
}
interface RequirementRow {
  id: string;
  status: string;
  dueAt: string | null;
  acknowledgedAt: string | null;
  waivedAt: string | null;
  waivedReason: string | null;
  tenant: { id: string; fullName: string } | null;
  ruleVersion: {
    versionNumber: number;
    rule: { title: string } | null;
  } | null;
}

const CATEGORY_LABELS: Record<string, string> = {
  conduct_rules: 'Conduct Rules',
  body_corporate_rules: 'Body Corporate Rules',
  estate_rules: 'Estate Rules',
  house_rules: 'House Rules',
  csos_rules: 'CSOS Rules',
  welcome_pack: 'Welcome Pack',
  rule_amendment: 'Rule Amendment',
  occupant_policy: 'Occupant Policy',
  other_compliance_document: 'Other',
};

function requirementStatusTone(status: string): 'success' | 'warning' | 'destructive' | 'neutral' {
  if (status === 'acknowledged') return 'success';
  if (status === 'waived') return 'neutral';
  if (status === 'pending' || status === 'viewed') return 'warning';
  return 'neutral';
}

export function PropertyCompliancePanel({
  propertyId,
  canManage,
}: {
  propertyId: string;
  canManage: boolean;
}) {
  const [rules, setRules] = useState<Rule[]>([]);
  const [summary, setSummary] = useState<Record<string, number> | null>(null);
  const [requirements, setRequirements] = useState<RequirementRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [newCategory, setNewCategory] = useState('conduct_rules');
  const [newTitle, setNewTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const [statusFilter, setStatusFilter] = useState<
    'pending' | 'acknowledged' | 'overdue' | 'waived' | null
  >(null);

  const load = useCallback(async () => {
    try {
      const [rulesRes, complianceRes] = await Promise.all([
        fetch(`/api/v1/properties/${propertyId}/rules`),
        fetch(`/api/v1/properties/${propertyId}/compliance`),
      ]);
      const rulesBody = await rulesRes.json();
      const complianceBody = await complianceRes.json();
      setRules(rulesBody.rules ?? []);
      setSummary(complianceBody.summary ?? null);
      setRequirements(complianceBody.requirements ?? []);
    } catch {
      setError('Could not load compliance data.');
    } finally {
      setLoaded(true);
    }
  }, [propertyId]);

  useEffect(() => {
    load();
  }, [load]);

  async function createRule(e: React.FormEvent) {
    e.preventDefault();
    if (!newTitle.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/properties/${propertyId}/rules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: newCategory, title: newTitle.trim() }),
      });
      if (!response.ok) {
        const body = await response.json();
        setError(body.error?.message ?? 'Could not create rule.');
        return;
      }
      setNewTitle('');
      await load();
    } finally {
      setCreating(false);
    }
  }

  async function waive(requirementId: string) {
    const reason = window.prompt('Reason for waiving this requirement:');
    if (!reason || !reason.trim()) return;
    setError(null);
    const response = await fetch(`/api/v1/compliance-requirements/${requirementId}/waive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: reason.trim() }),
    });
    if (!response.ok) {
      const body = await response.json();
      setError(body.error?.message ?? 'Could not waive requirement.');
      return;
    }
    await load();
  }

  if (!loaded) {
    return (
      <p className="panel py-8 text-center text-sm text-muted-foreground">
        Loading compliance data…
      </p>
    );
  }

  return (
    <div className="space-y-5">
      {error ? (
        <p className="rounded-md border border-light-danger bg-light-danger/10 px-3 py-2 text-xs text-light-danger dark:border-dark-danger dark:bg-dark-danger/10 dark:text-dark-danger">
          {error}
        </p>
      ) : null}

      {summary ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {(
            [
              ['total', 'Total', null],
              ['pending', 'Pending', 'pending'],
              ['acknowledged', 'Acknowledged', 'acknowledged'],
              ['overdue', 'Overdue', 'overdue'],
              ['waived', 'Waived', 'waived'],
            ] as const
          ).map(([key, label, filterValue]) => (
            <button
              key={key}
              type="button"
              onClick={() => setStatusFilter(statusFilter === filterValue ? null : filterValue)}
              className={`panel p-3 text-center transition-opacity ${
                statusFilter === filterValue ? 'ring-2 ring-light-accent dark:ring-dark-accent' : ''
              }`}
            >
              <p className="text-lg font-semibold text-foreground">{summary[key] ?? 0}</p>
              <p className="text-[11px] text-muted-foreground">{label}</p>
            </button>
          ))}
        </div>
      ) : null}

      <Panel title="Rules">
        <div className="space-y-3">
          {rules.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No rules uploaded for this property yet.
            </p>
          ) : (
            rules.map((rule) => (
              <RuleRow
                key={rule.id}
                rule={rule}
                propertyId={propertyId}
                canManage={canManage}
                onChanged={load}
              />
            ))
          )}

          {canManage ? (
            <form
              onSubmit={createRule}
              className="flex flex-wrap items-end gap-2 border-t border-border pt-3"
            >
              <label className="text-xs text-muted-foreground">
                Category
                <select
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                  className="mt-1 block rounded-md border border-border bg-transparent px-2 py-1.5 text-sm text-foreground"
                >
                  {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex-1 text-xs text-muted-foreground">
                Title
                <input
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="e.g. Conduct Rules"
                  className="mt-1 block w-full rounded-md border border-border bg-transparent px-2 py-1.5 text-sm text-foreground"
                />
              </label>
              <Button type="submit" size="sm" disabled={creating || !newTitle.trim()}>
                {creating ? 'Creating…' : 'Add rule'}
              </Button>
            </form>
          ) : null}
        </div>
      </Panel>

      <Panel
        title={
          statusFilter ? `Tenancy compliance — filtered: ${statusFilter}` : 'Tenancy compliance'
        }
      >
        {(() => {
          const isOverdue = (r: RequirementRow) =>
            (r.status === 'pending' || r.status === 'viewed') &&
            !!r.dueAt &&
            r.dueAt < new Date().toISOString();
          const filtered = requirements.filter((r) => {
            if (!statusFilter) return true;
            if (statusFilter === 'overdue') return isOverdue(r);
            if (statusFilter === 'pending') return r.status === 'pending' || r.status === 'viewed';
            return r.status === statusFilter;
          });
          if (filtered.length === 0) {
            return (
              <p className="py-4 text-center text-sm text-muted-foreground">
                {requirements.length === 0
                  ? 'No compliance requirements assigned yet -- activate a rule version to assign one.'
                  : 'No requirements match this filter.'}
              </p>
            );
          }
          return (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr>
                    <th className="py-1.5 pr-3">Tenant</th>
                    <th className="py-1.5 pr-3">Rule</th>
                    <th className="py-1.5 pr-3">Status</th>
                    <th className="py-1.5 pr-3" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr key={r.id} className="border-t border-border">
                      <td className="py-1.5 pr-3">{r.tenant?.fullName ?? '—'}</td>
                      <td className="py-1.5 pr-3">
                        {r.ruleVersion?.rule?.title ?? 'Rule'} v{r.ruleVersion?.versionNumber}
                      </td>
                      <td className="py-1.5 pr-3">
                        <Pill tone={requirementStatusTone(r.status)}>{r.status}</Pill>
                      </td>
                      <td className="py-1.5 pr-3 text-right">
                        {canManage && (r.status === 'pending' || r.status === 'viewed') ? (
                          <Button size="sm" variant="secondary" onClick={() => waive(r.id)}>
                            Waive
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })()}
      </Panel>
    </div>
  );
}

function RuleRow({
  rule,
  propertyId,
  canManage,
  onChanged,
}: {
  rule: Rule;
  propertyId: string;
  canManage: boolean;
  onChanged: () => Promise<void>;
}) {
  const [showAddVersion, setShowAddVersion] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [effectiveDate, setEffectiveDate] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const sortedVersions = [...rule.versions].sort((a, b) => b.versionNumber - a.versionNumber);

  async function addVersion(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !effectiveDate) return;
    setSubmitting(true);
    setLocalError(null);
    try {
      const categoriesRes = await fetch('/api/v1/document-categories');
      const categoriesBody = await categoriesRes.json();
      const category = (categoriesBody.categories ?? []).find(
        (c: { slug: string }) => c.slug === 'compliance_documents',
      );
      if (!category) {
        setLocalError('Compliance document category is not available.');
        return;
      }

      const uploadForm = new FormData();
      uploadForm.set('file', file);
      uploadForm.set('propertyId', propertyId);
      uploadForm.set('categoryId', category.id);
      uploadForm.set('documentType', 'supporting_document');
      const uploadRes = await fetch('/api/v1/documents', { method: 'POST', body: uploadForm });
      if (!uploadRes.ok) {
        const body = await uploadRes.json();
        setLocalError(body.error?.message ?? 'Could not upload the document.');
        return;
      }
      const uploadBody = await uploadRes.json();

      const versionRes = await fetch(`/api/v1/property-rules/${rule.id}/versions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentId: uploadBody.document.id,
          effectiveDate,
        }),
      });
      if (!versionRes.ok) {
        const body = await versionRes.json();
        setLocalError(body.error?.message ?? 'Could not create the new version.');
        return;
      }
      setShowAddVersion(false);
      setFile(null);
      setEffectiveDate('');
      await onChanged();
    } finally {
      setSubmitting(false);
    }
  }

  async function activate(versionId: string) {
    setLocalError(null);
    const response = await fetch(`/api/v1/property-rule-versions/${versionId}/activate`, {
      method: 'POST',
    });
    if (!response.ok) {
      const body = await response.json();
      setLocalError(body.error?.message ?? 'Could not activate this version.');
      return;
    }
    await onChanged();
  }

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-foreground">{rule.title}</p>
          <p className="text-[11px] text-muted-foreground">
            {CATEGORY_LABELS[rule.category] ?? rule.category}
          </p>
        </div>
        {canManage ? (
          <Button size="sm" variant="secondary" onClick={() => setShowAddVersion((v) => !v)}>
            Add version
          </Button>
        ) : null}
      </div>

      {localError ? (
        <p className="mt-2 text-xs text-light-danger dark:text-dark-danger">{localError}</p>
      ) : null}

      <ul className="mt-2 space-y-1">
        {sortedVersions.map((v) => (
          <li key={v.id} className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">
              v{v.versionNumber} · effective {v.effectiveDate}
            </span>
            <span className="flex items-center gap-2">
              <Pill tone={v.status === 'active' ? 'success' : 'neutral'}>{v.status}</Pill>
              {canManage && (v.status === 'draft' || v.status === 'archived') ? (
                <Button size="sm" variant="secondary" onClick={() => activate(v.id)}>
                  Activate
                </Button>
              ) : null}
            </span>
          </li>
        ))}
      </ul>

      {showAddVersion ? (
        <form onSubmit={addVersion} className="mt-3 space-y-2 border-t border-border pt-3">
          <input
            type="file"
            accept="application/pdf,image/jpeg,image/png"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block text-xs text-foreground"
          />
          <label className="block text-xs text-muted-foreground">
            Effective date
            <input
              type="date"
              value={effectiveDate}
              onChange={(e) => setEffectiveDate(e.target.value)}
              className="mt-1 block rounded-md border border-border bg-transparent px-2 py-1.5 text-sm text-foreground"
            />
          </label>
          <Button type="submit" size="sm" disabled={submitting || !file || !effectiveDate}>
            {submitting ? 'Uploading…' : 'Upload version (draft)'}
          </Button>
        </form>
      ) : null}
    </div>
  );
}
