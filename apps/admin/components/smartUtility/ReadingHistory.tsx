'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { api, Badge, errorMessage, fmtDateTime, fmtNumber, meterLabel, type MeterSummary, type Overview } from './shared';

// Per-meter reading history with evidence review (docs/SMART_UTILITIES_PROGRESS.md §8). Person-entered
// readings stay "unverified" until someone with utilities rights checks the photo/dial; rejected
// readings drop out of every calculation.

interface ReadingRow {
  id: string;
  readAt: string;
  reading: number;
  source: string;
  status: string;
  statusReason: string | null;
  documentId: string | null;
  verificationStatus: 'not_required' | 'unverified' | 'verified' | 'rejected';
  verifiedAt: string | null;
  verificationNote: string | null;
}

const VERIFY_TONE = { not_required: 'neutral', unverified: 'warn', verified: 'good', rejected: 'bad' } as const;
const VERIFY_LABEL = { not_required: 'Device reading', unverified: 'Unverified', verified: 'Verified', rejected: 'Rejected' } as const;

export function ReadingHistory({ data, meter, canManage, onClose }: { data: Overview; meter: MeterSummary; canManage: boolean; onClose: () => void }) {
  const [rows, setRows] = useState<ReadingRow[] | null>(null);
  const [unit, setUnit] = useState(meter.displayUnit);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await api(`/api/v1/smart-meters/${meter.id}/telemetry`, 'GET');
    if (!res.ok) return setError(errorMessage(res.data));
    setUnit(res.data.displayUnit);
    setRows(res.data.readings as ReadingRow[]);
  }, [meter.id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function review(id: string, decision: 'verified' | 'rejected') {
    const note = decision === 'rejected' ? window.prompt('Why is this reading rejected?') : null;
    if (decision === 'rejected' && note === null) return;
    const res = await api(`/api/v1/meter-readings/${id}`, 'POST', { decision, note: note || null });
    if (!res.ok) return setError(errorMessage(res.data));
    void load();
  }

  return (
    <div className="mb-4 space-y-2 rounded-md border border-light-border p-4 dark:border-dark-border">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium text-foreground">Readings — {meterLabel(meter, data.units)}</div>
        <Button size="sm" variant="secondary" onClick={onClose}>Close</Button>
      </div>
      {error ? <p className="text-xs text-light-danger dark:text-dark-danger">{error}</p> : null}
      {!rows ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">No readings yet.</p>
      ) : (
        <div className="max-h-96 overflow-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-muted-foreground">
              <tr>
                <th className="py-1 pr-2 font-medium">When</th>
                <th className="py-1 pr-2 font-medium">Reading ({unit})</th>
                <th className="py-1 pr-2 font-medium">Source</th>
                <th className="py-1 pr-2 font-medium">Evidence</th>
                <th className="py-1 pr-2 font-medium">Status</th>
                {canManage ? <th /> : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-light-border align-top dark:border-dark-border">
                  <td className="py-1 pr-2">{fmtDateTime(r.readAt)}</td>
                  <td className="py-1 pr-2">{fmtNumber(r.reading, 3)}</td>
                  <td className="py-1 pr-2">{r.source === 'manual' ? 'Entered by hand' : r.source === 'simulator' ? 'Simulator' : 'Device'}</td>
                  <td className="py-1 pr-2">
                    {r.documentId ? 'Photo' : '—'}
                    {r.source === 'manual' ? (
                      <a className="ml-1 underline" href={`/api/v1/meter-readings/${r.id}/evidence`} target="_blank" rel="noreferrer">PDF</a>
                    ) : null}
                  </td>
                  <td className="py-1 pr-2">
                    <Badge tone={VERIFY_TONE[r.verificationStatus]}>{VERIFY_LABEL[r.verificationStatus]}</Badge>
                    {r.status === 'suspect' ? <div className="text-[11px] text-muted-foreground">Flagged: {r.statusReason}</div> : null}
                    {r.verificationNote ? <div className="text-[11px] text-muted-foreground">{r.verificationNote}</div> : null}
                  </td>
                  {canManage ? (
                    <td className="py-1">
                      {r.verificationStatus === 'unverified' ? (
                        <div className="flex gap-1">
                          <Button size="sm" variant="secondary" onClick={() => void review(r.id, 'verified')}>Verify</Button>
                          <Button size="sm" variant="secondary" onClick={() => void review(r.id, 'rejected')}>Reject</Button>
                        </div>
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">Verify only after checking the photo or the meter dial. Rejected readings are excluded from consumption, reports and charges.</p>
    </div>
  );
}
