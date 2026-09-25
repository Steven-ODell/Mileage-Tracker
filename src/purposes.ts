export const PURPOSES = ['Inspection', 'Final walk', 'Canvassing', 'Adjuster meeting', 'Office', 'Supply run', 'Personal'] as const;

export function isBusiness(purpose: string | null) {
  return purpose !== 'Personal';
}

// A leg's purpose is either a preset button or, when he typed a reason and
// picked no button, that typed text (so the CSV's purpose column is never
// blank for it). These two convert between what's stored and what the
// picker shows: a button selection plus the text box.

// Stored → picker. A typed purpose goes back into the text box with no button
// lit, so saving it untouched stores the same thing again.
export function toPicker(purpose: string | null, note: string | null): { chip: string | null; text: string } {
  if (purpose == null || (PURPOSES as readonly string[]).includes(purpose)) {
    return { chip: purpose, text: note ?? '' };
  }
  return { chip: null, text: [purpose, note].filter(Boolean).join('; ') };
}

// Picker → stored. Null purpose means neither was given.
export function fromPicker(chip: string | null, text: string): { purpose: string | null; note: string | null } {
  const t = text.trim() || null;
  return chip ? { purpose: chip, note: t } : { purpose: t, note: null };
}
