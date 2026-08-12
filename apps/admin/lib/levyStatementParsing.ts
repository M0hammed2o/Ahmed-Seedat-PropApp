import 'server-only';

// Levy/body-corporate statement line-item heuristic parser (PHASE 10/11, WORKLOG.md this date).
//
// Deliberately disclosed as a heuristic, NOT a Textract/Google Document AI native feature -- no
// real vendor account exists in this environment (same external-service blocker as every other
// provider in this codebase), and neither DocumentIntelligenceProvider implementation has a
// structured multi-line-item extraction shape at all: extractFields() returns a fixed set of
// named fields (supplierName/amountDue/dueDate/...), correct for a single-vendor bill but wrong
// for a statement with a dozen variably-worded charge/payment/credit lines. Reusing extractFields()
// here would either misrepresent what the provider actually returns or require inventing a
// provider capability that has never been verified against a live response -- both violate "do not
// fabricate integrations or claim provider behavior that has not been verified".
//
// Instead this reuses extractText() (every provider, including the two real ones, already
// implements this generically -- no document-type branching involved) and applies the SAME kind of
// disclosed keyword/regex heuristic documentIntelligence.ts's own classifyFromText() already uses
// for document classification, just applied line-by-line. Every result is `source: 'ocr_heuristic'`
// with a deliberately low, fixed confidence -- staff review/correct before "review" is possible at
// all (POST .../review), and nothing here is ever auto-posted to accounting.
export interface ParsedLevyLineItem {
  lineType: 'charge' | 'payment' | 'credit';
  category: string;
  description: string;
  amount: number;
  confidence: number;
}

const HEURISTIC_CONFIDENCE = 0.4;

// A trailing monetary amount: optional "R"/"ZAR" currency marker, digits with optional
// thousands-comma-separators and a decimal portion, optional trailing/leading minus sign or
// parenthesised-negative convention (common in accounting statements).
const AMOUNT_PATTERN = /(-?\(?R?\s?[\d][\d,]*\.\d{2}\)?-?)\s*$/i;

const PAYMENT_KEYWORDS = /\bpayment\s+received\b|\bpayment\b/i;
const CREDIT_KEYWORDS = /\bcredit\b|\brefund\b/i;

function parseAmount(raw: string): number | null {
  const isNegative = /^-|\(.*\)|-$/.test(raw.trim());
  const cleaned = raw.replace(/[^\d.]/g, '');
  const value = Number.parseFloat(cleaned);
  if (!Number.isFinite(value)) return null;
  return isNegative ? -Math.abs(value) : value;
}

function categorize(description: string): string {
  const text = description.toLowerCase();
  if (/\bcsos\b/.test(text)) return 'csos_levy';
  if (/\bcommon\b.*\bwater\b/.test(text)) return 'common_water';
  if (/\bunit\b.*\bwater\b|\bwater\b/.test(text)) return 'unit_water';
  if (/\belectric/.test(text)) return 'electricity';
  if (/\bsewer/.test(text)) return 'sewer';
  // Special levy checked BEFORE the generic levy fallback -- "special levy" also contains the
  // word "levy", so the order here matters: a more specific match must win.
  if (/\bspecial\s+levy\b/.test(text)) return 'special_levy';
  if (/\blevy\b/.test(text)) return 'monthly_levy';
  if (/\bpenalt/.test(text)) return 'penalty';
  if (/\binterest\b/.test(text)) return 'interest';
  if (/\bpayment\b/.test(text)) return 'payment_received';
  return 'other';
}

/**
 * Best-effort line-item extraction from raw OCR'd statement text. Never throws -- a line that
 * doesn't match the trailing-amount pattern is simply skipped (staff can always add a missed line
 * manually during review), matching "never fabricate a result for a line that couldn't actually be
 * parsed" rather than guessing.
 */
export function parseLevyStatementLineItems(rawText: string): ParsedLevyLineItem[] {
  const lines = rawText
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const items: ParsedLevyLineItem[] = [];
  for (const line of lines) {
    const match = AMOUNT_PATTERN.exec(line);
    if (!match) continue;

    const amount = parseAmount(match[1]!);
    if (amount === null) continue;

    const description = line
      .slice(0, match.index)
      .trim()
      .replace(/[:\-–]+$/, '')
      .trim();
    if (description.length === 0) continue;

    const lineType: ParsedLevyLineItem['lineType'] =
      amount < 0 || PAYMENT_KEYWORDS.test(description)
        ? 'payment'
        : CREDIT_KEYWORDS.test(description)
          ? 'credit'
          : 'charge';

    items.push({
      lineType,
      category: categorize(description),
      description,
      amount: Math.abs(amount),
      confidence: HEURISTIC_CONFIDENCE,
    });
  }
  return items;
}
