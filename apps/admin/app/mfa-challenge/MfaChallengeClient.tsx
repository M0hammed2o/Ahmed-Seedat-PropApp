'use client';

import { useRouter } from 'next/navigation';
import { MfaChallengeForm } from '@/components/auth/MfaChallengeForm';

export function MfaChallengeClient({ factorId, next }: { factorId: string; next: string }) {
  const router = useRouter();

  return (
    <main className="flex min-h-screen items-center justify-center bg-light-surface px-6 dark:bg-dark-surface">
      <MfaChallengeForm
        factorId={factorId}
        onVerified={() => {
          router.replace(next);
          router.refresh();
        }}
      />
    </main>
  );
}
