'use strict';

// ============================================================
// CONFIGURAÇÃO CENTRALIZADA
// Todas as variáveis de ambiente e constantes do sistema vivem
// aqui, para que rotas, serviços e o próprio banco partilhem
// os mesmos valores (ICAO: Single Source of Truth).
// ============================================================

const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const env = process.env;

const DEMO_ADMIN_USERNAME = 'anderson';

const config = {
  root: ROOT,

  server: {
    port: Number(env.PORT) || 3000,
    // Por padrão escuta apenas localhost (ngrok/túnel ou o próprio PC).
    // Em containers/PaaS (Docker, Render, Railway...) o PORT é injetado
    // pelo provedor, então ligamos automaticamente a 0.0.0.0.
    host: env.HOST || (env.PORT ? '0.0.0.0' : '127.0.0.1'),
  },

  db: {
    driver: (env.DB_DRIVER || 'sqlite').toLowerCase(),
    sqlitePath: env.ALMOX_DB_PATH || path.join(ROOT, 'voltstock.db'),
    postgresUrl: env.DATABASE_URL || '',
    // ambiente isolado (testes/dev): quando ALMOX_DB_PATH é informado
    // explicitamente, abre esse banco dedicado sem recuperar de backups.
    isolated: !!env.ALMOX_DB_PATH,
    noRecover: env.ALMOX_NO_RECOVER === '1',
  },

  configPath: env.ALMOX_CONFIG_PATH || path.join(ROOT, 'nuvem_config.json'),

  admin: {
    username: DEMO_ADMIN_USERNAME,
    password: env.ALMOX_ADMIN_PASSWORD || '123456',
  },

  paths: {
    public: path.join(ROOT, 'public'),
    backups: path.join(ROOT, 'backups'),
    uploadsChat: path.join(ROOT, 'public', 'uploads', 'chat'),
    versao: path.join(ROOT, 'versao.txt'),
    atualizacaoPendente: path.join(ROOT, 'atualizacao_pendente'),
    backupCodigo: path.join(ROOT, 'backups', 'programa'),
  },

  roles: ['ADMIN_MASTER', 'OPERADOR', 'COMPRAS', 'CONSULTA'],

  security: {
    maxTentativas: 5,
    minutosBloqueio: 15,
    horasSessaoNormal: 12,
    horasSessaoLembrar: 24 * 30,
  },

  backup: {
    maxBackups: 30,
    intervaloMs: 24 * 60 * 60 * 1000,
    minIntervaloLocalMs: 5 * 60 * 1000,
    historicoLog: path.join(ROOT, 'backups', 'historico_backups.txt'),
  },

  chat: {
    maxImagemBytes: 4 * 1024 * 1024,
    limiteTotalUploads: 250 * 1024 * 1024,
    maxMensagemChars: 1000,
  },
};

module.exports = config;
