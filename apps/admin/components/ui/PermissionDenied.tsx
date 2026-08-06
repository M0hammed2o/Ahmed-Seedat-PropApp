import { ShieldAlert } from 'lucide-react';

// PWA_V1_COMPLETION_PLAN.md #5 -- pages that gate access on role previously each rendered their
// own ad hoc "Only X roles can view this" sentence inline (e.g. Tax Pack). One shared component so
// every permission-denied state looks and reads the same way.
export function PermissionDenied({
  message = "You don't have permission to view this page.",
}: {
  message?: string;
}) {
  return (
    <div className="flex flex-col items-center rounded-card border border-light-border bg-light-surfaceRaised px-6 py-12 text-center shadow-card dark:border-dark-border dark:bg-dark-surfaceRaised">
      <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-light-statusOverdue/12 text-light-statusOverdue dark:bg-dark-statusOverdue/12 dark:text-dark-statusOverdue">
        <ShieldAlert size={20} aria-hidden="true" />
      </span>
      <h2 className="mt-4 text-base font-semibold text-light-textPrimary dark:text-dark-textPrimary">
        Access restricted
      </h2>
      <p className="mt-1 max-w-sm text-sm text-light-textSecondary dark:text-dark-textSecondary">
        {message}
      </p>
    </div>
  );
}
