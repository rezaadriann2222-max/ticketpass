-- TicketPass: skema database (sesuai SRS/SAD bagian 6.8)
-- PostgreSQL = sumber kebenaran. Constraint di sini adalah pengaman terakhir
-- untuk zero double-booking (NFR-3) dan batas 2 tiket per NIK (FR-2.3).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE seat_status  AS ENUM ('available', 'sold');
CREATE TYPE order_status AS ENUM ('pending', 'paid', 'failed', 'expired');
CREATE TYPE event_status AS ENUM ('draft', 'queue', 'on_sale', 'closed');
CREATE TYPE user_role    AS ENUM ('buyer', 'admin', 'gate_staff');

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL,
  password_hash text NOT NULL,
  role          user_role NOT NULL DEFAULT 'buyer',
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_uq ON users (lower(email));

CREATE TABLE events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text NOT NULL,
  venue            text NOT NULL,
  starts_at        timestamptz NOT NULL,
  sale_opens_at    timestamptz NOT NULL,
  queue_rate_per_s integer NOT NULL DEFAULT 50 CHECK (queue_rate_per_s > 0),
  max_per_nik      smallint NOT NULL DEFAULT 2 CHECK (max_per_nik BETWEEN 1 AND 2),
  status           event_status NOT NULL DEFAULT 'draft',
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE seats (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  section     text NOT NULL,
  row_label   text NOT NULL,
  seat_number integer NOT NULL CHECK (seat_number > 0),
  price_idr   integer NOT NULL CHECK (price_idr >= 0),
  status      seat_status NOT NULL DEFAULT 'available',
  UNIQUE (event_id, section, row_label, seat_number)
);
CREATE INDEX seats_event_status_idx ON seats (event_id, status);

-- Satu baris per (event, NIK). NIK tidak pernah disimpan polos:
--   nik_hash      = HMAC-SHA256(pepper, nik) -> untuk pembatasan kuota
--   nik_encrypted = AES-256-GCM(nik)         -> untuk verifikasi di gerbang
CREATE TABLE nik_registry (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  nik_hash      char(64) NOT NULL,
  nik_encrypted bytea NOT NULL,
  ticket_count  smallint NOT NULL DEFAULT 0 CHECK (ticket_count BETWEEN 0 AND 2),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, nik_hash)
);

CREATE TABLE orders (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users(id),
  event_id         uuid NOT NULL REFERENCES events(id),
  nik_registry_id  uuid NOT NULL REFERENCES nik_registry(id),
  status           order_status NOT NULL DEFAULT 'pending',
  ticket_qty       smallint NOT NULL CHECK (ticket_qty BETWEEN 1 AND 2),
  total_idr        integer NOT NULL CHECK (total_idr >= 0),
  created_at       timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL,
  paid_at          timestamptz
);
CREATE INDEX orders_user_idx   ON orders (user_id);
CREATE INDEX orders_status_idx ON orders (status, expires_at);

CREATE TABLE tickets (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id   uuid NOT NULL REFERENCES orders(id),
  event_id   uuid NOT NULL REFERENCES events(id),
  seat_id    uuid NOT NULL REFERENCES seats(id),
  secret_enc bytea NOT NULL,          -- rahasia HMAC untuk QR dinamis (M4), terenkripsi
  used_at    timestamptz,             -- NULL = belum dipindai
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Pengaman final zero double-booking: satu kursi hanya boleh punya satu tiket
  CONSTRAINT tickets_event_seat_uq UNIQUE (event_id, seat_id)
);
CREATE INDEX tickets_order_idx ON tickets (order_id);

CREATE TABLE audit_log (
  id         bigserial PRIMARY KEY,
  actor      text,
  action     text NOT NULL,
  ip         inet,
  meta       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_ip_time_idx ON audit_log (ip, created_at DESC);
