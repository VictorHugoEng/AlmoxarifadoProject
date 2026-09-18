# 🏭 Almoxarifado Inteligente — Sistema Completo de Gestão de Estoque

[![Node.js](https://img.shields.io/badge/Node.js-24.x-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express-5.x-000000?logo=express&logoColor=white)](https://expressjs.com/)
[![SQLite](https://img.shields.io/badge/SQLite-3.x-003B57?logo=sqlite&logoColor=white)](https://sqlite.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white)](Dockerfile)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Security](https://img.shields.io/badge/Security-Hardened-brightgreen)](SECURITY.md)
[![CI](https://github.com/VictorHugoEng/AlmoxarifadoProject/actions/workflows/ci.yml/badge.svg)](https://github.com/VictorHugoEng/AlmoxarifadoProject/actions/workflows/ci.yml)

> **Monolito modular enterprise**: autenticação robusta, RBAC, backups locais + Google Drive, recuperação automática, chat privado, auditoria imutável e atualização over-the-air. Desenhado para ambientes críticos onde **perder dados não é opção**.

🇺🇸 [Read this in English](README.md)

---

## 🎯 Visão Geral

| Característica      | Descrição                                                                 |
| ------------------- | ------------------------------------------------------------------------- |
| **Domínio**         | Almoxarifado industrial / corporativo + metrologia                        |
| **Arquitetura**     | Monolito modular em `src/` (rotas, serviços, drivers de banco isolados)   |
| **Banco de dados**  | SQLite nativo (`node:sqlite`, WAL) **ou** PostgreSQL 16 (driver plugável) |
| **Autenticação**    | Tokens 256-bit + scrypt + rate limiting + proteção brute-force            |
| **Autorização**     | RBAC: `ADMIN_MASTER`, `OPERADOR`, `COMPRAS`, `CONSULTA`                   |
| **Backup**          | Local (30 dias) + Google Drive (contínuo) + auto-recovery no boot         |
| **Chat**            | Mensagens 1-a-1 com imagens guardadas no banco + notificações             |
| **Atualização**     | Over-the-air via Google Drive (código + versão)                           |
| **Observabilidade** | Auditoria completa (trilha de ações) + `/healthz` para plataformas        |
| **Deploy**          | Docker, Render (blueprint), PM2, Systemd                                  |

---

## 📸 Capturas de Tela

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/dashboard.png" alt="Dashboard"><br><sub><b>Dashboard</b> — indicadores e alertas de estoque crítico</sub></td>
    <td width="50%"><img src="docs/screenshots/estoque.png" alt="Estoque"><br><sub><b>Almoxarifado</b> — itens, categorias e nível crítico</sub></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/calibracao.png" alt="Calibração"><br><sub><b>Calibração</b> — equipamentos e vencimentos</sub></td>
    <td><img src="docs/screenshots/compras.png" alt="Compras"><br><sub><b>Compras</b> — fluxo de status e feedback</sub></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/chat.png" alt="Chat"><br><sub><b>Chat</b> — mensagens 1-a-1 com anexos</sub></td>
    <td><img src="docs/screenshots/administrador.png" alt="Administrador"><br><sub><b>Administrador</b> — usuários, auditoria e backup</sub></td>
  </tr>
</table>

---

## 🏗️ Arquitetura

```
┌───────────────────────────────────────────────────────────────────┐
│                     CLIENTE (Browser/PWA)                         │
│         Vanilla JS  +  Service Worker  +  localStorage            │
└──────────────────────────────┬────────────────────────────────────┘
                               │ HTTPS (polling)
                               ▼
┌───────────────────────────────────────────────────────────────────┐
│                  NODE.JS 24 — EXPRESS 5  (src/)                   │
│                                                                   │
│  src/app.js        pipeline de middlewares + montagem de rotas    │
│  src/index.js      entry point: banco → serviços → listen         │
│  src/routes/       auth, usuarios, estoque, equipamentos,         │
│                    compras, chat, notificacoes, nuvem (+OTA)      │
│  src/database.js   schema, crypto, seed, migrações, recovery      │
│  src/db/drivers/   sqlite.js  │  postgres.js  (mesma interface)   │
│  src/nuvem.js      OAuth Google Drive + backup contínuo + OTA     │
│  src/backup.js     backups locais agendados + histórico           │
│  src/auth.js       sessão, RBAC, logs de segurança                │
│  src/middlewares.js rate limit + headers + parsers                │
│  src/helpers.js    transformação de dados + utilitários           │
│                                                                   │
│      ▼ autenticação  →  ▼ rate limit  →  ▼ rotas (com auditoria)  │
└──────────────────────────────┬────────────────────────────────────┘
                               │
                  ┌────────────┴─────────────┐
                  ▼                          ▼
        ┌─────────────────┐       ┌────────────────────┐
        │    SQLite WAL   │       │     PostgreSQL     │
        │   (nativo)      │       │  16 (pg, plugável) │
        └────────▲────────┘       └─────────┬──────────┘
                 │                          │
        Backups locais (30d)      (backups locais só no SQLite)
        Google Drive (contínuo)   OTA e nuvem continuam iguais
        Auto-recovery no boot
```

**Driver único de banco:** `src/db/` expõe a interface `exec()` + `prepare()` (com `run/get/all`)
para **qualquer** motor. As rotas não sabem se o banco é SQLite ou PostgreSQL —
basta trocar `DB_DRIVER` e apontar `DATABASE_URL`.

---

## 🚀 Quick Start

### Pré-requisitos

- **Node.js 24** (usa `node:sqlite` para o modo padrão; intervalo suportado: `>=22.13`)
- **npm 10+**
- Conta Google Cloud (somente para sincronização Google Drive)

### Instalação Local

```bash
git clone https://github.com/VictorHugoEng/AlmoxarifadoProject.git
cd AlmoxarifadoProject

npm ci
npm start
# Servidor rodando em http://localhost:3000
```

### Credenciais Padrão (primeira execução)

```
Usuário: anderson
Senha:   123456   (altere por ALMOX_ADMIN_PASSWORD ou pelo painel)
Role:    ADMIN_MASTER
```

> ⚠️ **Altere a senha imediatamente após o primeiro login.**

---

## ⚙️ Configuração

Copie e edite `.env.example`; as variáveis abaixo regem o sistema:

| Variável               | Padrão                | Descrição                                                    |
| ---------------------- | --------------------- | ------------------------------------------------------------ |
| `PORT`                 | `3000`                | Porta HTTP (ingetada pelo Render em produção)                |
| `HOST`                 | `127.0.0.1`           | Escuta local; use `0.0.0.0` em containers/PaaS               |
| `DB_DRIVER`            | `sqlite`              | Motor: `sqlite` ou `postgres`                                |
| `DATABASE_URL`         | `''`                  | URL de conexão `postgres://user:pass@host:5432/db` (pg)      |
| `ALMOX_DB_PATH`        | `./voltstock.db`      | Arquivo do SQLite (ao informar, desliga recuperação no boot) |
| `ALMOX_CONFIG_PATH`    | `./nuvem_config.json` | Config do Google (fora do Git)                               |
| `ALMOX_ADMIN_PASSWORD` | `123456`              | Senha inicial do admin (só no 1º boot; seed idempotente)     |
| `ALMOX_NO_RECOVER`     | —                     | `1` desliga recuperação automática de backups (testes)       |

> As credenciais do Google Drive **não** são variáveis de ambiente: você as informa
> no painel **Admin → Nuvem** e o sistema salva em `nuvem_config.json` (gitignored).

### Usar PostgreSQL em vez de SQLite

```bash
DB_DRIVER=postgres DATABASE_URL=postgres://usr:senha@host:5432/almox npm start
```

No primeiro boot o sistema cria todo o schema (tabelas, índices, especificidades de
tipos `BIGSERIAL`/`BIGINT`/`BYTEA`), roda as migrações e o seed idempotente — tudo
de forma automática.

Rode os testes contra PostgreSQL do mesmo jeito (o CI faz isso em cada push):

```bash
DB_DRIVER=postgres DATABASE_URL=postgres://usr:senha@host:5432/almox npm test
```

> **Nota:** backups locais + auto-recovery são específicos do SQLite. Com PostgreSQL,
> a sincronização Google Drive e o OTA continuam funcionando normalmente.

### Google Drive Sync (produção)

1. Acesse o [Google Cloud Console](https://console.cloud.google.com/)
2. Crie um projeto → APIs → **Google Drive API** → Ativar
3. Credenciais → **OAuth 2.0 Client ID** (Application type: Web)
4. Autorized redirect URIs: `https://SEU-DOMINIO/api/nuvem/oauth2/callback`
5. No sistema: **Admin → Nuvem** → cole Client ID/Secret → **Conectar**

---

## 📚 API Reference

Especificação (OpenAPI 3.0): [`docs/api/openapi.yaml`](docs/api/openapi.yaml) — validar com `npx redocly lint docs/api/openapi.yaml`.

Todas as rotas vivem sob `/api` (prefixo montado em `src/app.js`). Trilha de
auditoria é gravada automaticamente nas mutações sensíveis.

### Autenticação e Sessão

| Método | Endpoint      | Descrição                         |
| ------ | ------------- | --------------------------------- |
| `POST` | `/api/login`  | Login (rate limit: 10/min por IP) |
| `GET`  | `/api/sessao` | Valida a sessão ativa             |
| `POST` | `/api/logout` | Encerra a sessão                  |

### Estoque e Categorias

| Método   | Endpoint                     | RBAC         | Descrição                                                   |
| -------- | ---------------------------- | ------------ | ----------------------------------------------------------- |
| `GET`    | `/api/estoque`               | autenticado  | Lista/filtra (`busca`, `categoria`, `apenas_criticos`)      |
| `POST`   | `/api/estoque`               | autenticado  | Cadastra item (código único)                                |
| `PATCH`  | `/api/estoque/:id/movimento` | autenticado  | `{ delta }` movimenta + registra histórico + dispara alerta |
| `PUT`    | `/api/estoque/:id`           | autenticado  | Edita item                                                  |
| `DELETE` | `/api/estoque/:id`           | ADMIN_MASTER | Exclui item                                                 |
| `GET`    | `/api/categorias`            | autenticado  | Lista categorias                                            |
| `POST`   | `/api/categorias`            | ADMIN_MASTER | Cria categoria                                              |
| `PUT`    | `/api/categorias/:id`        | ADMIN_MASTER | Renomeia categoria                                          |
| `DELETE` | `/api/categorias/:id`        | ADMIN_MASTER | Exclui categoria                                            |

### Equipamentos e Calibração (metrologia)

| Método   | Endpoint                | RBAC         | Descrição                      |
| -------- | ----------------------- | ------------ | ------------------------------ |
| `GET`    | `/api/equipamentos`     | autenticado  | Lista com status de calibração |
| `POST`   | `/api/equipamentos`     | autenticado  | Cadastra equipamento           |
| `PUT`    | `/api/equipamentos/:id` | autenticado  | Atualiza / renova calibração   |
| `DELETE` | `/api/equipamentos/:id` | ADMIN_MASTER | Exclui equipamento             |

### Compras, Destinatários e Alertas

| Método  | Endpoint                         | RBAC        | Descrição                     |
| ------- | -------------------------------- | ----------- | ----------------------------- |
| `GET`   | `/api/compras`                   | autenticado | Lista solicitações            |
| `POST`  | `/api/compras`                   | autenticado | Nova solicitação + alerta     |
| `PATCH` | `/api/compras/:id/status`        | COMPRAS+    | Muda status                   |
| `PATCH` | `/api/compras/:id/feedback`      | COMPRAS+    | Feedback do setor de compras  |
| `GET`   | `/api/destinatarios`             | autenticado | Lista destinatários de alerta |
| `PUT`   | `/api/destinatarios/:id`         | autenticado | Edita destinatário            |
| `GET`   | `/api/alertas/resumo`            | autenticado | Resumo de alertas ativos      |
| `POST`  | `/api/alertas/disparar-multiplo` | autenticado | Dispara alertas em lote       |

### Chat Privado

| Método | Endpoint                   | Descrição                           |
| ------ | -------------------------- | ----------------------------------- |
| `GET`  | `/api/chat/contatos`       | Contatos + última msg + não lidas   |
| `GET`  | `/api/chat/:id`            | Histórico da conversa               |
| `POST` | `/api/chat/:id`            | Envia texto/foto (até 12 MB)        |
| `POST` | `/api/chat/:id/lidas`      | Marca como lidas                    |
| `GET`  | `/api/chat/naolidas/total` | Badge total de não lidas            |
| `GET`  | `/api/chat/midia/:id`      | Serva imagem pública (id aleatório) |

### Notificações e Observações

| Método   | Endpoint                      | Descrição                     |
| -------- | ----------------------------- | ----------------------------- |
| `GET`    | `/api/notificacoes`           | Lista notificações do usuário |
| `POST`   | `/api/notificacoes/lidas`     | Marca lidas (`{ ids }` `{ }`) |
| `GET`    | `/api/observacoes`            | Lista observações             |
| `POST`   | `/api/observacoes`            | Cria observação               |
| `DELETE` | `/api/observacoes/:id`        | Remove observação             |
| `PATCH`  | `/api/observacoes/:id/status` | Resolve observação            |

### Admin: Usuários e Auditoria

| Método   | Endpoint                        | RBAC         | Descrição                        |
| -------- | ------------------------------- | ------------ | -------------------------------- |
| `GET`    | `/api/usuarios`                 | ADMIN_MASTER | Lista usuários                   |
| `POST`   | `/api/usuarios`                 | ADMIN_MASTER | Cria usuário/RBAC                |
| `PUT`    | `/api/usuarios/:id`             | ADMIN_MASTER | Edita/role/nova senha            |
| `DELETE` | `/api/usuarios/:id`             | ADMIN_MASTER | Exclui (proteção último admin)   |
| `POST`   | `/api/usuarios/:id/desbloquear` | ADMIN_MASTER | Desbloqueia brute-force          |
| `GET`    | `/api/auditoria`                | ADMIN_MASTER | Últimos 200 eventos de segurança |

### Nuvem, Backup e OTA

| Método | Endpoint                     | RBAC         | Descrição                            |
| ------ | ---------------------------- | ------------ | ------------------------------------ |
| `GET`  | `/api/nuvem/status`          | público      | Estado da conexão (tela de login)    |
| `GET`  | `/api/nuvem/login`           | público      | Redireciona para OAuth Google        |
| `GET`  | `/api/nuvem/oauth2/callback` | público      | Retorno do Google                    |
| `POST` | `/api/nuvem/config`          | ADMIN_MASTER | Salva credenciais                    |
| `POST` | `/api/nuvem/desconectar`     | ADMIN_MASTER | Desconecta conta Google              |
| `POST` | `/api/nuvem/enviar`          | ADMIN_MASTER | Backup p/ nuvem na hora              |
| `POST` | `/api/nuvem/restaurar`       | ADMIN_MASTER | Baixa última versão da nuvem         |
| `POST` | `/api/backup`                | ADMIN_MASTER | Backup manual                        |
| `GET`  | `/api/backup/status`         | ADMIN_MASTER | Status/localização dos backups       |
| `GET`  | `/api/atualizacao/status`    | ADMIN_MASTER | Versão atual vs. versão na nuvem     |
| `POST` | `/api/atualizacao/aplicar`   | ADMIN_MASTER | Aplica pacote OTA + reinicia         |
| `GET`  | `/api/versao`                | autenticado  | Versão do app (recarrega clientes)   |
| `GET`  | `/healthz`                   | público      | Health check p/ plataformas (uptime) |

---

## 🛡️ Segurança (Hardening)

| Camada          | Implementação                                                 |
| --------------- | ------------------------------------------------------------- |
| **Senhas**      | scrypt (N=16384, r=8, p=1) + salt 16B + `timingSafeEqual`     |
| **Sessões**     | Token 256-bit (`crypto.randomBytes`) + expiração configurável |
| **Rate Limit**  | Por IP e por rota (login 10/min, API geral 120/min)           |
| **Brute Force** | Bloqueio 15 min após 5 falhas + auditoria                     |
| **Headers**     | CSP estrito, HSTS, X-Frame-Options, Permissions-Policy        |
| **Uploads**     | Imagens do chat no banco (bytes), limite 4 MB/250 MB total    |
| **Auditoria**   | Log imutável: logins, RBAC, CRUD crítico, backp, nuvem, OTA   |
| **Recuperação** | Auto-restore local → nuvem → banco novo no boot               |

---

## 🧪 Qualidade de Código

```bash
npm run lint          # ESLint
npm run format        # Prettier (escreve)
npm run format:check  # Prettier (verifica)
npm test              # Smoke: boot do servidor + login + healthz
npm audit             # Auditoria de dependências
```

O pipeline [`ci.yml`](.github/workflows/ci.yml) roda lint → format → audit →
testes → verificação de sintaxe em cada push/PR para `main` e `develop`.

---

## 📦 Estrutura do Projeto

```
AlmoxarifadoProject/
├── src/                      # ⭐ Código-fonte (toda a lógica vive aqui)
│   ├── index.js              # Entry point: banco → serviços → listen
│   ├── app.js                # Express: middlewares + montagem de rotas
│   ├── config.js             # Variáveis de ambiente centralizadas
│   ├── database.js           # Schema, crypto, migrações, seed, recovery
│   ├── auth.js               # Sessões, RBAC, auditoria
│   ├── middlewares.js        # Rate limit, headers, parsers
│   ├── helpers.js            # Utilitários e enriquecimento de dados
│   ├── backup.js             # Backups locais agendados
│   ├── nuvem.js              # OAuth Google Drive + OTA
│   ├── db/
│   │   ├── index.js          # Seleciona driver (sqlite|postgres)
│   │   ├── schema-sqlite.js  # DDL SQLite
│   │   ├── schema-postgres.js# DDL PostgreSQL (BIGSERIAL/BYTEA/tz)
│   │   └── drivers/
│   │       ├── sqlite.js     # exec/prepare async sobre node:sqlite
│   │       └── postgres.js   # mesma interface sobre pg (Pool)
│   └── routes/               # Um módulo por domínio (express.Router)
│       ├── auth.js ├── usuarios.js ├── estoque.js
│       ├── equipamentos.js ├── compras.js ├── chat.js
│       ├── notificacoes.js └── nuvem.js
├── public/                   # Frontend estático (PWA offline-first)
│   ├── index.html ├── login.html ├── app.js
│   ├── style.css ├── sw.js └── manifest.webmanifest
├── test/
│   └── smoke.test.js         # Smoke: boot + login + endpoints públicos
├── .github/workflows/ci.yml  # CI/CD completo
├── Dockerfile                # imagem Node 24 Alpine + HEALTHCHECK
├── render.yaml               # blueprint Render (deploy 1 clique)
├── .env.example              # variáveis documentadas
└── backups/                  # backups locais (gitignored)
```

---

## 🚢 Deploy em Produção

### Docker (qualquer nuvem)

```bash
docker build -t almoxarifado .
docker run -d -p 3000:3000 \
  -e ALMOX_ADMIN_PASSWORD=troque-me \
  -v almox_data:/app \
  almoxarifado
```

A imagem expõe `HEALTHCHECK` e é a base do deploy no Render.

### Render (blueprint incluído)

O arquivo [`render.yaml`](render.yaml) permite **deploy com 1 clique**:

> `https://render.com/deploy?repo=https://github.com/VictorHugoEng/AlmoxarifadoProject`

- Runtime: Docker (imagem determinística do `Dockerfile`)
- Health check: `/healthz`
- Variáveis: `NODE_ENV`, `HOST`, `ALMOX_ADMIN_PASSWORD`
- Plano _free_ com renovação automática do Web Service

> 💡 **SQLite no Render free é efêmero** (sem disco persistente). Para dados
> permanentes na nuvem, conecte um PostgreSQL gerenciado:

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

## 🤝 Contribuindo

1. Fork o projeto
2. Crie uma branch: `git checkout -b feature/nova-funcionalidade`
3. Commit convencional: `git commit -m 'feat: adiciona nova funcionalidade'`
4. Push: `git push origin feature/nova-funcionalidade`
5. Abra um Pull Request

### Padrões de Commit (Conventional Commits)

`feat:` · `fix:` · `docs:` · `refactor:` · `test:` · `chore:` · `security:`

---

## 📄 Licença

MIT License — veja [LICENSE](LICENSE).

---

## 👨‍💻 Autor

**Victor Hugo** — Engenheiro de Software

- GitHub: [@VictorHugoEng](https://github.com/VictorHugoEng)
- LinkedIn: [victorhugoeng](https://linkedin.com/in/victorhugoeng)

---

> **Construído com padrão enterprise para produção.**  
> _Zero data loss. Zero downtime. Zero excuses._
