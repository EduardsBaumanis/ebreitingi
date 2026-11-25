import { normalizeForSearch } from './slug';

const MAX_TERMS = 6;
const MAX_QUERY_LENGTH = 100;

/**
 * Turns a user query into LIKE patterns, one per word, all of which must match.
 * "rigas 1. gimn" → ['%rigas%', '%1.%', '%gimn%']. Use with `LIKE ? ESCAPE '\'`.
 */
export function likeTerms(query: string): string[] {
  const normalized = normalizeForSearch(query.slice(0, MAX_QUERY_LENGTH));
  return normalized
    .split(' ')
    .filter(Boolean)
    .slice(0, MAX_TERMS)
    .map((term) => `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
}

/** SQL fragment + bindings matching every term against `column`. */
export function likeClause(column: string, terms: string[]): { sql: string; binds: string[] } {
  return {
    sql: terms.map(() => `${column} LIKE ? ESCAPE '\\'`).join(' AND '),
    binds: terms,
  };
}
