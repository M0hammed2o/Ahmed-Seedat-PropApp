/**
 * Staff seat pricing (WORKLOG.md this date, owner subscription + staff seat entitlement
 * architecture). A staff seat is billed to the SUBSCRIBING ORGANIZATION, never the staff member
 * themselves — this is the one place that number lives, so it is never hardcoded a second time in
 * a route handler or a UI component (e.g. StaffAccessPanel's seat-summary display imports this
 * rather than writing "R100" itself).
 *
 * `TO_BE_CONFIRMED`-style pricing decisions live with Mohammed, same convention
 * `planLimits.ts`'s `PROPVAULT_BASE_PLAN` already uses — the number below is the concrete target
 * price given for this task ("approximately R100 per staff member per month"), not yet a final,
 * billed price: no payment provider charges this amount anywhere in this codebase.
 */
export const STAFF_SEAT_MONTHLY_PRICE = {
  amount: 100,
  currency: 'ZAR' as const,
} as const;
