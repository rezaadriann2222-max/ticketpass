# TicketPass

Platform tiket konser skala besar dengan virtual queue anti-scalper.
Tugas Besar #11, Pengembangan Berbasis Platform (S1 Ilmu Komputer, Universitas An Nuur).
Lingkungan: Linux (WSL Ubuntu di Windows 11). Stack: Node.js/TypeScript (Express), PostgreSQL 16, Redis 7, Nginx, Docker Compose.

## Empat modul inti

| Modul | Fungsi | Mekanisme utama |
|---|---|---|
| M1 Virtual Waiting Room | Mengatur lalu lintas pembeli ke halaman checkout | Antrean token di Redis, admit bertahap, checkout token ber-TTL |
| M2 Anti-Scalper NIK Lock | Maksimal 2 tiket per NIK | NIK dienkripsi AES-256-GCM, hash untuk pencarian, ledger kuota atomik |
| M3 Interactive Seat Picker | Pemilihan kursi pada denah SVG | Lock kursi 10 menit (Redis, skrip Lua atomik), constraint UNIQUE di PostgreSQL |
| M4 Dynamic Rolling QR | Tiket digital dengan QR berganti tiap 30 detik | Payload ditandatangani HMAC-SHA256, validasi gerbang dengan UPDATE atomik |

## Menjalankan

Prasyarat: Docker Desktop menyala, terminal Ubuntu (WSL).

1. Buat file `.env` di root proyek (file ini tidak di-commit). Isi minimal: `JWT_SECRET`, `NIK_ENCRYPTION_KEY` (64 karakter hex, buat dengan `openssl rand -hex 32`), dan variabel database dari `docker-compose.yml`.
2. Jalankan:

        cd ~/ticketpass
        docker compose up -d --build
        docker compose ps

3. Buka http://localhost:8080 (nginx menyajikan frontend dan meneruskan `/api/v1` ke API).

Port: nginx 8080, PostgreSQL 127.0.0.1:5433, Redis 127.0.0.1:6380. Port API (3000) hanya internal Docker.

## Alur pengguna

Masuk, Event, Antrean, NIK, Kursi, Pesan, Tiket.
Pembayaran disimulasikan (`ALLOW_FAKE_PAYMENT=true` di `docker-compose.yml`); payment gateway sungguhan di luar cakupan SRS.

## Peran dan akun uji

Peran: `buyer` (default saat daftar), `gate_staff`, `admin`.
Membuat petugas gerbang: daftar akun lewat UI, lalu naikkan peran:

        docker compose exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "UPDATE users SET role = '"'"'gate_staff'"'"' WHERE email = '"'"'EMAIL_ANDA'"'"';"'

Akun `seat-*@example.com` dibuat otomatis oleh skrip uji kursi dan boleh dihapus.

## Endpoint utama (prefix /api/v1)

- `POST /auth/register`, `POST /auth/login`
- `POST /events/:id/queue/join`, `GET /events/:id/queue/status`
- `GET /events/:id/seats`, `POST|DELETE /events/:id/seats/:seatId/lock`
- `POST /events/:id/orders`, `POST /orders/:id/pay`, `POST /orders/:id/cancel`
- `GET /tickets/:id/qr`
- `POST /gate/validate` (peran `gate_staff` atau `admin`)

Spesifikasi lengkap: `docs/api/openapi.yaml`. Kebutuhan: `docs/SRS_TicketPass_2407016.pdf`.

## Pengujian

Skrip ada di `backend/scripts`. Jalankan di dalam container API:

        docker compose exec -e BASE=http://localhost:3000/api/v1 -e EVENT_ID=00000000-0000-0000-0000-000000000001 -e RACE_USERS=20 api node scripts/seat-smoke.mjs

Skrip lain: `smoke:queue`, `smoke:nik`, `test:nik`, `test:seat`, `test:quota` (lihat `backend/package.json`).

### Hasil uji (apa adanya)

| Uji | Hasil |
|---|---|
| Perebutan 1 kursi oleh 20 dan 100 pengguna | Tepat 1 berhasil, sisanya 409 |
| Duplikat (event_id, seat_id) di order_items dan tickets | 0 baris |
| QR kedaluwarsa | 410 QR_EXPIRED |
| QR dengan tanda tangan diubah | 400 QR_INVALID |
| Pemindaian kedua pada tiket yang sama | 410 TICKET_USED |
| Pemindaian oleh akun buyer | 403 |
| Latensi lock kursi p95 (100 pengguna) | 467 ms sebelum optimasi, 141 ms sesudah |

Keterbatasan: target lock < 50 ms belum tercapai; konkurensi 10.000 pengguna belum diuji (skala teruji 100); klien uji dan server berjalan di mesin yang sama sehingga angka latensi ikut dipengaruhi persaingan CPU.

## Struktur repositori

- `backend/` API (modul auth, queue, identity, seat, order, ticket)
- `nginx/` konfigurasi dan frontend (`html/index.html`)
- `db/` skema dan patch PostgreSQL
- `docs/` SRS dan OpenAPI
- `loadtest/` skrip k6
