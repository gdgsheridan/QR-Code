import { PACE } from '@/lib/domain/profile';

export const PACE_STOPS = ['', 'casual', 'balanced', 'competitive'] as const;
export type Pace = keyof typeof PACE | '';

export function directoryPace(value: string | undefined): Pace {
  return PACE_STOPS.find((pace, stop) => value === String(stop) || value === pace) ?? '';
}
