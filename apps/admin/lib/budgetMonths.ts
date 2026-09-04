/** Last 12 months including the current one, newest first -- {value: 'YYYY-MM-01', label}. */
export function lastTwelveMonthOptions(now: Date = new Date()): { value: string; label: string }[] {
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
    const label = d.toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' });
    return { value, label };
  });
}
