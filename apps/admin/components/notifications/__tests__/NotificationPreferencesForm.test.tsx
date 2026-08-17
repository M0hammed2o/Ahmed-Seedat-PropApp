// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { NotificationPreference } from '@propvault/types';
import { NOTIFICATION_CATEGORIES } from '@propvault/types';
import { NotificationPreferencesForm } from '../NotificationPreferencesForm';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

afterEach(cleanup);

// Human-readable labels (Phase 8, final pre-production pass) -- kept in sync with the form's own
// CATEGORY_LABELS map by testing against it structurally (every category has a real label, not
// that any one specific string was chosen) rather than duplicating the literal strings here.
const HUMAN_LABEL_PATTERN = /^[A-Za-z][A-Za-z &]*$/;

describe('NotificationPreferencesForm', () => {
  it('renders one row per notification category with a human-readable label, never the raw category token', () => {
    render(<NotificationPreferencesForm preferences={[]} />);
    for (const category of NOTIFICATION_CATEGORIES) {
      expect(screen.queryByText(category as string)).toBeNull();
    }
    const labelCells = screen.getAllByRole('cell').filter((_, i) => i % 4 === 0);
    expect(labelCells.length).toBe(NOTIFICATION_CATEGORIES.length);
    for (const cell of labelCells) {
      const label = cell.textContent?.split('Send on day')[0]?.trim() ?? '';
      expect(label).toMatch(HUMAN_LABEL_PATTERN);
    }
  });

  it('defaults every channel to checked when no preference row exists for a category', () => {
    render(<NotificationPreferencesForm preferences={[]} />);
    const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(checkboxes.length).toBe(NOTIFICATION_CATEGORIES.length * 3);
    expect(checkboxes.every((c) => c.checked)).toBe(true);
  });

  it('reflects an existing preference row instead of the default', () => {
    const preference: NotificationPreference = {
      userId: 'user-1',
      category: 'promotional',
      emailEnabled: false,
      pushEnabled: false,
      whatsappEnabled: false,
      preferredSummaryDay: null,
    };
    render(<NotificationPreferencesForm preferences={[preference]} />);
    const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    const uncheckedCount = checkboxes.filter((c) => !c.checked).length;
    expect(uncheckedCount).toBe(3);
  });

  it('shows a preferred-day selector only for the owner_summary category, defaulting to day 1', () => {
    render(<NotificationPreferencesForm preferences={[]} />);
    const selects = screen.getAllByRole('combobox') as HTMLSelectElement[];
    expect(selects.length).toBe(1);
    expect(selects[0]!.value).toBe('');
    expect(screen.getByText('1 (default)')).toBeTruthy();
  });
});
