'use client';

import * as React from 'react';
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';

// Adapted from reference/lovable-ui-reference's shadcn `dropdown-menu.tsx` (UI_INTEGRATION_PLAN.md)
// -- trimmed to the subset AppShell's user menu actually uses (no submenus/checkbox/radio items),
// restyled onto DESIGN_SYSTEM.md tokens instead of Tailwind v4 theme classes, and without `cn()`/
// `tailwindcss-animate` since neither is installed elsewhere in this codebase (plain template-
// literal classNames match every other component here).

export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;

export const DropdownMenuContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(({ className = '', sideOffset = 6, ...props }, ref) => (
  <DropdownMenuPrimitive.Portal>
    <DropdownMenuPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={`z-50 min-w-[14rem] overflow-hidden rounded-xl border border-light-border bg-light-surfaceRaised p-1 text-sm shadow-lift dark:border-dark-border dark:bg-dark-surfaceRaised ${className}`}
      {...props}
    />
  </DropdownMenuPrimitive.Portal>
));
DropdownMenuContent.displayName = 'DropdownMenuContent';

export const DropdownMenuItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item>
>(({ className = '', ...props }, ref) => (
  <DropdownMenuPrimitive.Item
    ref={ref}
    className={`flex cursor-pointer select-none items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] text-light-textPrimary outline-none transition-colors data-[highlighted]:bg-light-surface dark:text-dark-textPrimary dark:data-[highlighted]:bg-dark-surface ${className}`}
    {...props}
  />
));
DropdownMenuItem.displayName = 'DropdownMenuItem';

export const DropdownMenuLabel = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label>
>(({ className = '', ...props }, ref) => (
  <DropdownMenuPrimitive.Label
    ref={ref}
    className={`px-2.5 py-1.5 text-xs text-light-textMuted dark:text-dark-textMuted ${className}`}
    {...props}
  />
));
DropdownMenuLabel.displayName = 'DropdownMenuLabel';

export const DropdownMenuSeparator = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>
>(({ className = '', ...props }, ref) => (
  <DropdownMenuPrimitive.Separator
    ref={ref}
    className={`-mx-1 my-1 h-px bg-light-border dark:bg-dark-border ${className}`}
    {...props}
  />
));
DropdownMenuSeparator.displayName = 'DropdownMenuSeparator';
