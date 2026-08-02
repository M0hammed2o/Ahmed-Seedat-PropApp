'use client';

/**
 * Catches errors thrown by the root layout itself (app/error.tsx can't — it renders inside the
 * layout). Must render its own <html>/<body> since the layout it's replacing is what broke.
 */
export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body>
        <main
          style={{
            display: 'flex',
            minHeight: '100vh',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
          }}
        >
          <div style={{ textAlign: 'center', maxWidth: 360 }}>
            <h1 style={{ fontSize: 18, fontWeight: 600 }}>Something went wrong</h1>
            <p style={{ marginTop: 8, fontSize: 14, color: '#5B6068' }}>
              PropVault Admin hit an unexpected error loading the page shell.
            </p>
            <button
              onClick={reset}
              style={{
                marginTop: 24,
                borderRadius: 6,
                backgroundColor: '#2F5D50',
                color: '#FFFFFF',
                padding: '8px 16px',
                fontSize: 14,
              }}
            >
              Try again
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
