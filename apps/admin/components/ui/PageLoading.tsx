// Next.js App Router `loading.tsx` fallback, shown while a route segment's async server
// component resolves (TASKS.md M20's explicit "loading state" requirement per module). Plain
// pulse skeleton, no spinner -- matches DESIGN_SYSTEM.md's general "avoid spinners for anything
// but sub-second inline actions" guidance for a full-page navigation transition.

export function PageLoading({ rows = 4 }: { rows?: number }) {
  return (
    <div className="animate-pulse" role="status" aria-label="Loading">
      <div className="h-6 w-48 rounded bg-light-border dark:bg-dark-border" />
      <div className="mt-2 h-4 w-72 rounded bg-light-border dark:bg-dark-border" />
      <div className="mt-6 space-y-2">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="h-10 rounded bg-light-border dark:bg-dark-border" />
        ))}
      </div>
    </div>
  );
}
