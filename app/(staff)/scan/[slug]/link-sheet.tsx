'use client';

import { NativeDialog } from '@/components/ui/native-dialog';
import { Button } from '@/components/ui/button';

import { useEffect, useRef } from 'react';
import type { linkNotice } from '@/lib/domain/badge';
import type { NfcState } from '@/lib/scanner/nfc';

export type LinkState = { kind: 'waiting'; unreadable?: boolean } | { kind: 'saving' } | { kind: 'result'; notice: ReturnType<typeof linkNotice>; linked: boolean };

export function LinkSheet(props: {
  name: string;
  state: LinkState;
  readerState: NfcState;
  readerError: string | null;
  onStart: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);

  return (
    <NativeDialog
      ref={ref}
      className="tw-scanner-dialog w-[min(92vw,460px)] p-6 font-mono [&_h2]:mb-3 [&_h2]:text-2xl [&_h2]:tracking-tight [&_p]:text-muted-foreground [&_p]:leading-relaxed"
      aria-labelledby="link-title"
      onCancel={(e) => {
        e.preventDefault();
        props.onClose();
      }}
      // Chrome closes the dialog itself on a second Back/Escape. Ignore a queued close event from our own
      // effect cleanup (React runs effects twice in development) that finds the dialog open again.
      onClose={() => {
        if (!ref.current?.open) props.onClose();
      }}
    >
      <h2 id="link-title">Link a badge</h2>
      <p>Tap the badge to link it to {props.name}.</p>
      <div aria-live="polite" aria-atomic="true">
        {props.state.kind === 'waiting' && props.state.unreadable && <p>Couldn’t read that badge. Hold it still and tap again.</p>}
        {props.state.kind === 'saving' && <p>Linking badge…</p>}
        {props.state.kind === 'result' && <p className="[overflow-wrap:anywhere] [&[data-tone='bad']]:text-bad" data-tone={props.state.notice.tone}>{props.state.notice.text}</p>}
        {props.state.kind === 'waiting' && props.readerError && <p className="[overflow-wrap:anywhere] [&[data-tone='bad']]:text-bad" data-tone="bad">✕ {props.readerError}</p>}
        {props.state.kind === 'waiting' && props.readerState === 'starting' && <p>Starting badge reader…</p>}
      </div>
      <div className="flex gap-[10px] justify-end flex-wrap mt-[20px]">
        {props.state.kind === 'waiting' && props.readerState === 'off' && (
          <Button type="button" onClick={props.onStart}>
            Start badge reader
          </Button>
        )}
        <Button type="button" variant="outline" onClick={props.onClose} autoFocus>
          {props.state.kind === 'result' ? 'Done' : 'Cancel'}
        </Button>
      </div>
    </NativeDialog>
  );
}
