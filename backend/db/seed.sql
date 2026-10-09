-- Data contoh untuk pengembangan dan demo. Aman dijalankan berulang.
-- Jalankan: PGPASSWORD=ticketpass psql -h localhost -U ticketpass -d ticketpass -f backend/db/seed.sql

-- Event dengan penjualan SUDAH dibuka
INSERT INTO events (id, name, venue, starts_at, sale_opens_at) VALUES
  ('11111111-1111-1111-1111-111111111111',
   'Konser Demo TicketPass', 'Stadion Utama Jakarta',
   now() + interval '30 days', now() - interval '1 hour')
ON CONFLICT (id) DO NOTHING;

-- Event dengan penjualan BELUM dibuka (untuk menguji SALE_NOT_OPEN)
INSERT INTO events (id, name, venue, starts_at, sale_opens_at) VALUES
  ('22222222-2222-2222-2222-222222222222',
   'Konser Mendatang', 'Istora Senayan',
   now() + interval '60 days', now() + interval '7 days')
ON CONFLICT (id) DO NOTHING;
