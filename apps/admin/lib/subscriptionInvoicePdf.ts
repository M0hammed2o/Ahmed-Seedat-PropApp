import 'server-only';
import PDFDocument from 'pdfkit';
import { branding, platformBillingEntity } from '@propvault/config';

/**
 * V1 billing invoice pass (WORKLOG.md this date): renders a branded Proplyst PDF for a single
 * subscription_invoices row. A pure renderer -- takes already-fetched, already-authorized data
 * (the caller, an authenticated API route, is responsible for RLS-safe fetching and the org-access
 * check; this module never queries the database itself).
 *
 * Document title is "Payment Receipt" by default -- every row this ever renders already has
 * status 'paid' or 'refunded' (the invoice is only ever created once a payment is confirmed; V1
 * never generates a pre-payment bill), so "receipt" is the accurate word, not "invoice" in the
 * sense of "money owed." Never labelled "Tax Invoice" unless platformBillingEntity.vatNumber is
 * actually set -- do not fabricate VAT registration.
 */

export interface SubscriptionInvoicePdfData {
  invoiceNumber: string;
  invoiceType: 'new_subscription' | 'renewal' | 'upgrade' | 'reactivation';
  status: 'paid' | 'refunded';
  issuedAt: string;
  paidAt: string;
  currency: string;
  subtotal: number;
  discountAmount: number;
  total: number;
  billingPeriodStart: string;
  billingPeriodEnd: string;
  orgName: string;
  planName: string;
  /** Only present for invoiceType 'upgrade'/'reactivation' -- the plan being changed FROM. */
  previousPlanName: string | null;
  /** Only present for invoiceType 'upgrade'/'reactivation' -- the target plan's own full
   *  recurring price, shown for context ONLY, never substituted for `total` as "amount paid now". */
  newPlanRecurringPrice: number | null;
  /** Opaque gateway reference (e.g. a PayFast token) -- not a secret, just an audit trail. */
  paymentReference: string | null;
  /** Overnight V1 completion pass, Part E: 'trial_activation' means this "new_subscription"-typed
   * invoice is actually the once-off R5 card-verification fee, not a real subscription charge --
   * see subscription_payments.purpose and create_subscription_invoice_for_payment() (migration
   * 20260101000108), which deliberately doesn't distinguish the two at the invoice_type level. */
  paymentPurpose: string | null;
}

function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-ZA', { style: 'currency', currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-ZA', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function lineItemDescription(data: SubscriptionInvoicePdfData): string[] {
  if (data.invoiceType === 'new_subscription' && data.paymentPurpose === 'trial_activation') {
    return [
      'Card verification fee (once-off)',
      `${data.planName} plan -- 30-day free trial starts today, first subscription charge only after the trial ends`,
    ];
  }
  switch (data.invoiceType) {
    case 'new_subscription':
      return [`${data.planName} plan subscription`];
    case 'renewal':
      return [
        `${data.planName} plan — renewal`,
        `Billing period: ${formatDate(data.billingPeriodStart)} – ${formatDate(data.billingPeriodEnd)}`,
      ];
    case 'upgrade': {
      const lines = [`${data.planName} plan upgrade`];
      if (data.previousPlanName) lines.push(`Previous plan: ${data.previousPlanName}`);
      if (data.newPlanRecurringPrice !== null) {
        lines.push(
          `New recurring price: ${formatMoney(data.newPlanRecurringPrice, data.currency)}/month`,
        );
      }
      lines.push(
        `Prorated upgrade charge for remaining period: ${formatMoney(data.total, data.currency)}`,
      );
      return lines;
    }
    case 'reactivation':
      return [`${data.planName} plan reactivation`];
    default:
      return [`${data.planName} plan`];
  }
}

export function renderSubscriptionInvoicePdf(data: SubscriptionInvoicePdfData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const documentTitle = platformBillingEntity.vatNumber ? 'Tax Invoice' : 'Payment Receipt';

    // Header
    doc.fontSize(20).font('Helvetica-Bold').text(branding.productName, 50, 50);
    doc.fontSize(9).font('Helvetica').fillColor('#666666').text(branding.tagline, 50, 74);
    doc.fillColor('#000000');

    doc.fontSize(14).font('Helvetica-Bold').text(documentTitle, 50, 110);
    doc.fontSize(9).font('Helvetica');
    doc.text(`Invoice number: ${data.invoiceNumber}`, 50, 132);
    doc.text(`Issued: ${formatDate(data.issuedAt)}`, 50, 146);
    if (data.status === 'paid') {
      doc.text(`Paid: ${formatDate(data.paidAt)}`, 50, 160);
    }

    // Proplyst's own legal/billing entity details -- only rendered where actually confirmed,
    // never fabricated (platformBillingEntity's own header comment).
    let entityY = 110;
    doc.fontSize(9).font('Helvetica');
    if (platformBillingEntity.legalEntityName) {
      doc.text(platformBillingEntity.legalEntityName, 350, entityY, { width: 195, align: 'right' });
      entityY += 13;
    }
    if (platformBillingEntity.registeredAddress) {
      doc.text(platformBillingEntity.registeredAddress, 350, entityY, {
        width: 195,
        align: 'right',
      });
      entityY += 13;
    }
    if (platformBillingEntity.companyRegistrationNumber) {
      doc.text(`Reg no: ${platformBillingEntity.companyRegistrationNumber}`, 350, entityY, {
        width: 195,
        align: 'right',
      });
      entityY += 13;
    }
    if (platformBillingEntity.vatNumber) {
      doc.text(`VAT no: ${platformBillingEntity.vatNumber}`, 350, entityY, {
        width: 195,
        align: 'right',
      });
      entityY += 13;
    }
    doc.text(branding.websiteUrl, 350, entityY, { width: 195, align: 'right' });

    // Bill to
    doc.fontSize(9).font('Helvetica-Bold').text('Billed to', 50, 190);
    doc.font('Helvetica').text(data.orgName, 50, 204);

    // Status pill (text-only, no fabricated colour semantics beyond a simple label)
    doc
      .fontSize(9)
      .font('Helvetica-Bold')
      .text(`Status: ${data.status === 'paid' ? 'PAID' : 'REFUNDED'}`, 50, 228);

    // Line item table
    const tableTop = 260;
    doc.fontSize(9).font('Helvetica-Bold');
    doc.text('Description', 50, tableTop);
    doc.text('Amount', 460, tableTop, { width: 85, align: 'right' });
    doc
      .moveTo(50, tableTop + 14)
      .lineTo(545, tableTop + 14)
      .strokeColor('#dddddd')
      .stroke();

    const description = lineItemDescription(data);
    doc.font('Helvetica').fontSize(9);
    let rowY = tableTop + 22;
    description.forEach((line, idx) => {
      doc.text(line, 50, rowY, { width: 390 });
      if (idx === 0) {
        doc.text(formatMoney(data.subtotal, data.currency), 460, rowY, {
          width: 85,
          align: 'right',
        });
      }
      rowY += 14;
    });

    rowY += 8;
    doc.moveTo(50, rowY).lineTo(545, rowY).strokeColor('#dddddd').stroke();
    rowY += 10;

    if (data.discountAmount > 0) {
      doc.text('Discount', 350, rowY, { width: 100 });
      doc.text(`-${formatMoney(data.discountAmount, data.currency)}`, 460, rowY, {
        width: 85,
        align: 'right',
      });
      rowY += 16;
    }

    doc.font('Helvetica-Bold').fontSize(10);
    doc.text(data.status === 'paid' ? 'Total paid' : 'Total (refunded)', 350, rowY, { width: 100 });
    doc.text(formatMoney(data.total, data.currency), 460, rowY, { width: 85, align: 'right' });

    if (data.paymentReference) {
      doc
        .font('Helvetica')
        .fontSize(8)
        .fillColor('#666666')
        .text(`Payment reference: ${data.paymentReference}`, 50, rowY + 40);
      doc.fillColor('#000000');
    }

    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor('#999999')
      .text(
        `This ${documentTitle.toLowerCase()} was generated automatically by ${branding.productName} for a confirmed subscription charge and requires no signature.`,
        50,
        750,
        { width: 495, align: 'center' },
      );

    doc.end();
  });
}
