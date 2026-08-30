import { describe, expect, it } from 'vitest';
import { pickCurrentLease } from '../leasing';

interface Fixture {
  id: string;
  status: string;
  startDate: string;
}

describe('pickCurrentLease', () => {
  it('returns null current and empty history for no leases', () => {
    expect(pickCurrentLease<Fixture>([])).toEqual({ current: null, history: [] });
  });

  it('picks the active lease as current even when an earlier-started lease is more recent by date alone', () => {
    const active: Fixture = { id: 'active', status: 'active', startDate: '2026-01-01' };
    const newerDraft: Fixture = { id: 'newer-draft', status: 'draft', startDate: '2026-06-01' };
    const { current, history } = pickCurrentLease([newerDraft, active]);
    expect(current).toEqual(active);
    expect(history).toEqual([newerDraft]);
  });

  it('picks the most recently STARTED lease as current when none is active -- this is history, not occupancy', () => {
    const older: Fixture = { id: 'older', status: 'expired', startDate: '2025-01-01' };
    const newer: Fixture = { id: 'newer', status: 'expired', startDate: '2026-01-01' };
    const { current, history } = pickCurrentLease([older, newer]);
    expect(current).toEqual(newer);
    expect(history).toEqual([older]);
  });

  it('everything except the single current lease is history, in every other case', () => {
    const a: Fixture = { id: 'a', status: 'expired', startDate: '2024-01-01' };
    const b: Fixture = { id: 'b', status: 'expired', startDate: '2025-01-01' };
    const c: Fixture = { id: 'c', status: 'terminated', startDate: '2023-01-01' };
    const { current, history } = pickCurrentLease([a, b, c]);
    expect(current!.id).toBe('b');
    expect(history.map((h) => h.id).sort()).toEqual(['a', 'c']);
  });
});
