'use client';

import { Button } from '@/components/ui/button';

import { useState } from 'react';

// SPEC F15: teams share their join code on purpose (it isn't a secret), so the Team page offers to copy it.
export function CopyCode({ text }: { text: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setState('copied');
    } catch {
      setState('failed'); // no clipboard (plain http, an old browser): the code is still on screen to select
    }
  }
  return (
    <>
      <Button type="button" variant="outline" onClick={copy} aria-label="Copy join code" className="justify-self-start">
        {state === 'copied' ? '✓ Copied' : 'Copy'}
      </Button>
      {/* Always rendered, so screen readers announce each change; only the failure needs to be seen. */}
      <span role="status" className={state === 'failed' ? 'text-muted-foreground text-[14px]' : 'sr-only'}>
        {state === 'copied' ? 'Join code copied.' : state === 'failed' ? 'Couldn’t copy. Select the code instead.' : ''}
      </span>
    </>
  );
}
