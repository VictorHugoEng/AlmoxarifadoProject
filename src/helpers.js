'use strict';

// ============================================================
// HELPERS REUTILIZÁVEIS (status calculados, versão, merge de arquivos)
// ============================================================

const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');
const { db } = require('./database');

// Status de estoque calculado (CRITICO/NORMAL) + déficit em unidades
function enriquecerItemEstoque(item) {
  const isCritico = item.quantidade_atual <= item.quantidade_minima;
  return {
    ...item,
    status_alerta: isCritico ? 'CRITICO' : 'NORMAL',
    deficit: isCritico ? Math.max(0, item.quantidade_minima - item.quantidade_atual) : 0,
  };
}

// Status de calibração calculado em dias restantes (VENCIDO/ALERTA_15_DIAS/OK)
function enriquecerEquipamento(equip) {
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);

  const dataValidade = new Date(equip.data_validade_calibracao + 'T00:00:00');
  const diffMs = dataValidade.getTime() - hoje.getTime();
  const diasRestantes = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  let status = 'OK';
  if (diasRestantes <= 0) {
    status = 'VENCIDO';
  } else if (diasRestantes <= 15) {
    status = 'ALERTA_15_DIAS';
  }

  return {
    ...equip,
    dias_restantes: diasRestantes,
    status_calibracao: status,
  };
}

// Detecta violação de UNIQUE em SQLite ou PostgreSQL de forma portável
function eErroUnico(err) {
  return /UNIQUE constraint failed|duplicate key|unique constraint/i.test(
    (err && err.message) || ''
  );
}

// Versão atual do sistema (versao.txt) — dispara a recarga OTA dos clientes
function versaoAtual() {
  try {
    return fs.readFileSync(config.paths.versao, 'utf8').trim();
  } catch (e) {
    return '0.0.0';
  }
}

function compararVersoes(a, b) {
  const pa = String(a || '')
    .split('.')
    .map(n => parseInt(n, 10) || 0);
  const pb = String(b || '')
    .split('.')
    .map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

// Versão para o app: máximo mtime entre arquivos do frontend e o backend
function versaoDoApp() {
  const arquivos = [
    'index.html',
    'login.html',
    'app.js',
    'style.css',
    'sw.js',
    'manifest.webmanifest',
    'icons/icon.svg',
  ];
  let max = 0;
  for (const f of arquivos) {
    try {
      const s = fs.statSync(path.join(config.paths.public, f));
      if (s.mtimeMs > max) max = s.mtimeMs;
    } catch (e) {}
  }
  for (const f of ['src/index.js', 'src/app.js', 'src/database.js']) {
    try {
      const s = fs.statSync(path.join(config.root, f));
      if (s.mtimeMs > max) max = s.mtimeMs;
    } catch (e) {}
  }
  return { versao: String(Math.round(max)), atualizado_em: new Date(max).toISOString() };
}

// Copia arquivos sem apagar o que já existe (merge) — usado pela atualização OTA
function copiarRecursivo(de, para) {
  fs.mkdirSync(para, { recursive: true });
  for (const it of fs.readdirSync(de, { withFileTypes: true })) {
    const f = path.join(de, it.name);
    const d = path.join(para, it.name);
    if (it.isDirectory()) copiarRecursivo(f, d);
    else {
      try {
        fs.copyFileSync(f, d);
      } catch (e) {}
    }
  }
}

// Poda periódica de registros pesados (anti-encher disco): mantém as últimas
// 100 mil linhas de auditoria e 50 mil alertas históricos.
async function podarRegistrosPesados() {
  try {
    await db
      .prepare(
        'DELETE FROM logs_seguranca WHERE id NOT IN (SELECT id FROM logs_seguranca ORDER BY id DESC LIMIT 100000)'
      )
      .run();
    await db
      .prepare(
        'DELETE FROM historico_alertas WHERE id NOT IN (SELECT id FROM historico_alertas ORDER BY id DESC LIMIT 50000)'
      )
      .run();
  } catch (e) {
    console.error('[Poda] Falha ao podar registros:', e.message);
  }
}

module.exports = {
  enriquecerItemEstoque,
  enriquecerEquipamento,
  eErroUnico,
  versaoAtual,
  compararVersoes,
  versaoDoApp,
  copiarRecursivo,
  podarRegistrosPesados,
};
