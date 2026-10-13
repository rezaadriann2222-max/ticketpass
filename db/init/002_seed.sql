-- Data contoh untuk pengembangan. Jangan dipakai di produksi.
-- Akun admin sengaja tidak di-seed (hash password dibuat oleh aplikasi).

INSERT INTO events (id, name, venue, starts_at, sale_opens_at, queue_rate_per_s, status)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'Konser Demo TicketPass',
  'Istora Senayan, Jakarta',
  now() + interval '60 days',
  now() + interval '1 day',
  50,
  'on_sale'
);

-- 3 baris VIP x 10 kursi = 30 kursi
INSERT INTO seats (event_id, section, row_label, seat_number, price_idr)
SELECT '00000000-0000-0000-0000-000000000001', 'VIP', chr(64 + r), s, 2500000
FROM generate_series(1, 3) r, generate_series(1, 10) s;

-- 10 baris CAT1 x 20 kursi = 200 kursi
INSERT INTO seats (event_id, section, row_label, seat_number, price_idr)
SELECT '00000000-0000-0000-0000-000000000001', 'CAT1', chr(64 + r), s, 1200000
FROM generate_series(1, 10) r, generate_series(1, 20) s;
