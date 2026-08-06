// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { EmptyState } from '../EmptyState';

afterEach(cleanup);

describe('EmptyState', () => {
  it('renders the title and description', () => {
    render(
      <EmptyState
        icon={<span>icon</span>}
        title="No organizations yet"
        description="Create one to get started."
      />,
    );
    expect(screen.getByText('No organizations yet')).toBeTruthy();
    expect(screen.getByText('Create one to get started.')).toBeTruthy();
  });

  it('omits the description and action when none are provided', () => {
    render(<EmptyState icon={<span>icon</span>} title="All clear" />);
    expect(screen.queryByText('Create one to get started.')).toBeNull();
  });

  it('renders the action when provided', () => {
    render(
      <EmptyState
        icon={<span>icon</span>}
        title="No plans yet"
        action={<button>+ Add plan</button>}
      />,
    );
    expect(screen.getByText('+ Add plan')).toBeTruthy();
  });
});
