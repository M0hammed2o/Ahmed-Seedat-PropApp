// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Button } from '../Button';

afterEach(cleanup);

describe('Button', () => {
  it('renders its children and responds to clicks', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);
    fireEvent.click(screen.getByText('Save'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('does not fire onClick when disabled', () => {
    const onClick = vi.fn();
    render(
      <Button onClick={onClick} disabled>
        Archive
      </Button>,
    );
    fireEvent.click(screen.getByText('Archive'));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('defaults to the secondary variant', () => {
    render(<Button>Cancel</Button>);
    expect(screen.getByText('Cancel').className).toContain('border');
  });
});
