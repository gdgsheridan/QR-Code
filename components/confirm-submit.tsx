'use client';

import type { ComponentProps } from 'react';
import { Button } from '@/components/ui/button';

// A submit button that asks first (v0.11.25: for actions a tap can't undo, like leaving a team). Without
// JavaScript it submits as a plain button.
export function ConfirmSubmit({ message, ...props }: ComponentProps<typeof Button> & { message: string }) {
  return <Button type="submit" {...props} onClick={(e) => { if (!window.confirm(message)) e.preventDefault(); }} />;
}
