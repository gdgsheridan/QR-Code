'use client';

import { createContext, useContext, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';

const subscribe = () => () => {};
const TITLES = ['The event', 'Health and access', 'Networking (optional)'];
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
    if (step < 2) { event.preventDefault(); move(step + 1); }
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
      {number < 2 && <Button type="submit">Next</Button>}
    </div>}
  </section>;
}

export function SetupPanel({ networking = false, children }: { networking?: boolean; children: ReactNode }) {
  const { active, step, move, enabled } = useContext(Walkthrough);
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (active && networking && step === 3) ref.current?.querySelector<HTMLElement>('h2')?.focus();
  }, [active, networking, step]);
  const hidden = active && (networking ? step !== 3 : step === 3);
  return <div ref={ref} hidden={hidden} className={hidden ? 'hidden' : 'contents'}>
    {children}
    {enabled && networking && <div className="flex flex-wrap gap-3">
      {active && <Button type="button" variant="outline" onClick={() => move(2)}>Back</Button>}
      <Button asChild variant="ghost"><a href="/me">Done</a></Button>
    </div>}
  </div>;
}
