// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { branding, platformBillingEntity } from '@propvault/config';

import DeleteAccountPage from '../page';

// The URL given to Google Play as the app's Delete Account URL
// (support.google.com/googleplay/android-developer/answer/13327111). The policy asks that the page
// name the app and developer as they appear on the store listing, be reachable without signing in,
// and state both what is deleted and what is retained -- so those are what this pins.

afterEach(cleanup);

describe('/delete-account', () => {
  it('renders without a session, a request or any Supabase client', () => {
    // A default-exported component taking no props cannot depend on an authenticated context; if
    // this page ever starts reading a session, this render is what fails first.
    expect(DeleteAccountPage.length).toBe(0);
    render(<DeleteAccountPage />);
    expect(screen.getByRole('heading', { level: 1 })).toBeDefined();
  });

  it('names the app and the developer shown on the store listing', () => {
    render(<DeleteAccountPage />);

    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain(branding.productName);
    expect(document.body.textContent).toContain('Proplyst');
    expect(document.body.textContent).toContain(platformBillingEntity.legalEntityName);
  });

  it('puts the deletion pathway on the page rather than burying it', () => {
    render(<DeleteAccountPage />);
    const text = document.body.textContent ?? '';

    // The real path, named exactly as the app names it.
    expect(text).toMatch(/Account & security/i);
    expect(text).toMatch(/Delete account/i);
    expect(text).toMatch(/Profile/i);
  });

  it('does not promise a web control that does not exist', () => {
    // The page used to say "sign in and use the same option under your account settings". No such
    // option exists anywhere on the website -- no component calls the deletion endpoint -- so the
    // page described a control a person could go looking for and never find.
    render(<DeleteAccountPage />);
    const text = document.body.textContent ?? '';

    expect(text).toMatch(/no delete button on this website/i);
    expect(text).not.toMatch(/under your account settings/i);
  });

  it('is honest that deleting requires being signed in to the app', () => {
    render(<DeleteAccountPage />);
    const text = document.body.textContent ?? '';

    // Google Play's policy is explicit that the page must not imply an unauthenticated visitor can
    // delete an account here. It says the opposite: the app verifies who you are, and anyone who
    // cannot sign in is routed to a human.
    expect(text).toMatch(/signing in to the app/i);
    expect(text).toMatch(/cannot use the app/i);
  });

  it('states what is deleted and what is retained, with the reason', () => {
    render(<DeleteAccountPage />);
    const text = document.body.textContent ?? '';

    expect(text).toMatch(/email address/i);
    expect(text).toMatch(/phone number/i);
    // Retention is disclosed with its basis, and matches the privacy policy rather than inventing
    // a period: accounting records, five years, South African tax law.
    expect(text).toMatch(/five years/i);
    expect(text).toMatch(/accounting records/i);
  });

  it('explains that organisation records are not deleted with the account', () => {
    render(<DeleteAccountPage />);
    const text = document.body.textContent ?? '';

    expect(text).toMatch(/organisation/i);
    expect(text).toMatch(/does not delete them/i);
  });

  it('offers a route for someone who can no longer sign in', () => {
    render(<DeleteAccountPage />);
    const text = document.body.textContent ?? '';

    // With a real support mailbox configured, that is the email route; without one the page falls
    // back to password reset rather than printing a placeholder address at a customer.
    const configured = !branding.supportEmail.endsWith('.example');
    if (configured) {
      expect(text).toContain(branding.supportEmail);
    } else {
      expect(screen.getByRole('link', { name: /password reset/i })).toBeDefined();
    }
  });

  it('links to the privacy policy', () => {
    render(<DeleteAccountPage />);

    const privacy = screen.getByRole('link', { name: /privacy policy/i });
    expect(privacy.getAttribute('href')).toBe('/privacy');
  });

  it('never shows a placeholder support address to a customer', () => {
    render(<DeleteAccountPage />);

    expect(document.body.textContent).not.toMatch(/\.example/);
    expect(document.body.textContent).not.toMatch(/TO_BE_CONFIRMED/);
  });
});
