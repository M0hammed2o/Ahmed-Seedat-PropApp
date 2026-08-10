// Production incident fix (WORKLOG.md this date): a stale PostgREST schema cache turned a
// missing-function/column error into an HTTP 500 whose body, by the time it reached the browser,
// was not valid JSON (platform/edge error page, not this app's own NextResponse.json) -- every
// caller here did `const body = await response.json()` unconditionally, so that 500 crashed the
// UI a second time with "Unexpected end of JSON input" instead of showing the real error.
// safeJson() never throws; a response this app's own routes always still parses normally.
// Returns `any`, matching Response.prototype.json()'s own typing exactly -- a deliberate,
// backward-compatible drop-in for the bare `await response.json()` every caller already used,
// not a stricter type that would ripple typed-property errors out to every call site.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function safeJson(response: Response): Promise<any> {
  try {
    return await response.json();
  } catch {
    return {
      error: {
        code: 'invalid_response',
        message: `Unexpected response from the server (HTTP ${response.status}). Please try again.`,
      },
    };
  }
}
