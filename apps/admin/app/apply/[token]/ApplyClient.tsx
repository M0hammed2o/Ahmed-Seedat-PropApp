'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Building2 } from 'lucide-react';
import { branding } from '@propvault/config';
import { Button } from '@/components/ui/Button';

// Applicant->tenant->lease V1 (Phase A/B/C, WORKLOG.md 2026-08-25; OCR review added in the
// first-tenant-workflow predeploy pass, same date): the applicant-facing self-service intake page.
// Fully public, no session -- every read/write goes through the token-scoped API routes, which in
// turn only ever touch the ONE application this token was issued for. This page never receives or
// displays anything beyond what those routes return -- no staff notes, no other applications, no
// org/billing/audit data -- because those routes themselves never select those columns for a token
// caller.
//
// OCR is advisory only: a suggested value is never written to the application until the applicant
// clicks "Use this value" (copying it into the ordinary form field, editable like any other field)
// AND then submits the form -- the same submit_application_by_token() call that would run either
// way. Nothing here ever calls a write RPC directly from an OCR result.

interface ApplicationData {
  id: string;
  status: string;
  applicantName: string;
  applicantEmail: string | null;
  applicantPhone: string | null;
  dateOfBirth: string | null;
  currentAddress: string | null;
  employmentStatus: string | null;
  employerName: string | null;
  monthlyIncome: number | null;
  householdSize: number | null;
  applicantNotes: string | null;
  popiaConsentAt: string | null;
  propertyNickname: string | null;
  unitLabel: string | null;
}

interface DocumentRequirement {
  requirementKey: string;
  label: string;
  isRequired: boolean;
  status: 'requested' | 'uploaded' | 'reviewed' | 'accepted' | 'rejected';
  rejectionReason: string | null;
  documentId: string | null;
}

// Which extracted field(s) a given requirement's OCR result can offer to fill into the form, and
// which top-level form setter each maps to.
const FIELD_TARGETS: Record<string, { extractionKey: string; formField: FormFieldKey; label: string }[]> = {
  id_document: [
    { extractionKey: 'fullName', formField: 'name', label: 'Full name' },
    { extractionKey: 'dateOfBirth', formField: 'dob', label: 'Date of birth' },
  ],
  proof_of_address: [{ extractionKey: 'residentialAddress', formField: 'address', label: 'Address' }],
  proof_of_income: [
    { extractionKey: 'employerName', formField: 'employerName', label: 'Employer' },
    { extractionKey: 'netIncome', formField: 'monthlyIncome', label: 'Monthly income (net)' },
    { extractionKey: 'grossIncome', formField: 'monthlyIncome', label: 'Monthly income (gross)' },
  ],
  bank_statement: [{ extractionKey: 'residentialAddress', formField: 'address', label: 'Address' }],
};

type FormFieldKey = 'name' | 'dob' | 'address' | 'employerName' | 'monthlyIncome';

type Stage = 'loading' | 'invalid' | 'ready';

const inputClass =
  'mt-1 block w-full rounded-md border border-light-border bg-transparent px-3 py-2 text-sm text-light-textPrimary dark:border-dark-border dark:text-dark-textPrimary';

export function ApplyClient({ token }: { token: string }) {
  const [stage, setStage] = useState<Stage>('loading');
  const [invalidReason, setInvalidReason] = useState<string | null>(null);
  const [application, setApplication] = useState<ApplicationData | null>(null);
  const [requirements, setRequirements] = useState<DocumentRequirement[]>([]);

  // Form state lives here (not inside ApplicationForm) so an OCR "Use this value" click in
  // DocumentChecklist can write directly into it.
  const [fields, setFields] = useState<Record<FormFieldKey, string>>({
    name: '',
    dob: '',
    address: '',
    employerName: '',
    monthlyIncome: '',
  });

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/v1/apply/${token}`);
      const body = await response.json();
      if (!response.ok) {
        setInvalidReason(body.error?.message ?? 'This link is no longer valid.');
        setStage('invalid');
        return;
      }
      const app: ApplicationData = body.application;
      setApplication(app);
      setRequirements(body.documentRequirements ?? []);
      setFields((prev) => ({
        name: prev.name || app.applicantName || '',
        dob: prev.dob || app.dateOfBirth || '',
        address: prev.address || app.currentAddress || '',
        employerName: prev.employerName || app.employerName || '',
        monthlyIncome: prev.monthlyIncome || (app.monthlyIncome != null ? String(app.monthlyIncome) : ''),
      }));
      setStage('ready');
    } catch {
      setInvalidReason('Could not load your application — check your connection and try again.');
      setStage('invalid');
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  function applyField(formField: FormFieldKey, value: string) {
    setFields((prev) => ({ ...prev, [formField]: value }));
  }

  if (stage === 'loading') {
    return (
      <PageShell>
        <p className="text-center text-sm text-light-textMuted dark:text-dark-textMuted">Loading…</p>
      </PageShell>
    );
  }

  if (stage === 'invalid' || !application) {
    return (
      <PageShell>
        <h1 className="text-center font-display text-xl font-bold text-light-textPrimary dark:text-dark-textPrimary">
          Link not available
        </h1>
        <p className="mt-3 text-center text-sm text-light-textSecondary dark:text-dark-textSecondary">
          {invalidReason}
        </p>
      </PageShell>
    );
  }

  const isFinal = application.status === 'decided' || application.status === 'withdrawn';

  return (
    <div className="min-h-screen bg-light-surface px-4 py-10 dark:bg-dark-surface sm:px-6">
      <div className="mx-auto max-w-2xl">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-light-accent text-light-accentContrast shadow-glow dark:bg-dark-accent dark:text-dark-accentContrast">
            <Building2 size={20} aria-hidden="true" />
          </span>
          <div>
            <h1 className="font-display text-lg font-bold text-light-textPrimary dark:text-dark-textPrimary">
              Rental application
            </h1>
            <p className="text-xs text-light-textMuted dark:text-dark-textMuted">
              {application.propertyNickname
                ? `${application.propertyNickname} — ${application.unitLabel ?? ''}`
                : (application.unitLabel ?? '')}
            </p>
          </div>
        </div>

        {isFinal ? (
          <div className="rounded-card border border-light-border bg-light-surfaceRaised p-6 text-center dark:border-dark-border dark:bg-dark-surfaceRaised">
            <p className="text-sm text-light-textPrimary dark:text-dark-textPrimary">
              This application has already been decided. Your landlord will be in touch with next
              steps.
            </p>
          </div>
        ) : (
          <>
            <DocumentChecklist token={token} requirements={requirements} onUploaded={load} onApplyField={applyField} />
            <ApplicationForm token={token} application={application} fields={fields} setFields={setFields} onSaved={load} />
          </>
        )}

        <p className="mt-8 text-center text-xs text-light-textMuted dark:text-dark-textMuted">
          Powered by {branding.productName}
        </p>
      </div>
    </div>
  );
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-light-surface px-6 dark:bg-dark-surface">
      <div className="w-full max-w-sm rounded-card border border-light-border bg-light-surfaceRaised p-8 dark:border-dark-border dark:bg-dark-surfaceRaised">
        {children}
      </div>
    </main>
  );
}

function ApplicationForm({
  token,
  application,
  fields,
  setFields,
  onSaved,
}: {
  token: string;
  application: ApplicationData;
  fields: Record<FormFieldKey, string>;
  setFields: (updater: (prev: Record<FormFieldKey, string>) => Record<FormFieldKey, string>) => void;
  onSaved: () => void;
}) {
  const [email, setEmail] = useState(application.applicantEmail ?? '');
  const [phone, setPhone] = useState(application.applicantPhone ?? '');
  const [employmentStatus, setEmploymentStatus] = useState(application.employmentStatus ?? '');
  const [householdSize, setHouseholdSize] = useState(
    application.householdSize != null ? String(application.householdSize) : '',
  );
  const [notes, setNotes] = useState(application.applicantNotes ?? '');
  const [popiaConsent, setPopiaConsent] = useState(Boolean(application.popiaConsentAt));
  const [whatsappConsent, setWhatsappConsent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function set(key: FormFieldKey) {
    return (value: string) => setFields((prev) => ({ ...prev, [key]: value }));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const response = await fetch(`/api/v1/apply/${token}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          applicantName: fields.name,
          applicantEmail: email || null,
          applicantPhone: phone || null,
          dateOfBirth: fields.dob || null,
          currentAddress: fields.address || null,
          employmentStatus: employmentStatus || null,
          employerName: fields.employerName || null,
          monthlyIncome: fields.monthlyIncome ? Number(fields.monthlyIncome) : null,
          householdSize: householdSize ? Number(householdSize) : null,
          applicantNotes: notes || null,
          popiaConsent,
          whatsappConsent,
          whatsappPhone: whatsappConsent ? phone || null : null,
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error?.message ?? 'Could not submit your application.');
        return;
      }
      setSaved(true);
      onSaved();
    } catch {
      setError('Failed to submit — check your connection and try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="mt-6 space-y-6 rounded-card border border-light-border bg-light-surfaceRaised p-6 dark:border-dark-border dark:bg-dark-surfaceRaised"
    >
      {error ? (
        <p className="rounded-md border border-light-danger bg-light-danger/10 px-3 py-2 text-xs text-light-danger dark:border-dark-danger dark:bg-dark-danger/10 dark:text-dark-danger">
          {error}
        </p>
      ) : null}
      {saved ? (
        <p className="rounded-md border border-light-statusPaid bg-light-statusPaid/10 px-3 py-2 text-xs text-light-statusPaid dark:border-dark-statusPaid dark:bg-dark-statusPaid/10 dark:text-dark-statusPaid">
          Saved. You can keep editing and re-submit any time before it's reviewed.
        </p>
      ) : null}

      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold text-light-textPrimary dark:text-dark-textPrimary">
          Identity
        </legend>
        <label className="block text-xs">
          <span className="text-light-textMuted dark:text-dark-textMuted">Full legal name</span>
          <input required value={fields.name} onChange={(e) => set('name')(e.target.value)} className={inputClass} />
        </label>
        <label className="block text-xs">
          <span className="text-light-textMuted dark:text-dark-textMuted">Date of birth</span>
          <input type="date" value={fields.dob} onChange={(e) => set('dob')(e.target.value)} className={inputClass} />
        </label>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold text-light-textPrimary dark:text-dark-textPrimary">
          Contact
        </legend>
        <label className="block text-xs">
          <span className="text-light-textMuted dark:text-dark-textMuted">Email</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
        </label>
        <label className="block text-xs">
          <span className="text-light-textMuted dark:text-dark-textMuted">Phone</span>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputClass} />
        </label>
        <label className="block text-xs">
          <span className="text-light-textMuted dark:text-dark-textMuted">Residential address</span>
          <textarea
            value={fields.address}
            onChange={(e) => set('address')(e.target.value)}
            rows={2}
            className={inputClass}
          />
        </label>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold text-light-textPrimary dark:text-dark-textPrimary">
          Employment &amp; income
        </legend>
        <label className="block text-xs">
          <span className="text-light-textMuted dark:text-dark-textMuted">Employment status</span>
          <input
            value={employmentStatus}
            onChange={(e) => setEmploymentStatus(e.target.value)}
            placeholder="e.g. Employed, Self-employed, Student"
            className={inputClass}
          />
        </label>
        <label className="block text-xs">
          <span className="text-light-textMuted dark:text-dark-textMuted">Employer</span>
          <input
            value={fields.employerName}
            onChange={(e) => set('employerName')(e.target.value)}
            className={inputClass}
          />
        </label>
        <label className="block text-xs">
          <span className="text-light-textMuted dark:text-dark-textMuted">Monthly income (ZAR)</span>
          <input
            type="number"
            min={0}
            step={0.01}
            value={fields.monthlyIncome}
            onChange={(e) => set('monthlyIncome')(e.target.value)}
            className={inputClass}
          />
        </label>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold text-light-textPrimary dark:text-dark-textPrimary">
          Household
        </legend>
        <label className="block text-xs">
          <span className="text-light-textMuted dark:text-dark-textMuted">Number of occupants (including you)</span>
          <input
            type="number"
            min={1}
            value={householdSize}
            onChange={(e) => setHouseholdSize(e.target.value)}
            className={inputClass}
          />
        </label>
        <label className="block text-xs">
          <span className="text-light-textMuted dark:text-dark-textMuted">
            Anything else you'd like us to know (other occupants, pets, etc.)
          </span>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className={inputClass} />
        </label>
      </fieldset>

      <fieldset className="space-y-2 border-t border-light-border pt-4 dark:border-dark-border">
        <legend className="text-sm font-semibold text-light-textPrimary dark:text-dark-textPrimary">
          Consent
        </legend>
        <label className="flex items-start gap-2 text-xs text-light-textSecondary dark:text-dark-textSecondary">
          <input
            type="checkbox"
            required
            checked={popiaConsent}
            onChange={(e) => setPopiaConsent(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            I consent to my personal information being processed for the purposes of this rental
            application, including identity/document verification, in line with POPIA.
          </span>
        </label>
        <label className="flex items-start gap-2 text-xs text-light-textSecondary dark:text-dark-textSecondary">
          <input
            type="checkbox"
            checked={whatsappConsent}
            onChange={(e) => setWhatsappConsent(e.target.checked)}
            className="mt-0.5"
          />
          <span>I'd like to receive updates about this application by WhatsApp, at the phone number above.</span>
        </label>
      </fieldset>

      <Button type="submit" disabled={saving || !popiaConsent} className="w-full">
        {saving ? 'Submitting…' : 'Submit application'}
      </Button>
    </form>
  );
}

function DocumentChecklist({
  token,
  requirements,
  onUploaded,
  onApplyField,
}: {
  token: string;
  requirements: DocumentRequirement[];
  onUploaded: () => void;
  onApplyField: (formField: FormFieldKey, value: string) => void;
}) {
  if (requirements.length === 0) return null;
  return (
    <div className="rounded-card border border-light-border bg-light-surfaceRaised p-6 dark:border-dark-border dark:bg-dark-surfaceRaised">
      <h2 className="text-sm font-semibold text-light-textPrimary dark:text-dark-textPrimary">
        Required documents
      </h2>
      <p className="mt-1 text-xs text-light-textMuted dark:text-dark-textMuted">
        Upload each document, then scan it to pre-fill the form below — you can always edit the
        result before submitting.
      </p>
      <ul className="mt-3 space-y-3">
        {requirements.map((r) => (
          <DocumentRow key={r.requirementKey} token={token} requirement={r} onUploaded={onUploaded} onApplyField={onApplyField} />
        ))}
      </ul>
    </div>
  );
}

const STATUS_LABEL: Record<DocumentRequirement['status'], string> = {
  requested: 'Not yet uploaded',
  uploaded: 'Uploaded — awaiting review',
  reviewed: 'Under review',
  accepted: 'Accepted',
  rejected: 'Replacement required',
};

interface ExtractedFieldValue {
  value: string | number;
  confidence: number;
}

function DocumentRow({
  token,
  requirement,
  onUploaded,
  onApplyField,
}: {
  token: string;
  requirement: DocumentRequirement;
  onUploaded: () => void;
  onApplyField: (formField: FormFieldKey, value: string) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [extraction, setExtraction] = useState<Record<string, ExtractedFieldValue> | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});

  async function upload(file: File) {
    setUploading(true);
    setError(null);
    setExtraction(null);
    try {
      const form = new FormData();
      form.set('requirementKey', requirement.requirementKey);
      form.set('file', file);
      const response = await fetch(`/api/v1/apply/${token}/documents`, { method: 'POST', body: form });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error?.message ?? 'Upload failed.');
        return;
      }
      onUploaded();
    } catch {
      setError('Upload failed — check your connection and try again.');
    } finally {
      setUploading(false);
    }
  }

  async function scan() {
    if (!requirement.documentId) return;
    setScanning(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/apply/${token}/documents/${requirement.documentId}/extract`, {
        method: 'POST',
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error?.message ?? 'Could not scan this document.');
        return;
      }
      const raw = body.extractionResult?.rawProviderOutput ?? {};
      const fieldsOnly: Record<string, ExtractedFieldValue> = {};
      for (const [key, val] of Object.entries(raw)) {
        if (val && typeof val === 'object' && 'value' in (val as object) && 'confidence' in (val as object)) {
          fieldsOnly[key] = val as ExtractedFieldValue;
        }
      }
      setExtraction(fieldsOnly);
    } catch {
      setError('Scan failed — check your connection and try again.');
    } finally {
      setScanning(false);
    }
  }

  async function applyExtractedValue(extractionKey: string, formField: FormFieldKey, rawValue: string) {
    const finalValue = edits[extractionKey] ?? rawValue;
    onApplyField(formField, finalValue);
    if (edits[extractionKey] !== undefined && edits[extractionKey] !== rawValue && requirement.documentId) {
      // Record the correction (Phase 3/4 traceability) -- best-effort, never blocks applying the value.
      await fetch(`/api/v1/apply/${token}/documents/${requirement.documentId}/corrections`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ correctedFields: { [extractionKey]: finalValue } }),
      }).catch(() => undefined);
    }
  }

  const canReplace = requirement.status === 'requested' || requirement.status === 'rejected';
  const canScan =
    requirement.documentId &&
    (requirement.status === 'uploaded' || requirement.status === 'reviewed') &&
    FIELD_TARGETS[requirement.requirementKey];
  const targets = FIELD_TARGETS[requirement.requirementKey] ?? [];

  return (
    <li className="rounded-lg border border-light-border p-3 dark:border-dark-border">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm text-light-textPrimary dark:text-dark-textPrimary">
            {requirement.label}
            {requirement.isRequired ? '' : ' (optional)'}
          </p>
          <p className="text-xs text-light-textMuted dark:text-dark-textMuted">
            {STATUS_LABEL[requirement.status]}
            {requirement.status === 'rejected' && requirement.rejectionReason
              ? ` — ${requirement.rejectionReason}`
              : ''}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          {canScan ? (
            <Button type="button" variant="secondary" size="sm" disabled={scanning} onClick={scan}>
              {scanning ? 'Scanning…' : extraction ? 'Re-scan' : 'Scan document'}
            </Button>
          ) : null}
          {canReplace ? (
            <label className="cursor-pointer">
              <input
                type="file"
                accept="application/pdf,image/jpeg,image/png,image/heic"
                className="hidden"
                disabled={uploading}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void upload(file);
                  e.target.value = '';
                }}
              />
              <span className="inline-flex items-center rounded-md border border-light-border px-3 py-1.5 text-xs font-medium text-light-textPrimary hover:bg-light-surface dark:border-dark-border dark:text-dark-textPrimary dark:hover:bg-dark-surface">
                {uploading ? 'Uploading…' : requirement.status === 'rejected' ? 'Replace' : 'Upload'}
              </span>
            </label>
          ) : null}
        </div>
      </div>
      {error ? <p className="mt-1 text-xs text-light-danger dark:text-dark-danger">{error}</p> : null}

      {extraction ? (
        <div className="mt-3 space-y-2 border-t border-light-border pt-3 dark:border-dark-border">
          {targets.map(({ extractionKey, formField, label }) => {
            const field = extraction[extractionKey];
            if (!field) return null;
            const lowConfidence = field.confidence < 0.7;
            const currentValue = edits[extractionKey] ?? String(field.value);
            return (
              <div key={extractionKey} className="rounded-md bg-light-surface p-2 dark:bg-dark-surface">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-light-textPrimary dark:text-dark-textPrimary">
                    {label}
                  </span>
                  <span
                    className={
                      lowConfidence
                        ? 'rounded-full bg-light-danger/10 px-2 py-0.5 text-[10px] font-semibold text-light-danger dark:bg-dark-danger/10 dark:text-dark-danger'
                        : 'text-[10px] text-light-textMuted dark:text-dark-textMuted'
                    }
                  >
                    Confidence: {Math.round(field.confidence * 100)}%{lowConfidence ? ' — please check' : ''}
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-light-textMuted dark:text-dark-textMuted">
                  OCR result: {String(field.value)}
                </p>
                <div className="mt-1 flex gap-2">
                  <input
                    value={currentValue}
                    onChange={(e) => setEdits((prev) => ({ ...prev, [extractionKey]: e.target.value }))}
                    className={inputClass + ' mt-0 flex-1'}
                  />
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void applyExtractedValue(extractionKey, formField, String(field.value))}
                  >
                    Use this value
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </li>
  );
}
