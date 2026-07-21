import { describe, expect, it } from 'vitest';
import { validateFile } from '../fileValidation';

const PDF_HEADER = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]); // "%PDF-1.4"
const JPEG_HEADER = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);

describe('validateFile', () => {
  it('accepts a valid PDF', () => {
    const result = validateFile({
      mimeType: 'application/pdf',
      fileName: 'water-bill.pdf',
      fileSizeBytes: 100_000,
      maxFileSizeMb: 25,
      headerBytes: PDF_HEADER,
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects a file whose contents do not match its declared type (renamed file attack)', () => {
    const result = validateFile({
      mimeType: 'application/pdf',
      fileName: 'water-bill.pdf',
      fileSizeBytes: 100_000,
      maxFileSizeMb: 25,
      headerBytes: JPEG_HEADER, // actually a JPEG renamed to .pdf
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('do not match'))).toBe(true);
  });

  it('rejects an unsupported MIME type', () => {
    const result = validateFile({
      mimeType: 'application/zip',
      fileName: 'archive.zip',
      fileSizeBytes: 1000,
      maxFileSizeMb: 25,
    });
    expect(result.valid).toBe(false);
  });

  it('rejects a file exceeding the size limit', () => {
    const result = validateFile({
      mimeType: 'application/pdf',
      fileName: 'huge.pdf',
      fileSizeBytes: 30 * 1024 * 1024,
      maxFileSizeMb: 25,
      headerBytes: PDF_HEADER,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('size limit'))).toBe(true);
  });

  it('rejects a mismatched extension for the declared MIME type', () => {
    const result = validateFile({
      mimeType: 'image/png',
      fileName: 'photo.jpg',
      fileSizeBytes: 1000,
      maxFileSizeMb: 25,
    });
    expect(result.valid).toBe(false);
  });
});
