// Month and day boundaries on the financial screens are South African business dates. The server
// (Render) runs in UTC, so `new Date().getMonth()` there is still the previous month until 02:00
// SAST on the 1st -- the same class of bug as the cemetery CI failure fixed in fd250a2.

const SAST_PARTS = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Africa/Johannesburg',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/**
 * The current Africa/Johannesburg wall-clock time as a Date whose LOCAL fields (getFullYear,
 * getMonth, getDate, getHours) read as that wall clock, whatever the server's own time zone. Use it
 * wherever existing code derives calendar months/days from local getters (resolvePeriodRange,
 * monthKey). Do not use its getTime() as a real instant.
 */
export function southAfricanNow(instant: Date = new Date()): Date {
  const parts = Object.fromEntries(
    SAST_PARTS.formatToParts(instant).map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  return new Date(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
}

/** Today's South African business date, YYYY-MM-DD. */
export function southAfricanToday(instant: Date = new Date()): string {
  const d = southAfricanNow(instant);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const SAST_OFFSET_MS = 2 * 60 * 60 * 1000; // Africa/Johannesburg is UTC+2 all year (no daylight saving).

/**
 * The South African business date (YYYY-MM-DD) of a timestamptz string such as
 * `2026-10-31T22:30:00+00:00` (which is 1 November in South Africa). A bare date passes through.
 */
export function southAfricanDateOf(timestamp: string): string {
  if (timestamp.length === 10) return timestamp;
  const ms = Date.parse(timestamp);
  if (Number.isNaN(ms)) return timestamp.slice(0, 10);
  return new Date(ms + SAST_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * A timestamp's South African calendar date as YYYY/MM/DD (the en-ZA layout), for client
 * components. Unlike `toLocaleDateString('en-ZA')` it ignores the runtime's time zone and ICU, so
 * the server render (UTC on Render) and the browser hydration produce the same text -- a document
 * uploaded at 23:00 UTC is the next day in South Africa on both (React error #418 otherwise).
 */
export function formatSouthAfricanDate(value: string | Date): string {
  return southAfricanDateOf(value instanceof Date ? value.toISOString() : value).replaceAll(
    '-',
    '/',
  );
}
