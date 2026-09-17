# Guia de Contribuição

Obrigado por considerar contribuir com o **ServMil Almoxarifado**! 🎉

## 🚀 Como Começar

### 1. Fork e Clone

```bash
git fork https://github.com/VictorHugoEng/AlmoxarifadoProject.git
git clone https://github.com/SEU_USUARIO/AlmoxarifadoProject.git
cd AlmoxarifadoProject
```

### 2. Configure o Ambiente

```bash
npm ci
cp .env.example .env  # se existir
npm run dev
```

### 3. Crie uma Branch

```bash
git checkout -b feature/nome-da-feature
# ou
git checkout -b fix/nome-do-bug
```

## 📝 Padrões de Commit (Conventional Commits)

Use mensagens claras e padronizadas:

```
<tipo>(<escopo>): <descrição curta>

[corpo opcional]

[rodapé opcional]
```

### Tipos

| Tipo       | Descrição                          |
| ---------- | ---------------------------------- |
| `feat`     | Nova funcionalidade                |
| `fix`      | Correção de bug                    |
| `docs`     | Documentação                       |
| `style`    | Formatação (sem mudança de lógica) |
| `refactor` | Refatoração de código              |
| `test`     | Adição/correção de testes          |
| `chore`    | Manutenção (deps, config, etc)     |
| `perf`     | Melhoria de performance            |
| `security` | Correção de segurança              |

### Exemplos

```
feat(estoque): adiciona filtro por categoria na listagem

fix(auth): corrige validação de token expirado

docs(readme): atualiza instruções de deploy Docker

refactor(database): extrai migrações para módulo separado
```

## 🧪 Qualidade de Código

### Antes de Commitar

```bash
npm run lint        # Verifica problemas
npm run lint:fix    # Corrige automaticamente
npm run format      # Formata com Prettier
npm run audit       # Verifica vulnerabilidades
```

### Husky (Git Hooks)

O projeto usa Husky para rodar checks automaticamente:

- `pre-commit`: lint + format
- `commit-msg`: valida formato Conventional Commits

## 🔀 Pull Requests

### Checklist Obrigatório

- [ ] Branch atualizada com `main` (`git rebase main`)
- [ ] Commits seguem Conventional Commits
- [ ] `npm run lint` passa sem erros
- [ ] `npm run format:check` passa
- [ ] Testes passam (`npm test`)
- [ ] Documentação atualizada (README, API docs, etc)
- [ ] Variáveis de ambiente documentadas
- [ ] Sem secrets/keys no código

### Template de PR

Use o template `.github/PULL_REQUEST_TEMPLATE.md` — preencha tudo.

### Review Process

1. CI deve passar (GitHub Actions)
2. Pelo menos 1 approval (quando houver team)
3. Sem conflitos com `main`
4. Squash and merge (histórico limpo)

## 🏷️ Versionamento

Usamos [Semantic Versioning](https://semver.org/):

- `MAJOR`: Breaking changes
- `MINOR`: Novas funcionalidades (backward compatible)
- `PATCH`: Bug fixes (backward compatible)

Tags: `v1.0.0`, `v1.1.0`, `v1.1.1`

## 🐛 Reportando Bugs

Use o template **Bug Report** (`.github/ISSUE_TEMPLATE/bug_report.md`).
Inclua:

- Passos para reproduzir
- Comportamento esperado vs atual
- Ambiente (OS, Node, browser)
- Logs/screenshots

## 💡 Sugerindo Features

Use o template **Feature Request** (`.github/ISSUE_TEMPLATE/feature_request.md`).
Explique:

- Problema que resolve
- Solução proposta
- Critérios de aceitação

## 📚 Documentação

- **README.md**: Visão geral, quick start, API
- **docs/architecture.md**: Arquitetura detalhada
- **docs/api.md**: Referência completa da API
- **docs/deployment.md**: Guias de deploy
- **docs/security.md**: Threat model e hardening

Atualize a documentação relevante junto com o código.

## 🛡️ Segurança

**NUNCA** commite:

- Senhas, tokens, API keys
- Arquivos `.env` reais
- Certificados/keys privadas
- Dados sensíveis de usuários

Use `.env.example` para documentar variáveis necessárias.

Reportes de segurança: abra issue com label `security` ou email direto.

## 💬 Comunicação

- Issues: para bugs, features, dúvidas técnicas
- Discussions: para ideias, perguntas gerais, show & tell
- PRs: para revisão de código

Seja respeitoso, construtivo e inclusivo. Código de conduta: [Contributor Covenant](https://www.contributor-covenant.org/).

## 🎓 Para Estudantes/Iniciantes

**Não tenha medo de contribuir!**

- Marque issues com `good first issue` ou `help wanted`
- Pergunte nos comentários da issue
- Peça review antecipado (WIP PR)
- Aprenda com o feedback — é assim que se cresce

---

**Dúvidas? Abra uma issue ou discussion. Estamos aqui para ajudar!** 🤝
