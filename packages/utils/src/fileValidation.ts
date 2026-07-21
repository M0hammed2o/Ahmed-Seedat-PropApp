import { ALLOWED_MIME_TYPES } from '@propvault/types';

// Magic-byte (file signature) prefixes for the formats we accept, used as a defense-in-depth
// check alongside declared MIME type + extension (never authorization on their own — see
// SECURITY.md). HEIC uses the ISO base media file format box structure, so we check for the
// 'ftyp' box with a HEIC-family brand rather than a fixed byte prefix.
const SIGNATURES: Record<string, (bytes: Uint8Array) => boolean> = {
  'application/pdf': (b) => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46, // %PDF
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) =>
    b[0] === 0x89 &&
    b[1] === 0x50 &&
    b[2] === 0x4e &&
    b[3] === 0x47 &&
    b[4] === 0x0d &&
    b[5] === 0x0a,
  'image/heic': (b) => {
    if (b.length < 12) return false;
    const box = String.fromCharCode(b[4] ?? 0, b[5] ?? 0, b[6] ?? 0, b[7] ?? 0);
    const brand = String.fromCharCode(b[8] ?? 0, b[9] ?? 0, b[10] ?? 0, b[11] ?? 0);
    return (
      box === 'ftyp' &&
      (brand.startsWith('hei') || brand.startsWith('mif') || brand.startsWith('hev'))
    );
  },
};

const EXTENSION_BY_MIME: Record<string, string[]> = {
  'application/pdf': ['pdf'],
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/heic': ['heic', 'heif'],
};

export interface FileValidationInput {
  mimeType: string;
  fileName: string;
  fileSizeBytes: number;
  maxFileSizeMb: number;
  headerBytes?: Uint8Array; // first ~16 bytes of the file, when available
}

export interface FileValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateFile(input: FileValidationInput): FileValidationResult {
  const errors: string[] = [];

  if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(input.mimeType)) {
    errors.push(`Unsupported file type: ${input.mimeType}`);
  }

  const ext = input.fileName.split('.').pop()?.toLowerCase() ?? '';
  const expectedExtensions = EXTENSION_BY_MIME[input.mimeType];
  if (expectedExtensions && !expectedExtensions.includes(ext)) {
    errors.push(`File extension ".${ext}" does not match declared type ${input.mimeType}`);
  }

  const maxBytes = input.maxFileSizeMb * 1024 * 1024;
  if (input.fileSizeBytes > maxBytes) {
    errors.push(`File exceeds the ${input.maxFileSizeMb}MB size limit`);
  }
  if (input.fileSizeBytes <= 0) {
    errors.push('File is empty');
  }

  if (input.headerBytes) {
    const checkSignature = SIGNATURES[input.mimeType];
    if (checkSignature && !checkSignature(input.headerBytes)) {
      errors.push('File contents do not match the declared file type');
    }
  }

  return { valid: errors.length === 0, errors };
}
