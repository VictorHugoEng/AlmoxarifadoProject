'use strict';

// ============================================================
// ESQUEMA SQLITE (criado com CREATE TABLE IF NOT EXISTS)
// ============================================================

const createTablesSql = `
  -- Tabela de Usuários com RBAC (Role-Based Access Control)
  CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    nome_completo TEXT NOT NULL,
    cargo TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'OPERADOR',
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

  -- Tabela de Auditoria e Logs de Segurança
  CREATE TABLE IF NOT EXISTS logs_seguranca (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER,
    username_tentativa TEXT,
    evento TEXT NOT NULL,
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
`;

module.exports = { createTablesSql };
