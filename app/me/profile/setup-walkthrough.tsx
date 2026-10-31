'use client';

import { createContext, useContext, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';

const subscribe = () => () => {};
// v0.11.25: the emergency contact is a step again (required for a finished profile). Steps 1–3 are one form.
const TITLES = ['The event', 'Health and access', 'Emergency contact', 'Networking'];
export const LAST_FORM_STEP = 3;
const NETWORKING_STEP = 4;
const Walkthrough = createContext<{ step: number; move: (step: number) => void; active: boolean; enabled: boolean }>({ step: 1, move: () => {}, active: false, enabled: false });

export function SetupWalkthrough({ enabled, initialStep, children }: { enabled: boolean; initialStep: number; children: ReactNode }) {
  const hydrated = useSyncExternalStore(subscribe, () => true, () => false);
  const [step, setStep] = useState(initialStep);
  const active = enabled && hydrated;
  return (
    <Walkthrough value={{ step, move: setStep, active, enabled }}>
      {enabled && <div className="grid gap-2" role="status" aria-live="polite">
        <p className="m-0 text-sm text-muted-foreground">Step {step} of {TITLES.length}: {TITLES[step - 1]}</p>
        <div className="flex gap-2" aria-hidden="true">
          {TITLES.map((title, index) => <span key={title} className={`h-1 flex-1 rounded-sm ${index < step ? 'bg-accent' : 'bg-border'}`} />)}
        </div>
      </div>}
      {children}
    </Walkthrough>
  );
}

export function SetupForm({ action, className, children }: { action: (data: FormData) => Promise<void>; className: string; children: ReactNode }) {
  const { active, step, move } = useContext(Walkthrough);
  return <form action={action} className={className} noValidate={active} onSubmit={(event) => {
    if (!active) return;
    const fields = event.currentTarget.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`[data-step="${step}"] input, [data-step="${step}"] select, [data-step="${step}"] textarea`);
    for (const field of fields) {
      if (!field.reportValidity()) { event.preventDefault(); return; }
    }
    if (step < LAST_FORM_STEP) { event.preventDefault(); move(step + 1); }
  }}>{children}</form>;
}

export function SetupStep({ number, children }: { number: number; children: ReactNode }) {
  const { active, step, move, enabled } = useContext(Walkthrough);
  const ref = useRef<HTMLElement>(null);
  const previous = useRef(step);
  useLayoutEffect(() => {
    if (active && step === number && previous.current !== step) ref.current?.querySelector<HTMLElement>('h2')?.focus();
    previous.current = step;
  }, [active, step, number]);
  if (!enabled) return children;
  return <section ref={ref} data-step={number} aria-labelledby={`setup-step-${number}`} hidden={active && step !== number} className={!active ? 'contents' : step !== number ? 'hidden' : 'grid gap-[16px]'}>
    {children}
    {active && <div className="flex gap-3 [&>*]:flex-1">
      {number > 1 && <Button type="button" variant="outline" onClick={() => move(number - 1)}>Back</Button>}
      {/* Step 3's Next saves steps 1–3 and moves on to networking. */}
      {number <= LAST_FORM_STEP && <Button type="submit">Next</Button>}
    </div>}
    {/* Before hydration (or without JavaScript) every step shows at once, with one submit at the end. */}
    {!active && number === LAST_FORM_STEP && <Button type="submit">Next</Button>}
  </section>;
}

export function SetupPanel({ networking = false, listed = false, children }: { networking?: boolean; listed?: boolean; children: ReactNode }) {
  const { active, step, move, enabled } = useContext(Walkthrough);
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (active && networking && step === NETWORKING_STEP) ref.current?.querySelector<HTMLElement>('h2')?.focus();
  }, [active, networking, step]);
  const hidden = active && (networking ? step !== NETWORKING_STEP : step === NETWORKING_STEP);
  return <div ref={ref} hidden={hidden} className={hidden ? 'hidden' : 'contents'}>
    {children}
    {enabled && networking && <div className="flex flex-wrap items-center gap-3">
      {active && <Button type="button" variant="outline" onClick={() => move(LAST_FORM_STEP)}>Back</Button>}
      {/* Skip saves nothing on this step (owner's decision). */}
      <Button asChild variant="ghost"><a href="/me">Skip for now</a></Button>
      {listed && <p className="m-0 text-sm text-muted-foreground">You’ll stay listed in the Hacker directory; change it anytime on your profile.</p>}
    </div>}
  </div>;
}
