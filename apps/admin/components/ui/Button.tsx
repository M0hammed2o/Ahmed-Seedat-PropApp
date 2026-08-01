import type { ButtonHTMLAttributes } from 'react';

// DESIGN_SYSTEM.md "Buttons" -- three variants, one size scale, never colour-only for meaning.
// Solid accent fill is reserved for the single primary action per view/section (never PropView's
// "every action is the same blue" pattern, DESIGN_REVIEW.md §2).

export type ButtonVariant = 'primary' | 'secondary' | 'destructive';
export type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    'bg-light-accent text-light-accentContrast hover:opacity-90 dark:bg-dark-accent dark:text-dark-accentContrast',
  secondary:
    'border border-light-border text-light-textPrimary hover:bg-light-surfaceRaised dark:border-dark-border dark:text-dark-textPrimary dark:hover:bg-dark-surfaceRaised',
  destructive:
    'border border-light-danger text-light-danger hover:bg-light-danger hover:text-light-accentContrast dark:border-dark-danger dark:text-dark-danger dark:hover:bg-dark-danger dark:hover:text-dark-accentContrast',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs',
  md: 'h-10 px-4 text-sm',
  lg: 'h-12 px-6 text-base',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function Button({ variant = 'secondary', size = 'md', className = '', disabled, ...rest }: ButtonProps) {
  return (
    <button
      disabled={disabled}
      className={`inline-flex items-center justify-center rounded-md font-medium transition-opacity disabled:cursor-not-allowed disabled:opacity-40 ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${className}`}
      {...rest}
    />
  );
}
