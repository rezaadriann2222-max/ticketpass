# Setup TicketPass di Linux (WSL Ubuntu, Windows 11)

Semua perintah dijalankan di terminal Ubuntu/WSL (atau terminal VS Code Remote-WSL).

## 1. Paket dasar
```bash
sudo apt update
sudo apt install -y build-essential git curl postgresql postgresql-contrib redis-server
```

## 2. Node.js (via nvm)
```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc
nvm install 20
node -v && npm -v
```

## 3. Jalankan PostgreSQL dan Redis
WSL biasanya tanpa systemd, jadi gunakan `service`:
```bash
sudo service postgresql start
sudo service redis-server start
redis-cli ping        # harus membalas PONG
```

## 4. Buat database
```bash
sudo -u postgres psql -c "CREATE USER ticketpass WITH PASSWORD 'ticketpass';"
sudo -u postgres psql -c "CREATE DATABASE ticketpass OWNER ticketpass;"
PGPASSWORD=ticketpass psql -h localhost -U ticketpass -d ticketpass -f backend/db/schema.sql
```
Cek tabel: `PGPASSWORD=ticketpass psql -h localhost -U ticketpass -d ticketpass -c "\dt"`

## 5. Jalankan backend
```bash
cd backend
cp .env.example .env     # lalu isi JWT_SECRET dan NIK_ENCRYPTION_KEY
npm install
npm run dev
```
Isi `NIK_ENCRYPTION_KEY` dengan: `openssl rand -hex 32`

## 6. Uji
```bash
curl http://localhost:8080/api/v1/health
# {"ok":true,"postgres":"up","redis":"up"}
```

## Struktur
```
ticketpass/
├── backend/        # API (Node.js + TypeScript)
│   ├── db/schema.sql
│   └── src/index.ts
└── docs/
    ├── SAD_TicketPass.pdf
    ├── SETUP.md
    └── api/openapi.yaml
```
