'use strict';

// ============================================================
// ESQUEMA POSTGRESQL (arrays de comandos — o pg não aceita
// múltiplos statements numa única chamada)
// ============================================================

const createTables = [
  `CREATE TABLE IF NOT EXISTS usuarios (
    id BIGSERIAL PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    nome_completo TEXT NOT NULL,
    cargo TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'OPERADOR',
    ativo INTEGER NOT NULL DEFAULT 1,
    tentativas_falhas INTEGER NOT NULL DEFAULT 0,
    bloqueado_ate TIMESTAMP NULL,
    ultimo_login TIMESTAMP NULL,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_usuarios_username_lower ON usuarios (LOWER(username))`,
  `CREATE TABLE IF NOT EXISTS sessoes_ativas (
    token TEXT PRIMARY KEY,
    usuario_id BIGINT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    lembrar_me INTEGER NOT NULL DEFAULT 0,
    expira_em TIMESTAMP NOT NULL,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ip_origem TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS logs_seguranca (
    id BIGSERIAL PRIMARY KEY,
    usuario_id BIGINT,
    username_tentativa TEXT,
    evento TEXT NOT NULL,
    ip TEXT,
    detalhes TEXT,
    data_hora TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS estoque_itens (
    id BIGSERIAL PRIMARY KEY,
    codigo_id TEXT UNIQUE NOT NULL,
    nome TEXT NOT NULL,
    categoria TEXT NOT NULL,
    quantidade_atual INTEGER NOT NULL DEFAULT 0,
    quantidade_minima INTEGER NOT NULL DEFAULT 20,
    unidade_medida TEXT NOT NULL DEFAULT 'UN',
    localizacao TEXT NOT NULL,
    preco_estimado DOUBLE PRECISION DEFAULT 0.0,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS equipamentos_calibracao (
    id BIGSERIAL PRIMARY KEY,
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
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS solicitacoes_compras (
    id BIGSERIAL PRIMARY KEY,
    item_id BIGINT REFERENCES estoque_itens(id) ON DELETE SET NULL,
    item_nome TEXT NOT NULL,
    quantidade_atual INTEGER NOT NULL,
    quantidade_solicitada INTEGER NOT NULL,
    urgencia TEXT NOT NULL DEFAULT 'ALTA',
    solicitante TEXT NOT NULL DEFAULT 'Almoxarifado Inteligente',
    setor TEXT NOT NULL DEFAULT 'Almoxarifado Inteligente',
    status TEXT NOT NULL DEFAULT 'PENDENTE',
    observacao TEXT,
    feedback_compras TEXT DEFAULT 'Aguardando início de cotação',
    data_solicitacao TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS destinatarios_notificacao (
    id BIGSERIAL PRIMARY KEY,
    nome TEXT NOT NULL,
    cargo TEXT NOT NULL,
    telefone_whatsapp TEXT NOT NULL,
    email TEXT NOT NULL,
    ativo INTEGER NOT NULL DEFAULT 1
  )`,
  `CREATE TABLE IF NOT EXISTS historico_alertas (
    id BIGSERIAL PRIMARY KEY,
    tipo TEXT NOT NULL,
    origem_id BIGINT,
    titulo TEXT NOT NULL,
    mensagem TEXT NOT NULL,
    data_disparo TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS observacoes_setores (
    id BIGSERIAL PRIMARY KEY,
    autor TEXT NOT NULL,
    setor TEXT NOT NULL DEFAULT 'Almoxarifado Inteligente',
    observacao TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'EM_ABERTO',
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS mensagens_chat (
    id BIGSERIAL PRIMARY KEY,
    remetente_id BIGINT NOT NULL REFERENCES usuarios(id),
    destinatario_id BIGINT NOT NULL REFERENCES usuarios(id),
    mensagem TEXT NOT NULL DEFAULT '',
    imagem TEXT,
    lida INTEGER NOT NULL DEFAULT 0,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_mensagens_conversa ON mensagens_chat(remetente_id, destinatario_id)`,
  `CREATE TABLE IF NOT EXISTS chat_anexos (
    id TEXT PRIMARY KEY,
    mime TEXT NOT NULL,
    nome TEXT,
    tamanho INTEGER NOT NULL,
    conteudo BYTEA NOT NULL,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS notificacoes_visitas (
    usuario_id BIGINT PRIMARY KEY REFERENCES usuarios(id),
    ultimo_log_id BIGINT NOT NULL DEFAULT 0,
    atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS categorias (
    id BIGSERIAL PRIMARY KEY,
    nome TEXT UNIQUE NOT NULL,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
];

module.exports = { createTables };
