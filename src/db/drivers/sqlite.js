'use strict';

// ============================================================
// DRIVER SQLITE (node:sqlite nativo do Node)
// Expõe a interface padrão consumida pelas rotas: exec / prepare.
// A interface é assíncrona por contrato, mas aqui os valores são
// resolvidos imediatamente (SQLite síncrono em memória/disco).
// Isso permite trocar por um driver PostgreSQL sem tocar nas rotas.
// ============================================================

const { DatabaseSync } = require('node:sqlite');

function criarDriverSqlite(caminho) {
  const db = new DatabaseSync(caminho);

  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA synchronous = FULL;');
  db.exec('PRAGMA wal_autocheckpoint = 1000;');

  return {
    type: 'sqlite',

    async exec(sql) {
      return db.exec(sql);
    },

    // prepare é SÍNCRONO (como no SQLite): devolve um objeto de statement
    // cujos run/get/all são assíncronos (contrato para trocar de motor).
    prepare(sql) {
      const stmt = db.prepare(sql);
      return {
        async run(...params) {
          return stmt.run(...params);
        },
        async get(...params) {
          return stmt.get(...params);
        },
        async all(...params) {
          return stmt.all(...params);
        },
      };
    },

    // Handle nativo (usado pela recuperação automática de boot)
    native: db,
  };
}

module.exports = criarDriverSqlite;
