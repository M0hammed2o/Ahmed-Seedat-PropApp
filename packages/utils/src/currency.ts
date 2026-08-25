export function formatCurrency(amount: number, currencyCode = 'ZAR', locale = 'en-ZA'): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: currencyCode }).format(
    amount,
  );
}

/**
 * Deterministic en-ZA number formatting for text rendered on both the server and client.
 *
 * Render's Linux ICU and Chromium's ICU disagree on the en-ZA thousands separator (comma vs
 * non-breaking space). Calling `toLocaleString('en-ZA')` inside a Client Component therefore
 * produces a React hydration mismatch in production even though both values are otherwise valid.
 * This formatter follows the browser's South African presentation explicitly: NBSP groups and a
 * comma decimal separator, independent of the host operating system's ICU data.
 */
export function formatSouthAfricanNumber(
  amount: number,
  options: { minimumFractionDigits?: number; maximumFractionDigits?: number } = {},
): string {
  if (!Number.isFinite(amount)) return String(amount);

  const minimumFractionDigits = Math.max(0, Math.min(20, options.minimumFractionDigits ?? 0));
  const maximumFractionDigits = Math.max(
    minimumFractionDigits,
    Math.min(20, options.maximumFractionDigits ?? 2),
  );
  const fixed = Math.abs(amount).toFixed(maximumFractionDigits);
  const [whole = '0', initialFraction = ''] = fixed.split('.');
  let fraction = initialFraction;
  while (fraction.length > minimumFractionDigits && fraction.endsWith('0')) {
    fraction = fraction.slice(0, -1);
  }

  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0');
  const sign = amount < 0 ? '-' : '';
  return `${sign}${grouped}${fraction ? `,${fraction}` : ''}`;
}
