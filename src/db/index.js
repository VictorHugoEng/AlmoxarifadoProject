'use strict';

// ============================================================
// FÁBRICA DE DRIVERS DE BANCO DE DADOS
// Troca o motor através da variável DB_DRIVER (sqlite | postgres).
// A interface consumida pelo resto da aplicação é sempre a mesma:
//   db.exec(sql)
//   db.prepare(sql).run(...) | .get(...) | .all(...)
// ============================================================

const config = require('../config');
const criarDriverSqlite = require('./drivers/sqlite');
const criarDriverPostgres = require('./drivers/postgres');

function createDatabase() {
  switch (config.db.driver) {
    case 'postgres': {
      if (!config.db.postgresUrl) {
        throw new Error(
          'DB_DRIVER=postgres exige DATABASE_URL. Ex: postgres://user:pass@host:5432/dbname'
        );
      }
      return criarDriverPostgres(config.db.postgresUrl);
    }
    case 'sqlite':
    default:
      return criarDriverSqlite(config.db.sqlitePath);
  }
}

module.exports = { createDatabase };
