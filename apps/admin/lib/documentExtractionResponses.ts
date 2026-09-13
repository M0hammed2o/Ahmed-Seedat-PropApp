import 'server-only';
import { NextResponse } from 'next/server';
import {
  DOCUMENT_EXTRACTION_UNAVAILABLE_MESSAGE,
  EXTRACTION_RESULT_NOT_TRUSTED_MESSAGE,
} from './documentIntelligencePolicy';

/**
 * 503 for "document extraction cannot run here right now".
 *
 * Service Unavailable, not the 502 the extract routes already use for `extraction_failed`: a 502
 * means a real provider was called and failed, whereas this means none was called at all, because
 * none is configured. Keeping the two apart keeps provider outages and missing configuration
 * distinguishable in logs and monitoring.
 *
 * The body carries only the user-facing message. The operator-facing detail -- which variables are
 * missing -- goes to the server log and nowhere a user can see it.
 */
export function documentExtractionUnavailableResponse(route: string) {
  console.error(
    `[documentExtraction] ${route}: refused -- Google Cloud Document AI is not fully configured in this runtime, and the mock provider is never used in production. Set GOOGLE_CLOUD_PROJECT_ID, GOOGLE_CLOUD_LOCATION, GOOGLE_DOCUMENT_AI_PROCESSOR_ID and GOOGLE_DOCUMENT_AI_CREDENTIALS_JSON.`,
  );
  return NextResponse.json(
    {
      error: {
        code: 'document_extraction_unavailable',
        message: DOCUMENT_EXTRACTION_UNAVAILABLE_MESSAGE,
      },
    },
    { status: 503 },
  );
}

/**
 * 409 for "a stored result exists, but it cannot be trusted in this runtime".
 *
 * Conflict rather than 503: the service may be perfectly healthy -- the problem is the state of
 * this particular record, which predates real extraction or came from the mock.
 */
export function extractionResultNotTrustedResponse(route: string) {
  console.error(
    `[documentExtraction] ${route}: refused -- the stored extraction result was not produced by a real provider and cannot be used in production.`,
  );
  return NextResponse.json(
    {
      error: {
        code: 'extraction_result_not_trusted',
        message: EXTRACTION_RESULT_NOT_TRUSTED_MESSAGE,
      },
    },
    { status: 409 },
  );
}
