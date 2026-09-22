export const PURPOSES = ['Inspection', 'Canvassing', 'Adjuster meeting', 'Office', 'Supply run', 'Personal'] as const;

export function isBusiness(purpose: string | null) {
  return purpose !== 'Personal';
}
