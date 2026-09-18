'use strict';

// ============================================================
// AUTENTICAÇÃO, RBAC E AUDITORIA
// ============================================================

const { db, gerarTokenSessao } = require('./database');
const config = require('./config');

// IP real do cliente (confia no cabeçalho do proxy/ngrok)
function obterIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim().replace('::ffff:', '');
  const raw = req.ip || req.socket.remoteAddress || 'DESCONHECIDO';
  return raw.replace('::ffff:', '');
}

// Registro de eventos de segurança em trilha de auditoria
async function registrarLog(
  evento,
  usuarioId = null,
  usernameTentativa = null,
  detalhes = '',
  ip = null
) {
  try {
    await db
      .prepare(
        `
      INSERT INTO logs_seguranca (usuario_id, username_tentativa, evento, ip, detalhes)
      VALUES (?, ?, ?, ?, ?)
    `
      )
      .run(usuarioId, usernameTentativa, evento, ip, detalhes);
  } catch (e) {
    console.error('[Auditoria] Falha ao registrar evento:', e.message);
  }
}

function extrairToken(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7);
  return null;
}

// Middleware: exige sessão válida em todas as rotas protegidas
async function exigirAutenticacao(req, res, next) {
  const token = extrairToken(req);
  if (!token) return res.status(401).json({ erro: 'Não autenticado. Faça login para continuar.' });

  const sessao = await db.prepare('SELECT * FROM sessoes_ativas WHERE token = ?').get(token);
  if (!sessao) return res.status(401).json({ erro: 'Sessão inválida. Faça login novamente.' });

  if (Date.parse(sessao.expira_em) < Date.now()) {
    await db.prepare('DELETE FROM sessoes_ativas WHERE token = ?').run(token);
    return res.status(401).json({ erro: 'Sessão expirada. Faça login novamente.' });
  }

  const usuario = await db
    .prepare(
      `
    SELECT id, username, nome_completo, cargo, role, ativo FROM usuarios WHERE id = ?
  `
    )
    .get(sessao.usuario_id);

  if (!usuario || usuario.ativo !== 1) {
    return res.status(401).json({ erro: 'Conta desativada ou inexistente.' });
  }

  req.usuario = usuario;
  req.sessaoToken = token;
  req.sessao = sessao;
  next();
}

// Middleware: restringe rotas exclusivas do Administrador Master
async function exigirAdmin(req, res, next) {
  if (!req.usuario || req.usuario.role !== 'ADMIN_MASTER') {
    await registrarLog(
      'ACESSO_NEGADO',
      req.usuario?.id,
      req.usuario?.username,
      'Tentativa de acessar rota administrativa sem permissão',
      req.ip
    );
    return res.status(403).json({ erro: 'Acesso restrito ao Administrador Master.' });
  }
  next();
}

// Emissão de sessão criptograficamente forte (256 bits)
async function novaSessao(usuarioId, lembrarMe, ipOrigem) {
  const horas = lembrarMe ? config.security.horasSessaoLembrar : config.security.horasSessaoNormal;
  const expiraEm = new Date(Date.now() + horas * 3600000).toISOString();
  const token = gerarTokenSessao();

  await db
    .prepare(
      `
      INSERT INTO sessoes_ativas (token, usuario_id, lembrar_me, expira_em, ip_origem)
      VALUES (?, ?, ?, ?, ?)
    `
    )
    .run(token, usuarioId, lembrarMe ? 1 : 0, expiraEm, ipOrigem);

  return { token, expiraEm, horas };
}

// Erros internos NUNCA vazam detalhes para o cliente (só log no console)
function msgErroInterno(err) {
  console.error('[Erro interno]', err && err.message);
  return 'Ocorreu um erro interno. Tente novamente.';
}

module.exports = {
  obterIp,
  registrarLog,
  extrairToken,
  exigirAutenticacao,
  exigirAdmin,
  novaSessao,
  msgErroInterno,
};
