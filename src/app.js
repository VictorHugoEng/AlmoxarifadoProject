'use strict';

// ============================================================
// APLICAÇÃO EXPRESS (montagem de middlewares e rotas)
// Sem chamadas de rede nem inicialização de banco: isso fica no index.js.
// ============================================================

const express = require('express');
const path = require('node:path');
const config = require('./config');
const nuvem = require('./nuvem');
const backup = require('./backup');
const { exigirAutenticacao } = require('./auth');
const {
  criarRateLimiter,
  cabecalhosSeguranca,
  semCache,
  parseCorpoPadrao,
} = require('./middlewares');

const app = express();

// Confia no cabeçalho do proxy (ngrok/Render) para enxergar o IP real
app.set('trust proxy', true);

// Parsing de corpo com limites inteligentes:
// - Rotas de chat usam parser próprio (12 MB) registrado DEPOIS da autenticação
app.use(express.urlencoded({ extended: false, limit: '100kb' }));
app.use(parseCorpoPadrao);

app.use(cabecalhosSeguranca);
app.use(semCache);

app.use(express.static(path.join(config.paths.public)));

// Health check para plataformas de deploy (Render, Docker, etc.).
// Fica fora de /api de propósito para não exigir autenticação.
app.get('/healthz', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// ==========================================================
// NUVEM + BACKUP: DISPARO AUTOMÁTICO A CADA ALTERAÇÃO
// ==========================================================
// QUALQUER gravação (estoque, categorias, equipamentos, destinatários,
// usuários, compras, observações, alertas...) sobe para o Google Drive
// quase instantaneamente e também gera cópia local.
const ROTAS_SEM_SYNC = [
  '/api/nuvem',
  '/api/login',
  '/api/logout',
  '/api/chat',
  '/api/notificacoes',
];
app.use((req, res, next) => {
  if (req.path.startsWith('/api/') && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    res.on('finish', () => {
      const semSync = ROTAS_SEM_SYNC.some(p => req.path === p || req.path.startsWith(p + '/'));
      if (!semSync && res.statusCode >= 200 && res.statusCode < 300) {
        nuvem.agendarSincronizacaoNuvem();
        backup.agendarBackupLocal();
      }
    });
  }
  next();
});

// ==========================================================
// PROTEÇÃO GERAL: TODAS AS ROTAS /api EXIGEM LOGIN
// (exceto as rotas públicas declaradas abaixo)
// ==========================================================
const ROTAS_PUBLICAS_API = [
  '/api/login',
  '/api/nuvem/status', // tela de login consulta o estado da nuvem
  '/api/nuvem/login', // início do fluxo OAuth do Google
  '/api/nuvem/oauth2/callback', // retorno do Google após autorização
];
// Rotas com id secreto (a tag <img> do navegador não envia o token de login)
const ROTAS_PUBLICAS_PREFIXO = [
  '/api/chat/midia/', // fotos do chat (id aleatório e inacessível)
];
app.use('/api', (req, res, next) => {
  const caminho = req.originalUrl.split('?')[0];
  if (ROTAS_PUBLICAS_API.includes(caminho)) return next();
  if (ROTAS_PUBLICAS_PREFIXO.some(p => caminho.startsWith(p))) return next();
  exigirAutenticacao(req, res, next);
});
app.use('/api', criarRateLimiter({ nome: 'api', max: 120 }));

app.use('/api', require('./routes/auth'));
app.use('/api', require('./routes/usuarios'));
app.use('/api', require('./routes/estoque'));
app.use('/api', require('./routes/equipamentos'));
app.use('/api', require('./routes/compras'));
app.use('/api', require('./routes/chat'));
app.use('/api', require('./routes/notificacoes'));
app.use('/api', require('./routes/nuvem'));

module.exports = app;
