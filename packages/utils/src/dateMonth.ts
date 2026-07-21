const MONTH_LABELS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

export function monthLabel(month: number): string {
  const label = MONTH_LABELS[month - 1];
  if (!label) throw new RangeError(`month must be 1-12, got ${month}`);
  return label;
}

export interface YearMonth {
  year: number;
  month: number; // 1-12
}

export function currentYearMonth(now: Date = new Date()): YearMonth {
  return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };
}

export function formatYearMonth({ year, month }: YearMonth): string {
  return `${monthLabel(month)} ${year}`;
}

export function isOverdue(dueDateIso: string | null, now: Date = new Date()): boolean {
  if (!dueDateIso) return false;
  return new Date(dueDateIso).getTime() < now.getTime();
}

export function isSameYearMonth(a: YearMonth | null, b: YearMonth | null): boolean {
  if (!a || !b) return false;
  return a.year === b.year && a.month === b.month;
}
