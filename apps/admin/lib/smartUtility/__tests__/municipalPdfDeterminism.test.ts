import { it, expect, vi } from 'vitest';
vi.mock('server-only', () => ({}));
// MUN-A: a retry re-renders the approved report; the PDF must be byte-identical, not merely look the same.
it('the municipal PDF is byte-identical when re-rendered later', async () => {
  const { renderReportPdf } = await import('../municipalReport');
  const r = { version: 1, generatedAt: '2026-10-01T00:00:00Z', property: { name: 'x', address: 'y' }, preparedFor: null, municipality: null, municipalAccountNumber: null, period: { start: '2026-09-01', end: '2026-09-30' }, meters: [], notes: [] } as never;
  const a = await renderReportPdf(r); await new Promise((res) => setTimeout(res, 1100)); const b = await renderReportPdf(r);
  expect(a.equals(b)).toBe(true);
});
