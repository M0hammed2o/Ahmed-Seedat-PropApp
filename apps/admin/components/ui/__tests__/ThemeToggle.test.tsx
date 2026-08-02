// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ThemeProvider } from 'next-themes';
import { ThemeToggle } from '../ThemeToggle';

// jsdom has no window.matchMedia (a known gap, not a jsdom bug) -- next-themes' enableSystem path
// calls it to read the OS colour-scheme preference. Scoped to this file rather than a global
// vitest setup file, matching this codebase's existing pattern of test-local mocks (e.g. the
// next/navigation mock every component test that touches routing already carries individually).
beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
});

afterEach(cleanup);

describe('ThemeToggle', () => {
  it('renders a three-way Light/System/Dark control', () => {
    render(
      <ThemeProvider attribute="class">
        <ThemeToggle />
      </ThemeProvider>,
    );
    expect(screen.getByRole('radiogroup', { name: 'Theme' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Light' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'System' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Dark' })).toBeTruthy();
  });

  it('renders a single cycling button in compact mode', () => {
    render(
      <ThemeProvider attribute="class">
        <ThemeToggle compact />
      </ThemeProvider>,
    );
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });
});
