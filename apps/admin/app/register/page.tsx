import { RegisterForm } from './RegisterForm';

// Forced dynamic, same reason as /login/page.tsx: proxy.ts's per-request CSP nonce.
export const dynamic = 'force-dynamic';

export default function RegisterPage() {
  return <RegisterForm />;
}
