'use strict';

// ============================================================
// ROTAS DE AUTENTICAÇÃO (login, sessão, logout)
// ============================================================

const express = require('express');
const { db, validarSenha } = require('../database');
const config = require('../config');
const { criarRateLimiter } = require('../middlewares');
const {
  obterIp,
  registrarLog,
  exigirAutenticacao,
  novaSessao,
  msgErroInterno,
} = require('../auth');

const router = express.Router();

// Login com proteção contra força bruta
router.post(
  '/login',
  criarRateLimiter({ nome: 'login', max: 10, bloquearMs: 15 * 60000 }),
  async (req, res) => {
    try {
      const { username, senha, lembrar_me } = req.body;
      const ip = obterIp(req);

      if (!username || !senha) {
        return res.status(400).json({ erro: 'Informe usuário e senha.' });
      }

      const usuario = await db
        .prepare('SELECT * FROM usuarios WHERE username = ?')
        .get(username.trim());
      if (!usuario) {
        await registrarLog('LOGIN_FALHA', null, username.trim(), 'Usuário não localizado', ip);
        return res.status(401).json({ erro: 'Credenciais inválidas.' });
      }

      // Conta bloqueada temporariamente
      if (usuario.bloqueado_ate && Date.parse(usuario.bloqueado_ate) > Date.now()) {
        const minutosRestantes = Math.ceil(
          (Date.parse(usuario.bloqueado_ate) - Date.now()) / 60000
        );
        await registrarLog(
          'LOGIN_BLOQUEADO',
          usuario.id,
          usuario.username,
          `Bloqueado por ${config.security.minutosBloqueio} min`,
          ip
        );
        return res.status(423).json({
          erro: `Conta bloqueada por segurança. Tente novamente em ${minutosRestantes} min.`,
        });
      }

      const senhaValida = validarSenha(senha, usuario.password_hash, usuario.salt);

      if (!senhaValida) {
        const novasTentativas = usuario.tentativas_falhas + 1;
        if (novasTentativas >= config.security.maxTentativas) {
          const bloqueadoAte = new Date(
            Date.now() + config.security.minutosBloqueio * 60000
          ).toISOString();
          await db
            .prepare('UPDATE usuarios SET tentativas_falhas = ?, bloqueado_ate = ? WHERE id = ?')
            .run(novasTentativas, bloqueadoAte, usuario.id);
          await registrarLog(
            'BLOQUEIO_BRUTE_FORCE',
            usuario.id,
            usuario.username,
            `Conta bloqueada após ${novasTentativas} tentativas falhas (${config.security.minutosBloqueio} min)`,
            ip
          );
          return res.status(423).json({
            erro: `Conta bloqueada após ${novasTentativas} tentativas falhas. Aguarde ${config.security.minutosBloqueio} minutos.`,
          });
        }
        await db
          .prepare('UPDATE usuarios SET tentativas_falhas = ? WHERE id = ?')
          .run(novasTentativas, usuario.id);
        await registrarLog(
          'LOGIN_FALHA',
          usuario.id,
          usuario.username,
          `Tentativa ${novasTentativas}/${config.security.maxTentativas}`,
          ip
        );
        return res.status(401).json({
          erro: 'Credenciais inválidas.',
          tentativas: novasTentativas,
          max: config.security.maxTentativas,
        });
      }

      if (usuario.ativo !== 1) {
        await registrarLog(
          'LOGIN_DESATIVADO',
          usuario.id,
          usuario.username,
          'Conta desativada',
          ip
        );
        return res
          .status(403)
          .json({ erro: 'Conta desativada. Acione o administrador do sistema.' });
      }

      // Sucesso: emite sessão criptograficamente forte (256 bits)
      const { token, expiraEm, horas } = await novaSessao(usuario.id, !!lembrar_me, ip);

      await db
        .prepare(
          `
        UPDATE usuarios SET tentativas_falhas = 0, bloqueado_ate = NULL, ultimo_login = CURRENT_TIMESTAMP WHERE id = ?
      `
        )
        .run(usuario.id);

      await registrarLog(
        'LOGIN_SUCESSO',
        usuario.id,
        usuario.username,
        `Autenticação OK (sessão ${horas}h)`,
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
router.get('/sessao', async (req, res) => {
  try {
    const token = req.headers.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.slice(7)
      : null;
    if (!token) return res.status(401).json({ erro: 'Não autenticado' });

    const sessao = await db.prepare('SELECT * FROM sessoes_ativas WHERE token = ?').get(token);
    if (!sessao || Date.parse(sessao.expira_em) < Date.now())
      return res.status(401).json({ erro: 'Sessão inválida ou expirada' });

    const usuario = await db
      .prepare(
        `
      SELECT id, username, nome_completo, cargo, role, ativo FROM usuarios WHERE id = ?
    `
      )
      .get(sessao.usuario_id);

    if (!usuario || usuario.ativo !== 1) return res.status(401).json({ erro: 'Conta desativada' });

    res.json({ valida: true, expira_em: sessao.expira_em, usuario });
  } catch (error) {
    res.status(500).json({ erro: 'Falha ao validar sessão', detalhes: msgErroInterno(error) });
  }
});

// Encerramento seguro da sessão
router.post('/logout', exigirAutenticacao, async (req, res) => {
  try {
    await registrarLog(
      'LOGOUT',
      req.usuario.id,
      req.usuario.username,
      'Sessão encerrada manualmente',
      obterIp(req)
    );
    await db.prepare('DELETE FROM sessoes_ativas WHERE token = ?').run(req.sessaoToken);
    res.json({ mensagem: 'Sessão encerrada com segurança.' });
  } catch (error) {
    res.status(500).json({ erro: 'Erro ao encerrar sessão', detalhes: msgErroInterno(error) });
  }
});

module.exports = router;
