-- Penyelarasan skema Docker dengan kode backend/

ALTER TABLE users ADD COLUMN IF NOT EXISTS full_name TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS order_items (
    id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id  UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    event_id  UUID NOT NULL REFERENCES events(id),
    seat_id   UUID NOT NULL REFERENCES seats(id),
    UNIQUE (event_id, seat_id)
);

CREATE TABLE IF NOT EXISTS nik_quota_ledger (
    order_id   UUID PRIMARY KEY REFERENCES orders(id),
    event_id   UUID NOT NULL,
    nik_hash   TEXT NOT NULL,
    qty        INTEGER NOT NULL CHECK (qty BETWEEN 1 AND 2),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (event_id, nik_hash)
        REFERENCES nik_registry (event_id, nik_hash) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_nik_quota_ledger_nik
    ON nik_quota_ledger (event_id, nik_hash);
