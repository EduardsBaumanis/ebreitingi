-- Migration number: 0003 	 Random per-review key used while saving a submission.
--
-- A review, its scores and its tags are inserted in one D1 batch (one transaction). The score
-- and tag inserts find their review by this random UUID. It identifies the review only, not
-- the person who wrote it.
ALTER TABLE reviews ADD COLUMN submission_key TEXT;
CREATE UNIQUE INDEX idx_reviews_submission_key ON reviews(submission_key);
