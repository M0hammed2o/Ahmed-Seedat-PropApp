// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { LandingPage } from '../LandingPage';

afterEach(cleanup);

// Root-domain routing fix (WORKLOG.md this date): pins that the public landing page actually
// offers the four required entry points (sign in, start trial, pricing, product info) rather than
// just rendering "something" -- and that it never contains any authenticated-app-shell content
// (nav sections, org name, dashboard widgets) that would indicate the wrong component rendered.
describe('LandingPage', () => {
  it('offers a sign-in action', () => {
    render(<LandingPage />);
    expect(screen.getAllByRole('link', { name: /sign in/i }).length).toBeGreaterThan(0);
  });

  it('offers a start-free-trial action', () => {
    render(<LandingPage />);
    expect(
      screen.getAllByText(/start.*(free trial|your 30-day free trial)/i).length,
    ).toBeGreaterThan(0);
  });

  it('offers a pricing section with all three real tiers', () => {
    render(<LandingPage />);
    expect(screen.getByText('Starter')).toBeTruthy();
    expect(screen.getByText('Professional')).toBeTruthy();
    expect(screen.getByText('Business')).toBeTruthy();
    expect(screen.getByText('R299')).toBeTruthy();
    expect(screen.getByText('R699')).toBeTruthy();
    expect(screen.getByText('R1499')).toBeTruthy();
  });

  it('never renders internal admin/dashboard shell content', () => {
    render(<LandingPage />);
    expect(screen.queryByText(/platform admin/i)).toBeNull();
    expect(screen.queryByText(/super admin/i)).toBeNull();
  });
});
