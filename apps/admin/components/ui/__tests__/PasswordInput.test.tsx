// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PasswordInput } from '../PasswordInput';

afterEach(() => {
  cleanup();
});

describe('PasswordInput', () => {
  it('defaults to hidden (type=password)', () => {
    render(<PasswordInput defaultValue="secret123" />);
    const input = screen.getByDisplayValue('secret123') as HTMLInputElement;
    expect(input.type).toBe('password');
  });

  it('toggling visibility changes the input type but never the value', () => {
    render(<PasswordInput defaultValue="secret123" />);
    const input = screen.getByDisplayValue('secret123') as HTMLInputElement;

    fireEvent.click(screen.getByRole('button', { name: /show password/i }));
    expect(input.type).toBe('text');
    expect(input.value).toBe('secret123');

    fireEvent.click(screen.getByRole('button', { name: /hide password/i }));
    expect(input.type).toBe('password');
    expect(input.value).toBe('secret123');
  });

  it('the toggle button is keyboard-focusable and announces state via aria-pressed', () => {
    render(<PasswordInput defaultValue="secret123" />);
    const button = screen.getByRole('button', { name: /show password/i });
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(button.getAttribute('tabIndex')).toBe('0');
  });

  it('typing still updates the value normally (not intercepted by the toggle)', () => {
    render(<PasswordInput placeholder="password" />);
    const input = screen.getByPlaceholderText('password') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'hello' } });
    expect(input.value).toBe('hello');
  });
});
