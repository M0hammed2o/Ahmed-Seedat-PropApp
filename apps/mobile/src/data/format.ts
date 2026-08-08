export function formatZar(value: number, options?: { compact?: boolean }): string {
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    maximumFractionDigits: options?.compact ? 0 : 2,
    notation: options?.compact ? 'compact' : 'standard',
  }).format(value);
}

export function formatShortDate(value: string): string {
  return new Intl.DateTimeFormat('en-ZA', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value));
}

export function toE164(callingCode: string, mobileNumber: string): string | null {
  const code = callingCode.replace(/\D/g, '');
  let local = mobileNumber.replace(/\D/g, '');
  if (local.startsWith('0')) local = local.slice(1);
  const candidate = `+${code}${local}`;
  return /^\+[1-9]\d{7,14}$/.test(candidate) ? candidate : null;
}

export function relativeTime(value: string, now = new Date('2026-08-08T08:00:00+02:00')): string {
  const diffHours = Math.max(0, Math.round((now.getTime() - new Date(value).getTime()) / 3_600_000));
  if (diffHours < 1) return 'Just now';
  if (diffHours < 24) return `${diffHours}h ago`;
  const days = Math.round(diffHours / 24);
  return `${days}d ago`;
}
