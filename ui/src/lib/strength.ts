// A rough master-password strength hint for the create form. Length and character
// variety only; it is guidance, not a policy (the core enforces the minimum length).

export interface Strength {
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
  meter: string;
  textClass: string;
}

export function passwordStrength(pw: string): Strength {
  if (!pw) return { score: 0, label: '', meter: '', textClass: 'faint' };
  let classes = 0;
  if (/[a-z]/.test(pw)) classes++;
  if (/[A-Z]/.test(pw)) classes++;
  if (/[0-9]/.test(pw)) classes++;
  if (/[^a-zA-Z0-9]/.test(pw)) classes++;
  const words = pw.split(/[\s\-_.]+/).filter((w) => w.length >= 3).length;
  let score = 0;
  if (pw.length >= 8) score = 1;
  if (pw.length >= 12 && classes >= 2) score = 2;
  if ((pw.length >= 16 && classes >= 2) || words >= 3) score = 3;
  if ((pw.length >= 20 && classes >= 2) || words >= 4) score = 4;
  if (pw.length < 8) return { score: 1, label: 'Too short', meter: 'weak', textClass: 'danger-t' };
  const table: Record<number, Strength> = {
    1: { score: 1, label: 'Weak', meter: 'weak', textClass: 'danger-t' },
    2: { score: 2, label: 'Fair — add a word', meter: 'fair', textClass: 'warn-t' },
    3: { score: 3, label: 'Good', meter: '', textClass: 'ok-t' },
    4: { score: 4, label: 'Strong', meter: '', textClass: 'ok-t' },
  };
  return table[score];
}
