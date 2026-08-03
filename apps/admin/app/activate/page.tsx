import { ActivateClient } from './ActivateClient';

// Forced dynamic, same reason as /login and /register: proxy.ts's per-request CSP nonce.
// Deliberately NOT in proxy.ts's PROTECTED_ROUTE_PREFIXES -- a brand-new tenant is not signed in
// yet when they first open this link (PRODUCT DECISION 2), this page's own client-side branches
// on session state instead of relying on the proxy redirect gate.
export const dynamic = 'force-dynamic';

export default function ActivatePage() {
  return <ActivateClient />;
}
