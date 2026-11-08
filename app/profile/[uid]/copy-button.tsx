'use client';

import { Button } from '@/components/ui/button';

import { useState } from 'react';

// SPEC §6.5 (v0.9.2): Discord has no public profile link for a username, so the badge page offers to copy it.
export function CopyButton({ text, label, className }: { text: string; label: string; className?: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setState('copied');
    } catch {
      setState('failed'); // no clipboard (plain http, an old browser): the name is still on screen to select
    }
  }
  return (
    <>
      <Button type="button" variant="outline" size="sm" className={className} onClick={copy} aria-label={label}>
        {state === 'copied' ? '✓ Copied' : 'Copy'}
      </Button>
      {/* Always rendered, so screen readers announce each change; only the failure needs to be seen. */}
      <span role="status" className={state === 'failed' ? " [flex-basis:100%] text-muted-foreground text-[14px]" : 'sr-only'}>
        {state === 'copied' ? 'Discord username copied.' : state === 'failed' ? 'Couldn’t copy. Select the name instead.' : ''}
      </span>
    </>
  );
}
