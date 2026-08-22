'use client';

import { Button } from '@/components/ui/Button';
import { requestWalkthroughRestart } from './WalkthroughOverlay';

/** "Provide: Restart guided tour from Help/Settings" -- "do not automatically restart after
 * completion" means this is the ONLY way the walkthrough shows again once dismissed/completed. */
export function RestartWalkthroughButton() {
  return (
    <Button variant="secondary" size="sm" onClick={requestWalkthroughRestart}>
      Restart guided tour
    </Button>
  );
}
