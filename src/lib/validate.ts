/** Trim, collapse whitespace and drop control characters from a single-line value. */
export function cleanLine(value: unknown, maxLength: number): string {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

export const NAME_MAX = 100;
export const SUBJECTS_MAX = 200;

/** Returns an error message (Latvian) or null when the teacher name is acceptable. */
export function teacherNameError(name: string): string | null {
  if (name.length < 3) return 'Vārdam jābūt vismaz 3 rakstzīmes garam.';
  if (name.length > NAME_MAX) return `Vārds nedrīkst būt garāks par ${NAME_MAX} rakstzīmēm.`;
  if (!/\p{L}/u.test(name)) return 'Vārdā jābūt burtiem.';
  if (/[<>@]|https?:/i.test(name)) return 'Vārdā nedrīkst būt saites, e-pasti vai simboli < >.';
  return null;
}

export function positiveInt(value: unknown): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}
