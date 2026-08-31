import 'server-only';
import PDFDocument from 'pdfkit';

/**
 * P1 "Professional tenant invoice PDF" (WORKLOG.md this date, final hardening pass). Pure
 * renderer, same contract as subscriptionInvoicePdf.ts's renderSubscriptionInvoicePdf(): data in,
 * Buffer out, no database access inside this file at all -- the caller (GET
 * /api/v1/invoices/:id/pdf) is responsible for RLS-safe fetching and authorization, and for
 * choosing presentation_snapshot (an already-issued invoice) vs live organizations columns (a
 * draft, previewed before issue) as the source of the org-branding fields below. Never invents a
 * value: address/registration/VAT/contact/payment-instructions are each only rendered when the
 * caller actually passed one through -- an absent field is simply omitted, never a placeholder.
 */
export interface InvoicePdfLineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
}

export interface InvoicePdfData {
  invoiceNumber: string;
  status: 'draft' | 'issued';
  invoiceDate: string;
  dueDate: string;
  reference: string | null;
  description: string | null;
  notes: string | null;
  lineItems: InvoicePdfLineItem[];
  amount: number;
  currency: string;
  tenantName: string;
  propertyNickname: string | null;
  unitLabel: string | null;
  org: {
    displayName: string;
    address: string | null;
    cipcRegNo: string | null;
    vatNo: string | null;
    contactName: string | null;
    contactPhone: string | null;
    contactEmail: string | null;
    paymentInstructions: string | null;
    footer: string | null;
  };
}

function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-ZA', { style: 'currency', currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-ZA', { year: 'numeric', month: 'long', day: 'numeric' });
}

export function renderInvoicePdf(data: InvoicePdfData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header: org identity (left), invoice meta (right) -- mirrors subscriptionInvoicePdf.ts's own
    // left/right split, only every field here is the ORG's own configured detail, never Proplyst's.
    doc.fontSize(18).font('Helvetica-Bold').text(data.org.displayName, 50, 50, { width: 300 });
    let orgY = 72;
    doc.fontSize(9).font('Helvetica').fillColor('#444444');
    if (data.org.address) {
      doc.text(data.org.address, 50, orgY, { width: 280 });
      orgY += 13 * Math.max(1, Math.ceil(data.org.address.length / 60));
    }
    if (data.org.cipcRegNo) {
      doc.text(`Reg no: ${data.org.cipcRegNo}`, 50, orgY, { width: 280 });
      orgY += 13;
    }
    if (data.org.vatNo) {
      doc.text(`VAT no: ${data.org.vatNo}`, 50, orgY, { width: 280 });
      orgY += 13;
    }
    if (data.org.contactName || data.org.contactPhone || data.org.contactEmail) {
      const contactLine = [data.org.contactName, data.org.contactPhone, data.org.contactEmail]
        .filter(Boolean)
        .join(' · ');
      doc.text(contactLine, 50, orgY, { width: 280 });
      orgY += 13;
    }
    doc.fillColor('#000000');

    doc.fontSize(16).font('Helvetica-Bold').text('INVOICE', 350, 50, { width: 195, align: 'right' });
    doc.fontSize(9).font('Helvetica');
    let metaY = 74;
    doc.text(`Invoice number: ${data.invoiceNumber}`, 350, metaY, { width: 195, align: 'right' });
    metaY += 13;
    if (data.status === 'draft') {
      doc.font('Helvetica-Bold').text('DRAFT -- NOT YET ISSUED', 350, metaY, { width: 195, align: 'right' });
      doc.font('Helvetica');
      metaY += 13;
    }
    doc.text(`Invoice date: ${formatDate(data.invoiceDate)}`, 350, metaY, { width: 195, align: 'right' });
    metaY += 13;
    doc.text(`Due date: ${formatDate(data.dueDate)}`, 350, metaY, { width: 195, align: 'right' });
    metaY += 13;
    if (data.reference) {
      doc.text(`Reference: ${data.reference}`, 350, metaY, { width: 195, align: 'right' });
      metaY += 13;
    }

    // Bill to
    const billToY = Math.max(orgY, metaY) + 20;
    doc.fontSize(9).font('Helvetica-Bold').text('Bill to', 50, billToY);
    doc.font('Helvetica').text(data.tenantName, 50, billToY + 14);
    const propertyLine = [data.propertyNickname, data.unitLabel].filter(Boolean).join(' · ');
    if (propertyLine) {
      doc.text(propertyLine, 50, billToY + 28);
    }

    if (data.description) {
      doc.fontSize(9).font('Helvetica').text(data.description, 50, billToY + 50, { width: 495 });
    }

    // Line item table
    const tableTop = billToY + 80;
    doc.fontSize(9).font('Helvetica-Bold');
    doc.text('Description', 50, tableTop);
    doc.text('Qty', 350, tableTop, { width: 50, align: 'right' });
    doc.text('Rate', 405, tableTop, { width: 65, align: 'right' });
    doc.text('Amount', 475, tableTop, { width: 70, align: 'right' });
    doc.moveTo(50, tableTop + 14).lineTo(545, tableTop + 14).strokeColor('#dddddd').stroke();

    doc.font('Helvetica').fontSize(9);
    let rowY = tableTop + 22;
    for (const line of data.lineItems) {
      doc.text(line.description, 50, rowY, { width: 290 });
      doc.text(String(line.quantity), 350, rowY, { width: 50, align: 'right' });
      doc.text(formatMoney(line.unitPrice, data.currency), 405, rowY, { width: 65, align: 'right' });
      doc.text(formatMoney(line.amount, data.currency), 475, rowY, { width: 70, align: 'right' });
      rowY += 16;
    }

    rowY += 8;
    doc.moveTo(50, rowY).lineTo(545, rowY).strokeColor('#dddddd').stroke();
    rowY += 10;

    doc.font('Helvetica-Bold').fontSize(10);
    doc.text('Total', 405, rowY, { width: 65, align: 'right' });
    doc.text(formatMoney(data.amount, data.currency), 475, rowY, { width: 70, align: 'right' });
    rowY += 30;

    if (data.org.paymentInstructions) {
      doc.font('Helvetica-Bold').fontSize(9).text('Payment instructions', 50, rowY, { width: 495 });
      rowY += 14;
      doc.font('Helvetica').fontSize(9).text(data.org.paymentInstructions, 50, rowY, { width: 495 });
      rowY += 14 * Math.max(1, Math.ceil(data.org.paymentInstructions.length / 90));
    }

    if (data.notes) {
      rowY += 10;
      doc.font('Helvetica-Bold').fontSize(9).text('Notes', 50, rowY, { width: 495 });
      rowY += 14;
      doc.font('Helvetica').fontSize(9).text(data.notes, 50, rowY, { width: 495 });
    }

    if (data.org.footer) {
      doc
        .font('Helvetica')
        .fontSize(8)
        .fillColor('#999999')
        .text(data.org.footer, 50, 750, { width: 495, align: 'center' });
    }

    doc.end();
  });
}
