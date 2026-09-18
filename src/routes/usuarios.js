'use strict';

// ============================================================
// ADMINISTRADOR: USUÁRIOS, RBAC E AUDITORIA
// ============================================================

const express = require('express');
const { db, gerarHashSenha } = require('../database');
const config = require('../config');
const { exigirAdmin } = require('../auth');
const { obterIp, registrarLog, msgErroInterno } = require('../auth');
const { eErroUnico } = require('../helpers');

const router = express.Router();

const ROLES_VALIDAS = config.roles;

// Listar todos os usuários do sistema
router.get('/usuarios', exigirAdmin, async (req, res) => {
  try {
    const usuarios = (
      await db
        .prepare(
          `
        SELECT id, username, nome_completo, cargo, role, ativo, tentativas_falhas, bloqueado_ate, ultimo_login, criado_em
        FROM usuarios ORDER BY id ASC
      `
        )
        .all()
    ).map(u => ({
      ...u,
      bloqueado: !!(u.bloqueado_ate && Date.parse(u.bloqueado_ate) > Date.now()),
    }));
    res.json(usuarios);
  } catch (error) {
    res.status(500).json({ erro: 'Falha ao listar usuários', detalhes: msgErroInterno(error) });
  }
});

// Criar novo usuário com role definida
router.post('/usuarios', exigirAdmin, async (req, res) => {
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
    const novo = await db
      .prepare(
        `
        INSERT INTO usuarios (username, password_hash, salt, nome_completo, cargo, role, ativo)
        VALUES (?, ?, ?, ?, ?, ?, 1)
        RETURNING id
      `
      )
      .get(username.trim(), hash, salt, nome_completo.trim(), cargo || 'Operador', roleFinal);

    await registrarLog(
      'CRIACAO_USUARIO',
      req.usuario.id,
      req.usuario.username,
      `Criou usuário "${username.trim()}" com role ${roleFinal}`,
      obterIp(req)
    );

    res.status(201).json({ id: novo.id, username: username.trim(), role: roleFinal });
  } catch (error) {
    if (eErroUnico(error)) {
      return res.status(409).json({ erro: 'Nome de usuário já existe no sistema' });
    }
    res.status(500).json({ erro: 'Erro ao criar usuário', detalhes: msgErroInterno(error) });
  }
});

// Atualizar usuário (dados, role, status ou redefine senha)
router.put('/usuarios/:id', exigirAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { nome_completo, cargo, role, ativo, nova_senha } = req.body;

    const alvo = await db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id);
    if (!alvo) return res.status(404).json({ erro: 'Usuário não localizado' });

    const roleFinal = ROLES_VALIDAS.includes(role) ? role : alvo.role;

    if (nova_senha) {
      if (nova_senha.length < 6) {
        return res.status(400).json({ erro: 'Senha fraca: mínimo de 6 caracteres' });
      }
      const { salt, hash } = gerarHashSenha(nova_senha);
      await db
        .prepare(
          `
          UPDATE usuarios SET nome_completo = ?, cargo = ?, role = ?, ativo = ?, password_hash = ?, salt = ?, tentativas_falhas = 0, bloqueado_ate = NULL WHERE id = ?
        `
        )
        .run(
          nome_completo || alvo.nome_completo,
          cargo || alvo.cargo,
          roleFinal,
          ativo === undefined ? alvo.ativo : ativo ? 1 : 0,
          hash,
          salt,
          id
        );
      await registrarLog(
        'RESET_SENHA',
        req.usuario.id,
        req.usuario.username,
        `Redefiniu senha de "${alvo.username}"`,
        obterIp(req)
      );
    } else {
      await db
        .prepare(
          `
          UPDATE usuarios SET nome_completo = ?, cargo = ?, role = ?, ativo = ? WHERE id = ?
        `
        )
        .run(
          nome_completo || alvo.nome_completo,
          cargo || alvo.cargo,
          roleFinal,
          ativo === undefined ? alvo.ativo : ativo ? 1 : 0,
          id
        );
    }

    await registrarLog(
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
router.post('/usuarios/:id/desbloquear', exigirAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const alvo = await db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id);
    if (!alvo) return res.status(404).json({ erro: 'Usuário não localizado' });

    await db
      .prepare('UPDATE usuarios SET tentativas_falhas = 0, bloqueado_ate = NULL WHERE id = ?')
      .run(id);
    await registrarLog(
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
router.delete('/usuarios/:id', exigirAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (id === req.usuario.id) {
      return res.status(400).json({ erro: 'Você não pode excluir a própria conta.' });
    }

    const alvo = await db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id);
    if (!alvo) return res.status(404).json({ erro: 'Usuário não localizado' });

    if (alvo.role === 'ADMIN_MASTER') {
      const countAdmins = await db
        .prepare("SELECT COUNT(*) as total FROM usuarios WHERE role = 'ADMIN_MASTER' AND ativo = 1")
        .get();
      if (countAdmins.total <= 1) {
        return res
          .status(400)
          .json({ erro: 'Não é possível excluir o último administrador do sistema.' });
      }
    }

    await db.prepare('DELETE FROM sessoes_ativas WHERE usuario_id = ?').run(id);
    await db.prepare('DELETE FROM usuarios WHERE id = ?').run(id);
    await registrarLog(
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
router.get('/auditoria', exigirAdmin, async (req, res) => {
  try {
    const logs = await db
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

module.exports = router;
