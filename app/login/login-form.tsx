'use client';

import { Alert } from '@/components/ui/alert';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

import { useActionState, useState } from 'react';
import { sendPasswordLink, signIn } from './actions';

export function LoginForm({ next }: { next: string }) {
  const [forgot, setForgot] = useState(false);
  // Kept here, not in the action state, so a failed sign-in doesn't clear it.
  const [email, setEmail] = useState('');
  const [signInState, signInAction, signingIn] = useActionState(signIn, null);
  const [linkState, linkAction, sending] = useActionState(sendPasswordLink, null);

  if (forgot && linkState && 'sent' in linkState) {
    return (
      <div className="grid gap-[12px]">
        <Alert className="text-ok" asChild role="status"><p role="status" >
          ✓ Check your email. If that address can sign in here, we sent a link to set your password.
        </p></Alert>
        <Button type="button" variant="link" className="whitespace-normal font-normal" onClick={() => setForgot(false)}>
          Back to sign-in
        </Button>
      </div>
    );
  }
  if (forgot) {
    return (
      <form className="grid gap-[16px] [&_label_+_:is(input,_select,_textarea)]:mt-[-10px] [&_label]:text-[14px]

          [&_label]:font-medium [&_h2]:m-[12px_0px_-8px] [&_h2]:pt-[16px] [&_h2]:[border-top-width:1px]

          [&_h2]:[border-top-style:solid] [&_h2]:[border-top-color:var(--line)] [&_h2]:text-[18px]

          [&_h2:first-of-type]:mt-0 [&_h2:first-of-type]:pt-0 [&_h2:first-of-type]:[border-top:0px]" action={linkAction}>
        <input type="hidden" name="next" value={next} />
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="min-h-12 w-full" />
        <Button type="submit" disabled={sending}>
          {sending ? 'Sending…' : 'Email me a link to set my password'}
        </Button>
        <Button type="button" variant="link" className="whitespace-normal font-normal" onClick={() => setForgot(false)}>
          Back to sign-in
        </Button>
      </form>
    );
  }
  return (
    <form className="grid gap-[16px] [&_label_+_:is(input,_select,_textarea)]:mt-[-10px] [&_label]:text-[14px]

          [&_label]:font-medium [&_h2]:m-[12px_0px_-8px] [&_h2]:pt-[16px] [&_h2]:[border-top-width:1px]

          [&_h2]:[border-top-style:solid] [&_h2]:[border-top-color:var(--line)] [&_h2]:text-[18px]

          [&_h2:first-of-type]:mt-0 [&_h2:first-of-type]:pt-0 [&_h2:first-of-type]:[border-top:0px]" action={signInAction}>
      <input type="hidden" name="next" value={next} />
      <Label htmlFor="email">Email</Label>
      <Input id="email" name="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} className="min-h-12 w-full" />
      <Label htmlFor="password">Password</Label>
      <Input id="password" name="password" type="password" autoComplete="current-password" required className="min-h-12 w-full" />
      {signInState && 'error' in signInState && (
        <Alert className="text-bad" asChild><p role="alert" >
          ✕ Wrong email or password.
        </p></Alert>
      )}
      <Button type="submit" disabled={signingIn}>
        {signingIn ? 'Signing in…' : 'Sign in'}
      </Button>
      <Button type="button" variant="link" className="whitespace-normal font-normal" onClick={() => setForgot(true)}>
        Forgot or never set your password?
      </Button>
    </form>
  );
}
