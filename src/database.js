'use strict';

// ============================================================
// CAMADA DE DADOS (núcleo)
// - Escolhe e expõe o driver ativo (SQlite/PostgreSQL)
// - Cria o esquema e popula dados iniciais (seed)
// - Recuperação automática (SQLite: backup local → nuvem)
// - Utilitários criptográficos de nível federal (scrypt + timingSafeEqual)
// ============================================================

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');
const { createDatabase } = require('./db');
const { createTablesSql } = require('./db/schema-sqlite');
const { createTables } = require('./db/schema-postgres');

const DB_DRIVER = config.db.driver;
const DB_PATH = config.db.sqlitePath;
const PASTA_BACKUPS = config.paths.backups;

// ============================================================
// RECUPERAÇÃO AUTOMÁTICA DE DADOS (SQLite — proteção contra apagão)
// Se o voltstock.db for apagado/corrompido, restaura o último backup.
// ============================================================
function restaurarBackupMaisRecente() {
  try {
    if (!fs.existsSync(PASTA_BACKUPS)) return false;

    const arquivos = fs
      .readdirSync(PASTA_BACKUPS)
      .filter(f => f.startsWith('voltstock_') && f.endsWith('.db'))
      .sort();
    if (arquivos.length === 0) return false;

    const maisRecente = arquivos[arquivos.length - 1];
    const origem = path.join(PASTA_BACKUPS, maisRecente);
    const backupTmp = path.join(PASTA_BACKUPS, '.restaurando.db');

    fs.copyFileSync(origem, backupTmp);

    for (const suf of ['-wal', '-shm']) {
      try {
        fs.unlinkSync(DB_PATH + suf);
      } catch (e) {}
    }

    fs.copyFileSync(backupTmp, DB_PATH);
    try {
      fs.unlinkSync(backupTmp);
    } catch (e) {}

    try {
      fs.appendFileSync(
        path.join(PASTA_BACKUPS, 'historico_backups.txt'),
        `[${new Date().toLocaleString('pt-BR')}] RECUPERACAO AUTOMATICA: banco principal ausente/corrompido -> restaurado de ${maisRecente}\n`
      );
    } catch (e) {}

    console.log(
      `[Recuperação Automática] Banco principal não encontrado. Restaurando do backup: ${maisRecente}...`
    );
    return true;
  } catch (e) {
    console.error('[Recuperação Automática] Falha ao restaurar backup:', e.message);
    return false;
  }
}

// Recuperação pela nuvem (Google Drive) — máquina nova / perda total.
// Usa um processo filho assíncrono de forma sincronizada, garantindo
// que o banco ainda NÃO tenha sido aberto quando voltar.
function restaurarDaNuvem() {
  const cfgPath = config.configPath;
  if (!fs.existsSync(cfgPath)) return false;

  try {
    const { execSync } = require('node:child_process');
    const nuvemModule = path.join(__dirname, 'nuvem.js');
    const script =
      `require(${JSON.stringify(nuvemModule)})` +
      `.baixarBackupNuvem({aplicar:true})` +
      `.then(r=>{ if(!r.ok) throw new Error(r.erro||'falha'); process.exit(0); })` +
      `.catch(e=>{ console.error(e.message); process.exit(1); })`;

    execSync(`${JSON.stringify(process.execPath)} -e ${JSON.stringify(script)}`, {
      env: { ...process.env, ALMOX_NO_RECOVER: '1' },
      timeout: 60000,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    });

    try {
      const test = new DatabaseSync(DB_PATH);
      test.exec('PRAGMA integrity_check;');
      test.close();
      console.log('[Recuperação Automática] Banco recuperado com sucesso DA NUVEM (Google Drive).');
      return true;
    } catch (e) {
      console.error('[Recuperação Automática] Arquivo baixado da nuvem está inválido:', e.message);
      return false;
    }
  } catch (e) {
    console.error('[Recuperação Automática] Falha ao recuperar da nuvem:', e.message);
    return false;
  }
}

// Disparo na carga do módulo (apenas SQLite)
if (DB_DRIVER === 'sqlite' && !config.db.noRecover && !config.db.isolated) {
  if (!fs.existsSync(DB_PATH)) {
    if (!restaurarBackupMaisRecente() && !restaurarDaNuvem()) {
      console.log(
        '[Recuperação Automática] Nenhum backup local nem nuvem encontrado. Criando banco novo...'
      );
    }
  }
}

// Em modo auxiliar (processo filho da recuperação via nuvem), o banco
// NUNCA é aberto/criado aqui — senão o arquivo vazio criado sobrescreveria
// o backup baixado logo em seguida. (Espelha o comportamento do sistema antigo.)
const db = config.db.noRecover ? null : createDatabase();

let iniciado = false;

// Migrações incrementais específicas do SQLite (banco legado)
async function migracoesSqlite() {
  for (const sql of [
    'ALTER TABLE solicitacoes_compras ADD COLUMN feedback_compras TEXT DEFAULT "Aguardando cotação";',
    'ALTER TABLE solicitacoes_compras ADD COLUMN setor TEXT DEFAULT "Almoxarifado Inteligente";',
    'ALTER TABLE observacoes_setores ADD COLUMN status TEXT DEFAULT "EM_ABERTO";',
    'ALTER TABLE mensagens_chat ADD COLUMN imagem TEXT;',
  ]) {
    try {
      await db.exec(sql);
    } catch (e) {
      // coluna já existe — normal em bancos recentes
    }
  }
}

// Seeding idempotente: só popula tabelas vazias. Compatível com
// SQLite e PostgreSQL (usa apenas prepared statements).
async function seedDatabase() {
  const totalUsuarios = await db.prepare('SELECT COUNT(*) AS total FROM usuarios').get();
  if (totalUsuarios.total === 0) {
    const { salt, hash } = gerarHashSenha(config.admin.password);
    console.log(`[Segurança] Cadastrando Administrador Master (${config.admin.username})...`);
    await db
      .prepare(
        `
        INSERT INTO usuarios (username, password_hash, salt, nome_completo, cargo, role, ativo)
        VALUES (?, ?, ?, ?, ?, ?, 1)
      `
      )
      .run(
        config.admin.username,
        hash,
        salt,
        'Anderson',
        'Administrador Geral do Sistema',
        'ADMIN_MASTER'
      );
    console.log(
      '[Segurança] Administrador Master criado com sucesso e protegido com scrypt/256-bit!'
    );
  }

  const countDest = await db
    .prepare('SELECT COUNT(*) as total FROM destinatarios_notificacao')
    .get();
  if (countDest.total === 0) {
    const insertDest = await db.prepare(`
      INSERT INTO destinatarios_notificacao (nome, cargo, telefone_whatsapp, email, ativo)
      VALUES (?, ?, ?, ?, ?)
    `);
    const destinatariosPadrao = [
      ['Ana Souza', 'Gerente Geral', '5511900000001', 'ana.souza@empresa.com.br', 1],
      ['Bruno Lima', 'Diretor', '5511900000002', 'bruno.lima@empresa.com.br', 1],
      ['Carla Mendes', 'Diretora', '5511900000003', 'carla.mendes@empresa.com.br', 1],
      ['Diego Rocha', 'Diretor', '5511900000004', 'diego.rocha@empresa.com.br', 1],
      ['Elisa Ramos', 'Diretora', '5511900000005', 'elisa.ramos@empresa.com.br', 1],
      ['Fernanda Alves', 'Setor de Compras', '5511900000006', 'fernanda.alves@empresa.com.br', 1],
    ];
    for (const dest of destinatariosPadrao) {
      await insertDest.run(...dest);
    }
  }

  const countCats = await db.prepare('SELECT COUNT(*) as total FROM categorias').get();
  if (countCats.total === 0) {
    const insertCat = await db.prepare('INSERT INTO categorias (nome) VALUES (?)');
    const categoriasPadrao = [
      'Parafusos e Fixadores',
      'Suportes e Fixação',
      'Infraestrutura',
      'Disjuntores e Proteção',
      'Cabos e Fios',
      'Terminais e Conectores',
      'Insumos e Fitas',
      'EPI e Segurança',
    ];
    for (const nome of categoriasPadrao) await insertCat.run(nome);
  }

  const countItens = await db.prepare('SELECT COUNT(*) as total FROM estoque_itens').get();
  if (countItens.total === 0) {
    const insertItem = await db.prepare(`
      INSERT INTO estoque_itens
      (codigo_id, nome, categoria, quantidade_atual, quantidade_minima, unidade_medida, localizacao, preco_estimado)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const itensEletrica = [
      [
        'PAR-001',
        'Parafuso Sextavado M8 x 25mm Inox 304',
        'Parafusos e Fixadores',
        18,
        20,
        'UN',
        'Gaveteiro A - Gaveta 01',
        1.85,
      ],
      [
        'PAR-002',
        'Parafuso Allen Cabeça Cilíndrica M6 x 20mm',
        'Parafusos e Fixadores',
        15,
        20,
        'UN',
        'Gaveteiro A - Gaveta 02',
        1.2,
      ],
      [
        'PAR-003',
        'Parafuso Auto Brocante Philips 4.2 x 38mm',
        'Parafusos e Fixadores',
        85,
        20,
        'UN',
        'Gaveteiro A - Gaveta 03',
        0.45,
      ],
      [
        'PAR-004',
        'Porca Sextavada M8 Zincada c/ Arruela de Pressão',
        'Parafusos e Fixadores',
        19,
        20,
        'UN',
        'Gaveteiro A - Gaveta 04',
        0.85,
      ],
      [
        'SUP-001',
        'Suporte Perfilado 38x38 para Eletrocalha',
        'Suportes e Fixação',
        12,
        20,
        'UN',
        'Prateleira B - Nível 01',
        14.5,
      ],
      [
        'SUP-002',
        'Grampo C 1/4" Reforçado para Viga Metálica',
        'Suportes e Fixação',
        14,
        20,
        'UN',
        'Prateleira B - Nível 02',
        8.2,
      ],
      [
        'SUP-003',
        'Abraçadeira D com Cunha 1" para Eletroduto',
        'Suportes e Fixação',
        45,
        25,
        'UN',
        'Prateleira B - Nível 03',
        3.1,
      ],
      [
        'INF-001',
        'Eletroduto Galvanizado a Fogo 1" Barra 3m',
        'Infraestrutura',
        16,
        20,
        'BR',
        'Cavalete de Tubos - Setor E',
        48.0,
      ],
      [
        'INF-002',
        'Curva 90º Eletroduto Galvanizado 1"',
        'Infraestrutura',
        9,
        15,
        'UN',
        'Prateleira C - Caixa 02',
        12.0,
      ],
      [
        'INF-003',
        'Eletrocalha Perfurada 50x50x3000mm com Tampa',
        'Infraestrutura',
        8,
        10,
        'BR',
        'Cavalete de Eletrocalhas',
        65.0,
      ],
      [
        'DISJ-001',
        'Disjuntor Bipolar 32A Curva C 5kA DIN',
        'Disjuntores e Proteção',
        7,
        10,
        'UN',
        'Armário Painel - Prateleira 01',
        34.0,
      ],
      [
        'DISJ-002',
        'Disjuntor Tripolar 63A Curva C 10kA Schneider',
        'Disjuntores e Proteção',
        4,
        5,
        'UN',
        'Armário Painel - Prateleira 02',
        110.0,
      ],
      [
        'CAB-001',
        'Cabo Flexível 2.5mm² 750V Verde (Terra)',
        'Cabos e Fios',
        120,
        50,
        'MT',
        'Rolo E-01',
        2.8,
      ],
      [
        'CAB-002',
        'Cabo Flexível 6.0mm² 750V Azul Claro (Neutro)',
        'Cabos e Fios',
        80,
        50,
        'MT',
        'Rolo E-02',
        6.4,
      ],
      [
        'TER-001',
        'Terminal Tubular Ilhós 16mm² Amarelo',
        'Terminais e Conectores',
        110,
        30,
        'UN',
        'Gaveta Conectores - D01',
        0.85,
      ],
      [
        'TER-002',
        'Conector de Emenda Rápida WAGO 221-413 (3 vias)',
        'Terminais e Conectores',
        16,
        25,
        'UN',
        'Gaveta Conectores - D02',
        4.2,
      ],
      [
        'INS-001',
        'Fita Isolante Alta Fusão 19mm x 20m 3M Scotch',
        'Insumos e Fitas',
        8,
        10,
        'RL',
        'Prateleira Insumos - I01',
        32.5,
      ],
      [
        'EPI-001',
        'Luva Isolante de Borracha Classe 0 (1000V) Tam 10',
        'EPI e Segurança',
        5,
        4,
        'PAR',
        'Armário Segurança S-01',
        180.0,
      ],
    ];

    for (const item of itensEletrica) {
      await insertItem.run(...item);
    }
  }

  const countEquips = await db
    .prepare('SELECT COUNT(*) as total FROM equipamentos_calibracao')
    .get();
  if (countEquips.total === 0) {
    const insertEquip = await db.prepare(`
      INSERT INTO equipamentos_calibracao
      (tag_patrimonio, nome, fabricante, modelo, numero_serie, data_ultima_calibracao, data_validade_calibracao, laboratorio, certificado_num, responsavel)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const hoje = new Date();
    const emDias = n => {
      const d = new Date(hoje.getTime() + n * 24 * 60 * 60 * 1000);
      return d.toISOString().split('T')[0];
    };

    const dados = [
      [
        'PAT-EL-001',
        'Multímetro Digital True RMS 1000V',
        'Fluke',
        'Fluke 179',
        'FLK-983214',
        '2025-09-20',
        emDias(8),
        'LabCal RBC',
        'CAL-2025-901',
        'Victor Hugo',
      ],
      [
        'PAT-EL-002',
        'Alicate Amperímetro Digital AC/DC 1000A',
        'Minipa',
        'ET-3200',
        'MNP-45012',
        '2025-10-01',
        emDias(14),
        'Instrulab',
        'CAL-2025-442',
        'Engenharia de Campo',
      ],
      [
        'PAT-EL-003',
        'Megômetro Digital 5kV',
        'Megabras',
        'MD-5060x',
        'MB-77120',
        '2024-09-12',
        emDias(-4),
        'Aferitec RBC',
        'CAL-2024-883',
        'Manutenção Elétrica',
      ],
      [
        'PAT-EL-004',
        'Câmera Termográfica Infravermelha',
        'FLIR',
        'FLIR E4 WiFi',
        'FLR-10293',
        '2026-03-10',
        emDias(120),
        'Flir Certified',
        'CAL-2026-102',
        'Victor Hugo',
      ],
    ];
    for (const e of dados) await insertEquip.run(...e);
  }

  const countCompras = await db.prepare('SELECT COUNT(*) as total FROM solicitacoes_compras').get();
  if (countCompras.total === 0) {
    const item1 = await db
      .prepare('SELECT id, nome, quantidade_atual FROM estoque_itens WHERE codigo_id = ?')
      .get('PAR-001');
    const item2 = await db
      .prepare('SELECT id, nome, quantidade_atual FROM estoque_itens WHERE codigo_id = ?')
      .get('SUP-001');

    if (item1) {
      await db
        .prepare(
          `
          INSERT INTO solicitacoes_compras
          (item_id, item_nome, quantidade_atual, quantidade_solicitada, urgencia, solicitante, setor, status, observacao, feedback_compras)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
        )
        .run(
          item1.id,
          item1.nome,
          item1.quantidade_atual,
          200,
          'ALTA',
          'Victor Hugo (Almoxarifado)',
          'Almoxarifado Inteligente',
          'EM_COTACAO',
          'Estoque atingiu 18 un (crítico ≤ 20). Necessário para montagem de infraestrutura.',
          'Cotação com fornecedor habitual realizada. Aguardando liberação da diretoria.'
        );
    }

    if (item2) {
      await db
        .prepare(
          `
          INSERT INTO solicitacoes_compras
          (item_id, item_nome, quantidade_atual, quantidade_solicitada, urgencia, solicitante, setor, status, observacao, feedback_compras)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
        )
        .run(
          item2.id,
          item2.nome,
          item2.quantidade_atual,
          50,
          'CRÍTICA',
          'Victor Hugo (Almoxarifado)',
          'Almoxarifado Inteligente',
          'PENDENTE',
          'Faltam suportes para continuidade da obra da linha de produção.',
          'Pedido recebido em Compras. Aguardando liberação da diretoria.'
        );
    }
  }
}

// Migração das fotos antigas do chat (ficavam em disco) para o banco.
// Idempotente: depois de migrada, a mensagem não aponta mais para disco.
async function migrarImagensChatParaBanco() {
  try {
    const pasta = config.paths.uploadsChat;
    if (!fs.existsSync(pasta)) return;
    const arquivos = fs.readdirSync(pasta);
    let migradas = 0;
    for (const nome of arquivos) {
      const caminhoAntigo = `/uploads/chat/${nome}`;
      const refs = await db
        .prepare('SELECT id FROM mensagens_chat WHERE imagem = ?')
        .all(caminhoAntigo);
      if (refs.length === 0) continue;
      let buf;
      try {
        buf = fs.readFileSync(path.join(pasta, nome));
      } catch (e) {
        continue;
      }
      if (!buf || buf.length === 0) continue;
      const ext = (nome.split('.').pop() || '').toLowerCase();
      const mime =
        ext === 'png'
          ? 'image/png'
          : ext === 'webp'
            ? 'image/webp'
            : ext === 'gif'
              ? 'image/gif'
              : 'image/jpeg';
      const id = crypto.randomBytes(24).toString('hex');
      await db
        .prepare(
          'INSERT OR IGNORE INTO chat_anexos (id, mime, nome, tamanho, conteudo) VALUES (?, ?, ?, ?, ?)'
        )
        .run(id, mime, nome, buf.length, buf);
      await db
        .prepare('UPDATE mensagens_chat SET imagem = ? WHERE imagem = ?')
        .run(`/api/chat/midia/${id}`, caminhoAntigo);
      migradas++;
    }
    if (migradas > 0)
      console.log(`[Chat] ${migradas} imagem(ns) migrada(s) para o banco (agora vao no backup).`);
  } catch (e) {
    console.error('[Chat] Falha ao migrar imagens para o banco:', e.message);
  }
}

// Ponto único de inicialização do banco (chamado antes do servidor escutar)
async function initializeDatabase() {
  if (iniciado) return db;
  if (!db) throw new Error('Banco em modo auxiliar — inicialização não permitida.');
  iniciado = true;

  if (DB_DRIVER === 'sqlite') {
    await db.exec(createTablesSql);
    await migracoesSqlite();
  } else {
    await db.exec(createTables);
  }

  await seedDatabase();

  if (DB_DRIVER === 'sqlite') {
    await migrarImagensChatParaBanco();
    // Corrige afinação do WAL após criação/restauração
    try {
      await db.exec('PRAGMA wal_autocheckpoint = 1000;');
    } catch (e) {}
  }

  console.log(`[Banco de Dados] Motor: ${DB_DRIVER.toUpperCase()} | Pronto e semeado.`);
  return db;
}

// ============================================================
// UTILITÁRIOS CRIPTOGRÁFICOS
// Salt 16 bytes, scrypt 64 bytes, comparação em tempo constante
// ============================================================
function gerarHashSenha(senhaPura) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(senhaPura, salt, 64);
  return {
    salt,
    hash: derivedKey.toString('hex'),
  };
}

function validarSenha(senhaPura, hashArmazenado, salt) {
  try {
    const derivedKey = crypto.scryptSync(senhaPura, salt, 64);
    const keyBuffer = Buffer.from(derivedKey.toString('hex'), 'hex');
    const storedBuffer = Buffer.from(hashArmazenado, 'hex');
    return crypto.timingSafeEqual(keyBuffer, storedBuffer);
  } catch (err) {
    return false;
  }
}

function gerarTokenSessao() {
  return crypto.randomBytes(32).toString('hex'); // 256 bits de entropia
}

module.exports = {
  db,
  DB_PATH,
  DB_DRIVER,
  initializeDatabase,
  gerarHashSenha,
  validarSenha,
  gerarTokenSessao,
};
