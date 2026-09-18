# 🏭 Almoxarifado Inteligente — Sistema Completo de Gestão de Estoque

[![Node.js](https://img.shields.io/badge/Node.js-22.13%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express-5.x-000000?logo=express&logoColor=white)](https://expressjs.com/)
[![SQLite](https://img.shields.io/badge/SQLite-3.x-003B57?logo=sqlite&logoColor=white)](https://sqlite.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Security](https://img.shields.io/badge/Security-Hardened-brightgreen)](SECURITY.md)
[![CI](https://github.com/VictorHugoEng/AlmoxarifadoProject/actions/workflows/ci.yml/badge.svg)](https://github.com/VictorHugoEng/AlmoxarifadoProject/actions/workflows/ci.yml)

> **Sistema completo de almoxarifado** com autenticação robusta, backup automático, sincronização Google Drive, chat privado, auditoria completa e atualização over-the-air. Projetado para ambientes críticos onde **perda de dados não é opção**.

🇺🇸 [Read this in English](README.md)

---

## 🎯 Visão Geral

| Característica      | Descrição                                                        |
| ------------------- | ---------------------------------------------------------------- |
| **Domínio**         | Almoxarifado industrial / corporativo                            |
| **Arquitetura**     | Monolito modular Node.js + SQLite (WAL mode)                     |
| **Autenticação**    | Tokens 256-bit + scrypt + rate limiting + brute-force protection |
| **Autorização**     | RBAC: `ADMIN_MASTER`, `OPERADOR`, `COMPRAS`, `CONSULTA`          |
| **Backup**          | Local (30 dias) + Google Drive (contínuo) + auto-recovery        |
| **Chat**            | Mensagens 1-a-1 com imagens no banco + notificações (sininho)    |
| **Atualização**     | Over-the-air via Google Drive (código + versão)                  |
| **Observabilidade** | Auditoria completa (log de ações) + health checks                |

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
┌─────────────────────────────────────────────────────────────────┐
│                        CLIENTE (Browser/PWA)                    │
│  Vanilla JS SPA + Service Worker (app-shell) + localStorage    │
└─────────────────────────────┬───────────────────────────────────┘
                              │ HTTPS (polling)
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     SERVIDOR NODE.JS (Express 5)               │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌───────────┐ │
│  │   Auth      │ │  Estoque    │ │  Chat       │ │  Admin    │ │
│  │   Module    │ │  Module     │ │  Module     │ │  Module   │ │
│  └──────┬──────┘ └──────┬──────┘ └──────┬──────┘ └─────┬────┘ │
│         │               │               │             │       │
│         ▼               ▼               ▼             ▼       │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              MIDDLEWARE PIPELINE                        │   │
│  │  Rate Limit → Auth → RBAC → Audit Log → Cloud Sync     │   │
│  └────────────────────────────┬────────────────────────────┘   │
│                               │                                 │
│                               ▼                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              SQLITE (WAL + synchronous=FULL)            │   │
│  │  • ACID garantido  • Zero data loss  • Auto-checkpoint  │   │
│  └────────────────────────────┬────────────────────────────┘   │
│                               │                                 │
│              ┌────────────────┼────────────────┐                │
│              ▼                ▼                ▼                │
│       ┌─────────────┐ ┌─────────────┐ ┌─────────────┐          │
│       │ Backups Loc │ │ Google Drive│ │  Auto-Recovery│         │
│       │ (30 days)   │ │ (continuous)│ │ (boot-time)   │         │
│       └─────────────┘ └─────────────┘ └─────────────┘          │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🚀 Quick Start

### Pré-requisitos

- **Node.js 22.13+** (usa o módulo nativo `node:sqlite`; CI roda no Node 24)
- **npm 10+**
- Conta Google Cloud (para Google Drive sync - opcional)

### Instalação Local

```bash
# Clone o repositório
git clone https://github.com/VictorHugoEng/AlmoxarifadoProject.git
cd AlmoxarifadoProject

# Instale dependências
npm ci

# Inicie o servidor
npm start
# Servidor rodando em http://localhost:3000
```

### Credenciais Padrão (Primeira Execução)

```
Usuário: anderson
Senha:   123456
Role:    ADMIN_MASTER
```

> ⚠️ **Altere a senha imediatamente após o primeiro login!**

---

## ⚙️ Configuração

### Variáveis de Ambiente

Variáveis de ambiente reconhecidas pelo sistema:

```env
# Servidor
PORT=3000
# Em containers/PaaS (Docker, Render, Railway...) use 0.0.0.0
HOST=0.0.0.0

# Opcional: caminho do banco e do arquivo de credenciais da nuvem
ALMOX_DB_PATH=C:\dados\voltstock.db
ALMOX_CONFIG_PATH=C:\dados\nuvem_config.json

# Opcional: senha inicial do admin (só na 1ª execução; padrão 123456)
ALMOX_ADMIN_PASSWORD=troque-esta-senha

# Opcional: desliga a recuperação automática no boot (1 = desligado)
ALMOX_NO_RECOVER=1
```

> As credenciais do Google Drive **não** são variáveis de ambiente: são configuradas
> pelo painel **Admin → Nuvem** e salvas em `nuvem_config.json` (fora do Git).

### Google Drive Sync (Produção)

1. Acesse [Google Cloud Console](https://console.cloud.google.com/)
2. Crie projeto → APIs → **Google Drive API** → Ativar
3. Credenciais → **OAuth 2.0 Client ID** (Application type: Web)
4. Authorized redirect URIs: `https://SEU-DOMINIO/api/nuvem/oauth2/callback`
5. No sistema: **Admin → Nuvem** → Cole Client ID/Secret → **Conectar**

---

## 📚 API Reference

### Autenticação

| Método | Endpoint      | Descrição                    |
| ------ | ------------- | ---------------------------- |
| `POST` | `/api/login`  | Login (rate limited: 10/min) |
| `GET`  | `/api/sessao` | Validar sessão ativa         |
| `POST` | `/api/logout` | Encerrar sessão              |

### Estoque (Almoxarifado)

| Método   | Endpoint                  | RBAC         | Descrição                                                       |
| -------- | ------------------------- | ------------ | --------------------------------------------------------------- |
| `GET`    | `/api/estoque`            | All          | Listar itens (filtros: `busca`, `categoria`, `apenas_criticos`) |
| `POST`   | `/api/estoque`            | OPERADOR+    | Cadastrar item                                                  |
| `PUT`    | `/api/estoque/:id`        | OPERADOR+    | Atualizar item                                                  |
| `DELETE` | `/api/estoque/:id`        | ADMIN_MASTER | Excluir item                                                    |
| `GET`    | `/api/estoque/categorias` | All          | Listar categorias                                               |
| `POST`   | `/api/estoque/categorias` | ADMIN_MASTER | Criar categoria                                                 |

### Equipamentos / Metrologia

| Método   | Endpoint                | RBAC         | Descrição                    |
| -------- | ----------------------- | ------------ | ---------------------------- |
| `GET`    | `/api/equipamentos`     | All          | Listar com status calibração |
| `POST`   | `/api/equipamentos`     | OPERADOR+    | Cadastrar equipamento        |
| `PUT`    | `/api/equipamentos/:id` | OPERADOR+    | Atualizar                    |
| `DELETE` | `/api/equipamentos/:id` | ADMIN_MASTER | Excluir                      |

### Compras / Solicitações

| Método  | Endpoint                    | RBAC      | Descrição             |
| ------- | --------------------------- | --------- | --------------------- |
| `GET`   | `/api/compras`              | All       | Listar solicitações   |
| `POST`  | `/api/compras`              | OPERADOR+ | Nova solicitação      |
| `PATCH` | `/api/compras/:id/status`   | COMPRAS+  | Atualizar status      |
| `PATCH` | `/api/compras/:id/feedback` | COMPRAS+  | Feedback do comprador |

### Chat Privado

| Método | Endpoint                   | Descrição                               |
| ------ | -------------------------- | --------------------------------------- |
| `GET`  | `/api/chat/contatos`       | Lista contatos + última msg + não lidas |
| `GET`  | `/api/chat/:id`            | Histórico com usuário                   |
| `POST` | `/api/chat/:id`            | Enviar msg/imagem (12MB)                |
| `POST` | `/api/chat/:id/lidas`      | Marcar como lidas                       |
| `GET`  | `/api/chat/naolidas/total` | Badge total não lidas                   |

### Admin / Auditoria

| Método   | Endpoint                        | RBAC         | Descrição                    |
| -------- | ------------------------------- | ------------ | ---------------------------- |
| `GET`    | `/api/usuarios`                 | ADMIN_MASTER | Listar usuários              |
| `POST`   | `/api/usuarios`                 | ADMIN_MASTER | Criar usuário                |
| `PUT`    | `/api/usuarios/:id`             | ADMIN_MASTER | Editar usuário/role/senha    |
| `DELETE` | `/api/usuarios/:id`             | ADMIN_MASTER | Excluir usuário              |
| `POST`   | `/api/usuarios/:id/desbloquear` | ADMIN_MASTER | Desbloquear brute-force      |
| `GET`    | `/api/auditoria`                | ADMIN_MASTER | Logs segurança (200 últimos) |
| `POST`   | `/api/backup`                   | ADMIN_MASTER | Backup manual                |
| `GET`    | `/api/backup/status`            | ADMIN_MASTER | Status backups               |

### Nuvem (Google Drive)

| Método | Endpoint               | RBAC         | Descrição           |
| ------ | ---------------------- | ------------ | ------------------- |
| `GET`  | `/api/nuvem/status`    | Public       | Status conexão      |
| `GET`  | `/api/nuvem/login`     | Public       | OAuth Google        |
| `POST` | `/api/nuvem/config`    | ADMIN_MASTER | Salvar credenciais  |
| `POST` | `/api/nuvem/enviar`    | ADMIN_MASTER | Enviar backup agora |
| `POST` | `/api/nuvem/restaurar` | ADMIN_MASTER | Baixar da nuvem     |

### Atualização Over-the-Air

| Método | Endpoint                   | RBAC         | Descrição                  |
| ------ | -------------------------- | ------------ | -------------------------- |
| `GET`  | `/api/atualizacao/status`  | ADMIN_MASTER | Verificar versão na nuvem  |
| `POST` | `/api/atualizacao/aplicar` | ADMIN_MASTER | Aplicar update + reiniciar |

---

## 🛡️ Segurança (Hardening)

| Camada          | Implementação                                                   |
| --------------- | --------------------------------------------------------------- |
| **Senhas**      | scrypt (N=16384, r=8, p=1) + salt 16 bytes + timingSafeEqual    |
| **Sessões**     | Token 256-bit (crypto.randomBytes) + expiração configurável     |
| **Rate Limit**  | Por IP + por rota (login: 10/min, API: 120/min)                 |
| **Brute Force** | Bloqueio 15 min após 5 falhas + auditoria                       |
| **Headers**     | CSP estrito, HSTS, X-Frame-Options, Permissions-Policy          |
| **Auditoria**   | Log imutável: login, RBAC changes, CRUD sensível, backup, nuvem |
| **Recuperação** | Auto-restore local → nuvem → fresh DB (zero downtime)           |

---

## 🧪 Qualidade de Código

```bash
# Lint
npm run lint

# Format
npm run format

# Testes (smoke tests com node:test)
npm test
```

---

## 📦 Estrutura do Projeto

```
AlmoxarifadoProject/
├── server.js              # Entry point + routes + middleware pipeline
├── database.js            # SQLite schema, crypto, init, migrations, recovery
├── nuvem.js               # Google Drive OAuth + backup sync + version check
├── package.json           # Dependencies & scripts
├── .github/
│   ├── workflows/ci.yml   # CI/CD pipeline
│   ├── ISSUE_TEMPLATE/    # Bug report, feature request
│   └── PULL_REQUEST_TEMPLATE.md
├── test/
│   └── smoke.test.js      # Teste de fumaça (boot + login + versão)
├── public/                # Frontend estático (PWA)
│   ├── index.html
│   ├── login.html
│   ├── app.js
│   ├── style.css
│   ├── sw.js              # Service Worker (offline-first)
│   └── manifest.webmanifest
├── docs/screenshots/      # Capturas de tela da aplicação
├── converte-para-pdf/     # Microsserviço PDF (opcional)
└── backups/               # Backups locais (gitignored)
```

---

## 🚢 Deploy Produção

### PM2 (Recomendado VPS)

```bash
npm install -g pm2
pm2 start server.js --name almoxarifado
pm2 startup
pm2 save
```

### Docker (qualquer provedor)

O [`Dockerfile`](Dockerfile) já está pronto:

```bash
docker build -t almoxarifado .
docker run -d -p 3000:3000 -e ALMOX_ADMIN_PASSWORD=troque-me almoxarifado
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
ExecStart=/usr/bin/node server.js
Restart=on-failure
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

---

## 🤝 Contribuindo

1. Fork o projeto
2. Crie branch: `git checkout -b feature/nova-funcionalidade`
3. Commit: `git commit -m 'feat: adiciona nova funcionalidade'`
4. Push: `git push origin feature/nova-funcionalidade`
5. Abra Pull Request

### Padrões de Commit (Conventional Commits)

- `feat:` nova funcionalidade
- `fix:` correção de bug
- `docs:` documentação
- `refactor:` refatoração
- `test:` testes
- `chore:` manutenção

---

## 📄 Licença

MIT License - veja [LICENSE](LICENSE) para detalhes.

---

## 👨‍💻 Autor

**Victor Hugo** — Engenheiro de Software

- GitHub: [@VictorHugoEng](https://github.com/VictorHugoEng)
- LinkedIn: [victorhugoeng](https://linkedin.com/in/victorhugoeng)

---

## 🙏 Agradecimentos

- [Express](https://expressjs.com/) — Framework web minimalista
- [SQLite](https://sqlite.org/) — Banco embarcado confiável
- [Node.js](https://nodejs.org/) — Runtime JavaScript
- [Google Drive API](https://developers.google.com/drive) — Sync na nuvem

---

> **Construído com padrão enterprise para produção.**  
> _Zero data loss. Zero downtime. Zero excuses._
