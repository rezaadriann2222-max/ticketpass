-- TicketPass — skema PostgreSQL (sesuai ERD di SAD)
-- Jalankan: psql -U ticketpass -d ticketpass -f backend/db/schema.sql

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    full_name     TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'buyer'
                  CHECK (role IN ('buyer', 'gate_staff', 'admin')),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS events (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name          TEXT NOT NULL,
    venue         TEXT NOT NULL,
    starts_at     TIMESTAMPTZ NOT NULL,
    sale_opens_at TIMESTAMPTZ NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS seats (
    id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id  UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    section   TEXT NOT NULL,
    row_label TEXT NOT NULL,
    number    INTEGER NOT NULL CHECK (number > 0),
    price     NUMERIC(12,2) NOT NULL CHECK (price >= 0),
    UNIQUE (event_id, section, row_label, number)
);

-- NIK disimpan terenkripsi (AES-256-GCM, dilakukan di aplikasi);
-- nik_hash = HMAC-SHA256 untuk pencarian dan penegakan kuota.
CREATE TABLE IF NOT EXISTS nik_registry (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id       UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    nik_hash       TEXT NOT NULL,
    nik_encrypted  BYTEA NOT NULL,
    ticket_count   INTEGER NOT NULL DEFAULT 0 CHECK (ticket_count BETWEEN 0 AND 2),
    UNIQUE (event_id, nik_hash)
);

CREATE TABLE IF NOT EXISTS orders (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES users(id),
    event_id     UUID NOT NULL REFERENCES events(id),
    status       TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'paid', 'cancelled')),
    total_amount NUMERIC(12,2) NOT NULL CHECK (total_amount >= 0),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Pengaman akhir zero double-booking: satu kursi hanya boleh terjual sekali.
CREATE TABLE IF NOT EXISTS order_items (
    id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id  UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    event_id  UUID NOT NULL REFERENCES events(id),
    seat_id   UUID NOT NULL REFERENCES seats(id),
    UNIQUE (event_id, seat_id)
);

CREATE TABLE IF NOT EXISTS tickets (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_item_id  UUID NOT NULL UNIQUE REFERENCES order_items(id) ON DELETE CASCADE,
    secret         TEXT NOT NULL,            -- kunci HMAC untuk QR berputar
    status         TEXT NOT NULL DEFAULT 'valid'
                   CHECK (status IN ('valid', 'used', 'revoked')),
    used_at        TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS audit_log (
    id         BIGSERIAL PRIMARY KEY,
    actor_id   UUID REFERENCES users(id),
    action     TEXT NOT NULL,
    entity     TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_seats_event    ON seats(event_id);
CREATE INDEX IF NOT EXISTS idx_orders_user    ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_event   ON orders(event_id);
