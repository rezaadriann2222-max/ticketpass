# TicketPass

Platform tiket konser skala besar dengan virtual queue anti-scalper.

## Setup Environment
- Ubuntu 26.04.1 LTS (WSL 2, Windows 11)
- PostgreSQL 18.6
- Redis 8.0.5
- Git 2.53.0
- Node.js 24.21.0 (via nvm), npm 11.19.0

## Menjalankan Service
sudo service postgresql start
sudo service redis-server start
redis-cli ping