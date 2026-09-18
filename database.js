const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const crypto = require('node:crypto');
const fs = require('node:fs');

const DB_PATH = process.env.ALMOX_DB_PATH || path.join(__dirname, 'voltstock.db');
// Modo isolado (testes/dev): quando ALMOX_DB_PATH é informado explicitamente,
// abre esse banco dedicado sem tentar recuperar de backups locais ou da nuvem.
const DB_ISOLADO = !!process.env.ALMOX_DB_PATH;
const PASTA_BACKUPS = path.join(__dirname, 'backups');

// Processo auxiliar (filho) disparado pela recuperação da nuvem:
// nele NÃO tentamos recuperar de novo, para não criar loop infinito.
const SKIP_RECUPERACAO = process.env.ALMOX_NO_RECOVER === '1';

// ============================================================
// RECUPERAÇÃO AUTOMÁTICA DE DADOS (PROTEÇÃO CONTRA APAGÃO)
// ============================================================
// Se o voltstock.db for apagado/corrompido sem querer, o sistema
// restaura automaticamente o backup mais recente ao ser reiniciado.
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

    // Copia o backup para um arquivo temporário (nunca altera o backup original)
    fs.copyFileSync(origem, backupTmp);

    // Remove restos (WAL/SHM) do banco apagado para não conflitar com a restauração
    for (const suf of ['-wal', '-shm']) {
      try {
        fs.unlinkSync(DB_PATH + suf);
      } catch (e) {}
    }

    // Promove o backup restaurado para o banco principal
    fs.copyFileSync(backupTmp, DB_PATH);
    try {
      fs.unlinkSync(backupTmp);
    } catch (e) {}

    // Registra a recuperação no histórico de backups
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

// ============================================================
// RECUPERAÇÃO PELA NUVEM (GOOGLE DRIVE) — MÁQUINA NOVA / PERDA TOTAL
// ============================================================
// Se não houver backup local (ex: sistema montado do zero em outro PC),
// baixa a versão mais recente da nuvem e aplica direto no banco principal.
// Usa um processo filho (assíncrono por natureza) de forma sincronizada,
// garantindo que o banco ainda NÃO tenha sido aberto quando voltar.
function restaurarDaNuvem() {
  const cfgPath = path.join(__dirname, 'nuvem_config.json');
  if (!fs.existsSync(cfgPath)) return false;

  try {
    const { execSync } = require('node:child_process');
    const script =
      `require(${JSON.stringify(path.join(__dirname, 'nuvem.js'))})` +
      `.baixarBackupNuvem({aplicar:true})` +
      `.then(r=>{ if(!r.ok) throw new Error(r.erro||'falha'); process.exit(0); })` +
      `.catch(e=>{ console.error(e.message); process.exit(1); })`;

    execSync(`${JSON.stringify(process.execPath)} -e ${JSON.stringify(script)}`, {
      env: { ...process.env, ALMOX_NO_RECOVER: '1' },
      timeout: 60000,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    });

    // Confirma que o arquivo restaurado é um SQLite íntegro
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

// Se o banco principal NÃO existir (apagado sem querer), recupera do último backup
// (local primeiro; se não houver nenhum local, tenta a nuvem).
if (!SKIP_RECUPERACAO && !DB_ISOLADO) {
  if (!fs.existsSync(DB_PATH)) {
    if (!restaurarBackupMaisRecente() && !restaurarDaNuvem()) {
      console.log(
        '[Recuperação Automática] Nenhum backup local nem nuvem encontrado. Criando banco novo...'
      );
    }
  }
}

let db = null;
if (!SKIP_RECUPERACAO) {
  try {
    db = new DatabaseSync(DB_PATH);
  } catch (e) {
    console.error('[Recuperação Automática] Banco corrompido ou ilegível:', e.message);
    if (!restaurarBackupMaisRecente() && !restaurarDaNuvem()) {
      throw e;
    }
    db = new DatabaseSync(DB_PATH);
  }
} else {
  // Modo auxiliar (filho da recuperação da nuvem):
  // NUNCA abre/cria o banco aqui — senão o arquivo vazio criado
  // sobrescreveria o backup baixado logo em seguida.
  db = null;
}

if (db) {
  // Habilita chaves estrangeiras
  db.exec('PRAGMA foreign_keys = ON;');

  // ============================================================
  // DURABILIDADE MÁXIMA (PROTEÇÃO CONTRA PERDA DE DADOS)
  // ============================================================
  // - WAL: transações ficam seguras contra queda de energia/crash.
  // - synchronous FULL: toda gravação é confirmada somente após
  //   ser gravada fisicamente no disco (nada fica só em memória).
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA synchronous = FULL;');
  db.exec('PRAGMA wal_autocheckpoint = 1000;');
}

/**
 * ============================================================
 * UTILITÁRIOS CRIPTOGRÁFICOS DE NÍVEL FEDERAL (NODE:CRYPTO)
 * ============================================================
 * - Salt criptograficamente seguro com 16 bytes de entropia
 * - Derivação de chave lenta scrypt (resistente a ataques de GPU/ASIC e Rainbow Tables)
 * - Comparação em tempo constante (timingSafeEqual) contra timing attacks
 */
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

/**
 * Inicialização e migração do esquema de dados relacional do Almoxarifado
 */
function initDatabase() {
  db.exec(`
    -- Tabela de Usuários com RBAC (Role-Based Access Control)
    CREATE TABLE IF NOT EXISTS usuarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      nome_completo TEXT NOT NULL,
      cargo TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'OPERADOR', -- 'ADMIN_MASTER', 'OPERADOR', 'COMPRAS', 'CONSULTA'
      ativo INTEGER NOT NULL DEFAULT 1,
      tentativas_falhas INTEGER NOT NULL DEFAULT 0,
      bloqueado_ate DATETIME NULL,
      ultimo_login DATETIME NULL,
      criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Tabela de Sessões Ativas com Validade
    CREATE TABLE IF NOT EXISTS sessoes_ativas (
      token TEXT PRIMARY KEY,
      usuario_id INTEGER NOT NULL,
      lembrar_me INTEGER NOT NULL DEFAULT 0,
      expira_em DATETIME NOT NULL,
      criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
      ip_origem TEXT,
      FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
    );

    -- Tabela de Auditoria e Logs de Segurança (Padrão Bancário)
    CREATE TABLE IF NOT EXISTS logs_seguranca (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id INTEGER,
      username_tentativa TEXT,
      evento TEXT NOT NULL, -- 'LOGIN_SUCESSO', 'LOGIN_FALHA', 'BLOQUEIO_BRUTE_FORCE', 'LOGOUT', 'CRIACAO_USUARIO', 'EXCLUSAO_USUARIO'
      ip TEXT,
      detalhes TEXT,
      data_hora DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Tabela de Itens de Estoque do Almoxarifado
    CREATE TABLE IF NOT EXISTS estoque_itens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      codigo_id TEXT UNIQUE NOT NULL,
      nome TEXT NOT NULL,
      categoria TEXT NOT NULL,
      quantidade_atual INTEGER NOT NULL DEFAULT 0,
      quantidade_minima INTEGER NOT NULL DEFAULT 20,
      unidade_medida TEXT NOT NULL DEFAULT 'UN',
      localizacao TEXT NOT NULL,
      preco_estimado REAL DEFAULT 0.0,
      criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
      atualizado_em DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Tabela de Equipamentos e Metrologia
    CREATE TABLE IF NOT EXISTS equipamentos_calibracao (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tag_patrimonio TEXT UNIQUE NOT NULL,
      nome TEXT NOT NULL,
      fabricante TEXT NOT NULL,
      modelo TEXT NOT NULL,
      numero_serie TEXT NOT NULL,
      data_ultima_calibracao DATE NOT NULL,
      data_validade_calibracao DATE NOT NULL,
      laboratorio TEXT,
      certificado_num TEXT,
      responsavel TEXT NOT NULL,
      criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Tabela de Solicitações para o Setor de Compras
    CREATE TABLE IF NOT EXISTS solicitacoes_compras (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER,
      item_nome TEXT NOT NULL,
      quantidade_atual INTEGER NOT NULL,
      quantidade_solicitada INTEGER NOT NULL,
      urgencia TEXT NOT NULL DEFAULT 'ALTA',
      solicitante TEXT NOT NULL DEFAULT 'Almoxarifado Inteligente',
      setor TEXT NOT NULL DEFAULT 'Almoxarifado Inteligente',
      status TEXT NOT NULL DEFAULT 'PENDENTE',
      observacao TEXT,
      feedback_compras TEXT DEFAULT 'Aguardando início de cotação',
      data_solicitacao DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (item_id) REFERENCES estoque_itens(id) ON DELETE SET NULL
    );

    -- Tabela de Destinatários de Notificações
    CREATE TABLE IF NOT EXISTS destinatarios_notificacao (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      cargo TEXT NOT NULL,
      telefone_whatsapp TEXT NOT NULL,
      email TEXT NOT NULL,
      ativo INTEGER NOT NULL DEFAULT 1
    );

    -- Histórico Geral de Alertas
    CREATE TABLE IF NOT EXISTS historico_alertas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tipo TEXT NOT NULL,
      origem_id INTEGER,
      titulo TEXT NOT NULL,
      mensagem TEXT NOT NULL,
      data_disparo DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Mural de Observações Compartilhadas (todos os setores)
    CREATE TABLE IF NOT EXISTS observacoes_setores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      autor TEXT NOT NULL,
      setor TEXT NOT NULL DEFAULT 'Almoxarifado Inteligente',
      observacao TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'EM_ABERTO',
      criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Chat de Mensagens Privadas (1-a-1 entre usuários)
    CREATE TABLE IF NOT EXISTS mensagens_chat (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      remetente_id INTEGER NOT NULL,
      destinatario_id INTEGER NOT NULL,
      mensagem TEXT NOT NULL DEFAULT '',
      imagem TEXT,
      lida INTEGER NOT NULL DEFAULT 0,
      criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (remetente_id) REFERENCES usuarios(id),
      FOREIGN KEY (destinatario_id) REFERENCES usuarios(id)
    );

    CREATE INDEX IF NOT EXISTS idx_mensagens_conversa ON mensagens_chat(remetente_id, destinatario_id);

    -- ANEXOS DO CHAT (fotos) guardados DENTRO do banco.
    -- Assim entram no backup (local e nuvem) e voltam numa recuperação total.
    CREATE TABLE IF NOT EXISTS chat_anexos (
      id TEXT PRIMARY KEY,
      mime TEXT NOT NULL,
      nome TEXT,
      tamanho INTEGER NOT NULL,
      conteudo BLOB NOT NULL,
      criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Controle de notificações lidas por usuário (sininho)
    CREATE TABLE IF NOT EXISTS notificacoes_visitas (
      usuario_id INTEGER PRIMARY KEY,
      ultimo_log_id INTEGER NOT NULL DEFAULT 0,
      atualizado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
    );

    -- Categorias do Almoxarifado (para filtro e cadastro)
    CREATE TABLE IF NOT EXISTS categorias (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT UNIQUE NOT NULL COLLATE NOCASE,
      criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // ============================================================
  // CRIAÇÃO DO SUPER USUÁRIO MASTER ADMINISTRADOR
  // LOGIN: anderson | SENHA: 123456 (ou o valor de ALMOX_ADMIN_PASSWORD)
  // Só cria na PRIMEIRA execução (tabela de usuários vazia).
  // NÃO recria nem força senha nas execuções seguintes.
  // ============================================================
  const totalUsuarios = db.prepare('SELECT COUNT(*) AS total FROM usuarios').get().total;
  if (totalUsuarios === 0) {
    const senhaInicial = process.env.ALMOX_ADMIN_PASSWORD || '123456';
    console.log('[Segurança] Cadastrando Administrador Master (anderson)...');
    const { salt, hash } = gerarHashSenha(senhaInicial);

    db.prepare(
      `
      INSERT INTO usuarios (username, password_hash, salt, nome_completo, cargo, role, ativo)
      VALUES (?, ?, ?, ?, ?, ?, 1)
    `
    ).run('anderson', hash, salt, 'Anderson', 'Administrador Geral do Sistema', 'ADMIN_MASTER');
    console.log(
      '[Segurança] Administrador Master (anderson) criado com sucesso e protegido com scrypt/256-bit!'
    );
  }

  // Migração segura de colunas se banco já existir
  try {
    db.exec(
      'ALTER TABLE solicitacoes_compras ADD COLUMN feedback_compras TEXT DEFAULT "Aguardando cotação";'
    );
  } catch (e) {}

  try {
    db.exec(
      'ALTER TABLE solicitacoes_compras ADD COLUMN setor TEXT DEFAULT "Almoxarifado Inteligente";'
    );
  } catch (e) {}

  try {
    db.exec('ALTER TABLE observacoes_setores ADD COLUMN status TEXT DEFAULT "EM_ABERTO";');
  } catch (e) {}

  // Migração: histórico de chat com envio de imagem (foto)
  try {
    db.exec('ALTER TABLE mensagens_chat ADD COLUMN imagem TEXT;');
  } catch (e) {}

  // Seeding dos destinatários padrão de notificação (dados de exemplo)
  const countDest = db.prepare('SELECT COUNT(*) as total FROM destinatarios_notificacao').get();
  if (countDest.total === 0) {
    const insertDest = db.prepare(`
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
      insertDest.run(...dest);
    }
  }

  // Seeding das Categorias padrão do Almoxarifado
  const countCats = db.prepare('SELECT COUNT(*) as total FROM categorias').get();
  if (countCats.total === 0) {
    const insertCat = db.prepare('INSERT INTO categorias (nome) VALUES (?)');
    const categoriasPadrao = [
      'Parafusos e Fixadores',
      'Suportes e Fixação',
      'Infraestrutura e Eletrodutos',
      'Disjuntores e Proteção',
      'Cabos e Fios',
      'Terminais e Conectores',
      'Insumos e Fitas',
      'EPI e Segurança',
    ];
    for (const nome of categoriasPadrao) insertCat.run(nome);
  }

  // Seeding de itens com categorias de elétrica
  const countItens = db.prepare('SELECT COUNT(*) as total FROM estoque_itens').get();
  if (countItens.total === 0) {
    const insertItem = db.prepare(`
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
      insertItem.run(...item);
    }
  }

  // Seeding de Equipamentos (15 dias de calibração)
  const countEquips = db.prepare('SELECT COUNT(*) as total FROM equipamentos_calibracao').get();
  if (countEquips.total === 0) {
    const insertEquip = db.prepare(`
      INSERT INTO equipamentos_calibracao
      (tag_patrimonio, nome, fabricante, modelo, numero_serie, data_ultima_calibracao, data_validade_calibracao, laboratorio, certificado_num, responsavel)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const hoje = new Date();
    const dataAlerta1 = new Date(hoje.getTime() + 8 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0]; // Vence em 8 dias
    const dataAlerta2 = new Date(hoje.getTime() + 14 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0]; // Vence em 14 dias
    const dataVencido = new Date(hoje.getTime() - 4 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0]; // Vencido
    const dataOk = new Date(hoje.getTime() + 120 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]; // OK

    insertEquip.run(
      'PAT-EL-001',
      'Multímetro Digital True RMS 1000V',
      'Fluke',
      'Fluke 179',
      'FLK-983214',
      '2025-09-20',
      dataAlerta1,
      'LabCal RBC',
      'CAL-2025-901',
      'Victor Hugo'
    );
    insertEquip.run(
      'PAT-EL-002',
      'Alicate Amperímetro Digital AC/DC 1000A',
      'Minipa',
      'ET-3200',
      'MNP-45012',
      '2025-10-01',
      dataAlerta2,
      'Instrulab',
      'CAL-2025-442',
      'Engenharia de Campo'
    );
    insertEquip.run(
      'PAT-EL-003',
      'Megômetro Digital 5kV',
      'Megabras',
      'MD-5060x',
      'MB-77120',
      '2024-09-12',
      dataVencido,
      'Aferitec RBC',
      'CAL-2024-883',
      'Manutenção Elétrica'
    );
    insertEquip.run(
      'PAT-EL-004',
      'Câmera Termográfica Infravermelha',
      'FLIR',
      'FLIR E4 WiFi',
      'FLR-10293',
      '2026-03-10',
      dataOk,
      'Flir Certified',
      'CAL-2026-102',
      'Victor Hugo'
    );
  }

  // Seeding de Compras com feedback do comprador
  const countCompras = db.prepare('SELECT COUNT(*) as total FROM solicitacoes_compras').get();
  if (countCompras.total === 0) {
    const item1 = db
      .prepare('SELECT id, nome, quantidade_atual FROM estoque_itens WHERE codigo_id = ?')
      .get('PAR-001');
    const item2 = db
      .prepare('SELECT id, nome, quantidade_atual FROM estoque_itens WHERE codigo_id = ?')
      .get('SUP-001');

    if (item1) {
      db.prepare(
        `
        INSERT INTO solicitacoes_compras 
        (item_id, item_nome, quantidade_atual, quantidade_solicitada, urgencia, solicitante, setor, status, observacao, feedback_compras)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
      ).run(
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
      db.prepare(
        `
        INSERT INTO solicitacoes_compras 
        (item_id, item_nome, quantidade_atual, quantidade_solicitada, urgencia, solicitante, setor, status, observacao, feedback_compras)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
      ).run(
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

// ============================================================
// MIGRAÇÃO: fotos antigas do chat (que ficavam em disco) para o banco
// ============================================================
// Percorre public/uploads/chat, importa cada imagem referenciada por uma
// mensagem para a tabela chat_anexos e troca o caminho antigo pelo novo.
// É idempotente: depois de migrada, a mensagem não aponta mais para o disco.
function migrarImagensChatParaBanco() {
  try {
    const pasta = path.join(__dirname, 'public', 'uploads', 'chat');
    if (!fs.existsSync(pasta)) return;
    const arquivos = fs.readdirSync(pasta);
    let migradas = 0;
    for (const nome of arquivos) {
      const caminhoAntigo = `/uploads/chat/${nome}`;
      const refs = db.prepare('SELECT id FROM mensagens_chat WHERE imagem = ?').all(caminhoAntigo);
      if (refs.length === 0) continue; // ignorado/órfão
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
      db.prepare(
        'INSERT OR IGNORE INTO chat_anexos (id, mime, nome, tamanho, conteudo) VALUES (?, ?, ?, ?, ?)'
      ).run(id, mime, nome, buf.length, buf);
      db.prepare('UPDATE mensagens_chat SET imagem = ? WHERE imagem = ?').run(
        `/api/chat/midia/${id}`,
        caminhoAntigo
      );
      migradas++;
    }
    if (migradas > 0)
      console.log(`[Chat] ${migradas} imagem(ns) migrada(s) para o banco (agora vao no backup).`);
  } catch (e) {
    console.error('[Chat] Falha ao migrar imagens para o banco:', e.message);
  }
}

// Inicializa no carregamento do módulo (se o banco foi aberto)
if (db) {
  initDatabase();
  migrarImagensChatParaBanco();
}

module.exports = {
  db,
  DB_PATH,
  gerarHashSenha,
  validarSenha,
  gerarTokenSessao,
};
