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

describe('NotificationPreferencesForm', () => {
  it('renders one row per notification category', () => {
    render(<NotificationPreferencesForm preferences={[]} />);
    for (const category of NOTIFICATION_CATEGORIES) {
      expect(screen.getByText(category)).toBeTruthy();
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
    };
    render(<NotificationPreferencesForm preferences={[preference]} />);
    const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    const uncheckedCount = checkboxes.filter((c) => !c.checked).length;
    expect(uncheckedCount).toBe(3);
  });
});
