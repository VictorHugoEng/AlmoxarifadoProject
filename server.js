const express = require('express');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { db, DB_PATH, gerarHashSenha, validarSenha, gerarTokenSessao } = require('./database');
const nuvem = require('./nuvem');

const app = express();
const PORT = process.env.PORT || 3000;

// ==========================================
// SISTEMA DE BACKUP AUTOMÁTICO (NUNCA PERDER DADOS)
// ==========================================
const PASTA_BACKUPS = path.join(__dirname, 'backups');
const MAX_BACKUPS = 30; // mantém 30 cópias = ~1 mês de retenção
const INTERVALO_BACKUP_MS = 24 * 60 * 60 * 1000; // backup automático a cada 24h
const BACKUP_LOG_TXT = path.join(__dirname, 'backups', 'historico_backups.txt');
let ultimoBackup = null; // { data, caminho, tamanho }
let ultimoBackupLocalEm = 0; // quando um backup local foi feito
let timerBackupLocal = null; // agenda backup local após alterações
const MIN_INTERVALO_BACKUP_LOCAL_MS = 5 * 60 * 1000; // no máx. 1 a cada 5 min

function realizarBackup() {
  try {
    ultimoBackupLocalEm = Date.now();
    fs.mkdirSync(PASTA_BACKUPS, { recursive: true });

    // Força a gravação do WAL no arquivo principal para snapshot consistente
    db.exec('PRAGMA wal_checkpoint(FULL);');

    const agora = new Date();
    const stamp = agora.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const destino = path.join(PASTA_BACKUPS, `voltstock_${stamp}.db`);

    fs.copyFileSync(DB_PATH, destino);

    const tamanho = fs.statSync(destino).size;
    ultimoBackup = { data: agora.toISOString(), caminho: destino, tamanho };

    // Remove cópias antigas (mantém as MAX_BACKUPS mais recentes)
    const arquivos = fs
      .readdirSync(PASTA_BACKUPS)
      .filter(f => f.startsWith('voltstock_') && f.endsWith('.db'))
      .sort();
    while (arquivos.length > MAX_BACKUPS) {
      const antigo = arquivos.shift();
      try {
        fs.unlinkSync(path.join(PASTA_BACKUPS, antigo));
      } catch (e) {}
    }

    // Registra no histórico de backups
    try {
      fs.appendFileSync(
        BACKUP_LOG_TXT,
        `[${agora.toLocaleString('pt-BR')}] BACKUP: voltstock_${stamp}.db (${(tamanho / 1024).toFixed(1)} KB)\n`
      );
    } catch (e) {}

    console.log(
      `[Backup] Copia de segurança criada: voltstock_${stamp}.db (${(tamanho / 1024).toFixed(1)} KB)`
    );
    return ultimoBackup;
  } catch (e) {
    console.error('[Backup] Falha ao criar backup:', e.message);
    return null;
  }
}

// Backup local após alterações: junta várias e cria no máximo 1 a cada 5 min.
// Assim existe SEMPRE uma cópia local recente, sem depender só da nuvem.
function agendarBackupLocal() {
  if (timerBackupLocal) return;
  if (Date.now() - ultimoBackupLocalEm < MIN_INTERVALO_BACKUP_LOCAL_MS) return;
  timerBackupLocal = setTimeout(() => {
    timerBackupLocal = null;
    realizarBackup();
  }, 15000);
}

// Backup automático ao ligar o servidor + 1x por dia (24h)
setTimeout(() => realizarBackup(), 5000);
setInterval(realizarBackup, INTERVALO_BACKUP_MS);

// ==========================================
// SEGURANÇA DE INFRAESTRUTURA (BLINDAGEM)
// ==========================================
// Confia no cabeçalho do proxy (ngrok) para enxergar o IP real do cliente
app.set('trust proxy', true);

// Parsing de corpo com limites inteligentes:
// - Corpo pequeno nas rotas públicas/padrão (evita abuso de CPU/memória pré-login)
// - Rotas de chat usam parser próprio (12 MB) registrado DEPOIS da autenticação
app.use(express.urlencoded({ extended: false, limit: '100kb' }));
app.use((req, res, next) => {
  if (req.path.startsWith('/api/chat/')) return next();
  express.json({ limit: '100kb' })(req, res, next);
});

// Cabeçalhos de segurança (equivalente ao pacote "helmet")
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-XSS-Protection', '0');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      'font-src https://fonts.gstatic.com',
      "img-src 'self' data: https:",
      "connect-src 'self'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "object-src 'none'",
    ].join('; ')
  );
  next();
});

// Middleware de parsing e arquivos estáticos

// ==========================================
// ATUALIZAÇÃO INSTANTÂNEA (VOCÊ NO CONTROLE)
// ==========================================
// Impede que navegador/app guarde cópia antiga de qualquer coisa.
// Assim qualquer alteração feita no PC (dados ou códigos) chega
// na hora em todos os dispositivos, sem precisar reinstalar.
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

// ==========================================
// NUVEM: DISPARO AUTOMÁTICO A CADA ALTERAÇÃO
// ==========================================
// QUALQUER gravação (estoque, categorias, equipamentos, destinatários,
// usuários, compras, observações, alertas...) sobe para o Google Drive
// quase instantaneamente e também gera cópia local.
// Ficam de fora só rotas que não são dados de negócio ou que gerariam
// envios em excesso (a nuvem em si, login/logout, chat e notificações).
const ROTAS_SEM_SYNC = [
  '/api/nuvem',
  '/api/login',
  '/api/logout',
  '/api/chat',
  '/api/notificacoes',
];
app.use((req, res, next) => {
  if (req.path.startsWith('/api/') && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    res.on('finish', () => {
      const semSync = ROTAS_SEM_SYNC.some(p => req.path === p || req.path.startsWith(p + '/'));
      if (!semSync && res.statusCode >= 200 && res.statusCode < 300) {
        nuvem.agendarSincronizacaoNuvem();
        agendarBackupLocal();
      }
    });
  }
  next();
});

// ==========================================
// SEGURANÇA: CONSTANTES DE PROTEÇÃO EXTREMA
// ==========================================
const MAX_TENTATIVAS = 5; // bloqueio após 5 erros
const MINUTOS_BLOQUEIO = 15; // bloqueado por 15 minutos
const ROLES_VALIDAS = ['ADMIN_MASTER', 'OPERADOR', 'COMPRAS', 'CONSULTA'];

function obterIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim().replace('::ffff:', '');
  const raw = req.ip || req.socket.remoteAddress || 'DESCONHECIDO';
  return raw.replace('::ffff:', '');
}

// ==========================================
// RATE LIMITER POR IP (PROTEÇÃO CONTRA FLOOD/DOS)
// ==========================================
const limitesPorIP = new Map();

function removerLimitesAntigos() {
  const agora = Date.now();
  if (limitesPorIP.size < 5000) return;
  for (const [chave, rec] of limitesPorIP) {
    if (rec.bloqueadoAte < agora && agora - rec.janelaInicio > rec.janelaMs * 2) {
      limitesPorIP.delete(chave);
    }
  }
}

function criarRateLimiter({ janelaMs = 60000, max = 100, nome = 'api', bloquearMs = 0 }) {
  return (req, res, next) => {
    const chave = `${nome}:${obterIp(req)}`;
    const agora = Date.now();
    let rec = limitesPorIP.get(chave);
    if (!rec) {
      rec = { janelaInicio: agora, janelaMs, contador: 0, bloqueadoAte: 0 };
      limitesPorIP.set(chave, rec);
    }

    if (rec.bloqueadoAte > agora) {
      const seg = Math.ceil((rec.bloqueadoAte - agora) / 1000);
      return res.status(429).json({ erro: `Muitas requisições. Aguarde ${seg} segundos.` });
    }

    if (agora - rec.janelaInicio > janelaMs) {
      rec.janelaInicio = agora;
      rec.contador = 0;
    }

    rec.contador++;
    if (rec.contador > max) {
      if (bloquearMs > 0) rec.bloqueadoAte = agora + bloquearMs;
      registrarLog(
        'RATE_LIMIT',
        null,
        null,
        `IP ${obterIp(req)} excedeu limite ${nome} (${max}/janela)`,
        obterIp(req)
      );
      return res.status(429).json({ erro: 'Muitas requisições. Tente novamente em instantes.' });
    }

    removerLimitesAntigos();
    next();
  };
}

// Erros internos NUNCA vazam detalhes para o cliente (só log no console)
function msgErroInterno(err) {
  console.error('[Erro interno]', err && err.message);
  return 'Ocorreu um erro interno. Tente novamente.';
}

// Registro de eventos de segurança em trilha de auditoria
function registrarLog(
  evento,
  usuarioId = null,
  usernameTentativa = null,
  detalhes = '',
  ip = null
) {
  try {
    db.prepare(
      `
      INSERT INTO logs_seguranca (usuario_id, username_tentativa, evento, ip, detalhes)
      VALUES (?, ?, ?, ?, ?)
    `
    ).run(usuarioId, usernameTentativa, evento, ip, detalhes);
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
function exigirAutenticacao(req, res, next) {
  const token = extrairToken(req);
  if (!token) return res.status(401).json({ erro: 'Não autenticado. Faça login para continuar.' });

  const sessao = db.prepare('SELECT * FROM sessoes_ativas WHERE token = ?').get(token);
  if (!sessao) return res.status(401).json({ erro: 'Sessão inválida. Faça login novamente.' });

  if (Date.parse(sessao.expira_em) < Date.now()) {
    db.prepare('DELETE FROM sessoes_ativas WHERE token = ?').run(token);
    return res.status(401).json({ erro: 'Sessão expirada. Faça login novamente.' });
  }

  const usuario = db
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
function exigirAdmin(req, res, next) {
  if (!req.usuario || req.usuario.role !== 'ADMIN_MASTER') {
    registrarLog(
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

// ==========================================
// AUTENTICAÇÃO: LOGIN, SESSÃO E LOGOUT
// ==========================================

// Login com proteção contra força bruta
app.post(
  '/api/login',
  criarRateLimiter({ nome: 'login', max: 10, bloquearMs: 15 * 60000 }),
  (req, res) => {
    try {
      const { username, senha, lembrar_me } = req.body;
      const ip = obterIp(req);

      if (!username || !senha) {
        return res.status(400).json({ erro: 'Informe usuário e senha.' });
      }

      const usuario = db.prepare('SELECT * FROM usuarios WHERE username = ?').get(username.trim());
      if (!usuario) {
        registrarLog('LOGIN_FALHA', null, username.trim(), 'Usuário não localizado', ip);
        return res.status(401).json({ erro: 'Credenciais inválidas.' });
      }

      // Conta bloqueada temporariamente
      if (usuario.bloqueado_ate && Date.parse(usuario.bloqueado_ate) > Date.now()) {
        const minutosRestantes = Math.ceil(
          (Date.parse(usuario.bloqueado_ate) - Date.now()) / 60000
        );
        registrarLog(
          'LOGIN_BLOQUEADO',
          usuario.id,
          usuario.username,
          `Bloqueado por ${MINUTOS_BLOQUEIO} min`,
          ip
        );
        return res.status(423).json({
          erro: `Conta bloqueada por segurança. Tente novamente em ${minutosRestantes} min.`,
        });
      }

      const senhaValida = validarSenha(senha, usuario.password_hash, usuario.salt);

      if (!senhaValida) {
        const novasTentativas = usuario.tentativas_falhas + 1;
        if (novasTentativas >= MAX_TENTATIVAS) {
          const bloqueadoAte = new Date(Date.now() + MINUTOS_BLOQUEIO * 60000).toISOString();
          db.prepare(
            'UPDATE usuarios SET tentativas_falhas = ?, bloqueado_ate = ? WHERE id = ?'
          ).run(novasTentativas, bloqueadoAte, usuario.id);
          registrarLog(
            'BLOQUEIO_BRUTE_FORCE',
            usuario.id,
            usuario.username,
            `Conta bloqueada após ${novasTentativas} tentativas falhas (${MINUTOS_BLOQUEIO} min)`,
            ip
          );
          return res
            .status(423)
            .json({
              erro: `Conta bloqueada após ${novasTentativas} tentativas falhas. Aguarde ${MINUTOS_BLOQUEIO} minutos.`,
            });
        }
        db.prepare('UPDATE usuarios SET tentativas_falhas = ? WHERE id = ?').run(
          novasTentativas,
          usuario.id
        );
        registrarLog(
          'LOGIN_FALHA',
          usuario.id,
          usuario.username,
          `Tentativa ${novasTentativas}/${MAX_TENTATIVAS}`,
          ip
        );
        return res.status(401).json({
          erro: 'Credenciais inválidas.',
          tentativas: novasTentativas,
          max: MAX_TENTATIVAS,
        });
      }

      if (usuario.ativo !== 1) {
        registrarLog('LOGIN_DESATIVADO', usuario.id, usuario.username, 'Conta desativada', ip);
        return res
          .status(403)
          .json({ erro: 'Conta desativada. Acione o administrador do sistema.' });
      }

      // Sucesso: emite sessão criptograficamente forte (256 bits)
      const horasSessao = lembrar_me ? 24 * 30 : 12;
      const expiraEm = new Date(Date.now() + horasSessao * 3600000).toISOString();
      const token = gerarTokenSessao();

      db.prepare(
        `
      INSERT INTO sessoes_ativas (token, usuario_id, lembrar_me, expira_em, ip_origem)
      VALUES (?, ?, ?, ?, ?)
    `
      ).run(token, usuario.id, lembrar_me ? 1 : 0, expiraEm, ip);

      db.prepare(
        `
      UPDATE usuarios SET tentativas_falhas = 0, bloqueado_ate = NULL, ultimo_login = CURRENT_TIMESTAMP WHERE id = ?
    `
      ).run(usuario.id);

      registrarLog(
        'LOGIN_SUCESSO',
        usuario.id,
        usuario.username,
        `Autenticação OK (sessão ${horasSessao}h)`,
        ip
      );

      res.json({
        token,
        expira_em: expiraEm,
        lembrar_me: !!lembrar_me,
        usuario: {
          id: usuario.id,
          username: usuario.username,
          nome: usuario.nome_completo,
          cargo: usuario.cargo,
          role: usuario.role,
        },
      });
    } catch (error) {
      res
        .status(500)
        .json({ erro: 'Falha interna na autenticação', detalhes: msgErroInterno(error) });
    }
  }
);

// Validação de sessão ativa (usada na carga da página / guard)
app.get('/api/sessao', (req, res) => {
  const token = extrairToken(req);
  if (!token) return res.status(401).json({ erro: 'Não autenticado' });

  const sessao = db.prepare('SELECT * FROM sessoes_ativas WHERE token = ?').get(token);
  if (!sessao || Date.parse(sessao.expira_em) < Date.now())
    return res.status(401).json({ erro: 'Sessão inválida ou expirada' });

  const usuario = db
    .prepare(
      `
    SELECT id, username, nome_completo, cargo, role, ativo FROM usuarios WHERE id = ?
  `
    )
    .get(sessao.usuario_id);

  if (!usuario || usuario.ativo !== 1) return res.status(401).json({ erro: 'Conta desativada' });

  res.json({ valida: true, expira_em: sessao.expira_em, usuario });
});

// Encerramento seguro da sessão
app.post('/api/logout', exigirAutenticacao, (req, res) => {
  try {
    registrarLog(
      'LOGOUT',
      req.usuario.id,
      req.usuario.username,
      'Sessão encerrada manualmente',
      obterIp(req)
    );
    db.prepare('DELETE FROM sessoes_ativas WHERE token = ?').run(req.sessaoToken);
    res.json({ mensagem: 'Sessão encerrada com segurança.' });
  } catch (error) {
    res.status(500).json({ erro: 'Erro ao encerrar sessão', detalhes: msgErroInterno(error) });
  }
});

// Helper: Cálculo de status de estoque
function enriquecerItemEstoque(item) {
  const isCritico = item.quantidade_atual <= item.quantidade_minima;
  return {
    ...item,
    status_alerta: isCritico ? 'CRITICO' : 'NORMAL',
    deficit: isCritico ? Math.max(0, item.quantidade_minima - item.quantidade_atual) : 0,
  };
}

// Helper: Cálculo de status de calibração em dias
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

// ==========================================
// PROTEÇÃO GERAL: TODAS AS ROTAS /api EXIGEM LOGIN
// (exceto as rotas públicas já declaradas acima)
// ==========================================
const ROTAS_PUBLICAS_API = [
  '/api/login',
  '/api/nuvem/status', // tela de login consulta o estado da nuvem
  '/api/nuvem/login', // início do fluxo OAuth do Google
  '/api/nuvem/oauth2/callback', // retorno do Google após autorização
];
// Rotas com id secreto (a tag <img> do navegador não envia o token de login)
const ROTAS_PUBLICAS_PREFIXO = [
  '/api/chat/midia/', // fotos do chat (id aleatório e inacessível)
];
app.use('/api', (req, res, next) => {
  const caminho = req.originalUrl.split('?')[0];
  if (ROTAS_PUBLICAS_API.includes(caminho)) return next();
  if (ROTAS_PUBLICAS_PREFIXO.some(p => caminho.startsWith(p))) return next();
  exigirAutenticacao(req, res, next);
});
app.use('/api', criarRateLimiter({ nome: 'api', max: 120 }));

// ==========================================
// ADMINISTRADOR: CONTROLE GERAL (RBAC)
// ==========================================

// Listar todos os usuários do sistema
app.get('/api/usuarios', exigirAdmin, (req, res) => {
  try {
    const usuarios = db
      .prepare(
        `
      SELECT id, username, nome_completo, cargo, role, ativo, tentativas_falhas, bloqueado_ate, ultimo_login, criado_em
      FROM usuarios ORDER BY id ASC
    `
      )
      .all()
      .map(u => ({
        ...u,
        bloqueado: !!(u.bloqueado_ate && Date.parse(u.bloqueado_ate) > Date.now()),
      }));
    res.json(usuarios);
  } catch (error) {
    res.status(500).json({ erro: 'Falha ao listar usuários', detalhes: msgErroInterno(error) });
  }
});

// Criar novo usuário com role definida
app.post('/api/usuarios', exigirAdmin, (req, res) => {
  try {
    const { username, senha, nome_completo, cargo, role } = req.body;
    if (!username || !senha || !nome_completo) {
      return res.status(400).json({ erro: 'Campos obrigatórios: username, senha, nome_completo' });
    }
    if (senha.length < 6) {
      return res.status(400).json({ erro: 'Senha fraca: mínimo de 6 caracteres' });
    }
    const roleFinal = ROLES_VALIDAS.includes(role) ? role : 'OPERADOR';

    const { salt, hash } = gerarHashSenha(senha);
    const result = db
      .prepare(
        `
      INSERT INTO usuarios (username, password_hash, salt, nome_completo, cargo, role, ativo)
      VALUES (?, ?, ?, ?, ?, ?, 1)
    `
      )
      .run(username.trim(), hash, salt, nome_completo.trim(), cargo || 'Operador', roleFinal);

    registrarLog(
      'CRIACAO_USUARIO',
      req.usuario.id,
      req.usuario.username,
      `Criou usuário "${username.trim()}" com role ${roleFinal}`,
      obterIp(req)
    );

    res
      .status(201)
      .json({ id: result.lastInsertRowid, username: username.trim(), role: roleFinal });
  } catch (error) {
    if (error.message.includes('UNIQUE constraint failed')) {
      return res.status(409).json({ erro: 'Nome de usuário já existe no sistema' });
    }
    res.status(500).json({ erro: 'Erro ao criar usuário', detalhes: msgErroInterno(error) });
  }
});

// Atualizar usuário (dados, role, status ou redefine senha)
app.put('/api/usuarios/:id', exigirAdmin, (req, res) => {
  try {
    const id = Number(req.params.id);
    const { nome_completo, cargo, role, ativo, nova_senha } = req.body;

    const alvo = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id);
    if (!alvo) return res.status(404).json({ erro: 'Usuário não localizado' });

    const roleFinal = ROLES_VALIDAS.includes(role) ? role : alvo.role;

    if (nova_senha) {
      if (nova_senha.length < 6) {
        return res.status(400).json({ erro: 'Senha fraca: mínimo de 6 caracteres' });
      }
      const { salt, hash } = gerarHashSenha(nova_senha);
      db.prepare(
        `
        UPDATE usuarios SET nome_completo = ?, cargo = ?, role = ?, ativo = ?, password_hash = ?, salt = ?, tentativas_falhas = 0, bloqueado_ate = NULL WHERE id = ?
      `
      ).run(
        nome_completo || alvo.nome_completo,
        cargo || alvo.cargo,
        roleFinal,
        ativo === undefined ? alvo.ativo : ativo ? 1 : 0,
        hash,
        salt,
        id
      );
      registrarLog(
        'RESET_SENHA',
        req.usuario.id,
        req.usuario.username,
        `Redefiniu senha de "${alvo.username}"`,
        obterIp(req)
      );
    } else {
      db.prepare(
        `
        UPDATE usuarios SET nome_completo = ?, cargo = ?, role = ?, ativo = ? WHERE id = ?
      `
      ).run(
        nome_completo || alvo.nome_completo,
        cargo || alvo.cargo,
        roleFinal,
        ativo === undefined ? alvo.ativo : ativo ? 1 : 0,
        id
      );
    }

    registrarLog(
      'EDICAO_USUARIO',
      req.usuario.id,
      req.usuario.username,
      `Editou "${alvo.username}" (role ${roleFinal}, ativo ${ativo === undefined ? alvo.ativo : ativo ? 1 : 0})`,
      obterIp(req)
    );

    res.json({ mensagem: 'Usuário atualizado com sucesso.' });
  } catch (error) {
    res.status(500).json({ erro: 'Erro ao atualizar usuário', detalhes: msgErroInterno(error) });
  }
});

// Desbloquear conta após bloqueio por força bruta
app.post('/api/usuarios/:id/desbloquear', exigirAdmin, (req, res) => {
  try {
    const id = Number(req.params.id);
    const alvo = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id);
    if (!alvo) return res.status(404).json({ erro: 'Usuário não localizado' });

    db.prepare('UPDATE usuarios SET tentativas_falhas = 0, bloqueado_ate = NULL WHERE id = ?').run(
      id
    );
    registrarLog(
      'DESBLOQUEIO_MANUAL',
      req.usuario.id,
      req.usuario.username,
      `Desbloqueou conta "${alvo.username}"`,
      obterIp(req)
    );
    res.json({ mensagem: `Conta de "${alvo.username}" desbloqueada.` });
  } catch (error) {
    res.status(500).json({ erro: 'Erro ao desbloquear usuário', detalhes: msgErroInterno(error) });
  }
});

// Excluir usuário (não permite excluir a si mesmo nem o último admin)
app.delete('/api/usuarios/:id', exigirAdmin, (req, res) => {
  try {
    const id = Number(req.params.id);
    if (id === req.usuario.id) {
      return res.status(400).json({ erro: 'Você não pode excluir a própria conta.' });
    }

    const alvo = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id);
    if (!alvo) return res.status(404).json({ erro: 'Usuário não localizado' });

    if (alvo.role === 'ADMIN_MASTER') {
      const countAdmins = db
        .prepare("SELECT COUNT(*) as total FROM usuarios WHERE role = 'ADMIN_MASTER' AND ativo = 1")
        .get().total;
      if (countAdmins <= 1) {
        return res
          .status(400)
          .json({ erro: 'Não é possível excluir o último administrador do sistema.' });
      }
    }

    db.prepare('DELETE FROM sessoes_ativas WHERE usuario_id = ?').run(id);
    db.prepare('DELETE FROM usuarios WHERE id = ?').run(id);
    registrarLog(
      'EXCLUSAO_USUARIO',
      req.usuario.id,
      req.usuario.username,
      `Excluiu usuário "${alvo.username}"`,
      obterIp(req)
    );
    res.json({ mensagem: 'Usuário excluído com segurança.' });
  } catch (error) {
    res.status(500).json({ erro: 'Erro ao excluir usuário', detalhes: msgErroInterno(error) });
  }
});

// Trilha de auditoria / logs de segurança
app.get('/api/auditoria', exigirAdmin, (req, res) => {
  try {
    const logs = db
      .prepare(
        `
      SELECT l.id, l.username_tentativa, l.evento, l.ip, l.detalhes, l.data_hora,
             u.nome_completo AS nome_registrado
      FROM logs_seguranca l
      LEFT JOIN usuarios u ON u.id = l.usuario_id
      ORDER BY l.id DESC LIMIT 200
    `
      )
      .all();
    res.json(logs);
  } catch (error) {
    res.status(500).json({ erro: 'Falha ao carregar auditoria', detalhes: msgErroInterno(error) });
  }
});

// Backup manual (botão na aba ADMINISTRADOR) + status
app.post('/api/backup', exigirAdmin, (req, res) => {
  const backup = realizarBackup();
  if (!backup) return res.status(500).json({ erro: 'Falha ao gerar backup.' });
  registrarLog(
    'BACKUP_DB',
    req.usuario.id,
    req.usuario.username,
    `Gerou backup manual do banco (voltstock_${path.basename(backup.caminho)}, ${(backup.tamanho / 1024).toFixed(1)} KB)`,
    obterIp(req)
  );
  res.json({ mensagem: 'Backup gerado com sucesso!', backup });
});

app.get('/api/backup/status', exigirAdmin, (req, res) => {
  try {
    fs.mkdirSync(PASTA_BACKUPS, { recursive: true });
    const arquivos = fs
      .readdirSync(PASTA_BACKUPS)
      .filter(f => f.startsWith('voltstock_') && f.endsWith('.db'))
      .sort()
      .reverse()
      .slice(0, 5);
    const tamanhoDB = fs.statSync(DB_PATH).size;
    res.json({ ultimoBackup, backupsRecentes: arquivos, tamanhoDB });
  } catch (error) {
    res.status(500).json({ erro: 'Falha ao consultar backups', detalhes: msgErroInterno(error) });
  }
});

// ==========================================
// NUVEM (GOOGLE DRIVE) — BACKUP NA CONTA GOOGLE
// ==========================================

// Status público (tela de login usa para exibir o botão/estado)
app.get('/api/nuvem/status', (req, res) => {
  res.json(nuvem.status());
});

// Iniciar conexão com a nuvem (OAuth Google) — redireciona para o Google
app.get('/api/nuvem/login', (req, res) => {
  if (!nuvem.temCliente()) {
    return res.redirect('/login.html?nuvem=naoconfigurado');
  }
  const redirectUri = `${nuvem.originDoRequest(req)}/api/nuvem/oauth2/callback`;
  res.redirect(nuvem.urlAutorizacao(redirectUri));
});

// Retorno do Google após autorização
app.get('/api/nuvem/oauth2/callback', async (req, res) => {
  try {
    if (!req.query.code) {
      throw new Error(req.query.error || 'Autorização negada pelo Google');
    }
    const redirectUri = `${nuvem.originDoRequest(req)}/api/nuvem/oauth2/callback`;
    const dados = await nuvem.trocarCodigoPorToken(req.query.code, redirectUri);

    const cfg = nuvem.lerConfig();
    cfg.tokens = {
      access_token: dados.access_token,
      refresh_token: dados.refresh_token,
      expiry_date: Date.now() + (dados.expires_in || 3600) * 1000,
    };
    cfg.conta = (await nuvem.buscarEmailConta(dados.access_token)) || undefined;
    nuvem.salvarConfig(cfg);

    // Envia a primeira cópia imediatamente
    await nuvem.enviarBackupNuvem();
    res.redirect('/login.html?nuvem=ok');
  } catch (error) {
    console.error('[Nuvem] Falha no retorno do Google:', error.message);
    res.redirect('/login.html?nuvem=erro');
  }
});

// Salvar credenciais do app Google (só admin)
app.post('/api/nuvem/config', exigirAdmin, (req, res) => {
  try {
    const clientId = (req.body.client_id || '').trim();
    const clientSecret = (req.body.client_secret || '').trim();
    if (!clientId || !clientSecret) {
      return res.status(400).json({ erro: 'Informe o Client ID e o Client Secret do Google.' });
    }
    nuvem.salvarCredenciais(clientId, clientSecret);
    registrarLog(
      'NUVEM_CONFIG',
      req.usuario.id,
      req.usuario.username,
      'Configurou credenciais do Google Drive',
      obterIp(req)
    );
    res.json({ mensagem: 'Credenciais salvas! Agora clique em Conectar.' });
  } catch (error) {
    res.status(500).json({ erro: 'Erro ao salvar configuração', detalhes: msgErroInterno(error) });
  }
});

// Desconectar a conta Google (só admin)
app.post('/api/nuvem/desconectar', exigirAdmin, (req, res) => {
  try {
    nuvem.desconectar();
    registrarLog(
      'NUVEM_DESCONEXAO',
      req.usuario.id,
      req.usuario.username,
      'Desconectou a conta Google',
      obterIp(req)
    );
    res.json({ mensagem: 'Nuvem desconectada.' });
  } catch (error) {
    res.status(500).json({ erro: 'Erro ao desconectar', detalhes: msgErroInterno(error) });
  }
});

// Enviar backup para a nuvem agora (só admin)
app.post('/api/nuvem/enviar', exigirAdmin, async (req, res) => {
  try {
    const resultado = await nuvem.enviarBackupNuvem();
    if (!resultado.ok) return res.status(400).json({ erro: resultado.erro });
    registrarLog(
      'NUVEM_ENVIO',
      req.usuario.id,
      req.usuario.username,
      'Enviou backup ao Google Drive manualmente',
      obterIp(req)
    );
    res.json({
      mensagem: resultado.atualizado ? 'Backup enviado à nuvem!' : 'Nuvem já está atualizada.',
    });
  } catch (error) {
    res.status(500).json({ erro: 'Falha ao enviar', detalhes: msgErroInterno(error) });
  }
});

// Baixar a versão mais recente da nuvem (só admin)
app.post('/api/nuvem/restaurar', exigirAdmin, async (req, res) => {
  try {
    const resultado = await nuvem.baixarBackupNuvem();
    if (!resultado.ok) return res.status(400).json({ erro: resultado.erro });
    registrarLog(
      'NUVEM_DOWNLOAD',
      req.usuario.id,
      req.usuario.username,
      `Baixou backup da nuvem: ${path.basename(resultado.caminho)}`,
      obterIp(req)
    );
    res.json({
      mensagem: 'Backup baixado da nuvem! Para aplicá-lo, reinicie o servidor.',
      caminho: resultado.caminho,
    });
  } catch (error) {
    res.status(500).json({ erro: 'Falha ao baixar', detalhes: msgErroInterno(error) });
  }
});

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
// O envio compara o hash do banco, então NADA é enviado se não mudou (é barato),
// mas se um envio falhou (internet caiu, etc.) ele se recupera sozinho.
setInterval(
  () => {
    if (nuvem.temCliente() && nuvem.temTokens()) nuvem.sincronizarAgora();
  },
  3 * 60 * 1000
);

// ==========================================
// ATUALIZAÇÃO DO PROGRAMA PELA NUVEM
// (coloque servmil_update.zip + servmil_versao.txt na mesma pasta da nuvem)
// ==========================================
const ARQUIVO_VERSAO = path.join(__dirname, 'versao.txt');
const PASTA_ATUALIZACAO = path.join(__dirname, 'atualizacao_pendente');
const PASTA_BACKUP_CODIGO = path.join(__dirname, 'backups', 'programa');

function versaoAtual() {
  try {
    return fs.readFileSync(ARQUIVO_VERSAO, 'utf8').trim();
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

// Copia arquivos sem apagar o que já existe (merge)
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

const ARQ_PROTEGIDOS = new Set([
  'voltstock.db',
  'voltstock.db-wal',
  'voltstock.db-shm',
  'nuvem_config.json',
]);

app.get('/api/atualizacao/status', exigirAdmin, async (req, res) => {
  try {
    const atual = versaoAtual();
    const conectado = nuvem.temCliente() && nuvem.temTokens();
    let disponivel = null;
    if (conectado) disponivel = await nuvem.lerVersaoDaNuvem();
    res.json({
      versaoAtual: atual,
      versaoDisponivel: disponivel,
      temAtualizacao: !!disponivel && compararVersoes(disponivel, atual) > 0,
      conectado,
    });
  } catch (error) {
    res
      .status(500)
      .json({ erro: 'Falha ao verificar atualização', detalhes: msgErroInterno(error) });
  }
});

app.post('/api/atualizacao/aplicar', exigirAdmin, async (req, res) => {
  try {
    const atual = versaoAtual();
    const baixado = await nuvem.baixarAtualizacaoNuvem();
    if (!baixado.ok)
      return res.status(500).json({ erro: 'Falha ao baixar atualização', detalhes: baixado.erro });
    if (!baixado.disponivel)
      return res.status(404).json({ erro: 'Nenhum pacote de atualização na nuvem.' });
    if (baixado.versao && compararVersoes(baixado.versao, atual) <= 0) {
      return res.json({ mensagem: `Sistema já está na versão ${atual} (atualizada).` });
    }

    fs.rmSync(PASTA_ATUALIZACAO, { recursive: true, force: true });
    fs.mkdirSync(PASTA_ATUALIZACAO, { recursive: true });
    const zipPath = path.join(PASTA_ATUALIZACAO, 'pacote.zip');
    fs.writeFileSync(zipPath, baixado.zip);

    const { execSync } = require('node:child_process');
    const extraido = path.join(PASTA_ATUALIZACAO, 'extraido');
    execSync(
      `powershell -NoProfile -Command "Expand-Archive -Force -LiteralPath '${zipPath}' -DestinationPath '${extraido}'"`,
      { timeout: 120000, stdio: 'ignore' }
    );

    if (!fs.existsSync(path.join(extraido, 'server.js'))) {
      return res.status(400).json({ erro: 'Pacote inválido (server.js não encontrado).' });
    }

    // Backup do código atual (permite reverter manualmente depois)
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const backupDir = path.join(PASTA_BACKUP_CODIGO, stamp);
    fs.mkdirSync(backupDir, { recursive: true });
    for (const nome of [
      'server.js',
      'database.js',
      'nuvem.js',
      'package.json',
      'package-lock.json',
      'versao.txt',
      'public',
    ]) {
      const de = path.join(__dirname, nome);
      if (!fs.existsSync(de)) continue;
      if (nome === 'public') copiarRecursivo(de, path.join(backupDir, nome));
      else
        try {
          fs.copyFileSync(de, path.join(backupDir, nome));
        } catch (e) {}
    }

    // Aplica o novo código (mantém banco, credenciais e pastas de dados)
    for (const it of fs.readdirSync(extraido, { withFileTypes: true })) {
      const nome = it.name;
      if (ARQ_PROTEGIDOS.has(nome)) continue;
      if (nome === 'backups' || nome === 'atualizacao_pendente') continue;
      const de = path.join(extraido, nome);
      const para = path.join(__dirname, nome);
      if (it.isDirectory()) {
        if (nome === 'public')
          copiarRecursivo(de, para); // não apaga uploads
        else copiarRecursivo(de, para);
      } else {
        try {
          fs.copyFileSync(de, para);
        } catch (e) {}
      }
    }
    // versao.txt vem no pacote
    try {
      fs.copyFileSync(path.join(extraido, 'versao.txt'), ARQUIVO_VERSAO);
    } catch (e) {}

    registrarLog(
      'ATUALIZACAO_SISTEMA',
      req.usuario.id,
      req.usuario.username,
      `Aplicou atualização ${atual} -> ${baixado.versao}`,
      obterIp(req)
    );

    // O servidor roda pelo launcher iniciar.bat (loop), que reinicia sozinho
    // com o código novo. Por isso aqui só encerramos o processo atual.
    res.json({
      mensagem: `Atualização para ${baixado.versao} aplicada. O sistema está reiniciando...`,
      reiniciando: true,
    });
    setTimeout(() => process.exit(0), 900);
  } catch (error) {
    res.status(500).json({ erro: 'Falha ao aplicar atualização', detalhes: msgErroInterno(error) });
  }
});

// ==========================================
// CHAT PRIVADO (MENSAGENS 1-A-1 ENTRE USUÁRIOS)
// ==========================================
const PASTA_UPLOADS_CHAT = path.join(__dirname, 'public', 'uploads', 'chat');
const IMAGENS_PERMITIDAS = ['png', 'jpeg', 'jpg', 'webp', 'gif'];
const TAMANHO_MAX_IMAGEM = 4 * 1024 * 1024; // 4 MB por foto
const LIMITE_TOTAL_UPLOADS = 250 * 1024 * 1024; // 250 MB total de fotos (anti-encher disco)

// Salva a imagem (data URL) DENTRO DO BANCO e devolve a URL pública.
// Ficando no banco, a foto entra no backup (local e nuvem) e é recuperada
// automaticamente junto com as mensagens.
function salvarImagemChat(dataUrl) {
  const match = /^data:image\/(png|jpeg|jpg|webp|gif);base64,(.+)$/.exec(String(dataUrl || ''));
  if (!match) throw new Error('Formato de imagem inválido. Use PNG, JPG, WEBP ou GIF.');

  const tipo = match[1].toLowerCase();
  const buf = Buffer.from(match[2], 'base64');
  if (buf.length === 0) throw new Error('Imagem vazia.');
  if (buf.length > TAMANHO_MAX_IMAGEM) throw new Error('Imagem muito grande (máximo de 4 MB).');

  // Limite total (anti-encher o banco): soma das fotos já guardadas
  const total = db.prepare('SELECT COALESCE(SUM(tamanho), 0) AS t FROM chat_anexos').get().t;
  if (total + buf.length > LIMITE_TOTAL_UPLOADS) {
    throw new Error(
      'Limite total de fotos do chat atingido. Remova fotos antigas ou aumente o armazenamento.'
    );
  }

  const mime = `image/${tipo === 'jpg' ? 'jpeg' : tipo}`;
  const id = crypto.randomBytes(24).toString('hex');
  db.prepare(
    'INSERT INTO chat_anexos (id, mime, nome, tamanho, conteudo) VALUES (?, ?, ?, ?, ?)'
  ).run(id, mime, null, buf.length, buf);

  return `/api/chat/midia/${id}`;
}

// Serve a foto do chat guardada no banco (id aleatório inacessível)
app.get('/api/chat/midia/:id', (req, res) => {
  try {
    const anexo = db
      .prepare('SELECT mime, conteudo FROM chat_anexos WHERE id = ?')
      .get(req.params.id);
    if (!anexo) return res.status(404).send('Imagem não encontrada.');
    res.set('Content-Type', anexo.mime || 'image/jpeg');
    res.set('Cache-Control', 'private, max-age=31536000');
    res.send(Buffer.from(anexo.conteudo));
  } catch (error) {
    res.status(500).send('Falha ao carregar imagem.');
  }
});

// Descrição amigável do conteúdo (texto ou foto) para a lista de contatos
function legendaUltimaMensagem(mc) {
  if (!mc) return null;
  if (mc.imagem) return mc.mensagem ? `📷 Foto · ${mc.mensagem}` : '📷 Foto';
  return mc.mensagem;
}

// Lista de contatos (usuários ativos) com última mensagem e não-lidas
app.get('/api/chat/contatos', (req, res) => {
  try {
    const eu = req.usuario.id;
    const contatos = db
      .prepare(
        `
      SELECT
        u.id, u.username, u.nome_completo, u.cargo, u.role, u.ativo,
        (SELECT COUNT(*) FROM mensagens_chat mc
          WHERE mc.destinatario_id = ? AND mc.remetente_id = u.id AND mc.lida = 0) AS nao_lidas,
        (SELECT CASE WHEN mc.imagem IS NOT NULL THEN
            CASE WHEN mc.mensagem != '' THEN '📷 Foto · ' || mc.mensagem ELSE '📷 Foto' END
          ELSE mc.mensagem END
          FROM mensagens_chat mc
          WHERE (mc.remetente_id = ? AND mc.destinatario_id = u.id)
             OR (mc.remetente_id = u.id AND mc.destinatario_id = ?)
          ORDER BY mc.id DESC LIMIT 1) AS ultima_mensagem,
        (SELECT mc.criado_em FROM mensagens_chat mc
          WHERE (mc.remetente_id = ? AND mc.destinatario_id = u.id)
             OR (mc.remetente_id = u.id AND mc.destinatario_id = ?)
          ORDER BY mc.id DESC LIMIT 1) AS criado_em_ultima
      FROM usuarios u
      WHERE u.id != ? AND u.ativo = 1 AND u.id IN (SELECT id FROM usuarios WHERE ativo = 1)
      ORDER BY u.nome_completo COLLATE NOCASE ASC
    `
      )
      .all(eu, eu, eu, eu, eu, eu);
    res.json(contatos);
  } catch (error) {
    res.status(500).json({ erro: 'Falha ao carregar contatos', detalhes: msgErroInterno(error) });
  }
});

// Histórico da conversa com um usuário específico
app.get('/api/chat/:id', (req, res) => {
  try {
    const eu = req.usuario.id;
    const outroId = Number(req.params.id);
    if (outroId === eu)
      return res.status(400).json({ erro: 'Você não pode conversar consigo mesmo.' });

    const outro = db
      .prepare('SELECT id, nome_completo, username, ativo FROM usuarios WHERE id = ?')
      .get(outroId);
    if (!outro) return res.status(404).json({ erro: 'Usuário não localizado.' });

    const mensagens = db
      .prepare(
        `
      SELECT m.id, m.mensagem, m.imagem, m.lida, m.criado_em, m.remetente_id,
             u.nome_completo AS remetente_nome
      FROM mensagens_chat m
      JOIN usuarios u ON u.id = m.remetente_id
      WHERE (m.remetente_id = ? AND m.destinatario_id = ?)
         OR (m.remetente_id = ? AND m.destinatario_id = ?)
      ORDER BY m.id ASC
    `
      )
      .all(eu, outroId, outroId, eu);

    res.json({ outro, mensagens });
  } catch (error) {
    res.status(500).json({ erro: 'Falha ao carregar conversa', detalhes: msgErroInterno(error) });
  }
});

// Enviar mensagem (texto e/ou foto) para um usuário
// (parser próprio: aceita 12 MB de foto somente depois da autenticação)
app.post('/api/chat/:id', express.json({ limit: '12mb' }), (req, res) => {
  try {
    const eu = req.usuario.id;
    const outroId = Number(req.params.id);
    const { mensagem, imagem_base64 } = req.body;

    const texto = (mensagem || '').trim();
    if (!texto && !imagem_base64) {
      return res.status(400).json({ erro: 'Digite a mensagem ou envie uma imagem.' });
    }
    if (texto.length > 1000) {
      return res.status(400).json({ erro: 'Mensagem muito longa (máximo de 1000 caracteres).' });
    }
    if (outroId === eu)
      return res.status(400).json({ erro: 'Você não pode conversar consigo mesmo.' });

    const outro = db.prepare('SELECT id FROM usuarios WHERE id = ? AND ativo = 1').get(outroId);
    if (!outro) return res.status(404).json({ erro: 'Destinatário não localizado ou desativado.' });

    // Salva a foto (se enviada) e guarda o caminho público
    let caminhoImagem = null;
    if (imagem_base64) {
      try {
        caminhoImagem = salvarImagemChat(imagem_base64);
      } catch (e) {
        return res.status(400).json({ erro: e.message });
      }
    }

    const result = db
      .prepare(
        `
      INSERT INTO mensagens_chat (remetente_id, destinatario_id, mensagem, imagem)
      VALUES (?, ?, ?, ?)
    `
      )
      .run(eu, outroId, texto, caminhoImagem);

    const nova = db
      .prepare(
        `
      SELECT m.id, m.mensagem, m.imagem, m.lida, m.criado_em, m.remetente_id, u.nome_completo AS remetente_nome
      FROM mensagens_chat m JOIN usuarios u ON u.id = m.remetente_id
      WHERE m.id = ?
    `
      )
      .get(result.lastInsertRowid);

    registrarLog(
      'CHAT_MENSAGEM',
      eu,
      req.usuario.username,
      `Enviou ${caminhoImagem ? 'foto 📷' : 'mensagem'} para ${outroId}`,
      obterIp(req)
    );

    // Foto nova (agora guardada no banco): sobe o backup logo para a nuvem.
    if (caminhoImagem) nuvem.agendarSincronizacaoNuvem();

    res.status(201).json(nova);
  } catch (error) {
    res.status(500).json({ erro: 'Falha ao enviar mensagem', detalhes: msgErroInterno(error) });
  }
});

// Marcar como lidas as mensagens recebidas de um contato
app.post('/api/chat/:id/lidas', (req, res) => {
  try {
    const eu = req.usuario.id;
    const outroId = Number(req.params.id);
    db.prepare(
      `
      UPDATE mensagens_chat SET lida = 1
      WHERE destinatario_id = ? AND remetente_id = ? AND lida = 0
    `
    ).run(eu, outroId);
    res.json({ mensagem: 'Mensagens marcadas como lidas.' });
  } catch (error) {
    res.status(500).json({ erro: 'Falha ao marcar lidas', detalhes: msgErroInterno(error) });
  }
});

// Total de mensagens não lidas (badge na aba CHAT)
app.get('/api/chat/naolidas/total', (req, res) => {
  try {
    const total = db
      .prepare(
        `
      SELECT COUNT(*) AS total FROM mensagens_chat WHERE destinatario_id = ? AND lida = 0
    `
      )
      .get(req.usuario.id);
    res.json({ total: total.total });
  } catch (error) {
    res.status(500).json({ erro: 'Falha ao consultar não lidas', detalhes: msgErroInterno(error) });
  }
});

// ==========================================
// VERSÃO DO SISTEMA (ATUALIZAÇÃO INSTANTÂNEA P/ TODOS)
// ==========================================
// Se o admin alterar qualquer arquivo (dados ou código) no computador,
// esta "versão" muda e o app recarrega automaticamente em todos.
app.get('/api/versao', (req, res) => {
  try {
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
        const s = fs.statSync(path.join(__dirname, 'public', f));
        if (s.mtimeMs > max) max = s.mtimeMs;
      } catch (e) {}
    }
    for (const f of ['server.js', 'database.js']) {
      try {
        const s = fs.statSync(path.join(__dirname, f));
        if (s.mtimeMs > max) max = s.mtimeMs;
      } catch (e) {}
    }
    res.json({ versao: String(Math.round(max)), atualizado_em: new Date(max).toISOString() });
  } catch (error) {
    res.status(500).json({ erro: 'Falha ao consultar versão', detalhes: msgErroInterno(error) });
  }
});

// ==========================================
// SININHO DE NOTIFICAÇÕES (ALTERAÇÕES GERAIS)
// ==========================================
// Os eventos do sistema já são gravados em logs_seguranca pela auditoria.
// O sininho mostra essas alterações (exceto ruído de login/logout) e
// controla o "lido/não lido" por usuário.

app.get('/api/notificacoes', (req, res) => {
  try {
    const eu = req.usuario.id;
    const visita = db.prepare('SELECT * FROM notificacoes_visitas WHERE usuario_id = ?').get(eu);
    const ultimoLidoId = visita ? visita.ultimo_log_id : 0;

    const excluidos = [
      'LOGIN_SUCESSO',
      'LOGIN_FALHA',
      'LOGOUT',
      'ACESSO_NEGADO',
      'LOGIN_BLOQUEADO',
      'LOGIN_DESATIVADO',
    ];

    const ultimas = db
      .prepare(
        `
      SELECT id, evento, username_tentativa, detalhes, ip, data_hora AS criado_em
      FROM logs_seguranca
      WHERE evento NOT IN (${excluidos.map(() => '?').join(', ')})
      ORDER BY id DESC LIMIT 50
    `
      )
      .all(...excluidos);

    const naoLidas = db
      .prepare(
        `
      SELECT COUNT(*) AS total FROM logs_seguranca
      WHERE evento NOT IN (${excluidos.map(() => '?').join(', ')}) AND id > ?
    `
      )
      .all(...excluidos, ultimoLidoId)[0].total;

    res.json({ ultimoLidoId, naoLidas, notificacoes: ultimas });
  } catch (error) {
    res
      .status(500)
      .json({ erro: 'Falha ao carregar notificações', detalhes: msgErroInterno(error) });
  }
});

// Marca como lidas as notificações até o ID informado
app.post('/api/notificacoes/lidas', (req, res) => {
  try {
    const eu = req.usuario.id;
    const { ultimoId } = req.body;
    const id = Number(ultimoId) || 0;
    db.prepare(
      `
      INSERT INTO notificacoes_visitas (usuario_id, ultimo_log_id, atualizado_em)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(usuario_id) DO UPDATE SET
        ultimo_log_id = excluded.ultimo_log_id,
        atualizado_em = CURRENT_TIMESTAMP
    `
    ).run(eu, id);
    res.json({ mensagem: 'Notificações marcadas como lidas.' });
  } catch (error) {
    res.status(500).json({ erro: 'Falha ao marcar notificações', detalhes: msgErroInterno(error) });
  }
});

// ==========================================
// MURAL DE OBSERVAÇÕES (TODOS OS SETORES)
// ==========================================

// Listar observações compartilhadas
app.get('/api/observacoes', (req, res) => {
  try {
    const obs = db
      .prepare('SELECT * FROM observacoes_setores ORDER BY criado_em DESC, id DESC')
      .all();
    res.json(obs);
  } catch (error) {
    res
      .status(500)
      .json({ erro: 'Falha ao carregar observações', detalhes: msgErroInterno(error) });
  }
});

// Publicar nova observação (qualquer funcionário logado)
app.post('/api/observacoes', (req, res) => {
  try {
    const { observacao, setor, nome } = req.body;
    if (!observacao || !observacao.trim()) {
      return res.status(400).json({ erro: 'Escreva a observação antes de publicar.' });
    }

    const result = db
      .prepare(
        `
      INSERT INTO observacoes_setores (autor, setor, observacao)
      VALUES (?, ?, ?)
    `
      )
      .run(
        nome || req.usuario.nome_completo || req.usuario.username,
        setor || 'Almoxarifado ServMil',
        observacao.trim()
      );

    const nova = db
      .prepare('SELECT * FROM observacoes_setores WHERE id = ?')
      .get(result.lastInsertRowid);
    registrarLog(
      'OBSERVACAO_PUBLICADA',
      req.usuario.id,
      req.usuario.username,
      `Publicou observação no mural (setor ${nova.setor})`,
      obterIp(req)
    );
    res.status(201).json(nova);
  } catch (error) {
    res.status(500).json({ erro: 'Erro ao publicar observação', detalhes: msgErroInterno(error) });
  }
});

// Apagar observação (qualquer funcionário logado)
app.delete('/api/observacoes/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    const obs = db.prepare('SELECT * FROM observacoes_setores WHERE id = ?').get(id);
    const result = db.prepare('DELETE FROM observacoes_setores WHERE id = ?').run(id);
    if (result.changes === 0) return res.status(404).json({ erro: 'Observação não localizada' });
    registrarLog(
      'OBSERVACAO_APAGADA',
      req.usuario.id,
      req.usuario.username,
      `Apagou observação "${obs?.observacao?.slice(0, 50) || id}"${obs ? ` (de ${obs.autor})` : ''}`,
      obterIp(req)
    );
    res.json({ mensagem: 'Observação apagada.' });
  } catch (error) {
    res.status(500).json({ erro: 'Erro ao apagar observação', detalhes: msgErroInterno(error) });
  }
});

// Alterar status da observação (qualquer funcionário logado)
app.patch('/api/observacoes/:id/status', (req, res) => {
  try {
    const id = Number(req.params.id);
    const { status } = req.body;
    const statusValidos = ['EM_ABERTO', 'AGUARDANDO', 'RESOLVIDO'];
    if (!statusValidos.includes(status)) {
      return res
        .status(400)
        .json({ erro: 'Status inválido. Use EM_ABERTO, AGUARDANDO ou RESOLVIDO.' });
    }

    const obs = db.prepare('SELECT * FROM observacoes_setores WHERE id = ?').get(id);
    if (!obs) return res.status(404).json({ erro: 'Observação não localizada' });

    db.prepare('UPDATE observacoes_setores SET status = ? WHERE id = ?').run(status, id);
    registrarLog(
      'OBSERVACAO_STATUS',
      req.usuario.id,
      req.usuario.username,
      `Alterou status "${obs.autor}" (${obs.setor}): ${obs.status} → ${status}`,
      obterIp(req)
    );

    res.json({ ...obs, status });
  } catch (error) {
    res.status(500).json({ erro: 'Erro ao alterar status', detalhes: msgErroInterno(error) });
  }
});

// ==========================================
// ROTAS DE ESTOQUE (ALMOXARIFADO)
// ==========================================

// Listar todos os itens com status
app.get('/api/estoque', (req, res) => {
  try {
    const { busca, categoria, apenas_criticos } = req.query;
    let query = 'SELECT * FROM estoque_itens WHERE 1=1';
    const params = [];

    if (busca) {
      query += ' AND (nome LIKE ? OR codigo_id LIKE ? OR localizacao LIKE ?)';
      params.push(`%${busca}%`, `%${busca}%`, `%${busca}%`);
    }

    if (categoria && categoria !== 'TODAS') {
      query += ' AND categoria = ?';
      params.push(categoria);
    }

    query += ' ORDER BY (quantidade_atual <= quantidade_minima) DESC, nome ASC';

    const stmt = db.prepare(query);
    const itens = stmt.all(...params).map(enriquecerItemEstoque);

    if (apenas_criticos === 'true') {
      return res.json(itens.filter(i => i.status_alerta === 'CRITICO'));
    }

    res.json(itens);
  } catch (error) {
    res.status(500).json({ erro: 'Falha ao consultar estoque', detalhes: msgErroInterno(error) });
  }
});

// Cadastrar novo item de estoque
app.post('/api/estoque', (req, res) => {
  try {
    const {
      codigo_id,
      codigo_sku,
      nome,
      categoria,
      quantidade_atual,
      quantidade_minima,
      unidade_medida,
      localizacao,
      preco_estimado,
    } = req.body;
    const codFinal = (codigo_id || codigo_sku || '').toUpperCase().trim();

    if (!codFinal || !nome || !categoria) {
      return res.status(400).json({ erro: 'Campos obrigatórios: codigo_id, nome, categoria' });
    }

    const stmt = db.prepare(`
      INSERT INTO estoque_itens 
      (codigo_id, nome, categoria, quantidade_atual, quantidade_minima, unidade_medida, localizacao, preco_estimado)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      codFinal,
      nome.trim(),
      categoria.trim(),
      Number(quantidade_atual) || 0,
      Number(quantidade_minima) || 20,
      (unidade_medida || 'UN').toUpperCase().trim(),
      localizacao || 'Almoxarifado ServMil',
      Number(preco_estimado) || 0.0
    );

    const novoItem = db
      .prepare('SELECT * FROM estoque_itens WHERE id = ?')
      .get(result.lastInsertRowid);
    registrarLog(
      'ESTOQUE_CADASTRO',
      req.usuario.id,
      req.usuario.username,
      `Cadastrou item "${novoItem.nome}" (${codFinal}) qtd ${novoItem.quantidade_atual} ${novoItem.unidade_medida}`,
      obterIp(req)
    );
    res.status(201).json(enriquecerItemEstoque(novoItem));
  } catch (error) {
    if (error.message.includes('UNIQUE constraint failed')) {
      return res.status(409).json({ erro: 'ID / Código já cadastrado no sistema' });
    }
    res.status(500).json({ erro: 'Erro ao cadastrar item', detalhes: msgErroInterno(error) });
  }
});

// Movimentação rápida de estoque (+ ou - unidades)
app.patch('/api/estoque/:id/movimento', (req, res) => {
  try {
    const id = Number(req.params.id);
    const { delta, motivo } = req.body; // delta pode ser +5, -1, etc.

    if (isNaN(delta)) {
      return res.status(400).json({ erro: 'Valor de alteração (delta) inválido' });
    }

    const item = db.prepare('SELECT * FROM estoque_itens WHERE id = ?').get(id);
    if (!item) {
      return res.status(404).json({ erro: 'Item não encontrado' });
    }

    const novaQuantidade = Math.max(0, item.quantidade_atual + Number(delta));

    db.prepare(
      `
      UPDATE estoque_itens 
      SET quantidade_atual = ?, atualizado_em = CURRENT_TIMESTAMP 
      WHERE id = ?
    `
    ).run(novaQuantidade, id);

    const itemAtualizado = db.prepare('SELECT * FROM estoque_itens WHERE id = ?').get(id);
    const itemEnriquecido = enriquecerItemEstoque(itemAtualizado);

    // Se caiu no estoque crítico (<= quantidade_minima), registra no histórico
    if (
      itemEnriquecido.status_alerta === 'CRITICO' &&
      item.quantidade_atual > item.quantidade_minima
    ) {
      db.prepare(
        `
        INSERT INTO historico_alertas (tipo, origem_id, titulo, mensagem)
        VALUES (?, ?, ?, ?)
      `
      ).run(
        'ESTOQUE_BAIXO',
        id,
        `Estoque Crítico: ${item.nome}`,
        `Item atingiu saldo de ${novaQuantidade} ${item.unidade_medida} (Limite crítico: ${item.quantidade_minima}). Disparo recomendado para Compras.`
      );
    }

    registrarLog(
      'ESTOQUE_MOVIMENTO',
      req.usuario.id,
      req.usuario.username,
      `"${item.nome}" (${item.codigo_id}): ${item.quantidade_atual} → ${novaQuantidade} ${item.unidade_medida} (delta ${Number(delta)})`,
      obterIp(req)
    );

    res.json(itemEnriquecido);
  } catch (error) {
    res
      .status(500)
      .json({ erro: 'Falha na movimentação de estoque', detalhes: msgErroInterno(error) });
  }
});

// Atualização cadastral do item (parcial: só os campos enviados)
app.put('/api/estoque/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    const {
      codigo_id,
      nome,
      categoria,
      quantidade_atual,
      quantidade_minima,
      unidade_medida,
      localizacao,
      preco_estimado,
    } = req.body;

    const atual = db.prepare('SELECT * FROM estoque_itens WHERE id = ?').get(id);
    if (!atual) {
      return res.status(404).json({ erro: 'Item não localizado' });
    }

    const novoCodigo = (codigo_id ?? atual.codigo_id).toString().trim().toUpperCase();

    db.prepare(
      `
      UPDATE estoque_itens
      SET codigo_id = ?, nome = ?, categoria = ?, quantidade_atual = ?, quantidade_minima = ?, unidade_medida = ?, localizacao = ?, preco_estimado = ?, atualizado_em = CURRENT_TIMESTAMP
      WHERE id = ?
    `
    ).run(
      novoCodigo,
      (nome ?? atual.nome).toString().trim(),
      (categoria ?? atual.categoria).toString().trim(),
      Number(quantidade_atual ?? atual.quantidade_atual),
      Number(quantidade_minima ?? atual.quantidade_minima),
      (unidade_medida ?? atual.unidade_medida).toString().toUpperCase().trim(),
      (localizacao ?? atual.localizacao).toString().trim(),
      Number(preco_estimado ?? atual.preco_estimado),
      id
    );

    const atualizado = db.prepare('SELECT * FROM estoque_itens WHERE id = ?').get(id);
    registrarLog(
      'ESTOQUE_EDICAO',
      req.usuario.id,
      req.usuario.username,
      `Editou identificação do item "${atualizado.nome}" (${atualizado.codigo_id})`,
      obterIp(req)
    );
    res.json(enriquecerItemEstoque(atualizado));
  } catch (error) {
    if (error.message.includes('UNIQUE constraint failed')) {
      return res.status(409).json({ erro: 'Este ID já está em uso por outro item' });
    }
    res.status(500).json({ erro: 'Erro ao atualizar item', detalhes: msgErroInterno(error) });
  }
});

// Remover item
app.delete('/api/estoque/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    const item = db.prepare('SELECT * FROM estoque_itens WHERE id = ?').get(id);
    const result = db.prepare('DELETE FROM estoque_itens WHERE id = ?').run(id);
    if (result.changes === 0) return res.status(404).json({ erro: 'Item não localizado' });
    registrarLog(
      'ESTOQUE_EXCLUSAO',
      req.usuario.id,
      req.usuario.username,
      `Excluiu item "${item?.nome || id}" (${item?.codigo_id || ''})`,
      obterIp(req)
    );
    res.json({ mensagem: 'Item removido com sucesso' });
  } catch (error) {
    res.status(500).json({ erro: 'Erro ao excluir item', detalhes: msgErroInterno(error) });
  }
});

// ==========================================
// ROTAS DE CATEGORIAS (ALMOXARIFADO)
// ==========================================

// Listar categorias cadastradas
app.get('/api/categorias', (req, res) => {
  try {
    const cats = db.prepare('SELECT * FROM categorias ORDER BY nome COLLATE NOCASE').all();
    res.json(cats);
  } catch (error) {
    res
      .status(500)
      .json({ erro: 'Falha ao consultar categorias', detalhes: msgErroInterno(error) });
  }
});

// Cadastrar nova categoria
app.post('/api/categorias', (req, res) => {
  try {
    const nome = (req.body.nome || '').trim();
    if (!nome) return res.status(400).json({ erro: 'Informe o nome da categoria' });

    const result = db.prepare('INSERT INTO categorias (nome) VALUES (?)').run(nome);
    const nova = db.prepare('SELECT * FROM categorias WHERE id = ?').get(result.lastInsertRowid);
    registrarLog(
      'CATEGORIA_CADASTRO',
      req.usuario.id,
      req.usuario.username,
      `Cadastrou categoria "${nome}"`,
      obterIp(req)
    );
    res.status(201).json(nova);
  } catch (error) {
    if (error.message.includes('UNIQUE constraint failed')) {
      return res.status(409).json({ erro: 'Já existe uma categoria com esse nome' });
    }
    res.status(500).json({ erro: 'Erro ao cadastrar categoria', detalhes: msgErroInterno(error) });
  }
});

// Renomear categoria
app.put('/api/categorias/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    const nome = (req.body.nome || '').trim();
    if (!nome) return res.status(400).json({ erro: 'Informe o nome da categoria' });

    const result = db.prepare('UPDATE categorias SET nome = ? WHERE id = ?').run(nome, id);
    if (result.changes === 0) return res.status(404).json({ erro: 'Categoria não localizada' });

    const atualizada = db.prepare('SELECT * FROM categorias WHERE id = ?').get(id);
    registrarLog(
      'CATEGORIA_EDICAO',
      req.usuario.id,
      req.usuario.username,
      `Renomeou categoria "${atualizada?.nome || nome}"`,
      obterIp(req)
    );
    res.json(atualizada);
  } catch (error) {
    if (error.message.includes('UNIQUE constraint failed')) {
      return res.status(409).json({ erro: 'Já existe uma categoria com esse nome' });
    }
    res.status(500).json({ erro: 'Erro ao renomear categoria', detalhes: msgErroInterno(error) });
  }
});

// Excluir categoria
app.delete('/api/categorias/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    const cat = db.prepare('SELECT * FROM categorias WHERE id = ?').get(id);
    const result = db.prepare('DELETE FROM categorias WHERE id = ?').run(id);
    if (result.changes === 0) return res.status(404).json({ erro: 'Categoria não localizada' });
    registrarLog(
      'CATEGORIA_EXCLUSAO',
      req.usuario.id,
      req.usuario.username,
      `Excluiu categoria "${cat?.nome || id}"`,
      obterIp(req)
    );
    res.json({ mensagem: 'Categoria removida' });
  } catch (error) {
    res.status(500).json({ erro: 'Erro ao excluir categoria', detalhes: msgErroInterno(error) });
  }
});

// ==========================================
// ROTAS DE EQUIPAMENTOS & CALIBRAÇÃO
// ==========================================

// Listar todos os equipamentos com dias restantes calculados
app.get('/api/equipamentos', (req, res) => {
  try {
    const { status_filtro } = req.query;
    const stmt = db.prepare(
      'SELECT * FROM equipamentos_calibracao ORDER BY data_validade_calibracao ASC'
    );
    let lista = stmt.all().map(enriquecerEquipamento);

    if (status_filtro && status_filtro !== 'TODOS') {
      lista = lista.filter(e => e.status_calibracao === status_filtro);
    }

    res.json(lista);
  } catch (error) {
    res.status(500).json({ erro: 'Falha ao buscar equipamentos', detalhes: msgErroInterno(error) });
  }
});

// Cadastrar novo equipamento
app.post('/api/equipamentos', (req, res) => {
  try {
    const {
      tag_patrimonio,
      nome,
      fabricante,
      modelo,
      numero_serie,
      data_ultima_calibracao,
      data_validade_calibracao,
      laboratorio,
      certificado_num,
      responsavel,
    } = req.body;

    if (!tag_patrimonio || !nome || !data_validade_calibracao) {
      return res
        .status(400)
        .json({ erro: 'Campos obrigatórios: tag_patrimonio, nome, data_validade_calibracao' });
    }

    const stmt = db.prepare(`
      INSERT INTO equipamentos_calibracao
      (tag_patrimonio, nome, fabricante, modelo, numero_serie, data_ultima_calibracao, data_validade_calibracao, laboratorio, certificado_num, responsavel)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      tag_patrimonio.toUpperCase().trim(),
      nome.trim(),
      fabricante || 'N/A',
      modelo || 'N/A',
      numero_serie || 'S/N',
      data_ultima_calibracao || new Date().toISOString().split('T')[0],
      data_validade_calibracao,
      laboratorio || '',
      certificado_num || '',
      responsavel || 'Almoxarifado'
    );

    const novo = db
      .prepare('SELECT * FROM equipamentos_calibracao WHERE id = ?')
      .get(result.lastInsertRowid);
    registrarLog(
      'EQUIP_CADASTRO',
      req.usuario.id,
      req.usuario.username,
      `Cadastrou equipamento "${novo.nome}" (${novo.tag_patrimonio})`,
      obterIp(req)
    );
    res.status(201).json(enriquecerEquipamento(novo));
  } catch (error) {
    if (error.message.includes('UNIQUE constraint failed')) {
      return res.status(409).json({ erro: 'TAG de patrimônio já cadastrada' });
    }
    res
      .status(500)
      .json({ erro: 'Erro ao cadastrar equipamento', detalhes: msgErroInterno(error) });
  }
});

// Atualizar equipamento / renovar calibração
app.put('/api/equipamentos/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    const {
      nome,
      fabricante,
      modelo,
      numero_serie,
      data_ultima_calibracao,
      data_validade_calibracao,
      laboratorio,
      certificado_num,
      responsavel,
    } = req.body;

    const result = db
      .prepare(
        `
      UPDATE equipamentos_calibracao
      SET nome = ?, fabricante = ?, modelo = ?, numero_serie = ?, data_ultima_calibracao = ?, data_validade_calibracao = ?, laboratorio = ?, certificado_num = ?, responsavel = ?
      WHERE id = ?
    `
      )
      .run(
        nome,
        fabricante,
        modelo,
        numero_serie,
        data_ultima_calibracao,
        data_validade_calibracao,
        laboratorio,
        certificado_num,
        responsavel,
        id
      );

    if (result.changes === 0) return res.status(404).json({ erro: 'Equipamento não localizado' });

    const atualizado = db.prepare('SELECT * FROM equipamentos_calibracao WHERE id = ?').get(id);
    registrarLog(
      'EQUIP_EDICAO',
      req.usuario.id,
      req.usuario.username,
      `Editou equipamento "${atualizado.nome}" (${atualizado.tag_patrimonio})`,
      obterIp(req)
    );
    res.json(enriquecerEquipamento(atualizado));
  } catch (error) {
    res
      .status(500)
      .json({ erro: 'Erro ao atualizar equipamento', detalhes: msgErroInterno(error) });
  }
});

// Deletar equipamento
app.delete('/api/equipamentos/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    const equip = db.prepare('SELECT * FROM equipamentos_calibracao WHERE id = ?').get(id);
    const result = db.prepare('DELETE FROM equipamentos_calibracao WHERE id = ?').run(id);
    if (result.changes === 0) return res.status(404).json({ erro: 'Equipamento não localizado' });
    registrarLog(
      'EQUIP_EXCLUSAO',
      req.usuario.id,
      req.usuario.username,
      `Excluiu equipamento "${equip?.nome || id}" (${equip?.tag_patrimonio || ''})`,
      obterIp(req)
    );
    res.json({ mensagem: 'Equipamento removido' });
  } catch (error) {
    res.status(500).json({ erro: 'Erro ao excluir equipamento', detalhes: msgErroInterno(error) });
  }
});

// ==========================================
// ROTAS DE COMPRAS & SOLICITAÇÕES
// ==========================================

// Listar solicitações
app.get('/api/compras', (req, res) => {
  try {
    const solicitacoes = db
      .prepare('SELECT * FROM solicitacoes_compras ORDER BY data_solicitacao DESC')
      .all();
    res.json(solicitacoes);
  } catch (error) {
    res.status(500).json({ erro: 'Erro ao buscar solicitações', detalhes: msgErroInterno(error) });
  }
});

// Criar solicitação de compras com disparo de alerta
app.post('/api/compras', (req, res) => {
  try {
    const { item_id, quantidade_solicitada, urgencia, observacao, solicitante, setor } = req.body;

    const item = db.prepare('SELECT * FROM estoque_itens WHERE id = ?').get(Number(item_id));
    if (!item) {
      return res.status(404).json({ erro: 'Item de estoque não encontrado' });
    }

    const stmt = db.prepare(`
      INSERT INTO solicitacoes_compras 
      (item_id, item_nome, quantidade_atual, quantidade_solicitada, urgencia, solicitante, setor, observacao)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      item.id,
      item.nome,
      item.quantidade_atual,
      Number(quantidade_solicitada) || 100,
      urgencia || 'ALTA',
      solicitante || 'Almoxarifado ServMil',
      setor || 'Almoxarifado ServMil',
      observacao ||
        `Disparo automático de reposição. Saldo atual: ${item.quantidade_atual} ${item.unidade_medida}`
    );

    const novaSolicitacao = db
      .prepare('SELECT * FROM solicitacoes_compras WHERE id = ?')
      .get(result.lastInsertRowid);

    // Registra no histórico de alertas
    db.prepare(
      `
      INSERT INTO historico_alertas (tipo, origem_id, titulo, mensagem)
      VALUES (?, ?, ?, ?)
    `
    ).run(
      'SOLICITACAO_COMPRA',
      novaSolicitacao.id,
      `Nova Solicitação de Compra: ${item.nome}`,
      `Solicitado lote de ${quantidade_solicitada} ${item.unidade_medida}. Urgência: ${urgencia || 'ALTA'}. Saldo atual: ${item.quantidade_atual}.`
    );

    registrarLog(
      'COMPRA_CRIACAO',
      req.usuario.id,
      req.usuario.username,
      `Solicitou compra de "${item.nome}" x${quantidade_solicitada} (${urgencia || 'ALTA'})`,
      obterIp(req)
    );

    res.status(201).json(novaSolicitacao);
  } catch (error) {
    res
      .status(500)
      .json({ erro: 'Falha ao emitir solicitação de compra', detalhes: msgErroInterno(error) });
  }
});

// Alterar status da solicitação
app.patch('/api/compras/:id/status', (req, res) => {
  try {
    const id = Number(req.params.id);
    const { status } = req.body; // PENDENTE, EM_COTACAO, ATENDIDO, CANCELADO

    db.prepare('UPDATE solicitacoes_compras SET status = ? WHERE id = ?').run(status, id);
    const atualizado = db.prepare('SELECT * FROM solicitacoes_compras WHERE id = ?').get(id);
    registrarLog(
      'COMPRA_STATUS',
      req.usuario.id,
      req.usuario.username,
      `Alterou status da solicitação #REQ-${String(id).padStart(4, '0')} (${atualizado?.item_nome}) para ${status}`,
      obterIp(req)
    );
    res.json(atualizado);
  } catch (error) {
    res.status(500).json({ erro: 'Erro ao atualizar status', detalhes: msgErroInterno(error) });
  }
});

// Atualizar feedback do setor de compras e motivo da espera
app.patch('/api/compras/:id/feedback', (req, res) => {
  try {
    const id = Number(req.params.id);
    const { feedback_compras, status } = req.body;

    if (status) {
      db.prepare(
        'UPDATE solicitacoes_compras SET feedback_compras = ?, status = ? WHERE id = ?'
      ).run(feedback_compras, status, id);
    } else {
      db.prepare('UPDATE solicitacoes_compras SET feedback_compras = ? WHERE id = ?').run(
        feedback_compras,
        id
      );
    }

    const atualizado = db.prepare('SELECT * FROM solicitacoes_compras WHERE id = ?').get(id);
    registrarLog(
      'COMPRA_FEEDBACK',
      req.usuario.id,
      req.usuario.username,
      `Atualizou feedback da solicitação #REQ-${String(id).padStart(4, '0')}${status ? ` (status ${status})` : ''}`,
      obterIp(req)
    );
    res.json(atualizado);
  } catch (error) {
    res
      .status(500)
      .json({ erro: 'Erro ao atualizar feedback de compras', detalhes: msgErroInterno(error) });
  }
});

// ==========================================
// DESTINATÁRIOS DE ALERTA (6 RESPONSÁVEIS)
// ==========================================

// Listar os destinatários
app.get('/api/destinatarios', (req, res) => {
  try {
    const destinatarios = db
      .prepare('SELECT * FROM destinatarios_notificacao ORDER BY id ASC')
      .all();
    res.json(destinatarios);
  } catch (error) {
    res
      .status(500)
      .json({ erro: 'Falha ao buscar destinatários', detalhes: msgErroInterno(error) });
  }
});

// Atualizar dados de um destinatário (ex: telefone WhatsApp real ou e-mail)
app.put('/api/destinatarios/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    const { nome, cargo, telefone_whatsapp, email, ativo } = req.body;

    db.prepare(
      `
      UPDATE destinatarios_notificacao
      SET nome = ?, cargo = ?, telefone_whatsapp = ?, email = ?, ativo = ?
      WHERE id = ?
    `
    ).run(nome, cargo, telefone_whatsapp.replace(/\D/g, ''), email, ativo ? 1 : 0, id);

    const atualizado = db.prepare('SELECT * FROM destinatarios_notificacao WHERE id = ?').get(id);
    registrarLog(
      'DESTINATARIO_EDICAO',
      req.usuario.id,
      req.usuario.username,
      `Atualizou contato "${atualizado?.nome || id}" (cargo ${atualizado?.cargo || ''})`,
      obterIp(req)
    );
    res.json(atualizado);
  } catch (error) {
    res
      .status(500)
      .json({ erro: 'Falha ao atualizar destinatário', detalhes: msgErroInterno(error) });
  }
});

// ==========================================
// CENTRAL DE INTELIGÊNCIA & DISPARO DE ALERTAS
// ==========================================

// Resumo geral do dashboard (KPIs em tempo real)
app.get('/api/alertas/resumo', (req, res) => {
  try {
    const todosItens = db.prepare('SELECT * FROM estoque_itens').all().map(enriquecerItemEstoque);
    const todosEquips = db
      .prepare('SELECT * FROM equipamentos_calibracao')
      .all()
      .map(enriquecerEquipamento);

    const itensCriticos = todosItens.filter(i => i.status_alerta === 'CRITICO');
    const equipsAlerta15 = todosEquips.filter(e => e.status_calibracao === 'ALERTA_15_DIAS');
    const equipsVencidos = todosEquips.filter(e => e.status_calibracao === 'VENCIDO');
    const comprasPendentes = db
      .prepare("SELECT COUNT(*) as total FROM solicitacoes_compras WHERE status = 'PENDENTE'")
      .get().total;

    res.json({
      total_itens_estoque: todosItens.length,
      itens_estoque_critico: itensCriticos.length,
      total_equipamentos: todosEquips.length,
      equipamentos_alerta_15_dias: equipsAlerta15.length,
      equipamentos_vencidos: equipsVencidos.length,
      solicitacoes_compras_pendentes: comprasPendentes,
      itens_criticos_lista: itensCriticos.slice(0, 5),
      equipamentos_criticos_lista: [...equipsVencidos, ...equipsAlerta15].slice(0, 5),
    });
  } catch (error) {
    res
      .status(500)
      .json({ erro: 'Erro ao gerar resumo de alertas', detalhes: msgErroInterno(error) });
  }
});

// Endpoint de disparo de notificação para os 4 destinatários
app.post('/api/alertas/disparar-multiplo', (req, res) => {
  try {
    const { tipo, item_id, equipamento_id, mensagem_customizada } = req.body;

    const destinatariosAtivos = db
      .prepare('SELECT * FROM destinatarios_notificacao WHERE ativo = 1')
      .all();

    let titulo = '';
    let corpoMensagem = '';

    if (tipo === 'ESTOQUE_BAIXO' && item_id) {
      const item = db.prepare('SELECT * FROM estoque_itens WHERE id = ?').get(Number(item_id));
      if (!item) return res.status(404).json({ erro: 'Item não encontrado' });
      titulo = `🚨 ALERTA CRÍTICO: ESTOQUE BAIXO - ${item.nome}`;
      corpoMensagem =
        `*SERVMIL - ALERTA DE ALMOXARIFADO*\n\n` +
        `📦 *Item:* ${item.nome}\n` +
        `🔖 *ID/Código:* ${item.codigo_id}\n` +
        `📍 *Localização:* ${item.localizacao}\n` +
        `⚠️ *Saldo Físico:* ${item.quantidade_atual} ${item.unidade_medida}\n` +
        `🛑 *Limite Mínimo:* ${item.quantidade_minima} ${item.unidade_medida}\n\n` +
        `Ação imediata necessária: Solicitar reposição urgente junto ao setor de Compras.`;
    } else if (tipo === 'CALIBRACAO' && equipamento_id) {
      const equip = db
        .prepare('SELECT * FROM equipamentos_calibracao WHERE id = ?')
        .get(Number(equipamento_id));
      if (!equip) return res.status(404).json({ erro: 'Equipamento não encontrado' });
      const equipEnriquecido = enriquecerEquipamento(equip);
      titulo = `⚡ ALERTA DE METROLOGIA: CALIBRAÇÃO - ${equip.nome}`;
      corpoMensagem =
        `*SERVMIL - ALERTA DE CALIBRAÇÃO*\n\n` +
        `🔬 *Equipamento:* ${equip.nome}\n` +
        `🏷️ *Patrimônio:* ${equip.tag_patrimonio}\n` +
        `⚙️ *Modelo:* ${equip.fabricante} ${equip.modelo}\n` +
        `📅 *Vencimento:* ${equip.data_validade_calibracao}\n` +
        `⏳ *Prazo Restante:* ${equipEnriquecido.dias_restantes} dias (${equipEnriquecido.status_calibracao})\n` +
        `👤 *Responsável:* ${equip.responsavel}\n\n` +
        `Ação necessária: Agendar recalibração imediata com laboratório credenciado.`;
    } else {
      titulo = 'ALERTA GERAL DO SISTEMA';
      corpoMensagem =
        mensagem_customizada || 'Alerta operacional disparado pelo gestor do Almoxarifado.';
    }

    // Gera links universais do WhatsApp para cada um dos destinatários
    const disparos = destinatariosAtivos.map(dest => {
      const encodedMsg = encodeURIComponent(corpoMensagem);
      const whatsappLink = `https://wa.me/${dest.telefone_whatsapp}?text=${encodedMsg}`;

      return {
        id: dest.id,
        nome: dest.nome,
        cargo: dest.cargo,
        telefone: dest.telefone_whatsapp,
        email: dest.email,
        link_whatsapp: whatsappLink,
      };
    });

    // Registra disparo no histórico
    db.prepare(
      `
      INSERT INTO historico_alertas (tipo, origem_id, titulo, mensagem)
      VALUES (?, ?, ?, ?)
    `
    ).run(tipo || 'MANUAL', item_id || equipamento_id || null, titulo, corpoMensagem);

    registrarLog(
      'DISPARO_ALERTA',
      req.usuario.id,
      req.usuario.username,
      `Disparou alerta ${tipo || 'MANUAL'} para ${disparos.length} destinatário(s): ${titulo}`,
      obterIp(req)
    );

    res.json({
      sucesso: true,
      titulo,
      mensagem: corpoMensagem,
      total_destinatarios: disparos.length,
      destinatarios: disparos,
    });
  } catch (error) {
    res.status(500).json({ erro: 'Erro ao disparar alertas', detalhes: msgErroInterno(error) });
  }
});

// Poda automática de registros (anti-encher disco): mantém as últimas
// 100 mil linhas de auditoria e 50 mil alertas históricos.
function podarRegistrosPesados() {
  try {
    db.prepare(
      'DELETE FROM logs_seguranca WHERE id NOT IN (SELECT id FROM logs_seguranca ORDER BY id DESC LIMIT 100000)'
    ).run();
    db.prepare(
      'DELETE FROM historico_alertas WHERE id NOT IN (SELECT id FROM historico_alertas ORDER BY id DESC LIMIT 50000)'
    ).run();
  } catch (e) {
    console.error('[Poda] Falha ao podar registros:', e.message);
  }
}
setTimeout(podarRegistrosPesados, 60000);
setInterval(podarRegistrosPesados, 6 * 60 * 60 * 1000);

// Inicia servidor (encapsulado no localhost: só o ngrok/túnel ou o próprio PC acessam)
app.listen(PORT, '127.0.0.1', () => {
  console.log(`====================================================`);
  console.log(`⚡ SERVMIL // SISTEMA DE ALMOXARIFADO & CALIBRAÇÃO`);
  console.log(`Servidor ativo em: http://localhost:${PORT}`);
  console.log(`Banco de dados: voltstock.db (SQLite nativo)`);
  console.log(`[Segurança] Porta restrita ao localhost + rate limit + headers ativos`);
  console.log(`====================================================`);
});
