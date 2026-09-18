'use strict';

// ============================================================
// SISTEMA DE BACKUP AUTOMÁTICO (NUNCA PERDER DADOS)
// - Cópia de snapshot do SQLite (WAL checkpoint forçado antes)
// - Retenção de MAX_BACKUPS cópias (~1 mês)
// - Backup local pós-alteração com debounce de 15s (máx. 1 a cada 5 min)
// (PostgreSQL usa o próprio motor de backup; este fluxo é do SQLite.)
// ============================================================

const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');
const { db, DB_PATH, DB_DRIVER } = require('./database');

const PASTA_BACKUPS = config.paths.backups;
const BACKUP_LOG_TXT = config.backup.historicoLog;

let ultimoBackup = null; // { data, caminho, tamanho }
let ultimoBackupLocalEm = 0;
let timerBackupLocal = null;

async function realizarBackup() {
  if (DB_DRIVER !== 'sqlite') return null;
  try {
    ultimoBackupLocalEm = Date.now();
    fs.mkdirSync(PASTA_BACKUPS, { recursive: true });

    // Força a gravação do WAL no arquivo principal para snapshot consistente
    await db.exec('PRAGMA wal_checkpoint(FULL);');

    const agora = new Date();
    const stamp = agora.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const destino = path.join(PASTA_BACKUPS, `voltstock_${stamp}.db`);

    fs.copyFileSync(DB_PATH, destino);

    const tamanho = fs.statSync(destino).size;
    ultimoBackup = { data: agora.toISOString(), caminho: destino, tamanho };

    // Remove cópias antigas (mantém as MAX_BACKUPS mais recentes)
    const arquivos = fs
      .readdirSync(PASTA_BACKUPS)
      .filter(f => f.startsWith('voltstock_') && f.endsWith('.db'))
      .sort();
    while (arquivos.length > config.backup.maxBackups) {
      const antigo = arquivos.shift();
      try {
        fs.unlinkSync(path.join(PASTA_BACKUPS, antigo));
      } catch (e) {}
    }

    // Registra no histórico de backups
    try {
      fs.appendFileSync(
        BACKUP_LOG_TXT,
        `[${agora.toLocaleString('pt-BR')}] BACKUP: voltstock_${stamp}.db (${(tamanho / 1024).toFixed(1)} KB)\n`
      );
    } catch (e) {}

    console.log(
      `[Backup] Copia de segurança criada: voltstock_${stamp}.db (${(tamanho / 1024).toFixed(1)} KB)`
    );
    return ultimoBackup;
  } catch (e) {
    console.error('[Backup] Falha ao criar backup:', e.message);
    return null;
  }
}

// Backup local após alterações: junta várias e cria no máximo 1 a cada 5 min.
function agendarBackupLocal() {
  if (timerBackupLocal) return;
  if (Date.now() - ultimoBackupLocalEm < config.backup.minIntervaloLocalMs) return;
  timerBackupLocal = setTimeout(() => {
    timerBackupLocal = null;
    realizarBackup();
  }, 15000);
}

// Backup automático ao ligar o servidor + 1x por dia (24h)
function iniciarServicoBackup() {
  setTimeout(() => realizarBackup(), 5000);
  setInterval(realizarBackup, config.backup.intervaloMs);
}

function statusBackup() {
  fs.mkdirSync(PASTA_BACKUPS, { recursive: true });
  const arquivos = fs
    .readdirSync(PASTA_BACKUPS)
    .filter(f => f.startsWith('voltstock_') && f.endsWith('.db'))
    .sort()
    .reverse()
    .slice(0, 5);
  let tamanhoDB = 0;
  try {
    tamanhoDB = fs.statSync(DB_PATH).size;
  } catch (e) {}
  return { ultimoBackup, backupsRecentes: arquivos, tamanhoDB };
}

module.exports = {
  realizarBackup,
  agendarBackupLocal,
  iniciarServicoBackup,
  statusBackup,
};
