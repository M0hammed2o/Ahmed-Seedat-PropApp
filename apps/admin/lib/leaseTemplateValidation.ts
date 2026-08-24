import 'server-only';
import PizZip from 'pizzip';

// Lease-template DOCX security audit (WORKLOG.md 2026-08-25): a client-supplied Content-Type
// header (file.type) is trivially spoofable -- a renamed macro-enabled DOCM, or an unrelated zip,
// could claim to be 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' and
// pass the MIME allowlist alone. DOCX is itself just a zip container, so real content
// verification means: (1) it must actually be a well-formed zip with the OOXML marker file real
// Word documents always have, and (2) it must NOT contain a VBA macro project -- DOCM's one real
// structural difference from DOCX. This never opens/executes the document; it only inspects the
// zip's own file listing.

export interface DocxValidationResult {
  valid: boolean;
  reason?: string;
}

/** Only called for files claiming the DOCX MIME type -- PDF is not a zip container and needs no
 * equivalent check here (PDF structure is validated implicitly by whichever PDF viewer/library
 * later opens it; this codebase does not parse PDF content at upload time for any document type). */
export function validateDocxContent(buffer: Buffer): DocxValidationResult {
  let zip: PizZip;
  try {
    zip = new PizZip(buffer);
  } catch {
    return { valid: false, reason: 'File does not appear to be a valid DOCX (not a readable zip archive).' };
  }

  if (!zip.file('[Content_Types].xml')) {
    return {
      valid: false,
      reason: 'File does not appear to be a valid Office Open XML document (missing [Content_Types].xml).',
    };
  }

  // A macro-enabled document (DOCM, or a DOCX with an embedded macro project regardless of its
  // claimed extension/MIME type) always carries this file. Reject outright -- never executed,
  // never accepted "just in case."
  if (zip.file('word/vbaProject.bin')) {
    return {
      valid: false,
      reason: 'Macro-enabled documents are not supported. Upload a plain DOCX without macros.',
    };
  }

  return { valid: true };
}
