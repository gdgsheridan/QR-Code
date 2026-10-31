import { expect, it } from 'vitest';
import { directoryPace } from '@/components/pace-options';

it('T-DIR-05: pace filter accepts slider stops and legacy links; unknown values mean any pace', () => {
  for (const [stop, pace] of ['', 'casual', 'balanced', 'competitive'].entries()) {
    expect(directoryPace(String(stop))).toBe(pace);
    expect(directoryPace(pace)).toBe(pace);
  }
  for (const value of [undefined, '4', '-1', '1.5', '01', 'fast', 'toString']) {
    expect(directoryPace(value)).toBe('');
  }
});
