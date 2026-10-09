import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { buildMunicipalReport, renderEvidencePdf, renderReportPdf, type ReportPoint } from '../municipalReport';
import { sastInstant } from '../consumption';

// Meter evidence: the evidence PDF embeds the photo beside the reading, and municipal packs say
// whether a photo was actually reviewed. With GENERATE_SMART_UTILITY_EXAMPLES=1 the same code
// writes the example reports to docs/examples/ (synthetic meter image — not a real meter).

async function sampleMeterPhoto(): Promise<Buffer> {
  // A drawn water-meter face (synthetic; clearly labelled as an example).
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480">
    <rect width="640" height="480" fill="#2b3a42"/>
    <circle cx="320" cy="240" r="200" fill="#e9eef2" stroke="#111" stroke-width="8"/>
    <text x="320" y="130" font-family="Arial" font-size="26" text-anchor="middle" fill="#333">SAMPLE IMAGE — kL</text>
    <rect x="170" y="200" width="300" height="70" fill="#111"/>
    <text x="320" y="252" font-family="Courier New" font-size="54" text-anchor="middle" fill="#fff">01035</text>
    <rect x="400" y="200" width="70" height="70" fill="#b00020"/>
    <text x="435" y="252" font-family="Courier New" font-size="54" text-anchor="middle" fill="#fff">5</text>
    <text x="320" y="330" font-family="Arial" font-size="22" text-anchor="middle" fill="#333">Meter TSH-W-0001 · SN 9988</text>
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 85 }).toBuffer();
}

describe('meter evidence', () => {
  it('renders an evidence PDF with an embedded JPEG photo', async () => {
    const photo = await sampleMeterPhoto();
    const pdf = await renderEvidencePdf({
      propertyName: 'Example Block (sample)',
      propertyAddress: '1 Example Street, Pretoria',
      meterLabel: 'main — Boundary box, left of gate',
      meterNumber: 'TSH-W-0001',
      serialNumber: '9988',
      utilityType: 'water',
      reading: 1035.5,
      unit: 'kL',
      readAt: '2026-10-20T08:15:00Z',
      submittedBy: 'Caretaker (example)',
      source: 'manual',
      verificationStatus: 'verified',
      verifiedBy: 'Property manager (example)',
      verifiedAt: '2026-10-20T10:00:00Z',
      note: 'Digits clearly visible; matches previous trend.',
      image: photo,
      imageCaption: 'Original photo: meter.jpg (synthetic example image)',
    });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    // An embedded JPEG makes the file substantially larger than a text-only page.
    const noPhoto = await renderEvidencePdf({
      propertyName: 'x', propertyAddress: 'x', meterLabel: 'x', meterNumber: null, serialNumber: null,
      utilityType: 'water', reading: 1, unit: 'kL', readAt: '2026-10-20T08:15:00Z', submittedBy: null,
      source: 'manual', verificationStatus: 'unverified', verifiedBy: null, verifiedAt: null, note: null,
      image: null, imageCaption: 'No photo',
    });
    expect(pdf.length).toBeGreaterThan(noPhoto.length + 5_000);

    if (process.env.GENERATE_SMART_UTILITY_EXAMPLES === '1') {
      const dir = path.resolve(__dirname, '../../../../../docs/examples');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'meter-evidence-report-example.pdf'), pdf);
      const report = buildMunicipalReport({
        propertyName: 'Example Block (sample)',
        propertyAddress: '1 Example Street, Pretoria',
        preparedFor: 'Example Properties (Pty) Ltd',
        municipality: { code: 'tshwane', name: 'City of Tshwane' },
        municipalAccountNumber: '5000000000 (example)',
        periodStart: sastInstant(2026, 9, 25),
        periodEnd: sastInstant(2026, 10, 25),
        meters: [{
          meterId: 'm1', utilityType: 'water', meterNumber: 'TSH-W-0001', serialNumber: '9988', registerDigits: null,
          points: [
            { readAt: '2026-09-24T08:00:00Z', rawValue: 1010000, value: 1010000, multiplier: 1, status: 'valid', source: 'manual', documentId: 'd0', verificationStatus: 'verified' },
            { readAt: '2026-10-20T08:15:00Z', rawValue: 1035500, value: 1035500, multiplier: 1, status: 'valid', source: 'manual', documentId: 'd1', verificationStatus: 'verified' },
          ],
        }],
        now: new Date('2026-10-20T10:00:00Z'),
      });
      const pack = await renderReportPdf(report, { images: [{ meterId: 'm1', buffer: photo, caption: 'Meter photo, 2026-10-20 (synthetic example image)' }] });
      fs.writeFileSync(path.join(dir, 'municipal-reading-pack-example.pdf'), pack);
    }
  });

  it('distinguishes a reviewed photo from an unreviewed one in the municipal pack', () => {
    const mk = (verificationStatus: ReportPoint['verificationStatus']) =>
      buildMunicipalReport({
        propertyName: 'P', propertyAddress: 'A', preparedFor: null, municipality: null, municipalAccountNumber: null,
        periodStart: sastInstant(2026, 9, 25), periodEnd: sastInstant(2026, 10, 25),
        meters: [{
          meterId: 'm', utilityType: 'water', meterNumber: 'W', serialNumber: null, registerDigits: null,
          points: [{ readAt: '2026-10-20T08:00:00Z', rawValue: 5, value: 5, multiplier: 1, status: 'valid', source: 'manual', documentId: 'd', verificationStatus }],
        }],
      }).meters[0]!.verificationNote;
    expect(mk('verified')).toMatch(/reviewed\.$/);
    expect(mk('unverified')).toMatch(/not yet reviewed/);
  });
});
