'use client';

import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Panel } from '@/components/ui/Panel';
import { MUNICIPALITIES, getMunicipality } from '@/lib/smartUtility/catalog';
import { api, Badge, errorClass, errorMessage, fmtDateTime, fmtNumber, inputClass, labelClass, noteClass, type Overview } from './shared';

// Monthly municipal reading submissions (docs/SMART_UTILITY_ARCHITECTURE.md §8). Copy is explicit
// that a sent pack is not an accepted reading, and that only the official municipal meter is
// reported.

const STATUS_TONE: Record<string, 'good' | 'warn' | 'bad' | 'neutral'> = {
  draft: 'neutral',
  pending_approval: 'warn',
  approved: 'neutral',
  sending: 'warn',
  sent: 'good',
  partially_failed: 'bad',
  failed: 'bad',
  cancelled: 'neutral',
};
const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft (send it yourself)',
  pending_approval: 'Awaiting your approval',
  approved: 'Approved',
  sending: 'Sending',
  sent: 'Sent',
  partially_failed: 'Partly failed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};
const ACCEPTANCE_LABEL: Record<string, string> = {
  unknown: 'Not confirmed',
  accepted: 'Accepted by municipality',
  rejected: 'Rejected by municipality',
  not_applicable: 'Not applicable',
};

interface DeliveryView {
  id: string;
  recipientEmail: string;
  status: string;
  attempts: number;
  nextAttemptAt: string | null;
  lastError: string | null;
}

export function SubmissionsSection({ data, canManage, onChanged }: { data: Overview; canManage: boolean; onChanged: () => void }) {
  const s = data.submission;
  const [form, setForm] = useState({
    municipalityCode: s.settings?.municipalityCode ?? '',
    municipalAccountNumber: s.settings?.municipalAccountNumber ?? '',
    mode: s.settings?.mode ?? 'approval_required',
    billingDay: s.settings?.billingDay ?? 25,
    leadDays: s.settings?.leadDays ?? 5,
    includePhotos: s.settings?.includePhotos ?? true,
    enabled: s.settings?.enabled ?? false,
  });
  const [recipient, setRecipient] = useState({ email: '', label: '', recipientType: 'municipality', authorise: false });
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const muni = getMunicipality(form.municipalityCode);
  const municipalMeters = data.meters.filter((m) => m.active && m.ownership === 'municipal');

  async function saveSettings(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    const res = await api(`/api/v1/properties/${data.property.id}/municipal-submissions/settings`, 'PUT', {
      ...form,
      municipalityCode: form.municipalityCode || null,
      municipalAccountNumber: form.municipalAccountNumber || null,
      billingDay: Number(form.billingDay),
      leadDays: Number(form.leadDays),
    });
    if (!res.ok) return setError(errorMessage(res.data));
    setSaved(true);
    onChanged();
  }

  async function addRecipient(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await api(`/api/v1/properties/${data.property.id}/municipal-submissions/recipients`, 'POST', {
      ...recipient,
      label: recipient.label || null,
    });
    if (!res.ok) return setError(errorMessage(res.data));
    setRecipient({ email: '', label: '', recipientType: 'municipality', authorise: false });
    onChanged();
  }

  async function patchRecipient(id: string, body: Record<string, unknown>) {
    const res = await api(`/api/v1/municipal-submission-recipients/${id}`, 'PATCH', body);
    if (!res.ok) setError(errorMessage(res.data));
    onChanged();
  }

  async function act(id: string, body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const res = await api(`/api/v1/municipal-submissions/${id}`, 'POST', body);
    setBusy(false);
    if (!res.ok) setError(errorMessage(res.data));
    onChanged();
  }

  async function generateNow() {
    setBusy(true);
    setError(null);
    const res = await api(`/api/v1/properties/${data.property.id}/municipal-submissions`, 'POST', {});
    setBusy(false);
    if (!res.ok) setError(errorMessage(res.data));
    onChanged();
  }

  async function recordAcceptance(id: string) {
    const answer = window.prompt('What did the municipality do? Type: accepted, rejected or unknown', 'accepted');
    if (!answer || !['accepted', 'rejected', 'unknown'].includes(answer.trim().toLowerCase())) return;
    const reference = window.prompt('Reference number from the municipality (optional)') ?? null;
    await act(id, { action: 'acceptance', acceptanceStatus: answer.trim().toLowerCase(), reference: reference || null });
  }

  return (
    <Panel title="Monthly municipal readings" description="Prepare and send official meter readings to your municipality or agent">
      <div className={`${noteClass} mb-4 space-y-1`}>
        <p>Only the <strong>official municipal meter</strong> is reported — private unit meters are never sent to a municipality.</p>
        <p>A sent email is <strong>not</strong> confirmation that the municipality accepted the reading. Check your next municipal account and record the outcome here.</p>
      </div>
      {error ? <div className={`${errorClass} mb-3`}>{error}</div> : null}
      {municipalMeters.length === 0 ? (
        <p className="mb-3 text-sm text-light-warning dark:text-dark-warning">
          No meter is marked as the municipal meter yet. Add the main meter with “Who owns it: Municipality”.
        </p>
      ) : null}

      <form onSubmit={saveSettings} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <label className={labelClass}>
            Municipality
            <select className={inputClass} value={form.municipalityCode} disabled={!canManage} onChange={(e) => setForm({ ...form, municipalityCode: e.target.value })}>
              <option value="">Choose…</option>
              {MUNICIPALITIES.map((m) => <option key={m.code} value={m.code}>{m.name}</option>)}
            </select>
          </label>
          <label className={labelClass}>
            Municipal account number
            <input className={inputClass} value={form.municipalAccountNumber} disabled={!canManage} maxLength={60} onChange={(e) => setForm({ ...form, municipalAccountNumber: e.target.value })} />
          </label>
          <label className={labelClass}>
            How to send
            <select className={inputClass} value={form.mode} disabled={!canManage} onChange={(e) => setForm({ ...form, mode: e.target.value as typeof form.mode })}>
              <option value="manual">Manual — prepare it, I send it myself</option>
              <option value="approval_required">Ask me to approve before sending</option>
              <option value="automatic" disabled={!!muni && !muni.emailSubmission && muni.code !== 'other'}>Send automatically to authorised recipients</option>
            </select>
          </label>
          <label className={labelClass}>
            Municipal billing day (1–28)
            <input className={inputClass} type="number" min={1} max={28} value={form.billingDay} disabled={!canManage} onChange={(e) => setForm({ ...form, billingDay: Number(e.target.value) })} />
          </label>
          <label className={labelClass}>
            Prepare this many days before
            <input className={inputClass} type="number" min={0} max={20} value={form.leadDays} disabled={!canManage} onChange={(e) => setForm({ ...form, leadDays: Number(e.target.value) })} />
          </label>
          <div className="flex flex-col justify-end gap-1 text-xs text-muted-foreground">
            <label className="flex items-center gap-2"><input type="checkbox" checked={form.includePhotos} disabled={!canManage} onChange={(e) => setForm({ ...form, includePhotos: e.target.checked })} /> Attach meter photos</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={form.enabled} disabled={!canManage} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} /> Prepare automatically every month</label>
          </div>
        </div>
        {form.mode === 'automatic' && !s.autoSubmissionEnabled ? (
          <p className={noteClass}>Automatic sending is not yet switched on for Proplyst, so packs will wait for your approval until it is.</p>
        ) : null}
        {muni ? (
          <div className={`${noteClass} space-y-1`}>
            <div className="font-medium text-foreground">{muni.name}</div>
            {muni.channels.length ? (
              <div>Official channels: {muni.channels.map((c) => `${c.value} (${c.kind}, ${c.utility})`).join('; ')}</div>
            ) : null}
            <div>Window: {muni.windowNote}</div>
            <div>They ask for: {muni.requiredInfo} Photo: {muni.photo.replace('_', ' ')}.</div>
            {muni.caveats.map((c) => <div key={c}>• {c}</div>)}
            {!muni.emailSubmission ? <div>No verified email channel — download the pack and submit it through the municipality’s own app or portal.</div> : null}
            {muni.sourceUrl ? <div>Source (checked {muni.verifiedOn}): <a className="underline" href={muni.sourceUrl} target="_blank" rel="noreferrer">{muni.sourceUrl}</a></div> : null}
          </div>
        ) : null}
        {canManage ? (
          <div className="flex items-center gap-3">
            <Button type="submit">Save settings</Button>
            {saved ? <span className="text-xs text-muted-foreground">Saved.</span> : null}
          </div>
        ) : null}
      </form>

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
                  <Button size="sm" variant="secondary" onClick={() => patchRecipient(r.id, { authorise: !r.authorisedAt })}>{r.authorisedAt ? 'Withdraw' : 'Authorise'}</Button>
                  <Button size="sm" variant="secondary" onClick={() => patchRecipient(r.id, { active: !r.active })}>{r.active ? 'Remove' : 'Restore'}</Button>
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
            I authorise Proplyst to email this address the property’s meter readings and municipal account number. I have checked the address on the municipality’s official website or my account statement.
          </label>
        </form>
      ) : null}

      <div className="mb-2 mt-6 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">History</h3>
        {canManage ? <Button size="sm" variant="secondary" disabled={busy} onClick={generateNow}>Prepare last period now</Button> : null}
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
                      <Button size="sm" disabled={busy} onClick={() => act(h.id, { action: 'approve' })}>Approve &amp; send</Button>
                    ) : null}
                    {canManage && ['partially_failed', 'failed', 'sending'].includes(h.status) ? (
                      <Button size="sm" variant="secondary" disabled={busy} onClick={() => act(h.id, { action: 'send' })}>Retry now</Button>
                    ) : null}
                    {canManage && ['draft', 'pending_approval', 'approved'].includes(h.status) ? (
                      <Button size="sm" variant="secondary" disabled={busy} onClick={() => act(h.id, { action: 'cancel' })}>Cancel</Button>
                    ) : null}
                    {canManage && h.status !== 'cancelled' ? (
                      <Button size="sm" variant="secondary" onClick={() => recordAcceptance(h.id)}>Record outcome</Button>
                    ) : null}
                  </div>
                </div>
                <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                  {(report.meters ?? []).map((m, i) => (
                    <li key={i}>
                      Meter {m.meterNumber ?? '—'}: {fmtNumber(m.currentReading, 3)} {m.unit}, used {fmtNumber(m.consumption, 3)} {m.unit} — {m.verificationNote}
                    </li>
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
