'use strict';

// ============================================================
// DRIVER POSTGRESQL (pg)
// Implementa EXATAMENTE a mesma interface do driver SQLite:
//   exec(sql | string[]), prepare(sql) -> { run, get, all }
//
// Particularidades tratadas aqui para reutilizar as mesmas SQLs:
//  - Placeholders "?" convertidos para $1, $2, ... (pg não aceita "?")
//  - PRAGMA (SQLite) são ignorados silenciosamente
//  - CREATE TABLE IF NOT EXISTS em array (vários statements)
//  - int8/numeric devolvidos como Number (COUNT, ids, preços, totais)
// ============================================================

function criarDriverPostgres(connectionString) {
  const { Pool, types } = require('pg');

  // COUNT(*), SUM, ids BIGSERIAL vêm como string no pg; normaliza para Number
  types.setTypeParser(20, v => parseInt(v, 10)); // int8
  types.setTypeParser(1700, v => parseFloat(v)); // numeric

  const { hostname } = new URL(connectionString);
  const local = !hostname || hostname === 'localhost' || hostname === '127.0.0.1';

  const pool = new Pool({
    connectionString,
    ssl: local ? undefined : { rejectUnauthorized: false },
    max: 10,
  });

  // Divide blocos de SQL (-- comentários e ; no fim de cada statement).
  // Simples e suficiente para os scripts fixos do projeto.
  function separarStatements(sql) {
    return String(sql)
      .split('\n')
      .filter(linha => !linha.trim().startsWith('--'))
      .join('\n')
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0);
  }

  function converterPlaceholders(sql) {
    let i = 0;
    return sql.replace(/\?/g, () => `$${++i}`);
  }

  return {
    type: 'postgres',

    async exec(sql) {
      const statements = Array.isArray(sql)
        ? sql.slice()
        : separarStatements(sql).filter(s => !/^PRAGMA/i.test(s));
      for (const stmt of statements) {
        if (/^PRAGMA/i.test(stmt)) continue;
        await pool.query(stmt);
      }
    },

    // prepare é SÍNCRONO (mesmo contrato do SQLite): devolve um objeto de
    // statement cujos run/get/all são assíncronos.
    prepare(sql) {
      const texto = converterPlaceholders(sql);
      return {
        async run(...params) {
          const res = await pool.query(texto, params);
          return {
            changes: res.rowCount || 0,
            lastInsertRowid: undefined,
          };
        },
        async get(...params) {
          const res = await pool.query(texto, params);
          return res.rows[0];
        },
        async all(...params) {
          const res = await pool.query(texto, params);
          return res.rows;
        },
      };
    },
  };
}

module.exports = criarDriverPostgres;
