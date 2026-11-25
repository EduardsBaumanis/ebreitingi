const scoreFormat = new Intl.NumberFormat('lv-LV', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const intFormat = new Intl.NumberFormat('lv-LV');
const dateFormat = new Intl.DateTimeFormat('lv-LV', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Riga' });

/** 4.333 → "4,3" (Latvian decimal comma). */
export function formatScore(score: number): string {
  return scoreFormat.format(score);
}

export function formatInt(n: number): string {
  return intFormat.format(n);
}

const monthFormat = new Intl.DateTimeFormat('lv-LV', { month: 'long', year: 'numeric', timeZone: 'Europe/Riga' });

function parseSqliteUtc(sqliteUtc: string): Date {
  return new Date(sqliteUtc.replace(' ', 'T') + 'Z');
}

/** D1 datetime('now') strings are UTC "YYYY-MM-DD HH:MM:SS". */
export function formatDate(sqliteUtc: string): string {
  return dateFormat.format(parseSqliteUtc(sqliteUtc));
}

/**
 * Month and year only ("2026. g. novembris"). Used for public review dates: an exact
 * timestamp would make it easier to guess who wrote a review.
 */
export function formatMonth(sqliteUtc: string): string {
  return monthFormat.format(parseSqliteUtc(sqliteUtc));
}

/**
 * Latvian noun agreement: 1, 21, 31 … take the singular; everything else (incl. 11) the plural.
 * plural(3, 'atsauksme', 'atsauksmes') → "3 atsauksmes"
 */
export function plural(n: number, one: string, other: string): string {
  const word = n % 10 === 1 && n % 100 !== 11 ? one : other;
  return `${formatInt(n)} ${word}`;
}

/** Export locations are uppercase ("ĶEKAVAS NOVADS") → "Ķekavas novads". */
export function formatLocation(location: string | null): string | null {
  if (!location) return null;
  const lower = location.toLocaleLowerCase('lv');
  return lower.charAt(0).toLocaleUpperCase('lv') + lower.slice(1);
}

export type ScoreLevel = 'high' | 'mid' | 'low' | 'none';

export function scoreLevel(score: number | null): ScoreLevel {
  if (score == null) return 'none';
  if (score >= 4) return 'high';
  if (score >= 3) return 'mid';
  return 'low';
}
