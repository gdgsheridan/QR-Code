import type { CheckpointKind } from '@/lib/scanner/result-view';

export interface Checkpoint {
  id: string;
  name: string;
  kind: CheckpointKind;
  isOpen: boolean;
  requiresCheckin: boolean;
  capacity: number | null;
}

export const KIND_LABEL: Record<CheckpointKind, string> = { door: 'Door', meal: 'Meal', session: 'Session', custom: 'Custom' };
export const KIND_ICON: Record<CheckpointKind, string> = { door: '🚪', meal: '🍽', session: '🎤', custom: '★' };

// localStorage holds scanner preferences only (CLAUDE.md), never participant data.
export const checkpointKey = (slug: string) => `station:checkpoint:${slug}`;
export const CAMERA_KEY = 'station:camera';
export const NFC_KEY = 'station:nfc';
/** Camera or NFC badges, one at a time (§10.1, v0.8.1). */
export const INPUT_KEY = 'station:input';
export type InputMode = 'camera' | 'nfc';

export function readPref(key: string): string | null {
  try {
    return window.localStorage.getItem(key) ?? window.localStorage.getItem(legacyPrefKey(key));
  } catch {
    return null;
  }
}

export function writePref(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // private mode: the preference just isn't remembered
  }
}

/** The same preference under its pre-rename `passline:` key, so phones keep their checkpoint and camera (v0.11.21). */
export const legacyPrefKey = (key: string) => key.replace(/^station:/, 'passline:');
