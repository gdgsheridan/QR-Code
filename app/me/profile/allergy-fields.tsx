'use client';

import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';

import { useState } from 'react';

// SPEC F14 (v0.9): once an allergy is typed, its severity is required, so the browser asks before the form is
// sent. A refusal from the server would re-render the form with only what was saved, losing what was typed.
export function AllergyFields(props: { allergies: string; severity: string; inputClass?: string; hintClass?: string }) {
  const [text, setText] = useState(props.allergies);
  const typed = text.trim() !== '';
  return (
    <>
      <Label htmlFor="allergies">Allergies</Label>
      <Input
        id="allergies"
        name="allergies"
        maxLength={300}
        placeholder="Peanuts, shellfish… Leave empty if none"
        autoComplete="off"
        value={text}
        onChange={(e) => setText(e.target.value)}
        className={props.inputClass}
      />
      <Label htmlFor="allergySeverity">How severe?</Label>
      <NativeSelect id="allergySeverity" name="allergySeverity" required={typed} defaultValue={props.severity} className={props.inputClass}>
        <option value="">{typed ? 'Choose how severe' : 'No allergies'}</option>
        <option value="mild">Mild</option>
        <option value="moderate">Moderate</option>
        <option value="severe">Severe: life-threatening (e.g. I carry an EpiPen)</option>
      </NativeSelect>
      <p className={`copy ${props.hintClass ?? ''}`}>Separate from dietary preferences. Volunteers serving food see your allergy.</p>
    </>
  );
}
