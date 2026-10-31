'use client';

import { useState, type CSSProperties } from 'react';
import { Label } from '@/components/ui/label';
import { PACE } from '@/lib/domain/profile';
import { PACE_STOPS } from './pace-options';

export function PaceSlider({ value, filter = false }: { value: string; filter?: boolean }) {
  const initialStop = PACE_STOPS.findIndex((pace) => pace === value);
  const [stop, setStop] = useState(initialStop > 0 ? initialStop : filter ? 0 : 2);
  const [unset, setUnset] = useState(initialStop <= 0);
  const id = filter ? 'pace' : 'profilePace';
  const pace = PACE_STOPS[stop] ?? '';
  const label = !filter && unset ? 'No pace set' : pace ? PACE[pace] : 'Any pace';
  const color = !filter && unset ? 'var(--muted-foreground)' : {
    '': 'var(--muted-foreground)', casual: 'var(--accent)', balanced: 'var(--warn)', competitive: 'var(--bad)',
  }[pace];
  const sliderStyle = {
    '--pace-position': `${((stop - (filter ? 0 : 1)) / (filter ? 3 : 2)) * 100}%`,
    '--pace-color': color,
  } as CSSProperties;

  return <div className="grid min-w-0 gap-2">
    {!filter && <noscript>
      <style>{'.pace-enhanced { display: none; }'}</style>
      <fieldset className="grid gap-2">
        <legend>Your pace</legend>
        {PACE_STOPS.map((choice) => <Label key={choice}>
          <input type="radio" name="pace" value={choice} defaultChecked={value === choice} />
          {choice ? PACE[choice] : 'Prefer not to say'}
        </Label>)}
      </fieldset>
    </noscript>}
    <div className={filter ? 'grid gap-2' : 'pace-enhanced grid gap-2'}>
      <Label htmlFor={id}>{filter ? 'Pace' : 'Your pace'}</Label>
      <div className="pace-control" style={sliderStyle}>
        <span className="pace-visual" aria-hidden="true">
          <span className="pace-fill" /><span className="pace-thumb" />
        </span>
        <input id={id} className="pace-range" type="range" name={filter ? 'pace' : undefined}
          min={filter ? 0 : 1} max={3} step={1} value={stop} disabled={!filter && unset}
          aria-valuetext={label}
          onChange={(event) => setStop(Number(event.currentTarget.value))} />
      </div>
      <p className="m-0 flex justify-between gap-3 text-xs text-muted-foreground" aria-hidden="true">
        {filter && <span>Any</span>}<span>Learn</span><span>Balanced</span><span>Win</span>
      </p>
      {!filter && <Label>
        <input type="checkbox" className="size-[22px]" checked={unset} onChange={(event) => setUnset(event.currentTarget.checked)} />
        Prefer not to say
      </Label>}
    </div>
    {/* The no-JS radio precedes this field so FormData.get reads its choice. */}
    {!filter && <input type="hidden" name="pace" value={unset ? '' : pace} />}
  </div>;
}
