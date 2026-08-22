import { describe, expect, it } from 'vitest';
import ConfirmEmailPage from '../page';

// Staff invitation flow audit (this date): `next` on this page is never a bare safe path -- it's
// the FULL `emailRedirectTo` URL Supabase's `{{ .RedirectTo }}` email-template variable renders
// (confirmed empirically against a real local send, see WORKLOG.md this date). This page's own
// job is to extract the INNER `next` query param from that URL and validate it with
// safeNextPathOr() before ConfirmEmailClient ever sees it -- these tests pin that extraction and
// its safety, calling the Server Component directly and inspecting the element it returns (no
// redirect() is ever called by this page, so this is a safe, simple way to test it without a
// rendering harness).

function renderPage(searchParams: { token_hash?: string; type?: string; next?: string }) {
  return ConfirmEmailPage({ searchParams: Promise.resolve(searchParams) });
}

describe('ConfirmEmailPage', () => {
  it('extracts the inner next from a full RedirectTo URL and passes it to ConfirmEmailClient', async () => {
    const redirectTo = `http://localhost:3000/auth/callback?next=${encodeURIComponent('/invitations/accept?token=abc-123')}`;
    const element = await renderPage({ token_hash: 'a-real-hash', type: 'signup', next: redirectTo });
    expect(element.props.next).toBe('/invitations/accept?token=abc-123');
    expect(element.props.tokenHash).toBe('a-real-hash');
  });

  it('defaults to / when no next is present at all (ordinary generic signup)', async () => {
    const element = await renderPage({ token_hash: 'a-real-hash', type: 'signup' });
    expect(element.props.next).toBe('/');
  });

  it('defaults to / when the RedirectTo URL carries no inner next (or an empty one)', async () => {
    const redirectTo = 'http://localhost:3000/auth/callback';
    const element = await renderPage({ token_hash: 'a-real-hash', type: 'signup', next: redirectTo });
    expect(element.props.next).toBe('/');
  });

  it('never trusts a malformed/garbage next value -- falls back to / instead of throwing', async () => {
    const element = await renderPage({
      token_hash: 'a-real-hash',
      type: 'signup',
      next: 'not-a-valid-url-at-all',
    });
    expect(element.props.next).toBe('/');
  });

  it('open-redirect protection: an absolute-URL inner next is neutralized, never passed through', async () => {
    const redirectTo = `http://localhost:3000/auth/callback?next=${encodeURIComponent('https://evil.example/steal')}`;
    const element = await renderPage({ token_hash: 'a-real-hash', type: 'signup', next: redirectTo });
    expect(element.props.next).toBe('/');
  });

  it('open-redirect protection: a protocol-relative inner next (//evil.example) is neutralized', async () => {
    const redirectTo = `http://localhost:3000/auth/callback?next=${encodeURIComponent('//evil.example')}`;
    const element = await renderPage({ token_hash: 'a-real-hash', type: 'signup', next: redirectTo });
    expect(element.props.next).toBe('/');
  });

  it('a plan-specific-CTA next (choose-plan with plan+interval) survives extraction intact', async () => {
    const redirectTo = `http://localhost:3000/auth/callback?next=${encodeURIComponent('/onboarding/choose-plan?plan=professional&interval=annual')}`;
    const element = await renderPage({ token_hash: 'a-real-hash', type: 'signup', next: redirectTo });
    expect(element.props.next).toBe('/onboarding/choose-plan?plan=professional&interval=annual');
  });

  it('passes tokenHash=null for a structurally invalid link (missing token_hash or wrong type)', async () => {
    const element = await renderPage({ type: 'signup' });
    expect(element.props.tokenHash).toBeNull();

    const element2 = await renderPage({ token_hash: 'a-real-hash', type: 'recovery' });
    expect(element2.props.tokenHash).toBeNull();
  });
});
