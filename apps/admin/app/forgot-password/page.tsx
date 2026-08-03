import { ForgotPasswordForm } from './ForgotPasswordForm';

// Forced dynamic -- same CSP-nonce requirement as /login (proxy.ts).
export const dynamic = 'force-dynamic';

export default function ForgotPasswordPage() {
  return <ForgotPasswordForm />;
}
