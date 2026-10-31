'use client';

import { Button } from '@/components/ui/button';

import Link from 'next/link';
import { useSyncExternalStore } from 'react';

const subscribe = (onChange: () => void) => {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
};

// The link's token arrives in the URL fragment, which browsers never send to the server (like I-3).
// It leaves the page only in the POST that spends it.
export function ConfirmForm(props: { action: (form: FormData) => Promise<void>; type: string; next: string }) {
  const tokenHash = useSyncExternalStore(subscribe, () => window.location.hash.replace(/^#/, ''), () => null);
  // null on the server (the fragment is unknown there); '' once the browser shows the link lost its token,
  // e.g. a mail app or a copy-paste dropped everything after the #.
  if (tokenHash === '') {
    return (
      <p className="copy">
        This link is incomplete. <Link className="underline inline-flex min-h-11 items-center" href="/login?error=link">Request a new one</Link>.
      </p>
    );
  }
  return (
    <form action={props.action} className="grid gap-[16px] [&_label_+_:is(input,_select,_textarea)]:mt-[-10px] [&_label]:text-[14px]

          [&_label]:font-medium [&_h2]:m-[12px_0px_-8px] [&_h2]:pt-[16px] [&_h2]:[border-top-width:1px]

          [&_h2]:[border-top-style:solid] [&_h2]:[border-top-color:var(--line)] [&_h2]:text-[18px]

          [&_h2:first-of-type]:mt-0 [&_h2:first-of-type]:pt-0 [&_h2:first-of-type]:[border-top:0px]">
      <input type="hidden" name="token_hash" value={tokenHash ?? ''} />
      <input type="hidden" name="type" value={props.type} />
      <input type="hidden" name="next" value={props.next} />
      <Button type="submit" disabled={!tokenHash}>
        Continue
      </Button>
    </form>
  );
}
