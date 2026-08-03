import { ResetPasswordForm } from './ResetPasswordForm';

// Forced dynamic -- same CSP-nonce requirement as /login (proxy.ts).
export const dynamic = 'force-dynamic';

export default function ResetPasswordPage() {
  return <ResetPasswordForm />;
}
