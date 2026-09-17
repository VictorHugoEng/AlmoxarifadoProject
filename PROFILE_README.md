# 👋 Olá, sou Victor Hugo

**Estudante de Engenharia de Software** • Desenvolvedor Full-Stack • Apaixonado por resolver problemas reais com código

[![LinkedIn](https://img.shields.io/badge/LinkedIn-0077B5?style=for-the-badge&logo=linkedin&logoColor=white)](https://linkedin.com/in/victorhugoeng)
[![GitHub](https://img.shields.io/badge/GitHub-100000?style=for-the-badge&logo=github&logoColor=white)](https://github.com/VictorHugoEng)
[![Email](https://img.shields.io/badge/Email-D14836?style=for-the-badge&logo=gmail&logoColor=white)](mailto:victorhugoeng@email.com)

---

## 🎯 Sobre Mim

> *"Não sou apenas um estudante que aprende tecnologias — sou um engenheiro que constrói sistemas completos, do banco de dados à interface, do deploy à monitoração."*

- 🎓 **Cursando Engenharia de Software** — foco em arquitetura, qualidade e boas práticas
- 🏭 **Experiência real** — construí sistemas completos para ambiente industrial/militar (ServMil)
- 🧠 **Mentalidade Senior** — penso em escalabilidade, segurança, observabilidade e manutenibilidade desde o dia 1
- 🚀 **Entrega ponta-a-ponta** — backend, frontend, DevOps, banco, CI/CD, documentação

---

## 🛠️ Stack Tecnológico

### Backend & Arquitetura
![Node.js](https://img.shields.io/badge/Node.js-339933?style=flat-square&logo=node.js&logoColor=white)
![Express](https://img.shields.io/badge/Express-000000?style=flat-square&logo=express&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-003B57?style=flat-square&logo=sqlite&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-316192?style=flat-square&logo=postgresql&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-DC382D?style=flat-square&logo=redis&logoColor=white)

### Frontend
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=flat-square&logo=javascript&logoColor=black)
![HTML5](https://img.shields.io/badge/HTML5-E34F26?style=flat-square&logo=html5&logoColor=white)
![CSS3](https://img.shields.io/badge/CSS3-1572B6?style=flat-square&logo=css3&logoColor=white)
![PWA](https://img.shields.io/badge/PWA-5A0FC8?style=flat-square&logo=pwa&logoColor=white)

### DevOps & Ferramentas
![Git](https://img.shields.io/badge/Git-F05032?style=flat-square&logo=git&logoColor=white)
![GitHub Actions](https://img.shields.io/badge/GitHub_Actions-2088FF?style=flat-square&logo=github-actions&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?style=flat-square&logo=docker&logoColor=white)
![Linux](https://img.shields.io/badge/Linux-FCC624?style=flat-square&logo=linux&logoColor=black)
![PM2](https://img.shields.io/badge/PM2-2B037A?style=flat-square&logo=pm2&logoColor=white)

### Qualidade & Segurança
![ESLint](https://img.shields.io/badge/ESLint-4B32C3?style=flat-square&logo=eslint&logoColor=white)
![Prettier](https://img.shields.io/badge/Prettier-F7B93E?style=flat-square&logo=prettier&logoColor=black)
![Jest](https://img.shields.io/badge/Jest-C21325?style=flat-square&logo=jest&logoColor=white)

---

## 🏆 Projeto Destaque: **ServMil Almoxarifado**

> **Sistema completo de gestão de almoxarifado industrial** com padrões de qualidade militar

[![Repo](https://img.shields.io/badge/Repo-VictorHugoEng/AlmoxarifadoProject-181717?style=for-the-badge&logo=github)](https://github.com/VictorHugoEng/AlmoxarifadoProject)

### 🎯 O que faz
- Gestão de estoque com alertas críticos automáticos
- Controle de equipamentos/metrologia (calibração)
- Solicitações de compras com workflow e feedback
- Chat privado 1-a-1 com imagens (armazenadas no banco)
- Mural de observações compartilhadas entre setores
- Sistema de notificações (sininho) com auditoria

### 🛡️ Segurança Nível Bancário
- **scrypt** + salt 16 bytes + timing-safe-compare
- Tokens 256-bit + rate limiting + brute-force protection
- RBAC: `ADMIN_MASTER`, `OPERADOR`, `COMPRAS`, `CONSULTA`
- CSP estrito, HSTS, audit trail imutável

### ☁️ Resiliência & Cloud
- **Zero data loss**: SQLite WAL + synchronous=FULL
- Backup local automático (30 dias) + Google Drive sync contínuo
- **Auto-recovery**: boot-time restore local → nuvem → fresh DB
- Atualização over-the-air via Google Drive (código + versão)

### 📊 Observabilidade
- Health checks + version endpoint para cache-busting
- Logs estruturados + auditoria completa (200 últimos via API)
- Notificações de mudanças sensíveis em tempo real

### 🏗️ Arquitetura
```
Monolito modular Node.js/Express 5
├── Auth Module (JWT-like + RBAC)
├── Estoque Module (CRUD + alertas)
├── Equipamentos Module (metrologia)
├── Compras Module (workflow + feedback)
├── Chat Module (1-a-1 + imagens no DB)
├── Admin Module (usuários, auditoria, backup)
├── Cloud Module (Google Drive OAuth + sync)
└── Update Module (OTA via Drive)
```

---

## 📈 GitHub Stats

![VictorHugoEng's Stats](https://github-readme-stats.vercel.app/api?username=VictorHugoEng&show_icons=true&theme=tokyonight&hide_border=true&count_private=true)

![Top Langs](https://github-readme-stats.vercel.app/api/top-langs/?username=VictorHugoEng&layout=compact&theme=tokyonight&hide_border=true)

---

## 🎓 Formação & Aprendizado Contínuo

| Área | Status |
|------|--------|
| **Engenharia de Software** | 🎓 Cursando |
| **Arquitetura de Software** | 📚 Estudando (Clean Arch, DDD, Hexagonal) |
| **Sistemas Distribuídos** | 📚 Estudando (CAP, consensus, messaging) |
| **Cloud Native** | 📚 Estudando (K8s, service mesh, observability) |
| **Segurança Ofensiva/Defensiva** | 📚 Estudando (OWASP, threat modeling) |

### Certificações Planejadas
- [ ] AWS Solutions Architect Associate
- [ ] CKAD (Kubernetes)
- [ ] eJPT / OSCP (Security)

---

## 💡 O Que Me Diferencia

| Estudante Típico | Minha Abordagem |
|------------------|-----------------|
| Aprende framework da moda | Domina fundamentos (HTTP, TCP, SQL, OS) |
| Faz "trabalho de faculdade" | Entrega **produto pronto para produção** |
| Ignora testes/docs/CI | **Qualidade não-negociável** desde o commit 1 |
| Deploy = FTP/zip | **Pipeline automatizado** com gates de qualidade |
| "Funciona na minha máquina" | **Observabilidade, recovery, rollback** |

---

## 🤝 Buscando Oportunidades

> **Estágio / Júnior / Trainee** em Engenharia de Software  
> Disponível para: **Remoto / Híbrido / Presencial (SP/Interior)**  
> Início: **Imediato**

### O que levo para o time
- ✅ Código limpo, testado, documentado
- ✅ Mentalidade de **dono do produto** (não só "tarefa")
- ✅ Comunicação clara, proatividade, foco em resultado
- ✅ Vontade real de aprender com seniors e evoluir rápido

---

## 📫 Vamos Conversar?

- 💼 **LinkedIn**: [linkedin.com/in/victorhugoeng](https://linkedin.com/in/victorhugoeng)
- 🐙 **GitHub**: [github.com/VictorHugoEng](https://github.com/VictorHugoEng)
- 📧 **Email**: victorhugoeng@email.com

---

<div align="center">

**"Código que não está em produção não gera valor.  
Código sem testes não é confiável.  
Código sem documentação não é mantível.  
Engenharia de software é sobre entregar valor sustentável."**

</div>

---

⭐ **Se gostou do meu trabalho, deixe uma estrela no [AlmoxarifadoProject](https://github.com/VictorHugoEng/AlmoxarifadoProject)!**