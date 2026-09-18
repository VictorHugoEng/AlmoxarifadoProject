'use strict';

// ============================================================
// PONTO DE ENTRADA DO SERVIDOR
// Inicializa o banco ANTES de escutar e agenda os serviços
// em segundo plano (backup, nuvem, poda de registros).
// ============================================================

const config = require('./config');
const app = require('./app');
const database = require('./database');
const backup = require('./backup');
const nuvem = require('./nuvem');
const { podarRegistrosPesados } = require('./helpers');

async function iniciar() {
  // Banco pronto (esquema + seed idempotente + migrações de imagem)
  await database.initializeDatabase();

  // Backup automático ao ligar o servidor + 1x por dia (24h)
  backup.iniciarServicoBackup();

  // Ao ligar o servidor, sincroniza com a nuvem (baixa a última versão se houver)
  setTimeout(() => {
    if (nuvem.temCliente() && nuvem.temTokens()) {
      nuvem.enviarBackupNuvem().then(r => {
        if (!r.ok && r.erro) console.log(`[Nuvem] Sincronização inicial: ${r.erro}`);
      });
      nuvem.baixarBackupNuvem().then(r => {
        if (r.ok) console.log(`[Nuvem] Versão mais recente da nuvem salva em: ${r.caminho}`);
      });
    }
  }, 20000);

  // Rede de segurança: a cada 3 min garante que a nuvem está atualizada.
  setInterval(
    () => {
      if (nuvem.temCliente() && nuvem.temTokens()) nuvem.sincronizarAgora();
    },
    3 * 60 * 1000
  );

  // Poda automática de registros (anti-encher disco)
  setTimeout(() => podarRegistrosPesados(), 60000);
  setInterval(podarRegistrosPesados, 6 * 60 * 60 * 1000);

  app.listen(config.server.port, config.server.host, () => {
    const banco =
      database.DB_DRIVER === 'sqlite'
        ? 'voltstock.db (SQLite nativo)'
        : `PostgreSQL (${database.DB_DRIVER})`;
    console.log(`====================================================`);
    console.log(`⚡ ALMOXARIFADO INTELIGENTE // SISTEMA DE ESTOQUE & CALIBRAÇÃO`);
    console.log(`Servidor ativo em: http://${config.server.host}:${config.server.port}`);
    console.log(`Banco de dados: ${banco}`);
    console.log(`[Segurança] Rate limit + headers ativos (bind: ${config.server.host})`);
    console.log(`====================================================`);
  });
}

iniciar().catch(err => {
  console.error('[Inicialização] Falha fatal:', err);
  process.exit(1);
});
