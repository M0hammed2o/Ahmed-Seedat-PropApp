import { ApplyClient } from './ApplyClient';

type RouteParams = { params: Promise<{ token: string }> };

// Forced dynamic, same reason as /activate and /owner-invitations/accept: proxy.ts's per-request
// CSP nonce, and an applicant is never signed in at all -- this page has no session to branch on.
export const dynamic = 'force-dynamic';

export default async function ApplyPage({ params }: RouteParams) {
  const { token } = await params;
  return <ApplyClient token={token} />;
}
