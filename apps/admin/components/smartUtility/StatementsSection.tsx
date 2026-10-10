'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Panel } from '@/components/ui/Panel';
import { api, Badge, errorClass, errorMessage, fmtDateTime, fmtRand, inputClass, labelClass, noteClass, type Overview } from './shared';

// Monthly utility statements (docs/HYBRID_UTILITIES_ARCHITECTURE.md §F): prepared from approved charges, reviewed and
// approved by staff before anyone else sees them. Emailing tenants is off unless the server flag is set.

interface Statement {
  id: string;
  audience: 'tenant' | 'owner';
  period_start: string;
  period_end: string;
  status: 'draft' | 'approved' | 'sent' | 'void';
  approved_at: string | null;
  sent_at: string | null;
  sent_to: string | null;
  unitLabel: string | null;
  tenantName: string | null;
  total: number | null;
}

const TONE = { draft: 'warn', approved: 'good', sent: 'good', void: 'neutral' } as const;

export function StatementsSection({ data, canManage }: { data: Overview; canManage: boolean }) {
  const pid = data.property.id;
  const [rows, setRows] = useState<Statement[]>([]);
  const [sendingEnabled, setSendingEnabled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [period, setPeriod] = useState({ periodStart: data.period.lastComplete.start, periodEnd: new Date(Date.parse(`${data.period.lastComplete.end}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10) });

  const load = useCallback(async () => {
    const res = await api(`/api/v1/properties/${pid}/utility-statements`, 'GET');
    if (res.ok) {
      setRows(res.data.statements);
      setSendingEnabled(res.data.tenantSendingEnabled === true);
    }
  }, [pid]);

  useEffect(() => {
    void load();
  }, [load]);

  async function call(url: string, body: unknown, done: string) {
    setError(null);
    setInfo(null);
    const res = await api(url, 'POST', body);
    if (!res.ok) return setError(errorMessage(res.data));
    setInfo(done + (res.data?.deliveryConfigured === false ? ' (email delivery is not configured on this server, so nothing left it).' : ''));
    void load();
  }

  return (
    <Panel title="Utility statements" description="Monthly statements for tenants and owners — reviewed before anyone receives them">
      <p className={`${noteClass} mb-3`}>
        Statements are built only from <strong>approved</strong> charges. A tenant sees their statement in the tenant app once you approve it.
        {sendingEnabled ? ' Emailing statements is enabled on this server: Send emails the approved PDF to the tenant.' : ' Emailing statements is switched off; download the PDF to share it.'}
      </p>
      {error ? <div className={`${errorClass} mb-3`} role="alert">{error}</div> : null}
      {info ? <p className="mb-3 text-xs text-muted-foreground" role="status">{info}</p> : null}
      {canManage ? (
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <label className={labelClass}>
            From
            <input className={inputClass} type="date" value={period.periodStart} onChange={(e) => setPeriod({ ...period, periodStart: e.target.value })} />
          </label>
          <label className={labelClass}>
            To (exclusive)
            <input className={inputClass} type="date" value={period.periodEnd} onChange={(e) => setPeriod({ ...period, periodEnd: e.target.value })} />
          </label>
          <Button size="sm" onClick={() => void call(`/api/v1/properties/${pid}/utility-statements`, { ...period, audience: 'tenant' }, 'Tenant statements prepared as drafts.')}>Prepare tenant statements</Button>
          <Button size="sm" variant="secondary" onClick={() => void call(`/api/v1/properties/${pid}/utility-statements`, { ...period, audience: 'owner' }, 'Owner report prepared as a draft.')}>Prepare owner report</Button>
        </div>
      ) : null}
      {rows.length === 0 ? <p className="text-sm text-muted-foreground">No statements yet.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-muted-foreground">
              <tr>
                <th className="py-1 pr-2 font-medium">For</th>
                <th className="py-1 pr-2 font-medium">Period</th>
                <th className="py-1 pr-2 font-medium">Total</th>
                <th className="py-1 pr-2 font-medium">Status</th>
                <th className="py-1 pr-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const url = `/api/v1/properties/${pid}/utility-statements/${s.id}`;
                return (
                  <tr key={s.id} className="border-t border-light-border dark:border-dark-border">
                    <td className="py-1 pr-2">{s.audience === 'owner' ? 'Owner report' : `${s.tenantName ?? 'Tenant'}${s.unitLabel ? ` · ${s.unitLabel}` : ''}`}</td>
                    <td className="py-1 pr-2">{s.period_start} → {s.period_end}</td>
                    <td className="py-1 pr-2">{s.total === null ? '—' : fmtRand(Number(s.total))}</td>
                    <td className="py-1 pr-2">
                      <Badge tone={TONE[s.status]}>{s.status}</Badge>
                      {s.sent_at ? <div className="text-[11px] text-muted-foreground">sent {fmtDateTime(s.sent_at)}</div> : null}
                    </td>
                    <td className="py-1 pr-2">
                      <div className="flex flex-wrap gap-2">
                        <a className="underline" href={url} target="_blank" rel="noreferrer">PDF</a>
                        {canManage && s.status === 'draft' ? <button className="underline" onClick={() => void call(url, { action: 'approve' }, 'Approved.')}>approve</button> : null}
                        {canManage && s.status === 'approved' && s.audience === 'tenant' && sendingEnabled ? (
                          <button className="underline" onClick={() => window.confirm('Email this statement to the tenant?') && void call(url, { action: 'send' }, 'Sent.')}>send</button>
                        ) : null}
                        {canManage && s.status !== 'void' ? <button className="underline" onClick={() => window.confirm('Void this statement? You can prepare it again.') && void call(url, { action: 'void' }, 'Voided.')}>void</button> : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
