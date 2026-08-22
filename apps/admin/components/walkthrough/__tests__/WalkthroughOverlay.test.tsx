// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  WalkthroughOverlay,
  requestWalkthroughRestart,
} from '../WalkthroughOverlay';
import type { WalkthroughStep } from '@/lib/walkthroughSteps';

const STEPS: WalkthroughStep[] = [
  { id: 'dashboard', title: 'Your dashboard', body: 'Body 1', href: '/dashboard', navLabel: 'Dashboard' },
  { id: 'properties', title: 'Properties', body: 'Body 2', href: '/properties', navLabel: 'Properties' },
];

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('WalkthroughOverlay', () => {
  it('does not render when autoShow is false and no restart event has fired', () => {
    render(<WalkthroughOverlay orgId="org-1" steps={STEPS} autoShow={false} />);
    expect(screen.queryByText('Your dashboard')).toBeNull();
  });

  it('auto-shows the first step when autoShow is true', () => {
    render(<WalkthroughOverlay orgId="org-1" steps={STEPS} autoShow />);
    expect(screen.getByText('Your dashboard')).toBeTruthy();
    expect(screen.getByText('Step 1 of 2')).toBeTruthy();
  });

  it('Next advances to the next step and back becomes available', () => {
    render(<WalkthroughOverlay orgId="org-1" steps={STEPS} autoShow />);
    fireEvent.click(screen.getByText('Next'));
    expect(screen.getByText('Properties')).toBeTruthy();
    expect(screen.getByText('Back')).toBeTruthy();
  });

  it('Finish on the last step posts walkthrough completed and closes', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchSpy);

    render(<WalkthroughOverlay orgId="org-1" steps={STEPS} autoShow />);
    fireEvent.click(screen.getByText('Next'));
    fireEvent.click(screen.getByText('Finish'));

    expect(screen.queryByText('Properties')).toBeNull();
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/v1/organizations/org-1/onboarding',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ action: 'walkthrough', state: 'completed' }),
      }),
    );
  });

  it('Skip tour posts walkthrough dismissed and closes', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchSpy);

    render(<WalkthroughOverlay orgId="org-1" steps={STEPS} autoShow />);
    fireEvent.click(screen.getByText('Skip tour'));

    expect(screen.queryByText('Your dashboard')).toBeNull();
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/v1/organizations/org-1/onboarding',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ action: 'walkthrough', state: 'dismissed' }),
      }),
    );
  });

  it('does not auto-restart after completion, but requestWalkthroughRestart() reopens it from step one', () => {
    render(<WalkthroughOverlay orgId="org-1" steps={STEPS} autoShow={false} />);
    expect(screen.queryByText('Your dashboard')).toBeNull();

    act(() => {
      requestWalkthroughRestart();
    });
    expect(screen.getByText('Your dashboard')).toBeTruthy();
    expect(screen.getByText('Step 1 of 2')).toBeTruthy();
  });
});
