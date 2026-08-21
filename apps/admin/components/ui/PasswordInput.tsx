'use client';

import { forwardRef, useId, useState, type InputHTMLAttributes } from 'react';
import { Eye, EyeOff } from 'lucide-react';

/**
 * Password show/hide toggle (WORKLOG.md this date, commercial plan restructure pass). A thin
 * wrapper around a plain <input> -- never alters the value itself, only the `type` attribute
 * (password/text), so nothing about form state or submission changes. Defaults hidden, matching
 * this pass's own explicit requirement. Keyboard- and screen-reader-accessible: a real <button>
 * (not a bare clickable icon) with an `aria-label` that changes with state, `aria-pressed` so
 * assistive tech announces the current visibility state, not just the icon change.
 *
 * Forwards its ref -- react-hook-form's `register('password')` spread (LoginForm.tsx,
 * ResetPasswordForm.tsx) needs a real DOM ref to manage focus/validation; the manual
 * value/onChange pattern (RegisterForm.tsx) works unaffected either way.
 *
 * `className` styles the input itself (matching every plain <input type="password"> in this
 * codebase's own `inputClass` convention) -- the wrapping div only positions the toggle button.
 */
export const PasswordInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function PasswordInput({ className = '', ...rest }, ref) {
    const [visible, setVisible] = useState(false);
    const generatedId = useId();

    return (
      <div className="relative">
        <input
          {...rest}
          ref={ref}
          id={rest.id ?? generatedId}
          type={visible ? 'text' : 'password'}
          className={`${className} pr-10`}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
          tabIndex={0}
          className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-light-textSecondary hover:text-light-textPrimary dark:text-dark-textSecondary dark:hover:text-dark-textPrimary"
        >
          {visible ? (
            <EyeOff size={16} aria-hidden="true" />
          ) : (
            <Eye size={16} aria-hidden="true" />
          )}
        </button>
      </div>
    );
  },
);
