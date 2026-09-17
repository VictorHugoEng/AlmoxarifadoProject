# Política de Segurança

## 🔒 Versões Suportadas

| Versão | Suportada | Status        |
| ------ | --------- | ------------- |
| 1.x.x  | ✅        | Ativa         |
| < 1.0  | ❌        | Não suportada |

## 🚨 Reportando Vulnerabilidades

**NÃO abra issue pública para falhas de segurança.**

Envie relatório privado para: **victorhugoeng@email.com**

Inclua:

- Descrição da vulnerabilidade
- Passos para reproduzir
- Impacto potencial
- Sugestão de mitigação (se tiver)

Responderemos em **48h** com:

- Confirmação de recebimento
- Avaliação inicial
- Timeline estimada para fix

## 🛡️ Hardening Implementado

### Autenticação & Autorização

- **scrypt** (N=16384, r=8, p=1) + salt 16 bytes para hash de senhas
- Tokens de sessão 256-bit (`crypto.randomBytes(32)`)
- Comparação em tempo constante (`timingSafeEqual`)
- Rate limiting por IP + por rota (login: 10/min, API: 120/min)
- Bloqueio automático 15 min após 5 tentativas falhas
- RBAC estrito: `ADMIN_MASTER`, `OPERADOR`, `COMPRAS`, `CONSULTA`

### Proteção de Dados

- SQLite WAL mode + `synchronous=FULL` (ACID garantido)
- Backup automático local (30 dias retenção)
- Sync contínuo Google Drive (OAuth 2.0)
- Auto-recovery: local → nuvem → fresh DB
- Headers de segurança (CSP, HSTS, X-Frame-Options, Permissions-Policy)
- `trust proxy` para IP real atrás de proxy/ngrok

### Auditoria & Monitoramento

- Log imutável de eventos sensíveis (padrão bancário)
- Eventos auditados: login, RBAC changes, CRUD sensível, backup, nuvem, admin actions
- Retenção: 200 últimos eventos via API, completo no banco
- Rate limit logs para detecção de ataques

### Princípios de Segurança

- **Defesa em profundidade**: múltiplas camadas
- **Menor privilégio**: roles granulares
- **Fail-safe**: bloqueio por padrão
- **Zero trust**: validação contínua
- **Auditabilidade**: trilha completa

## 🔄 Atualizações de Segurança

- Dependências monitoradas via **Dependabot** (weekly)
- `npm audit` no CI/CD (high+ blocking)
- Snyk scan opcional no pipeline
- Security advisories acompanhados

## 📋 Checklist de Deploy Seguro

- [ ] `.env` com secrets fortes (não use defaults)
- [ ] HTTPS/TLS configurado (reverse proxy + certs)
- [ ] `NODE_ENV=production`
- [ ] Rate limits ajustados para carga real
- [ ] Logs de auditoria monitorados
- [ ] Backup testado (restore drill)
- [ ] Google Drive OAuth configurado corretamente
- [ ] CSP ajustado para domínio real
- [ ] Health checks configurados

## 🏷️ Labels de Segurança

| Label               | Uso                        |
| ------------------- | -------------------------- |
| `security`          | Vulnerabilidade confirmada |
| `security:low`      | Baixo risco                |
| `security:medium`   | Médio risco                |
| `security:high`     | Alto risco                 |
| `security:critical` | Crítico - patch imediato   |

## 📚 Referências

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Node.js Security Best Practices](https://nodejs.org/en/docs/guides/security/)
- [Express Security](https://expressjs.com/en/advanced/best-practice-security.html)
- [SQLite Security](https://www.sqlite.org/security.html)

---

**Segurança é responsabilidade de todos.** Obrigado por ajudar a manter o ServMil seguro! 🛡️
