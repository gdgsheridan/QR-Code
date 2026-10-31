'use client';

import { useId, useRef, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { NativeDialog } from '@/components/ui/native-dialog';

// A submit button that asks first in the site's dialog (v0.11.25: for actions a tap can't undo, like leaving a
// team). The dialog sits inside the form, so its confirm button submits it. Without JavaScript the trigger
// submits as a plain button.
export function ConfirmSubmit({ title, message, confirmLabel, cancelLabel, children }: {
  title: string; message: string; confirmLabel: string; cancelLabel: string; children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  return <>
    <Button type="submit" variant="outline" onClick={(e) => { e.preventDefault(); dialog.current?.showModal(); }}>{children}</Button>
    <NativeDialog ref={dialog} aria-labelledby={titleId} className="w-[min(92vw,420px)]">
      <div className="grid gap-4">
        <h2 id={titleId} className="m-0 text-lg">{title}</h2>
        <p className="copy m-0 text-muted-foreground">{message}</p>
        <div className="flex flex-wrap justify-end gap-3">
          <Button type="button" variant="outline" onClick={() => dialog.current?.close()}>{cancelLabel}</Button>
          <Button type="submit" variant="destructive">{confirmLabel}</Button>
        </div>
      </div>
    </NativeDialog>
  </>;
}
