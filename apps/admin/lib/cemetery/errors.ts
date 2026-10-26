import 'server-only';
import { jsonError } from '@/lib/smartUtility/http';

// Maps the cemetery_* exceptions raised by migration 184's functions and triggers to HTTP responses. Deny-by-default
// (same rule as lib/safeError.ts): only these known codes reach the browser, with fixed wording; anything else is
// logged server-side and answered with the caller's generic fallback.

const KNOWN: Record<string, { status: number; message: string }> = {
  cemetery_site_not_found: { status: 404, message: 'Grave site not found.' },
  cemetery_section_not_found: { status: 404, message: 'Section not found.' },
  cemetery_sale_not_found: { status: 404, message: 'Sale not found.' },
  cemetery_purchaser_not_found: { status: 404, message: 'Purchaser not found.' },
  cemetery_site_already_sold: {
    status: 409,
    message: 'This grave site has already been sold. Refresh to see its current status.',
  },
  cemetery_site_unavailable: {
    status: 409,
    message: 'This grave site is marked unavailable and cannot be sold.',
  },
  cemetery_site_reserved_for_other: {
    status: 409,
    message:
      'This grave site is reserved for a different purchaser. Release the reservation first.',
  },
  cemetery_site_not_available: {
    status: 409,
    message: 'Only an available grave site can be reserved or withdrawn.',
  },
  cemetery_site_not_reserved: { status: 409, message: 'This grave site is not reserved.' },
  cemetery_site_not_unavailable: { status: 409, message: 'This grave site is not withdrawn.' },
  cemetery_site_not_sold: {
    status: 409,
    message: 'Record the sale or grant of rights before recording a burial.',
  },
  cemetery_site_full: {
    status: 409,
    message: 'This grave site has no interment left under its burial rules.',
  },
  cemetery_site_has_active_sale: { status: 409, message: 'This grave site has an active sale.' },
  cemetery_site_requires_sale: {
    status: 409,
    message: 'A site can only be marked sold by recording a sale.',
  },
  cemetery_sale_not_active: {
    status: 409,
    message: 'Payments can only be recorded against an active sale.',
  },
  cemetery_payment_exceeds_balance: {
    status: 409,
    message: 'The payment is more than the balance due.',
  },
  cemetery_invalid_price: { status: 400, message: 'The selling price must be greater than zero.' },
  cemetery_invalid_deposit: {
    status: 400,
    message: 'The deposit must be between zero and the selling price.',
  },
  cemetery_invalid_amount: {
    status: 400,
    message: 'The payment amount must be greater than zero.',
  },
  cemetery_reason_required: { status: 400, message: 'Give a reason for withdrawing the site.' },
  cemetery_invalid_site_count: {
    status: 400,
    message: 'A section can have between 1 and 2,000 sites.',
  },
};

export function cemeteryDbError(
  error: { message: string; code?: string },
  fallback: string,
  context: string,
) {
  const code = error.message.split(':')[0]?.trim() ?? '';
  const known = KNOWN[code];
  if (known) {
    // The balance message carries the amount still due, which is useful and not sensitive (the caller can read it).
    const detail =
      code === 'cemetery_payment_exceeds_balance'
        ? error.message.split(':').slice(1).join(':').trim()
        : '';
    return jsonError(
      known.status,
      code,
      detail
        ? `${known.message} (${detail.replace('balance due is', 'Balance due: R')})`
        : known.message,
    );
  }
  if (error.code === '42501')
    return jsonError(403, 'forbidden', 'You do not have permission to do that.');
  if (error.code === '23505') return jsonError(409, 'conflict', 'That record already exists.');
  console.error(`[cemetery] ${context}: ${error.message}`);
  return jsonError(500, 'cemetery_error', fallback);
}
