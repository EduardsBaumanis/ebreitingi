-- Migration number: 0002 	 Starting criteria and tags (plan.md §3). Editable later in the CMS.

INSERT INTO criteria (label, description, sort_order) VALUES
  ('Skaidrība',   'Skaidri izskaidro mācību vielu',             1),
  ('Taisnīgums',  'Taisnīga un caurskatāma vērtēšana',          2),
  ('Iesaiste',    'Padara stundas saistošas',                   3),
  ('Pieejamība',  'Pieejams jautājumiem un palīdzībai',         4),
  ('Zināšanas',   'Labi pārzina savu mācību priekšmetu',        5);

INSERT INTO tags (label, sentiment, sort_order) VALUES
  ('Palīdzīgs',             'positive', 1),
  ('Interesantas stundas',  'positive', 2),
  ('Skaidras prasības',     'positive', 3),
  ('Grūts, bet vērtīgs',    'positive', 4),
  ('Daudz mājasdarbu',      'neutral',  5),
  ('Stingra vērtēšana',     'neutral',  6),
  ('Neskaidras prasības',   'negative', 7),
  ('Bieži kavē',            'negative', 8);
