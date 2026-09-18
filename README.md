# 🏭 Almoxarifado Inteligente — Intelligent Warehouse Management System

[![Node.js](https://img.shields.io/badge/Node.js-24.x-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express-5.x-000000?logo=express&logoColor=white)](https://expressjs.com/)
[![SQLite](https://img.shields.io/badge/SQLite-3.x-003B57?logo=sqlite&logoColor=white)](https://sqlite.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white)](Dockerfile)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Security](https://img.shields.io/badge/Security-Hardened-brightgreen)](SECURITY.md)
[![CI](https://github.com/VictorHugoEng/AlmoxarifadoProject/actions/workflows/ci.yml/badge.svg)](https://github.com/VictorHugoEng/AlmoxarifadoProject/actions/workflows/ci.yml)

> **Enterprise modular monolith**: robust authentication, RBAC, local + Google Drive backups, automatic recovery, private chat, immutable audit trail and over-the-air updates. Built for critical environments where **data loss is not an option**.

🇧🇷 [Leia em Português](README.pt-BR.md)

---

## 🎯 Overview

| Feature           | Description                                                              |
| ----------------- | ------------------------------------------------------------------------ |
| **Domain**        | Industrial / corporate warehouse + metrology                             |
| **Architecture**  | Modular monolith in `src/` (routes, services, isolated database drivers) |
| **Database**      | Native SQLite (`node:sqlite`, WAL) **or** PostgreSQL 16 (plug-in driver) |
| **Auth**          | 256-bit tokens + scrypt + rate limiting + brute-force protection         |
| **RBAC**          | `ADMIN_MASTER`, `OPERADOR`, `COMPRAS`, `CONSULTA`                        |
| **Backup**        | Local (30 days) + Google Drive (continuous) + automatic boot recovery    |
| **Chat**          | 1-to-1 messages with images stored in DB + notifications                 |
| **OTA Updates**   | Over-the-air via Google Drive (code + version)                           |
| **Observability** | Full audit trail + `/healthz` for platforms                              |
| **Deploy**        | Docker, Render (blueprint), PM2, Systemd                                 |

---

## 📸 Screenshots

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/dashboard.png" alt="Dashboard"><br><sub><b>Dashboard</b> — indicators and critical stock alerts</sub></td>
    <td width="50%"><img src="docs/screenshots/estoque.png" alt="Inventory"><br><sub><b>Warehouse</b> — items, categories and critical level</sub></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/calibracao.png" alt="Calibration"><br><sub><b>Metrology</b> — equipment and expirations</sub></td>
    <td><img src="docs/screenshots/compras.png" alt="Purchasing"><br><sub><b>Purchasing</b> — status flow and feedback</sub></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/chat.png" alt="Chat"><br><sub><b>Chat</b> — 1-to-1 messages with attachments</sub></td>
    <td><img src="docs/screenshots/administrador.png" alt="Admin"><br><sub><b>Admin</b> — users, audit and backup</sub></td>
  </tr>
</table>

---

## 🏗️ Architecture

```
┌───────────────────────────────────────────────────────────────────┐
│                    CLIENT (Browser / PWA)                         │
│           Vanilla JS  +  Service Worker  +  localStorage          │
└──────────────────────────────┬────────────────────────────────────┘
                               │ HTTPS (polling)
                               ▼
┌───────────────────────────────────────────────────────────────────┐
│              NODE.JS 24 — EXPRESS 5  (src/)                       │
│                                                                   │
│  src/app.js        middleware pipeline + route mounting           │
│  src/index.js      entry: database → services → listen            │
│  src/routes/       auth, usuarios, estoque, equipamentos,         │
│                    compras, chat, notificacoes, nuvem (+OTA)      │
│  src/database.js   schema, crypto, seed, migrations, recovery     │
│  src/db/drivers/   sqlite.js  │  postgres.js  (same interface)    │
│  src/nuvem.js      Google Drive OAuth + continuous backup + OTA   │
│  src/backup.js     scheduled local backups + history              │
│  src/auth.js       sessions, RBAC, security logs                  │
│  src/middlewares.js rate limit + headers + parsers                │
│  src/helpers.js    data enrichment + utilities                    │
│                                                                   │
│      ▼ auth  →  ▼ rate limit  →  ▼ routes (with audit log)       │
└──────────────────────────────┬────────────────────────────────────┘
                               │
                  ┌────────────┴─────────────┐
                  ▼                          ▼
        ┌─────────────────┐       ┌────────────────────┐
        │    SQLite WAL   │       │     PostgreSQL     │
        │   (native)      │       │  16 (pg, plug-in)  │
        └────────▲────────┘       └─────────┬──────────┘
                 │                          │
        Local backups (30d)       (local backups SQLite-only)
        Google Drive (continuous) OTA and cloud sync unchanged
        Boot-time auto-recovery
```

**Single DB interface:** `src/db/` exposes `exec()` + `prepare()` (with `run/get/all`)
for **any** engine. Routes do not know whether the database is SQLite or PostgreSQL —
just change `DB_DRIVER` and set `DATABASE_URL`.

---

## 🚀 Quick Start

### Prerequisites

- **Node.js 24** (uses `node:sqlite` for the default driver; supported range: `>=22.13`)
- **npm 10+**
- Google Cloud account (only for Google Drive sync)

### Local Installation

```bash
git clone https://github.com/VictorHugoEng/AlmoxarifadoProject.git
cd AlmoxarifadoProject

npm ci
npm start
# Server running at http://localhost:3000
```

### Default Credentials (first run)

```
Username: anderson
Password: 123456   (change via ALMOX_ADMIN_PASSWORD or the admin panel)
Role:     ADMIN_MASTER
```

> ⚠️ **Change the password immediately after the first login.**

---

## ⚙️ Configuration

Copy and edit `.env.example`; the variables below drive the system:

| Variable               | Default               | Description                                               |
| ---------------------- | --------------------- | --------------------------------------------------------- |
| `PORT`                 | `3000`                | HTTP port (injected by Render in production)              |
| `HOST`                 | `127.0.0.1`           | Local listen; use `0.0.0.0` in containers / PaaS          |
| `DB_DRIVER`            | `sqlite`              | Engine: `sqlite` or `postgres`                            |
| `DATABASE_URL`         | `''`                  | Connection URL `postgres://user:pass@host:5432/db` (pg)   |
| `ALMOX_DB_PATH`        | `./voltstock.db`      | SQLite file (setting it disables boot recovery)           |
| `ALMOX_CONFIG_PATH`    | `./nuvem_config.json` | Google credentials file (gitignored)                      |
| `ALMOX_ADMIN_PASSWORD` | `123456`              | Initial admin password (first boot only; idempotent seed) |
| `ALMOX_NO_RECOVER`     | —                     | Set `1` to disable automatic backup recovery (tests)      |

> Google Drive credentials are **not** environment variables: you enter them in
> **Admin → Cloud** and the system stores them in `nuvem_config.json` (gitignored).

### Switching to PostgreSQL

```bash
DB_DRIVER=postgres DATABASE_URL=postgres://usr:pass@host:5432/almox npm start
```

On the first boot the system creates the full schema (tables, indexes, `BIGSERIAL` / `BYTEA`
types), runs migrations and the idempotent seed — all automatically.

Run the test suite against PostgreSQL the same way (the CI does this on every push):

```bash
DB_DRIVER=postgres DATABASE_URL=postgres://usr:pass@host:5432/almox npm test
```

> **Note:** local backups + auto-recovery are SQLite-only. With PostgreSQL, Google Drive
> sync and OTA updates continue to work as normal.

### Google Drive Sync (production)

1. Visit the [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project → APIs → **Google Drive API** → Enable
3. Credentials → **OAuth 2.0 Client ID** (Application type: Web)
4. Authorized redirect URIs: `https://YOUR-DOMAIN/api/nuvem/oauth2/callback`
5. In the system: **Admin → Cloud** → paste Client ID/Secret → **Connect**

---

## 📚 API Reference

Specification (OpenAPI 3.0): [`docs/api/openapi.yaml`](docs/api/openapi.yaml) — validate with `npx redocly lint docs/api/openapi.yaml`.

All routes live under `/api` (mounted in `src/app.js`). Sensitive mutations
are automatically recorded in the security audit trail.

### Authentication & Session

| Method | Endpoint      | Description                       |
| ------ | ------------- | --------------------------------- |
| `POST` | `/api/login`  | Login (rate limit: 10/min per IP) |
| `GET`  | `/api/sessao` | Validate active session           |
| `POST` | `/api/logout` | End session                       |

### Inventory & Categories

| Method   | Endpoint                     | RBAC          | Description                                             |
| -------- | ---------------------------- | ------------- | ------------------------------------------------------- |
| `GET`    | `/api/estoque`               | authenticated | List / filter (`busca`, `categoria`, `apenas_criticos`) |
| `POST`   | `/api/estoque`               | authenticated | Create item (unique code)                               |
| `PATCH`  | `/api/estoque/:id/movimento` | authenticated | `{ delta }` moves stock + logs history + fires alerts   |
| `PUT`    | `/api/estoque/:id`           | authenticated | Edit item                                               |
| `DELETE` | `/api/estoque/:id`           | ADMIN_MASTER  | Delete item                                             |
| `GET`    | `/api/categorias`            | authenticated | List categories                                         |
| `POST`   | `/api/categorias`            | ADMIN_MASTER  | Create category                                         |
| `PUT`    | `/api/categorias/:id`        | ADMIN_MASTER  | Rename category                                         |
| `DELETE` | `/api/categorias/:id`        | ADMIN_MASTER  | Delete category                                         |

### Equipment & Calibration (Metrology)

| Method   | Endpoint                | RBAC          | Description                  |
| -------- | ----------------------- | ------------- | ---------------------------- |
| `GET`    | `/api/equipamentos`     | authenticated | List with calibration status |
| `POST`   | `/api/equipamentos`     | authenticated | Register equipment           |
| `PUT`    | `/api/equipamentos/:id` | authenticated | Update / renew calibration   |
| `DELETE` | `/api/equipamentos/:id` | ADMIN_MASTER  | Delete equipment             |

### Purchasing, Recipients & Alerts

| Method  | Endpoint                         | RBAC          | Description                    |
| ------- | -------------------------------- | ------------- | ------------------------------ |
| `GET`   | `/api/compras`                   | authenticated | List purchase requests         |
| `POST`  | `/api/compras`                   | authenticated | New request + alert            |
| `PATCH` | `/api/compras/:id/status`        | COMPRAS+      | Update status                  |
| `PATCH` | `/api/compras/:id/feedback`      | COMPRAS+      | Purchasing department feedback |
| `GET`   | `/api/destinatarios`             | authenticated | List alert recipients          |
| `PUT`   | `/api/destinatarios/:id`         | authenticated | Edit recipient                 |
| `GET`   | `/api/alertas/resumo`            | authenticated | Active alerts summary          |
| `POST`  | `/api/alertas/disparar-multiplo` | authenticated | Fire batch alerts              |

### Private Chat

| Method | Endpoint                   | Description                      |
| ------ | -------------------------- | -------------------------------- |
| `GET`  | `/api/chat/contatos`       | Contacts + last message + unread |
| `GET`  | `/api/chat/:id`            | Conversation history             |
| `POST` | `/api/chat/:id`            | Send text/photo (up to 12 MB)    |
| `POST` | `/api/chat/:id/lidas`      | Mark as read                     |
| `GET`  | `/api/chat/naolidas/total` | Unread badge count               |
| `GET`  | `/api/chat/midia/:id`      | Serve image (random public id)   |

### Notifications & Observations

| Method   | Endpoint                      | Description                   |
| -------- | ----------------------------- | ----------------------------- |
| `GET`    | `/api/notificacoes`           | User notifications            |
| `POST`   | `/api/notificacoes/lidas`     | Mark read (`{ ids }` or `{}`) |
| `GET`    | `/api/observacoes`            | List observations             |
| `POST`   | `/api/observacoes`            | Create observation            |
| `DELETE` | `/api/observacoes/:id`        | Remove observation            |
| `PATCH`  | `/api/observacoes/:id/status` | Resolve observation           |

### Admin: Users & Audit

| Method   | Endpoint                        | RBAC         | Description                  |
| -------- | ------------------------------- | ------------ | ---------------------------- |
| `GET`    | `/api/usuarios`                 | ADMIN_MASTER | List users                   |
| `POST`   | `/api/usuarios`                 | ADMIN_MASTER | Create user / RBAC           |
| `PUT`    | `/api/usuarios/:id`             | ADMIN_MASTER | Edit / role / reset password |
| `DELETE` | `/api/usuarios/:id`             | ADMIN_MASTER | Delete (last-admin guard)    |
| `POST`   | `/api/usuarios/:id/desbloquear` | ADMIN_MASTER | Unlock brute-force lock      |
| `GET`    | `/api/auditoria`                | ADMIN_MASTER | Last 200 security events     |

### Cloud, Backup & OTA

| Method | Endpoint                     | RBAC          | Description                          |
| ------ | ---------------------------- | ------------- | ------------------------------------ |
| `GET`  | `/api/nuvem/status`          | public        | Connection state (login screen)      |
| `GET`  | `/api/nuvem/login`           | public        | Redirects to Google OAuth            |
| `GET`  | `/api/nuvem/oauth2/callback` | public        | Google return                        |
| `POST` | `/api/nuvem/config`          | ADMIN_MASTER  | Save credentials                     |
| `POST` | `/api/nuvem/desconectar`     | ADMIN_MASTER  | Disconnect Google account            |
| `POST` | `/api/nuvem/enviar`          | ADMIN_MASTER  | Push backup to cloud now             |
| `POST` | `/api/nuvem/restaurar`       | ADMIN_MASTER  | Download latest from cloud           |
| `POST` | `/api/backup`                | ADMIN_MASTER  | Manual backup                        |
| `GET`  | `/api/backup/status`         | ADMIN_MASTER  | Backup locations and history         |
| `GET`  | `/api/atualizacao/status`    | ADMIN_MASTER  | Current version vs cloud version     |
| `POST` | `/api/atualizacao/aplicar`   | ADMIN_MASTER  | Apply OTA package + restart          |
| `GET`  | `/api/versao`                | authenticated | App version (triggers client reload) |
| `GET`  | `/healthz`                   | public        | Health check for platforms (uptime)  |

---

## 🛡️ Security (Hardening)

| Layer           | Implementation                                                 |
| --------------- | -------------------------------------------------------------- |
| **Passwords**   | scrypt (N=16384, r=8, p=1) + 16-byte salt + `timingSafeEqual`  |
| **Sessions**    | 256-bit token (`crypto.randomBytes`) + configurable expiry     |
| **Rate Limit**  | Per-IP and per-route (login 10/min, general API 120/min)       |
| **Brute Force** | 15-minute lockout after 5 failures + audit trail               |
| **Headers**     | Strict CSP, HSTS, X-Frame-Options, Permissions-Policy          |
| **Uploads**     | Chat images stored as bytes in DB (4 MB / 250 MB total cap)    |
| **Audit**       | Immutable log: logins, RBAC changes, critical CRUD, cloud, OTA |
| **Recovery**    | Auto-restore local → cloud → fresh DB at boot                  |

---

## 🧪 Code Quality

```bash
npm run lint          # ESLint
npm run format        # Prettier (writes)
npm run format:check  # Prettier (checks)
npm test              # Smoke test: server boot + login + healthz
npm audit             # Dependency audit
```

The CI pipeline [`ci.yml`](.github/workflows/ci.yml) runs lint → format → audit →
tests → syntax verification on every push / PR to `main` and `develop`.

---

## 📦 Project Structure

```
AlmoxarifadoProject/
├── src/                      # ⭐ Source (all logic lives here)
│   ├── index.js              # Entry: database → services → listen
│   ├── app.js                # Express: middleware pipeline + routes
│   ├── config.js             # Centralized env config
│   ├── database.js           # Schema, crypto, migrations, seed, recovery
│   ├── auth.js               # Sessions, RBAC, security audit
│   ├── middlewares.js        # Rate limit, headers, body parsers
│   ├── helpers.js            # Utilities and data enrichment
│   ├── backup.js             # Scheduled local backups
│   ├── nuvem.js              # Google Drive OAuth + OTA
│   ├── db/
│   │   ├── index.js          # Driver selection (sqlite | postgres)
│   │   ├── schema-sqlite.js  # SQLite DDL
│   │   ├── schema-postgres.js# PostgreSQL DDL (BIGSERIAL/BYTEA/tz)
│   │   └── drivers/
│   │       ├── sqlite.js     # async exec/prepare over node:sqlite
│   │       └── postgres.js   # same interface over pg (Pool)
│   └── routes/               # One module per domain (express.Router)
│       ├── auth.js ├── usuarios.js ├── estoque.js
│       ├── equipamentos.js ├── compras.js ├── chat.js
│       ├── notificacoes.js └── nuvem.js
├── public/                   # Static frontend (offline-first PWA)
│   ├── index.html ├── login.html ├── app.js
│   ├── style.css ├── sw.js └── manifest.webmanifest
├── test/
│   └── smoke.test.js         # Smoke: boot + login + public endpoints
├── .github/workflows/ci.yml  # Full CI/CD pipeline
├── Dockerfile                # Node 24 Alpine image + HEALTHCHECK
├── render.yaml               # Render blueprint (1-click deploy)
├── .env.example              # Documented environment variables
└── backups/                  # Local backups (gitignored)
```

---

## 🚢 Production Deployment

### Docker (any cloud)

```bash
docker build -t almoxarifado .
docker run -d -p 3000:3000 \
  -e ALMOX_ADMIN_PASSWORD=change-me \
  -v almox_data:/app \
  almoxarifado
```

The image ships with a `HEALTHCHECK` and is the base for Render deployments.

### Render (blueprint included)

The file [`render.yaml`](render.yaml) enables **1-click deploy**:

> `https://render.com/deploy?repo=https://github.com/VictorHugoEng/AlmoxarifadoProject`

- Runtime: Docker (deterministic image from `Dockerfile`)
- Health check: `/healthz`
- Env vars: `NODE_ENV`, `HOST`, `ALMOX_ADMIN_PASSWORD`
- Free plan with automatic Web Service renewal

> 💡 **SQLite on Render free is ephemeral** (no persistent disk). For permanent
> cloud data, connect a managed PostgreSQL:

```bash
DB_DRIVER=postgres DATABASE_URL=postgres://...:5432/almox
```

### PM2 (VPS)

```bash
npm install -g pm2
pm2 start src/index.js --name almoxarifado
pm2 startup && pm2 save
```

### Systemd (Linux)

```ini
# /etc/systemd/system/almoxarifado.service
[Unit]
Description=Almoxarifado Inteligente
After=network.target

[Service]
Type=simple
User=almox
WorkingDirectory=/opt/almoxarifado
ExecStart=/usr/bin/node src/index.js
Restart=on-failure
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

---

## 🤝 Contributing

1. Fork the project
2. Create a branch: `git checkout -b feature/new-feature`
3. Conventional commit: `git commit -m 'feat: add new feature'`
4. Push: `git push origin feature/new-feature`
5. Open a Pull Request

### Commit Patterns (Conventional Commits)

`feat:` · `fix:` · `docs:` · `refactor:` · `test:` · `chore:` · `security:`

---

## 📄 License

MIT License — see [LICENSE](LICENSE).

---

## 👨‍💻 Author

**Victor Hugo** — Software Engineer

- GitHub: [@VictorHugoEng](https://github.com/VictorHugoEng)
- LinkedIn: [victorhugoeng](https://linkedin.com/in/victorhugoeng)

---

> **Built with enterprise standards for production.**  
> _Zero data loss. Zero downtime. Zero excuses._
