'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Building2 } from 'lucide-react';
import { branding } from '@propvault/config';
import { Button } from '@/components/ui/Button';

// Applicant->tenant->lease V1 continuation (Phase A/B/C, WORKLOG.md 2026-08-25): the
// applicant-facing self-service intake page. Fully public, no session -- every read/write goes
// through the token-scoped API routes (GET/POST /api/v1/apply/:token(/submit|/documents)), which
// in turn only ever touch the ONE application this token was issued for
// (get_application_by_token()/submit_application_by_token()/record_application_document_upload(),
// migration 20260101000132/135). This page never receives or displays anything beyond what those
// routes return -- no staff notes, no other applications, no org/billing/audit data -- because
// those routes themselves never select those columns for a token caller.

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
}

type Stage = 'loading' | 'invalid' | 'ready';

const inputClass =
  'mt-1 block w-full rounded-md border border-light-border bg-transparent px-3 py-2 text-sm text-light-textPrimary dark:border-dark-border dark:text-dark-textPrimary';

export function ApplyClient({ token }: { token: string }) {
  const [stage, setStage] = useState<Stage>('loading');
  const [invalidReason, setInvalidReason] = useState<string | null>(null);
  const [application, setApplication] = useState<ApplicationData | null>(null);
  const [requirements, setRequirements] = useState<DocumentRequirement[]>([]);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/v1/apply/${token}`);
      const body = await response.json();
      if (!response.ok) {
        setInvalidReason(body.error?.message ?? 'This link is no longer valid.');
        setStage('invalid');
        return;
      }
      setApplication(body.application);
      setRequirements(body.documentRequirements ?? []);
      setStage('ready');
    } catch {
      setInvalidReason('Could not load your application — check your connection and try again.');
      setStage('invalid');
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

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
            <ApplicationForm token={token} application={application} onSaved={load} />
            <DocumentChecklist token={token} requirements={requirements} onUploaded={load} />
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
  onSaved,
}: {
  token: string;
  application: ApplicationData;
  onSaved: () => void;
}) {
  const [name, setName] = useState(application.applicantName);
  const [email, setEmail] = useState(application.applicantEmail ?? '');
  const [phone, setPhone] = useState(application.applicantPhone ?? '');
  const [dob, setDob] = useState(application.dateOfBirth ?? '');
  const [address, setAddress] = useState(application.currentAddress ?? '');
  const [employmentStatus, setEmploymentStatus] = useState(application.employmentStatus ?? '');
  const [employerName, setEmployerName] = useState(application.employerName ?? '');
  const [monthlyIncome, setMonthlyIncome] = useState(
    application.monthlyIncome != null ? String(application.monthlyIncome) : '',
  );
  const [householdSize, setHouseholdSize] = useState(
    application.householdSize != null ? String(application.householdSize) : '',
  );
  const [notes, setNotes] = useState(application.applicantNotes ?? '');
  const [popiaConsent, setPopiaConsent] = useState(Boolean(application.popiaConsentAt));
  const [whatsappConsent, setWhatsappConsent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

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
          applicantName: name,
          applicantEmail: email || null,
          applicantPhone: phone || null,
          dateOfBirth: dob || null,
          currentAddress: address || null,
          employmentStatus: employmentStatus || null,
          employerName: employerName || null,
          monthlyIncome: monthlyIncome ? Number(monthlyIncome) : null,
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
      className="space-y-6 rounded-card border border-light-border bg-light-surfaceRaised p-6 dark:border-dark-border dark:bg-dark-surfaceRaised"
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
          <input required value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
        </label>
        <label className="block text-xs">
          <span className="text-light-textMuted dark:text-dark-textMuted">Date of birth</span>
          <input type="date" value={dob} onChange={(e) => setDob(e.target.value)} className={inputClass} />
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
          <textarea value={address} onChange={(e) => setAddress(e.target.value)} rows={2} className={inputClass} />
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
          <input value={employerName} onChange={(e) => setEmployerName(e.target.value)} className={inputClass} />
        </label>
        <label className="block text-xs">
          <span className="text-light-textMuted dark:text-dark-textMuted">Monthly income (ZAR)</span>
          <input
            type="number"
            min={0}
            step={0.01}
            value={monthlyIncome}
            onChange={(e) => setMonthlyIncome(e.target.value)}
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
}: {
  token: string;
  requirements: DocumentRequirement[];
  onUploaded: () => void;
}) {
  if (requirements.length === 0) return null;
  return (
    <div className="mt-6 rounded-card border border-light-border bg-light-surfaceRaised p-6 dark:border-dark-border dark:bg-dark-surfaceRaised">
      <h2 className="text-sm font-semibold text-light-textPrimary dark:text-dark-textPrimary">
        Required documents
      </h2>
      <ul className="mt-3 space-y-3">
        {requirements.map((r) => (
          <DocumentRow key={r.requirementKey} token={token} requirement={r} onUploaded={onUploaded} />
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

function DocumentRow({
  token,
  requirement,
  onUploaded,
}: {
  token: string;
  requirement: DocumentRequirement;
  onUploaded: () => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setUploading(true);
    setError(null);
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

  const canReplace = requirement.status === 'requested' || requirement.status === 'rejected';

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
        {canReplace ? (
          <label className="shrink-0">
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
            <span className="inline-flex cursor-pointer items-center rounded-md border border-light-border px-3 py-1.5 text-xs font-medium text-light-textPrimary hover:bg-light-surface dark:border-dark-border dark:text-dark-textPrimary dark:hover:bg-dark-surface">
              {uploading ? 'Uploading…' : requirement.status === 'rejected' ? 'Replace' : 'Upload'}
            </span>
          </label>
        ) : null}
      </div>
      {error ? <p className="mt-1 text-xs text-light-danger dark:text-dark-danger">{error}</p> : null}
    </li>
  );
}
