'use client';

import { useRouter } from 'next/navigation';
import { MfaSettingsPanel } from '@/components/settings/MfaSettingsPanel';

// Thin client wrapper so the page itself can stay a server component (its own auth/redirect
// checks run server-side) -- same "Page.tsx does the server-side gate, a colocated Client.tsx
// does the interactive part" split this codebase already uses (e.g. app/activate/ActivateClient.tsx,
// components/invitations/AcceptInviteClient.tsx).
export function MfaSetupClient() {
  const router = useRouter();
  return (
    <MfaSettingsPanel
      onVerified={() => {
        router.replace('/platform-admin/overview');
        router.refresh();
      }}
    />
  );
}
