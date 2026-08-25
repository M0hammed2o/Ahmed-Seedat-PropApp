import { describe, expect, it } from 'vitest';
import PizZip from 'pizzip';
import { mergeLeaseTemplate, type LeaseMergeFields } from '../leaseGeneration';

// leaseGeneration.ts configures docxtemplater with {{double_brace}} delimiters (its own default is
// single braces) to match the merge-field syntax organisations are told to put in their templates.
function buildTemplate(bodyXml: string): Buffer {
  const zip = new PizZip();
  // docxtemplater identifies a valid DOCX via [Content_Types].xml's Override for word/document.xml
  // (plus a root relationship to it) -- a bare empty Content_Types.xml, tried first, failed with
  // "filetype could not be identified" even though pizzip alone reads it fine. This is the minimal
  // structure that actually satisfies docxtemplater's own filetype check.
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  zip.file(
    'word/document.xml',
    `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${bodyXml}</w:body></w:document>`,
  );
  return zip.generate({ type: 'nodebuffer' });
}

function paragraph(text: string): string {
  return `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
}

const FULL_FIELDS: LeaseMergeFields = {
  tenant_full_name: 'Sipho Nkosi',
  property_name: 'Musgrave Flats',
  property_address: '12 Musgrave Rd, Durban',
  unit_label: 'Unit 601',
  monthly_rent: 'R 12,500',
  lease_start_date: '2026-09-01',
  landlord_name: 'Mo\'s Properties',
  organisation_name: 'Mo\'s Properties (Pty) Ltd',
};

describe('mergeLeaseTemplate', () => {
  it('merges known placeholders into the document', () => {
    const template = buildTemplate(paragraph('Tenant: {{tenant_full_name}}, Rent: {{monthly_rent}}'));
    const result = mergeLeaseTemplate(template, FULL_FIELDS);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const zip = new PizZip(result.buffer);
      const xml = zip.file('word/document.xml')!.asText();
      expect(xml).toContain('Sipho Nkosi');
      expect(xml).toContain('R 12,500');
    }
  });

  it('renders an unknown/unfilled optional placeholder as blank, never invented text', () => {
    const template = buildTemplate(paragraph('Parking: {{parking}} Special: {{special_conditions}}'));
    const result = mergeLeaseTemplate(template, FULL_FIELDS);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const zip = new PizZip(result.buffer);
      const xml = zip.file('word/document.xml')!.asText();
      expect(xml).toContain('Parking: ');
      expect(xml).not.toMatch(/Parking: \{\{parking\}\}/);
    }
  });

  it('blocks generation when a required field is missing, and lists exactly which ones', () => {
    const template = buildTemplate(paragraph('Tenant: {{tenant_full_name}}'));
    const { tenant_full_name: _omit, ...incomplete } = FULL_FIELDS;
    const result = mergeLeaseTemplate(template, incomplete);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.missingFields).toContain('tenant_full_name');
    }
  });

  it('blocks generation when several required fields are missing at once', () => {
    const template = buildTemplate(paragraph('x'));
    const result = mergeLeaseTemplate(template, {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.missingFields?.length).toBeGreaterThanOrEqual(8);
    }
  });

  it('rejects a non-zip buffer as an invalid template', () => {
    const result = mergeLeaseTemplate(Buffer.from('not a zip file'), FULL_FIELDS);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/not a valid DOCX/);
    }
  });
});
