import { ShieldCheck } from 'lucide-react';
import { MfaSetupClient } from './MfaSetupClient';

export const dynamic = 'force-dynamic';

export default function MfaSetupPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-light-surface px-6 dark:bg-dark-surface">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-light-accent text-light-accentContrast shadow-glow dark:bg-dark-accent dark:text-dark-accentContrast">
            <ShieldCheck size={20} aria-hidden="true" />
          </span>
          <h1 className="mt-4 font-display text-xl font-bold text-light-textPrimary dark:text-dark-textPrimary">
            Two-factor authentication required
          </h1>
          <p className="mt-2 text-sm text-light-textSecondary dark:text-dark-textSecondary">
            The Super Admin interface requires an authenticator app on every account, with no
            exceptions. Set it up below to continue.
          </p>
        </div>
        <MfaSetupClient />
      </div>
    </main>
  );
}
