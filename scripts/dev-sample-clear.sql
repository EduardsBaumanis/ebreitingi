-- LOCAL DEVELOPMENT ONLY: removes the rows added by dev-sample-data.sql (teachers with "paraugs-" slugs).
DELETE FROM teacher_replies      WHERE review_id IN (SELECT id FROM reviews WHERE teacher_id IN (SELECT id FROM teachers WHERE slug LIKE 'paraugs-%'));
DELETE FROM review_tags          WHERE review_id IN (SELECT id FROM reviews WHERE teacher_id IN (SELECT id FROM teachers WHERE slug LIKE 'paraugs-%'));
DELETE FROM review_scores        WHERE review_id IN (SELECT id FROM reviews WHERE teacher_id IN (SELECT id FROM teachers WHERE slug LIKE 'paraugs-%'));
DELETE FROM reviews              WHERE teacher_id IN (SELECT id FROM teachers WHERE slug LIKE 'paraugs-%');
DELETE FROM teacher_institutions WHERE teacher_id IN (SELECT id FROM teachers WHERE slug LIKE 'paraugs-%');
DELETE FROM teachers             WHERE slug LIKE 'paraugs-%';

UPDATE institutions SET avg_score = NULL, rated_teachers = 0, review_count = 0
 WHERE reg_number IN ('3391000218', '3391000709', '1013900258');
