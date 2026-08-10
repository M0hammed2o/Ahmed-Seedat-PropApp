import { OwnerAcceptClient } from './OwnerAcceptClient';

// Forced dynamic, same reason as /activate and /login: proxy.ts's per-request CSP nonce. Not in
// proxy.ts's PROTECTED_ROUTE_PREFIXES -- an invited owner may not be signed in yet when they
// first open this link; this page's own client branches on session state instead.
export const dynamic = 'force-dynamic';

export default function OwnerInvitationAcceptPage() {
  return <OwnerAcceptClient />;
}
