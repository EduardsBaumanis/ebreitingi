-- LOCAL DEVELOPMENT ONLY: sample teachers and reviews for checking page layouts.
-- npm run dev:sample        (re-runnable; replaces earlier sample rows)
-- npm run dev:sample:clear  (removes them)
-- Sample teachers have slugs starting with "paraugs-" and names ending in "(paraugs)"; cleanup
-- goes by that slug, so teachers you add yourself are never touched. Never run against staging/production.

-- Clear any earlier sample data
DELETE FROM teacher_replies      WHERE review_id IN (SELECT id FROM reviews WHERE teacher_id IN (SELECT id FROM teachers WHERE slug LIKE 'paraugs-%'));
DELETE FROM review_tags          WHERE review_id IN (SELECT id FROM reviews WHERE teacher_id IN (SELECT id FROM teachers WHERE slug LIKE 'paraugs-%'));
DELETE FROM review_scores        WHERE review_id IN (SELECT id FROM reviews WHERE teacher_id IN (SELECT id FROM teachers WHERE slug LIKE 'paraugs-%'));
DELETE FROM reviews              WHERE teacher_id IN (SELECT id FROM teachers WHERE slug LIKE 'paraugs-%');
DELETE FROM teacher_institutions WHERE teacher_id IN (SELECT id FROM teachers WHERE slug LIKE 'paraugs-%');
DELETE FROM teachers             WHERE slug LIKE 'paraugs-%';

-- Teachers (Anna works at two institutions; Pēteris has no reviews; the last one is a pending suggestion)
INSERT INTO teachers (id, full_name, name_search, slug, status, source) VALUES
  (900001, 'Anna Bērziņa (paraugs)',        'anna berzina (paraugs)',        'paraugs-anna-berzina',   'active',  'admin'),
  (900002, 'Jānis Kalniņš (paraugs)',       'janis kalnins (paraugs)',       'paraugs-janis-kalnins',  'active',  'admin'),
  (900003, 'Līga Ozola (paraugs)',          'liga ozola (paraugs)',          'paraugs-liga-ozola',     'active',  'admin'),
  (900004, 'Pēteris Liepa (paraugs)',       'peteris liepa (paraugs)',       'paraugs-peteris-liepa',  'active',  'admin'),
  (900005, 'Ieteiktais Pedagogs (paraugs)', 'ieteiktais pedagogs (paraugs)', 'paraugs-ieteiktais',     'pending', 'suggested');

INSERT INTO teacher_institutions (teacher_id, institution_id, subjects)
SELECT v.column1, i.id, v.column3
  FROM (VALUES
    (900001, '3391000218', 'Matemātiskā analīze'),   -- Latvijas Universitāte
    (900001, '3391000709', 'Augstākā matemātika'),   -- Rīgas Tehniskā universitāte
    (900002, '3391000218', 'Programmēšanas pamati'),
    (900003, '1013900258', 'Latviešu valoda'),       -- Jēkabpils 2. vidusskola
    (900004, '1013900258', 'Fizika'),
    (900005, '1013900258', 'Ķīmija')
  ) AS v
  JOIN institutions i ON i.reg_number = v.column2;

-- Reviews (overall_score is filled in below)
INSERT INTO reviews (id, teacher_id, institution_id, subject, period, comment, overall_score, status, created_at, moderated_at)
SELECT v.column1, v.column2, i.id, v.column4, v.column5, v.column6, 0, v.column7, v.column8, v.column9
  FROM (VALUES
    (900001, 900001, '3391000218', 'Matemātiskā analīze', '2025/2026',
     'Ļoti skaidri izskaidro pat sarežģītākās tēmas. Lekcijās vienmēr ir piemēri, un uz e-pastiem atbild ātri. Eksāmens grūts, bet godīgs.',
     'approved', '2026-11-10 09:00:00', '2026-11-10 12:00:00'),
    (900002, 900001, '3391000218', 'Matemātiskā analīze', '2024/2025',
     'Prasības ir augstas, bet viss ir pateikts jau pirmajā lekcijā. Konsultācijas ļoti palīdzēja.',
     'approved', '2026-11-12 09:00:00', '2026-11-12 15:00:00'),
    (900003, 900001, '3391000709', 'Augstākā matemātika', '2025/2026',
     'Tempā grūti izsekot, slaidi nav pieejami pirms lekcijas. Pati viela gan izskaidrota labi.',
     'approved', '2026-11-15 09:00:00', '2026-11-15 10:00:00'),
    (900004, 900002, '3391000218', 'Programmēšanas pamati', '2025/2026',
     'Mājasdarbu vērtēšanas kritēriji nav skaidri, un atzīmes nāk ar lielu nokavēšanos. Priekšmetu gan pārzina ļoti labi.',
     'approved', '2026-11-18 09:00:00', '2026-11-18 11:00:00'),
    (900005, 900003, '1013900258', 'Latviešu valoda', '2025/2026',
     'Stundas ir interesantas, daudz diskusiju. Vienmēr palīdz sagatavoties eksāmenam.',
     'approved', '2026-11-20 09:00:00', '2026-11-20 13:00:00'),
    (900006, 900003, '1013900258', 'Latviešu valoda', '2025/2026',
     'Gaida moderatora pārbaudi, nedrīkst parādīties publiski.',
     'pending', '2026-11-24 09:00:00', NULL)
  ) AS v
  JOIN institutions i ON i.reg_number = v.column3;

-- Criterion scores by criterion sort_order (1 Skaidrība, 2 Taisnīgums, 3 Iesaiste, 4 Pieejamība, 5 Zināšanas)
INSERT INTO review_scores (review_id, criterion_id, score)
SELECT v.column1, c.id, v.column3
  FROM (VALUES
    (900001,1,5),(900001,2,5),(900001,3,4),(900001,4,5),(900001,5,5),
    (900002,1,4),(900002,2,4),(900002,3,3),(900002,4,4),(900002,5,5),
    (900003,1,3),(900003,2,3),(900003,3,3),(900003,4,2),(900003,5,4),
    (900004,1,2),(900004,2,2),(900004,3,2),(900004,4,2),(900004,5,4),
    (900005,1,5),(900005,2,4),(900005,3,5),(900005,4,4),(900005,5,5),
    (900006,1,1),(900006,2,1),(900006,3,1),(900006,4,1),(900006,5,1)
  ) AS v
  JOIN criteria c ON c.sort_order = v.column2;

INSERT INTO review_tags (review_id, tag_id)
SELECT v.column1, t.id
  FROM (VALUES (900001,1),(900001,4),(900002,3),(900002,6),(900003,5),(900004,7),(900005,1),(900005,2)) AS v
  JOIN tags t ON t.sort_order = v.column2;

UPDATE reviews
   SET overall_score = (SELECT AVG(score) FROM review_scores WHERE review_id = reviews.id)
 WHERE id >= 900000;

-- A review a moderator redacted, and an approved teacher reply
UPDATE reviews
   SET comment_original = comment || ' Viņa tālruņa numurs ir 20000000.',
       edited_by_moderator = 1
 WHERE id = 900002;

INSERT INTO teacher_replies (review_id, body, status, created_at, moderated_at) VALUES
  (900004,
   'Paldies par atsauksmi! No nākamā semestra vērtēšanas kritēriji būs pieejami e-studijās jau pirmajā nedēļā, un mājasdarbus centīšos novērtēt nedēļas laikā.',
   'approved', '2026-11-19 10:00:00', '2026-11-19 12:00:00');

-- Cached aggregates (the real recalculation code comes in week 5; this mirrors plan.md §8)
UPDATE teachers SET
  review_count = (SELECT COUNT(*) FROM reviews WHERE teacher_id = teachers.id AND status = 'approved'),
  avg_score    = (SELECT AVG(overall_score) FROM reviews WHERE teacher_id = teachers.id AND status = 'approved')
WHERE id >= 900000;

UPDATE institutions SET
  avg_score = (
    SELECT AVG(x.teacher_avg) FROM (
      SELECT r.institution_id, AVG(r.overall_score) AS teacher_avg
        FROM reviews r JOIN teachers t ON t.id = r.teacher_id AND t.status = 'active'
       WHERE r.status = 'approved'
       GROUP BY r.institution_id, r.teacher_id
    ) x WHERE x.institution_id = institutions.id),
  rated_teachers = (
    SELECT COUNT(DISTINCT r.teacher_id) FROM reviews r JOIN teachers t ON t.id = r.teacher_id AND t.status = 'active'
     WHERE r.institution_id = institutions.id AND r.status = 'approved'),
  review_count = (
    SELECT COUNT(*) FROM reviews r JOIN teachers t ON t.id = r.teacher_id AND t.status = 'active'
     WHERE r.institution_id = institutions.id AND r.status = 'approved')
WHERE reg_number IN ('3391000218', '3391000709', '1013900258');
