import { describe, expect, it } from 'vitest';
import { detectDelimiter, parseCsv } from '../src/lib/csv';
import { formatLocation, formatScore, plural } from '../src/lib/format';
import { parseReplyForm } from '../src/lib/replies';
import { parseRequestForm } from '../src/lib/removal';
import { cleanComment, overallScore, parseReviewForm, schoolYears, type ReviewFormOptions } from '../src/lib/reviews';
import { likeTerms } from '../src/lib/search';
import { normalizeForSearch, slugify } from '../src/lib/slug';
import { cleanLine, teacherNameError } from '../src/lib/validate';

function form(entries: [string, string][]) {
  const f = new FormData();
  for (const [k, v] of entries) f.append(k, v);
  return f;
}

const options: ReviewFormOptions = {
  criteria: [
    { id: 1, label: 'Skaidrība', description: null },
    { id: 2, label: 'Taisnīgums', description: null },
  ],
  tags: [1, 2, 3, 4, 5, 6].map((id) => ({ id, label: `Birka ${id}`, sentiment: 'neutral' as const })),
  periods: ['2026/2027', '2025/2026'],
};
const goodComment = 'Stundas ir saprotamas, un pedagogs vienmēr palīdz.';

describe('review form', () => {
  it('accepts a complete form', () => {
    const { values, errors } = parseReviewForm(
      form([['score_1', '5'], ['score_2', '3'], ['tags', '2'], ['tags', '2'], ['subject', '  Fizika '], ['period', '2025/2026'], ['comment', goodComment], ['rules', 'on']]),
      options,
    );
    expect(errors).toEqual({});
    expect(values).toMatchObject({ scores: { 1: 5, 2: 3 }, tagIds: [2], subject: 'Fizika', period: '2025/2026' });
    expect(overallScore(values.scores)).toBe(4);
  });

  it('reports every problem at once', () => {
    const { errors } = parseReviewForm(
      form([['score_1', '6'], ['tags', '1'], ['tags', '2'], ['tags', '3'], ['tags', '4'], ['tags', '5'], ['tags', '6'], ['period', '1999/2000'], ['comment', 'par īsu']]),
      options,
    );
    expect(errors.missingCriteria).toEqual([1, 2]);
    expect(Object.keys(errors).sort()).toEqual(['comment', 'missingCriteria', 'period', 'rules', 'scores', 'tags']);
  });

  it('ignores unknown tag ids and rejects links in comments', () => {
    const { values, errors } = parseReviewForm(
      form([['score_1', '4'], ['score_2', '4'], ['tags', '999'], ['comment', 'Vairāk informācijas: www.example.com, tur viss aprakstīts.'], ['rules', 'on']]),
      options,
    );
    expect(values.tagIds).toEqual([]);
    expect(errors.comment).toMatch(/saites/);
  });

  it('counts characters, not bytes (Latvian letters)', () => {
    const comment = 'ā'.repeat(30);
    const { errors } = parseReviewForm(form([['score_1', '4'], ['score_2', '4'], ['comment', comment], ['rules', 'on']]), options);
    expect(errors.comment).toBeUndefined();
  });

  it('cleans comments but keeps paragraphs', () => {
    expect(cleanComment('  Pirmā  rinda \r\n\r\n\r\n\r\nOtrā\u0007 rinda  ')).toBe('Pirmā rinda\n\nOtrā rinda');
  });

  it('offers the current school year first (starting 1 September)', () => {
    expect(schoolYears(new Date('2026-08-31T12:00:00Z'), 2)).toEqual(['2025/2026', '2024/2025']);
    expect(schoolYears(new Date('2026-09-01T12:00:00Z'), 2)).toEqual(['2026/2027', '2025/2026']);
  });
});

describe('teacher names and text fields', () => {
  it('validates teacher names', () => {
    expect(teacherNameError('Anna Bērziņa')).toBeNull();
    expect(teacherNameError('X')).not.toBeNull();
    expect(teacherNameError('12345')).not.toBeNull();
    expect(teacherNameError('<b>Anna</b>')).not.toBeNull();
    expect(teacherNameError('anna@skola.lv')).not.toBeNull();
    expect(teacherNameError('A'.repeat(101))).not.toBeNull();
  });

  it('cleans single-line fields', () => {
    expect(cleanLine('  a\n\tb   c ', 100)).toBe('a b c');
    expect(cleanLine(null, 10)).toBe('');
    expect(cleanLine('abcdef', 3)).toBe('abc');
  });
});

describe('search and slugs', () => {
  it('ignores diacritics, case and quotes', () => {
    expect(normalizeForSearch('Rīgas  Valsts 1. Ģimnāzija')).toBe('rigas valsts 1. gimnazija');
    expect(normalizeForSearch('Iestāde „Citrus skola”')).toBe('iestade citrus skola');
    expect(slugify('Rīgas Valsts 1. ģimnāzija')).toBe('rigas-valsts-1-gimnazija');
    expect(slugify('Ķīmija & Ēšana')).toBe('kimija-esana');
  });

  it('turns a query into escaped LIKE patterns, one per word', () => {
    expect(likeTerms('Rīgas  tehn')).toEqual(['%rigas%', '%tehn%']);
    expect(likeTerms('100%_x')).toEqual(['%100\\%\\_x%']);
    expect(likeTerms('a b c d e f g h')).toHaveLength(6);
    expect(likeTerms('   ')).toEqual([]);
  });
});

describe('CSV', () => {
  it('handles quotes, escaped quotes, semicolons in fields, CRLF, BOM and blank lines', () => {
    const text = '﻿full_name;reg;subjects\r\n"Pēteris ""Pēcis"" Ozols";123;"Fizika; Ķīmija"\r\n\r\nAnna;456;\n';
    expect(parseCsv(text)).toEqual([
      ['full_name', 'reg', 'subjects'],
      ['Pēteris "Pēcis" Ozols', '123', 'Fizika; Ķīmija'],
      ['Anna', '456', ''],
    ]);
  });

  it('detects the delimiter from the first line', () => {
    expect(detectDelimiter('a;b;c\n')).toBe(';');
    expect(detectDelimiter('a\tb\tc\n')).toBe('\t');
    expect(detectDelimiter('a,b,c\n')).toBe(',');
    expect(detectDelimiter('single\n')).toBe(';');
  });
});

describe('Latvian formatting', () => {
  it('uses singular for 1, 21, 31… but not 11', () => {
    expect(plural(1, 'atsauksme', 'atsauksmes')).toBe('1 atsauksme');
    expect(plural(21, 'atsauksme', 'atsauksmes')).toBe('21 atsauksme');
    expect(plural(11, 'atsauksme', 'atsauksmes')).toBe('11 atsauksmes');
    expect(plural(0, 'atsauksme', 'atsauksmes')).toBe('0 atsauksmes');
  });

  it('formats scores with a decimal comma and locations in sentence case', () => {
    expect(formatScore(4.333)).toBe('4,3');
    expect(formatScore(3)).toBe('3,0');
    expect(formatLocation('ĶEKAVAS NOVADS')).toBe('Ķekavas novads');
    expect(formatLocation(null)).toBeNull();
  });
});

describe('reply and removal request forms', () => {
  it('validates a teacher reply', () => {
    const ok = parseReplyForm(form([['body', 'Paldies par atsauksmi, ņemšu vērā!'], ['email', ' Anna@LU.lv '], ['confirm', 'on']]));
    expect(ok.errors).toEqual({});
    expect(ok.values.email).toBe('anna@lu.lv');
    const bad = parseReplyForm(form([['body', 'īsi'], ['email', 'nav-epasts']]));
    expect(Object.keys(bad.errors).sort()).toEqual(['body', 'confirm', 'email']);
  });

  it('validates a removal request', () => {
    const ok = parseRequestForm(
      form([['name', 'Anna Bērziņa'], ['email', 'anna@lu.lv'], ['relation', 'teacher'], ['message', 'Lūdzu dzēst šo atsauksmi, tā ir nepatiesa.'], ['consent', 'on']]),
    );
    expect(ok.errors).toEqual({});
    const bad = parseRequestForm(form([['relation', 'hacker']]));
    expect(Object.keys(bad.errors).sort()).toEqual(['consent', 'email', 'message', 'name', 'relation']);
  });
});
