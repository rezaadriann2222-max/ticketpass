# Draft Paper: Arsitektur Virtual Queue dan Seat Lock Terdistribusi untuk Penjualan Tiket Konser Anti-Scalper

## Abstrak (150-200 kata)
Masalah: lonjakan request saat war ticket dan aksi bot/calo. Metode: empat modul (antrean token Redis, kuota NIK terenkripsi, lock kursi atomik, QR dinamis HMAC). Hasil utama: zero double-booking pada uji perebutan 20 dan 100 pengguna; p95 lock turun dari 467 ms ke 141 ms setelah optimasi. Keterbatasan: target 50 ms dan 10.000 pengguna belum tercapai.
Kata kunci: virtual queue, distributed lock, Redis, PostgreSQL, anti-scalper, QR dinamis.

## 1. Pendahuluan
- Latar belakang: server crash saat penjualan tiket populer, calo dan bot.
- Rumusan masalah dan tujuan.
- Kontribusi: integrasi 4 modul, analisis bottleneck lock.

## 2. Tinjauan Pustaka
(Isi dari referensi yang Anda temukan: virtual waiting room, distributed lock Redis/Redlock, kontrol konkurensi di PostgreSQL, TOTP/HMAC. Jangan mengutip sumber yang belum Anda baca.)

## 3. Metodologi dan Arsitektur
3.1 Arsitektur umum (Nginx, API Node.js, PostgreSQL, Redis; sertakan diagram)
3.2 M1 antrean token
3.3 M2 kuota NIK: AES-256-GCM, hash, ledger
3.4 M3 lock kursi: skrip Lua SET NX PX, lapisan kedua UNIQUE (event_id, seat_id)
3.5 M4 QR: payload ticketId.step.signature, langkah 30 detik, toleransi 1 langkah, UPDATE ... WHERE used_at IS NULL
3.6 Lingkungan uji: WSL Ubuntu, Docker Compose, spesifikasi laptop

## 4. Hasil dan Pembahasan
4.1 Pengujian fungsional (tabel di README)
4.2 Zero double-booking (20 dan 100 pengguna, query duplikat 0 baris)
4.3 Latensi lock
- Sebelum: 79-106 ms (20 pengguna), 467 ms (100 pengguna)
- Temuan: 3 query PostgreSQL per lock, pool default 10 koneksi, yang kalah tetap melewati query
- Perbaikan: Redis lebih dulu, satu query validasi, pool 30
- Sesudah: 82 ms (20), 141 ms (100)
4.4 Keamanan QR (QR_EXPIRED, QR_INVALID, TICKET_USED, 403)
- Latensi validasi gerbang (100 pemindaian paralel pada satu tiket): p95 203,3 ms sebelum optimasi; setelah kunci HKDF di-cache, p95 163,2 ms dan 141,0 ms pada dua run (target SRS < 200 ms).
- Hasil atomik: tepat 1 pemindaian valid, 99 ditolak TICKET_USED (UPDATE ... WHERE used_at IS NULL).
- Catatan: klien dan server satu mesin, lewat nginx, 20 thread paralel.
4.5 Temuan bug selama integrasi: skema dan kode tidak cocok; tiket order batal menahan kursi
4.6 Keterbatasan: target 50 ms belum tercapai, 10.000 pengguna belum diuji, klien dan server satu mesin, pembayaran simulasi

## 5. Kesimpulan dan Saran
Ringkas hasil, lalu pekerjaan lanjutan: uji dengan k6 dari luar container, Redis Cluster, pengukuran gerbang < 200 ms.

## Daftar Pustaka
(Isi setelah kerangka disetujui.)
