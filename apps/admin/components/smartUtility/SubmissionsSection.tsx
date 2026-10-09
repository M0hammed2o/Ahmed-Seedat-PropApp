'use client';

import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Panel } from '@/components/ui/Panel';
import { MUNICIPALITIES, getMunicipality } from '@/lib/smartUtility/catalog';
import { DEFAULT_BODY, DEFAULT_INCLUDE_FIELDS, DEFAULT_SUBJECT, PLACEHOLDERS, type IncludeFields } from '@/lib/smartUtility/templates';
import { api, Badge, errorClass, errorMessage, fmtDateTime, fmtNumber, inputClass, labelClass, noteClass, type Overview } from './shared';

// Monthly municipal readings (docs/SMART_UTILITIES_PROGRESS.md §7): settings, recipients, template
// editor, full preview (exactly what is sent), test send to yourself, approve, schedule; history.
// Copy is explicit that sent ≠ accepted and that only the official municipal meter is reported.

const STATUS_TONE: Record<string, 'good' | 'warn' | 'bad' | 'neutral'> = {
  draft: 'neutral',
  pending_approval: 'warn',
  approved: 'neutral',
  scheduled: 'neutral',
  sending: 'warn',
  sent: 'good',
  partially_failed: 'bad',
  failed: 'bad',
  cancelled: 'neutral',
};
const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft — send it yourself',
  pending_approval: 'Awaiting approval',
  approved: 'Approved',
  scheduled: 'Scheduled',
  sending: 'Sending',
  sent: 'Sent',
  partially_failed: 'Delivery failed for some recipients',
  failed: 'Delivery failed',
  cancelled: 'Cancelled',
};
const ACCEPTANCE_LABEL: Record<string, string> = {
  unknown: 'Not confirmed by municipality',
  accepted: 'Acknowledged / accepted',
  rejected: 'Rejected by municipality',
  not_applicable: 'Not applicable',
};
const FIELD_LABEL: Record<keyof IncludeFields, string> = {
  propertyAddress: 'Property address',
  accountNumber: 'Municipal account number',
  accountHolder: 'Account holder',
  serialNumber: 'Meter serial number',
  previousReading: 'Previous reading',
  consumption: 'Consumption (difference)',
  readingDate: 'Reading dates',
  photos: 'Meter photos',
};

interface DeliveryView {
  id: string;
  recipientEmail: string;
  status: string;
  attempts: number;
  nextAttemptAt: string | null;
  lastError: string | null;
}

interface PreviewData {
  periodStart: string;
  periodEnd: string;
  to: string[];
  cc: string[];
  subject: string;
  bodyText: string;
  bodyHtml: string;
  attachments: { filename: string; contentType: string }[];
  photos: { filename: string; dataUrl: string }[];
  templateHash: string;
  isDraft: boolean;
  approved: boolean;
  scheduleEnabled: boolean;
  scheduledFor: string;
  warnings: {
    unknownPlaceholders: string[];
    noAuthorisedRecipients: boolean;
    municipalityHasNoEmailChannel: boolean;
    noMunicipalMeter: boolean;
    missingReadings: number;
  };
}

type SettingsExtra = {
  ccEmails?: string[];
  accountHolderName?: string | null;
  customMessage?: string | null;
  subjectTemplate?: string | null;
  bodyTemplate?: string | null;
  includeFields?: Partial<IncludeFields>;
  scheduleEnabled?: boolean;
  templateApprovedAt?: string | null;
};

export function SubmissionsSection({ data, canManage, onChanged }: { data: Overview; canManage: boolean; onChanged: () => void }) {
  const s = data.submission;
  const saved = (s.settings ?? {}) as NonNullable<typeof s.settings> & SettingsExtra;
  const [form, setForm] = useState({
    municipalityCode: saved.municipalityCode ?? '',
    municipalAccountNumber: saved.municipalAccountNumber ?? '',
    mode: (saved.mode ?? 'approval_required') as 'manual' | 'approval_required' | 'automatic',
    billingDay: saved.billingDay ?? 25,
    leadDays: saved.leadDays ?? 5,
    includePhotos: saved.includePhotos ?? true,
    enabled: saved.enabled ?? false,
    ccEmails: (saved.ccEmails ?? []).join(', '),
    accountHolderName: saved.accountHolderName ?? '',
    customMessage: saved.customMessage ?? '',
    subjectTemplate: saved.subjectTemplate ?? DEFAULT_SUBJECT,
    bodyTemplate: saved.bodyTemplate ?? DEFAULT_BODY,
    includeFields: { ...DEFAULT_INCLUDE_FIELDS, ...(saved.includeFields ?? {}) } as IncludeFields,
  });
  const [recipient, setRecipient] = useState({ email: '', label: '', recipientType: 'municipality', authorise: false });
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const muni = getMunicipality(form.municipalityCode);
  const municipalMeters = data.meters.filter((m) => m.active && m.ownership === 'municipal');
  const sendDay = ((form.billingDay - form.leadDays + 27) % 28) + 1;

  function payload(extra: Record<string, unknown> = {}) {
    return {
      municipalityCode: form.municipalityCode || null,
      municipalAccountNumber: form.municipalAccountNumber || null,
      mode: form.mode,
      billingDay: Number(form.billingDay),
      leadDays: Number(form.leadDays),
      includePhotos: form.includePhotos,
      enabled: form.enabled,
      ccEmails: form.ccEmails.split(/[,;\s]+/).map((e) => e.trim()).filter(Boolean),
      accountHolderName: form.accountHolderName || null,
      customMessage: form.customMessage || null,
      subjectTemplate: form.subjectTemplate === DEFAULT_SUBJECT ? null : form.subjectTemplate,
      bodyTemplate: form.bodyTemplate === DEFAULT_BODY ? null : form.bodyTemplate,
      includeFields: form.includeFields,
      ...extra,
    };
  }

  async function save(e?: FormEvent, extra: Record<string, unknown> = {}) {
    e?.preventDefault();
    setError(null);
    setInfo(null);
    const res = await api(`/api/v1/properties/${data.property.id}/municipal-submissions/settings`, 'PUT', payload(extra));
    if (!res.ok) {
      setError(errorMessage(res.data));
      return false;
    }
    setInfo(res.data.approvalWithdrawn ? 'Saved. The content changed, so approval was withdrawn and scheduled sending switched off — preview and approve again.' : 'Saved.');
    setPreview(null);
    onChanged();
    return true;
  }

  async function loadPreview(draft: boolean) {
    setBusy(true);
    setError(null);
    const body = draft
      ? {
          subjectTemplate: form.subjectTemplate,
          bodyTemplate: form.bodyTemplate,
          customMessage: form.customMessage || null,
          accountHolderName: form.accountHolderName || null,
          includeFields: form.includeFields,
        }
      : undefined;
    const res = await api(`/api/v1/properties/${data.property.id}/municipal-submissions/preview`, 'POST', body);
    setBusy(false);
    if (!res.ok) return setError(errorMessage(res.data));
    setPreview(res.data as PreviewData);
  }

  async function action(url: string, method: 'POST' | 'DELETE' | 'PATCH', body?: unknown) {
    setBusy(true);
    setError(null);
    setInfo(null);
    const res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(errorMessage(json));
      return null;
    }
    onChanged();
    return json;
  }

  async function addRecipient(e: FormEvent) {
    e.preventDefault();
    const out = await action(`/api/v1/properties/${data.property.id}/municipal-submissions/recipients`, 'POST', { ...recipient, label: recipient.label || null });
    if (out) {
      setRecipient({ email: '', label: '', recipientType: 'municipality', authorise: false });
      if (out.approvalWithdrawn) setInfo('Recipient added. Approval was withdrawn because the recipients changed.');
      setPreview(null);
    }
  }

  async function recordAcceptance(id: string) {
    const answer = window.prompt('What did the municipality do? Type: accepted, rejected or unknown', 'accepted');
    if (!answer || !['accepted', 'rejected', 'unknown'].includes(answer.trim().toLowerCase())) return;
    const reference = window.prompt('Reference number from the municipality (optional)') ?? null;
    await action(`/api/v1/municipal-submissions/${id}`, 'POST', { action: 'acceptance', acceptanceStatus: answer.trim().toLowerCase(), reference: reference || null });
  }

  const approvedNow = !!saved.templateApprovedAt;

  return (
    <Panel title="Monthly municipal readings" description="Prepare, preview and send official meter readings to your municipality, agent or accountant">
      <div className={`${noteClass} mb-4 space-y-1`}>
        <p>Only the <strong>official municipal meter</strong> is reported — private unit meters are never sent to a municipality.</p>
        <p>A delivered email is <strong>not</strong> confirmation that the municipality accepted the reading. Check your next account and record the outcome.</p>
        {muni && !muni.emailSubmission ? <p>{muni.name} takes readings through its own app/portal. Proplyst prepares the pack for you to submit there; emailing it does not meet the municipality's requirement.</p> : null}
      </div>
      {error ? <div className={`${errorClass} mb-3`} role="alert">{error}</div> : null}
      {info ? <p className="mb-3 text-xs text-muted-foreground" role="status">{info}</p> : null}
      {municipalMeters.length === 0 ? (
        <p className="mb-3 text-sm text-light-warning dark:text-dark-warning">No meter is marked as the municipal meter yet. Add the main meter with "Who owns it: Municipality".</p>
      ) : null}

      <form onSubmit={(e) => void save(e)} className="space-y-4">
        <fieldset className="grid gap-3 sm:grid-cols-3" disabled={!canManage}>
          <label className={labelClass}>
            Municipality
            <select className={inputClass} value={form.municipalityCode} onChange={(e) => setForm({ ...form, municipalityCode: e.target.value })}>
              <option value="">Choose…</option>
              {MUNICIPALITIES.map((m) => <option key={m.code} value={m.code}>{m.name}</option>)}
            </select>
          </label>
          <label className={labelClass}>
            Municipal account / reference number
            <input className={inputClass} value={form.municipalAccountNumber} maxLength={60} onChange={(e) => setForm({ ...form, municipalAccountNumber: e.target.value })} />
          </label>
          <label className={labelClass}>
            Account holder (if required)
            <input className={inputClass} value={form.accountHolderName} maxLength={200} onChange={(e) => setForm({ ...form, accountHolderName: e.target.value })} />
          </label>
          <label className={labelClass}>
            How to send
            <select className={inputClass} value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value as typeof form.mode })}>
              <option value="manual">Manual — prepare it, I send it myself</option>
              <option value="approval_required">Ask me to approve each month</option>
              <option value="automatic" disabled={!!muni && !muni.emailSubmission && muni.code !== 'other'}>Automatic — send the approved template monthly</option>
            </select>
          </label>
          <label className={labelClass}>
            Municipal billing day (1–28)
            <input className={inputClass} type="number" min={1} max={28} value={form.billingDay} onChange={(e) => setForm({ ...form, billingDay: Number(e.target.value) })} />
          </label>
          <label className={labelClass}>
            Prepare / send this many days before
            <input className={inputClass} type="number" min={0} max={20} value={form.leadDays} onChange={(e) => setForm({ ...form, leadDays: Number(e.target.value) })} />
            <span className="mt-1 block text-[11px]">Monthly submission date: around day {sendDay}.</span>
          </label>
          <label className={`${labelClass} sm:col-span-2`}>
            CC (up to 5, comma-separated)
            <input className={inputClass} value={form.ccEmails} onChange={(e) => setForm({ ...form, ccEmails: e.target.value })} />
          </label>
          <div className="flex flex-col justify-end gap-1 text-xs text-muted-foreground">
            <label className="flex items-center gap-2"><input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} /> Prepare automatically every month</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={form.includePhotos} onChange={(e) => setForm({ ...form, includePhotos: e.target.checked })} /> Allow meter photos</label>
          </div>
        </fieldset>

        {muni ? (
          <details className={noteClass}>
            <summary className="cursor-pointer font-medium text-foreground">About {muni.name}</summary>
            {muni.channels.length ? <div className="mt-1">Official channels: {muni.channels.map((c) => `${c.value} (${c.kind}, ${c.utility})`).join('; ')}</div> : null}
            <div>Window: {muni.windowNote}</div>
            <div>They ask for: {muni.requiredInfo} Photo: {muni.photo.replace('_', ' ')}.</div>
            {muni.caveats.map((c) => <div key={c}>• {c}</div>)}
            <div>Choosing a municipality does not mean an email address is an accepted channel — add the recipient yourself after checking the municipality's website or your account.</div>
            {muni.sourceUrl ? <div>Source (checked {muni.verifiedOn}): <a className="underline" href={muni.sourceUrl} target="_blank" rel="noreferrer">{muni.sourceUrl}</a></div> : null}
          </details>
        ) : null}

        <fieldset className="space-y-3 rounded-md border border-light-border p-3 dark:border-dark-border" disabled={!canManage}>
          <legend className="px-1 text-sm font-semibold text-foreground">Email template</legend>
          <label className={labelClass}>
            Subject
            <input className={inputClass} value={form.subjectTemplate} maxLength={300} onChange={(e) => setForm({ ...form, subjectTemplate: e.target.value })} />
          </label>
          <label className={labelClass}>
            Message
            <textarea className={`${inputClass} font-mono`} rows={9} maxLength={5000} value={form.bodyTemplate} onChange={(e) => setForm({ ...form, bodyTemplate: e.target.value })} />
          </label>
          <div className="flex flex-wrap gap-1 text-[11px]" aria-label="Insert a placeholder">
            {PLACEHOLDERS.map((ph) => (
              <button key={ph} type="button" className="rounded border border-light-border px-1.5 py-0.5 dark:border-dark-border" onClick={() => setForm({ ...form, bodyTemplate: `${form.bodyTemplate}{{${ph}}}` })}>
                {`{{${ph}}}`}
              </button>
            ))}
          </div>
          <label className={labelClass}>
            Custom message ({'{{custom_message}}'})
            <textarea className={inputClass} rows={2} maxLength={2000} value={form.customMessage} onChange={(e) => setForm({ ...form, customMessage: e.target.value })} />
          </label>
          <div className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-4">
            {(Object.keys(FIELD_LABEL) as (keyof IncludeFields)[]).map((k) => (
              <label key={k} className="flex items-center gap-2">
                <input type="checkbox" checked={form.includeFields[k]} onChange={(e) => setForm({ ...form, includeFields: { ...form.includeFields, [k]: e.target.checked } })} />
                {FIELD_LABEL[k]}
              </label>
            ))}
          </div>
        </fieldset>

        {canManage ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit">Save settings</Button>
            <Button type="button" variant="secondary" disabled={busy} onClick={() => void loadPreview(true)}>Preview my edits</Button>
            <Button type="button" variant="secondary" disabled={busy} onClick={() => void loadPreview(false)}>Preview saved email</Button>
          </div>
        ) : null}
      </form>

      {preview ? (
        <section className="mt-4 space-y-3 rounded-md border border-light-border p-4 dark:border-dark-border" aria-label="Email preview">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground">{preview.isDraft ? 'Preview of unsaved edits' : 'Exactly what will be sent'}</h3>
            {preview.isDraft ? <Badge tone="warn">Save before approving</Badge> : preview.approved ? <Badge tone="good">Approved</Badge> : <Badge tone="warn">Not approved</Badge>}
          </div>
          <dl className="grid gap-1 text-xs sm:grid-cols-[10rem_1fr]">
            <dt className="text-muted-foreground">To</dt><dd>{preview.to.length ? preview.to.join(', ') : <span className="text-light-danger dark:text-dark-danger">No authorised recipients</span>}</dd>
            <dt className="text-muted-foreground">CC</dt><dd>{preview.cc.join(', ') || '—'}</dd>
            <dt className="text-muted-foreground">Subject</dt><dd className="font-medium">{preview.subject}</dd>
            <dt className="text-muted-foreground">Period</dt><dd>{preview.periodStart} to {preview.periodEnd}</dd>
            <dt className="text-muted-foreground">Scheduled for</dt><dd>{fmtDateTime(preview.scheduledFor)} {preview.scheduleEnabled ? '' : '(scheduled sending is off)'}</dd>
            <dt className="text-muted-foreground">Attachments</dt><dd>{preview.attachments.map((a) => a.filename).join(', ')}</dd>
          </dl>
          {[
            preview.warnings.noMunicipalMeter && 'No municipal meter — the pack has no readings.',
            preview.warnings.missingReadings > 0 && `${preview.warnings.missingReadings} meter(s) have no reading for this period.`,
            preview.warnings.municipalityHasNoEmailChannel && 'This municipality has no verified email channel.',
            preview.warnings.unknownPlaceholders.length > 0 && `Unknown placeholders: ${preview.warnings.unknownPlaceholders.join(', ')}`,
          ]
            .filter(Boolean)
            .map((w) => <p key={String(w)} className="text-xs text-light-warning dark:text-dark-warning">⚠ {w}</p>)}
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded bg-light-surface p-3 text-xs dark:bg-dark-surface">{preview.bodyText}</pre>
          {preview.photos.length ? (
            <div className="flex flex-wrap gap-2">
              {preview.photos.map((ph) => (
                <img key={ph.filename} src={ph.dataUrl} alt={ph.filename} className="h-28 rounded border border-light-border object-cover dark:border-dark-border" />
              ))}
            </div>
          ) : null}
          {!preview.isDraft ? (
            <iframe title="PDF report preview" src={`/api/v1/properties/${data.property.id}/municipal-submissions/preview?format=pdf`} className="h-96 w-full rounded border border-light-border dark:border-dark-border" />
          ) : null}
          {canManage && !preview.isDraft ? (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" disabled={busy} onClick={async () => {
                const out = await action(`/api/v1/properties/${data.property.id}/municipal-submissions/test-send`, 'POST');
                if (out) setInfo(out.message);
              }}>Send test to my email</Button>
              {!preview.approved ? (
                <Button size="sm" disabled={busy || preview.to.length === 0} onClick={async () => {
                  const out = await action(`/api/v1/properties/${data.property.id}/municipal-submissions/approve-template`, 'POST', { templateHash: preview.templateHash });
                  if (out) {
                    setInfo('Template approved.');
                    await loadPreview(false);
                  }
                }}>Approve this email</Button>
              ) : (
                <>
                  {!preview.scheduleEnabled ? (
                    <Button size="sm" disabled={busy} onClick={async () => {
                      if (!window.confirm(`Send this email automatically every month to ${preview.to.join(', ')}${preview.cc.length ? ` (CC ${preview.cc.join(', ')})` : ''}?`)) return;
                      if (await save(undefined, { scheduleEnabled: true })) setInfo('Scheduled sending enabled.');
                    }}>Enable scheduled sending</Button>
                  ) : (
                    <Button size="sm" variant="secondary" disabled={busy} onClick={async () => {
                      if (await save(undefined, { scheduleEnabled: false })) setInfo('Scheduled sending disabled.');
                    }}>Disable scheduled sending</Button>
                  )}
                  <Button size="sm" variant="secondary" disabled={busy} onClick={async () => {
                    await action(`/api/v1/properties/${data.property.id}/municipal-submissions/approve-template`, 'DELETE');
                    setPreview(null);
                  }}>Withdraw approval</Button>
                </>
              )}
            </div>
          ) : null}
          {!s.autoSubmissionEnabled && form.mode === 'automatic' ? (
            <p className={noteClass}>Automatic sending is not yet switched on for this Proplyst environment, so each month's pack will wait for your approval.</p>
          ) : null}
        </section>
      ) : approvedNow ? (
        <p className="mt-3 text-xs text-muted-foreground">Template approved {fmtDateTime(saved.templateApprovedAt)}{saved.scheduleEnabled ? ' · scheduled sending on' : ''}.</p>
      ) : null}

      <h3 className="mb-2 mt-6 text-sm font-semibold text-foreground">Recipients</h3>
      {s.recipients.length === 0 ? <p className="mb-2 text-sm text-muted-foreground">No recipients yet.</p> : (
        <ul className="mb-3 space-y-1 text-sm">
          {s.recipients.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2">
              <span className={r.active ? 'text-foreground' : 'text-muted-foreground line-through'}>{r.email}</span>
              <span className="text-xs text-muted-foreground">{r.label ?? r.recipientType.replace('_', ' ')}</span>
              <Badge tone={r.authorisedAt ? 'good' : 'warn'}>{r.authorisedAt ? 'Authorised' : 'Not authorised — will not be emailed'}</Badge>
              {canManage ? (
                <>
                  <Button size="sm" variant="secondary" onClick={() => void action(`/api/v1/municipal-submission-recipients/${r.id}`, 'PATCH', { authorise: !r.authorisedAt })}>{r.authorisedAt ? 'Withdraw' : 'Authorise'}</Button>
                  <Button size="sm" variant="secondary" onClick={() => void action(`/api/v1/municipal-submission-recipients/${r.id}`, 'PATCH', { active: !r.active })}>{r.active ? 'Remove' : 'Restore'}</Button>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {canManage ? (
        <form onSubmit={addRecipient} className="grid gap-3 sm:grid-cols-4">
          <label className={labelClass}>
            Email
            <input className={inputClass} type="email" required value={recipient.email} onChange={(e) => setRecipient({ ...recipient, email: e.target.value })} />
          </label>
          <label className={labelClass}>
            Recipient
            <select className={inputClass} value={recipient.recipientType} onChange={(e) => setRecipient({ ...recipient, recipientType: e.target.value })}>
              <option value="municipality">Municipality</option>
              <option value="managing_agent">Managing agent</option>
              <option value="utility_company">Utility management company</option>
              <option value="accountant">Accountant</option>
              <option value="custom">Other</option>
            </select>
          </label>
          <label className={labelClass}>
            Label (optional)
            <input className={inputClass} value={recipient.label} maxLength={100} onChange={(e) => setRecipient({ ...recipient, label: e.target.value })} />
          </label>
          <div className="flex items-end"><Button type="submit">Add recipient</Button></div>
          <label className="flex items-start gap-2 text-xs text-muted-foreground sm:col-span-4">
            <input type="checkbox" checked={recipient.authorise} onChange={(e) => setRecipient({ ...recipient, authorise: e.target.checked })} />
            I authorise Proplyst to email this address the property's meter readings and municipal account number. I have checked the address on the municipality's official website or my account statement.
          </label>
        </form>
      ) : null}

      <div className="mb-2 mt-6 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">History</h3>
        {canManage ? <Button size="sm" variant="secondary" disabled={busy} onClick={() => void action(`/api/v1/properties/${data.property.id}/municipal-submissions`, 'POST', {})}>Prepare last period now</Button> : null}
      </div>
      {s.history.length === 0 ? <p className="text-sm text-muted-foreground">No reading packs yet.</p> : (
        <ul className="space-y-2">
          {s.history.map((h) => {
            const report = h.report as { meters?: { meterNumber: string | null; currentReading: number | null; unit: string; consumption: number | null; verificationNote: string }[] };
            return (
              <li key={h.id} className="rounded-md border border-light-border p-3 text-sm dark:border-dark-border">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="font-medium text-foreground">{h.periodStart} → {h.periodEnd}</div>
                    <div className="mt-1 flex flex-wrap gap-2">
                      <Badge tone={STATUS_TONE[h.status] ?? 'neutral'}>{STATUS_LABEL[h.status] ?? h.status}</Badge>
                      <Badge tone={h.acceptanceStatus === 'accepted' ? 'good' : h.acceptanceStatus === 'rejected' ? 'bad' : 'neutral'}>{ACCEPTANCE_LABEL[h.acceptanceStatus]}</Badge>
                      {h.submissionReference ? <span className="text-xs text-muted-foreground">Ref {h.submissionReference}</span> : null}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <a className="text-xs underline" href={`/api/v1/municipal-submissions/${h.id}/export?format=pdf`}>PDF</a>
                    <a className="text-xs underline" href={`/api/v1/municipal-submissions/${h.id}/export?format=csv`}>CSV</a>
                    {canManage && ['draft', 'pending_approval'].includes(h.status) ? (
                      <Button size="sm" disabled={busy} onClick={() => void action(`/api/v1/municipal-submissions/${h.id}`, 'POST', { action: 'approve' })}>Approve &amp; send</Button>
                    ) : null}
                    {canManage && ['partially_failed', 'failed', 'sending'].includes(h.status) ? (
                      <Button size="sm" variant="secondary" disabled={busy} onClick={() => void action(`/api/v1/municipal-submissions/${h.id}`, 'POST', { action: 'send' })}>Retry now</Button>
                    ) : null}
                    {canManage && ['draft', 'pending_approval', 'approved', 'scheduled'].includes(h.status) ? (
                      <Button size="sm" variant="secondary" disabled={busy} onClick={() => void action(`/api/v1/municipal-submissions/${h.id}`, 'POST', { action: 'cancel' })}>Cancel</Button>
                    ) : null}
                    {canManage && h.status !== 'cancelled' ? (
                      <Button size="sm" variant="secondary" onClick={() => void recordAcceptance(h.id)}>Record outcome</Button>
                    ) : null}
                  </div>
                </div>
                <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                  {(report.meters ?? []).map((m, i) => (
                    <li key={i}>Meter {m.meterNumber ?? '—'}: {fmtNumber(m.currentReading, 3)} {m.unit}, used {fmtNumber(m.consumption, 3)} {m.unit} — {m.verificationNote}</li>
                  ))}
                  {(h.deliveries as unknown as DeliveryView[]).map((d) => (
                    <li key={d.id}>
                      To {d.recipientEmail}: {d.status}{d.attempts > 1 ? ` after ${d.attempts} attempts` : ''}{d.lastError ? ` — ${d.lastError}` : ''}{d.status === 'failed' && d.nextAttemptAt ? ` · next try ${fmtDateTime(d.nextAttemptAt)}` : ''}
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
