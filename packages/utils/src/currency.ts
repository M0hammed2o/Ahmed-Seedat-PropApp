export function formatCurrency(amount: number, currencyCode = 'ZAR', locale = 'en-ZA'): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: currencyCode }).format(
    amount,
  );
}
