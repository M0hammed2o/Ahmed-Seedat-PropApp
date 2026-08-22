// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

// Root-domain routing fix (WORKLOG.md this date): pins the exact bug report this fixed --
// unauthenticated `/` must render the public landing page, never redirect into (or render) any
// authenticated app shell; every authenticated caller must still be routed via the centralized
// resolver.

const mockRedirect = vi.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`);
});
vi.mock('next/navigation', () => ({ redirect: mockRedirect }));

const mockResolveAuthenticatedDestination = vi.fn();
vi.mock('@/lib/destinationResolver', () => ({
  resolveAuthenticatedDestination: mockResolveAuthenticatedDestination,
}));

let demoMode = false;
vi.mock('@/lib/demoMode', () => ({
  get ADMIN_DEMO_MODE() {
    return demoMode;
  },
}));

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  demoMode = false;
});

async function renderRootPage() {
  const { default: RootPage } = await import('../page');
  return RootPage();
}

describe('RootPage (/)', () => {
  it('renders the public landing page for a genuinely unauthenticated visitor', async () => {
    mockResolveAuthenticatedDestination.mockResolvedValue(null);
    const element = await renderRootPage();
    render(element);
    // LandingPage's own real content, not a stand-in -- confirms the actual component rendered.
    expect(screen.getAllByRole('link', { name: /sign in/i }).length).toBeGreaterThan(0);
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it('never shows a login form or any admin-shell content for an unauthenticated visitor', async () => {
    mockResolveAuthenticatedDestination.mockResolvedValue(null);
    const element = await renderRootPage();
    render(element);
    expect(screen.queryByLabelText(/password/i)).toBeNull();
    expect(screen.queryByText(/overview/i)).toBeNull();
  });

  it('redirects a platform admin to /platform-admin/overview, not the landing page', async () => {
    mockResolveAuthenticatedDestination.mockResolvedValue({
      kind: 'platform-admin',
      path: '/platform-admin/overview',
    });
    await expect(renderRootPage()).rejects.toThrow('REDIRECT:/platform-admin/overview');
  });

  it('redirects a normal org member to /dashboard', async () => {
    mockResolveAuthenticatedDestination.mockResolvedValue({
      kind: 'org-dashboard',
      path: '/dashboard',
    });
    await expect(renderRootPage()).rejects.toThrow('REDIRECT:/dashboard');
  });

  it('redirects a suspended-org member to /access-restricted', async () => {
    mockResolveAuthenticatedDestination.mockResolvedValue({
      kind: 'org-restricted',
      path: '/access-restricted',
    });
    await expect(renderRootPage()).rejects.toThrow('REDIRECT:/access-restricted');
  });

  it('redirects a tenant to /portal', async () => {
    mockResolveAuthenticatedDestination.mockResolvedValue({
      kind: 'tenant-portal',
      path: '/portal',
    });
    await expect(renderRootPage()).rejects.toThrow('REDIRECT:/portal');
  });

  it('redirects an owner to /owner-portal', async () => {
    mockResolveAuthenticatedDestination.mockResolvedValue({
      kind: 'owner-portal',
      path: '/owner-portal',
    });
    await expect(renderRootPage()).rejects.toThrow('REDIRECT:/owner-portal');
  });

  it('redirects an identity-less authenticated caller to onboarding', async () => {
    mockResolveAuthenticatedDestination.mockResolvedValue({
      kind: 'onboarding',
      path: '/onboarding/create-organization',
    });
    await expect(renderRootPage()).rejects.toThrow('REDIRECT:/onboarding/create-organization');
  });

  it('redirects a portfolio-eligible identity-less caller to /onboarding/choose-plan (commercial onboarding bypass fix)', async () => {
    mockResolveAuthenticatedDestination.mockResolvedValue({
      kind: 'onboarding',
      path: '/onboarding/choose-plan',
    });
    await expect(renderRootPage()).rejects.toThrow('REDIRECT:/onboarding/choose-plan');
  });

  it('demo mode always redirects to /platform-admin/overview without consulting the resolver', async () => {
    demoMode = true;
    await expect(renderRootPage()).rejects.toThrow('REDIRECT:/platform-admin/overview');
    expect(mockResolveAuthenticatedDestination).not.toHaveBeenCalled();
  });
});
