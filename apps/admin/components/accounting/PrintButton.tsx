'use client';

import { Button } from '@/components/ui/Button';

// Browser print-to-PDF, not a server-rendered PDF -- no PDF-generation dependency for V1
// (deliberate scope decision, see the print page's own comment).
export function PrintButton() {
  return (
    <Button variant="primary" size="sm" onClick={() => window.print()}>
      Print / save as PDF
    </Button>
  );
}
