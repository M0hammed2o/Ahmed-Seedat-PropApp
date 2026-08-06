'use client';

import * as React from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';

// Adapted from reference/lovable-ui-reference's shadcn `popover.tsx` (UI_INTEGRATION_PLAN.md) --
// restyled onto DESIGN_SYSTEM.md tokens, no `cn()`/`tailwindcss-animate` (see DropdownMenu.tsx).

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;

export const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className = '', align = 'center', sideOffset = 8, ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      className={`z-50 rounded-xl border border-light-border bg-light-surfaceRaised text-light-textPrimary shadow-lift outline-none dark:border-dark-border dark:bg-dark-surfaceRaised dark:text-dark-textPrimary ${className}`}
      {...props}
    />
  </PopoverPrimitive.Portal>
));
PopoverContent.displayName = 'PopoverContent';
