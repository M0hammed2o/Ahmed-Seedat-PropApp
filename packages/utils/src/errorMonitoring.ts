/**
 * Error-monitoring abstraction suitable for a backend like Sentry (brief). Phase 1 ships a
 * console-based implementation; swapping in a real Sentry client later means implementing this
 * interface, not touching call sites.
 */
export type ErrorSeverity = 'fatal' | 'error' | 'warning';

export interface AppError {
  message: string;
  correlationId: string;
  severity: ErrorSeverity;
  retryable: boolean;
  context?: Record<string, string | number | boolean>;
}

const SENSITIVE_KEY_PATTERN = /token|password|secret|key|biometric|document|file/i;

/** Strips any context key that looks sensitive before an error ever reaches a reporter. */
export function scrubContext(
  context: Record<string, unknown> | undefined,
): Record<string, string | number | boolean> {
  if (!context) return {};
  const clean: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(context)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) continue;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      clean[key] = value;
    }
  }
  return clean;
}

export interface ErrorReporter {
  report(error: AppError): void;
}

export class ConsoleErrorReporter implements ErrorReporter {
  report(error: AppError): void {
    console.error(`[${error.severity}] (${error.correlationId}) ${error.message}`, error.context);
  }
}
