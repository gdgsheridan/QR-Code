'use client';

import { NativeDialog } from '@/components/ui/native-dialog';
import { Button } from '@/components/ui/button';

import { useEffect, useRef, useState } from 'react';
import { KIND_ICON, KIND_LABEL, type Checkpoint } from './types';

// SPEC §10.1: switching checkpoint requires confirmation (unless none is selected yet).
export function CheckpointPicker(props: {
  checkpoints: Checkpoint[];
  currentId: string | null;
  /** v0.12.1: no Web NFC on this device, so Check-in (which links each badge) is offered but can't be picked. */
  doorBlocked: boolean;
  onChoose: (id: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [pending, setPending] = useState<Checkpoint | null>(null);
  // v0.11.41 (owner's request): only open checkpoints are offered; organizers open them on the Checkpoints page.
  const open = props.checkpoints.filter((cp) => cp.isOpen);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);

  function pick(cp: Checkpoint) {
    if (props.currentId === null) props.onChoose(cp.id);
    else if (cp.id !== props.currentId) setPending(cp);
    else props.onCancel();
  }

  return (
    <NativeDialog
      ref={ref}
      className="tw-scanner-dialog w-[min(92vw,460px)] p-6 font-mono [&_h2]:mb-3 [&_h2]:text-2xl [&_h2]:tracking-tight [&_p]:text-muted-foreground [&_p]:leading-relaxed"
      aria-labelledby="picker-title"
      onCancel={(e) => {
        e.preventDefault();
        if (props.currentId !== null) props.onCancel();
      }}
    >
      {pending ? (
        <>
          <h2 id="picker-title">Switch to {pending.name}?</h2>
          <p>New scans will be recorded at {pending.name}.</p>
          <div className="flex gap-[10px] justify-end flex-wrap mt-[20px]">
            <Button type="button" variant="outline" onClick={() => setPending(null)}>
              Back
            </Button>
            <Button type="button" onClick={() => props.onChoose(pending.id)}>
              Switch to {pending.name}
            </Button>
          </div>
        </>
      ) : (
        <>
          <h2 id="picker-title">Choose your checkpoint</h2>
          {props.checkpoints.length === 0 && <p>This event has no checkpoints yet. Ask an organizer.</p>}
          {props.checkpoints.length > 0 && open.length === 0 && <p>No checkpoint is open right now. Ask an organizer to open one.</p>}
          <div className="grid gap-[10px] m-[20px_0px]">
            {open.map((cp) => (
              <Button
                key={cp.id}
                type="button"
                variant="outline" className="min-h-[58px] justify-start gap-3 rounded-md bg-raised px-4 py-3 text-left whitespace-normal aria-pressed:border-primary aria-pressed:bg-primary/10 aria-pressed:outline aria-pressed:outline-primary [&_small]:block [&_small]:mt-1 [&_small]:text-xs [&_small]:text-muted-foreground"
                aria-pressed={cp.id === props.currentId}
                disabled={props.doorBlocked && cp.kind === 'door'}
                onClick={() => pick(cp)}
              >
                <span aria-hidden="true">{KIND_ICON[cp.kind]}</span>
                <span>
                  {cp.name} <small>· {KIND_LABEL[cp.kind]}</small>
                  {props.doorBlocked && cp.kind === 'door' && <small>Check-in needs an Android phone with NFC (Chrome).</small>}
                </span>
              </Button>
            ))}
          </div>
          {props.currentId !== null && (
            <div className="flex gap-[10px] justify-end flex-wrap mt-[20px]">
              <Button type="button" variant="outline" onClick={props.onCancel}>
                Cancel
              </Button>
            </div>
          )}
        </>
      )}
    </NativeDialog>
  );
}
