// Keep in sync with normalize()/slugify() in scripts/build-institutions-seed.py.

const QUOTES = /["'„“”«»‘’`]/g;

/** Lowercase, strip diacritics (ā→a, š→s, …) and quotes, collapse whitespace. Used for search. */
export function normalizeForSearch(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(QUOTES, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** URL slug: "Rīgas 1. ģimnāzija" → "rigas-1-gimnazija". */
export function slugify(text: string): string {
  return normalizeForSearch(text)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
