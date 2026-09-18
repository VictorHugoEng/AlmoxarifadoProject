'use strict';

// ============================================================
// NOTIFICAÇÕES (sininho) E MURAL DE OBSERVAÇÕES
// ============================================================

const express = require('express');
const { db } = require('../database');
const { obterIp, registrarLog, msgErroInterno } = require('../auth');

const router = express.Router();

const EVENTOS_EXCLUIDOS_DO_SININHO = [
  'LOGIN_SUCESSO',
  'LOGIN_FALHA',
  'LOGOUT',
  'ACESSO_NEGADO',
  'LOGIN_BLOQUEADO',
  'LOGIN_DESATIVADO',
];

// ==========================================================
// SININHO DE NOTIFICAÇÕES (ALTERAÇÕES GERAIS)
// ==========================================================

router.get('/notificacoes', async (req, res) => {
  try {
    const eu = req.usuario.id;
    const visita = await db
      .prepare('SELECT * FROM notificacoes_visitas WHERE usuario_id = ?')
      .get(eu);
    const ultimoLidoId = visita ? visita.ultimo_log_id : 0;

    const excluidos = EVENTOS_EXCLUIDOS_DO_SININHO;

    const ultimas = await db
      .prepare(
        `
        SELECT id, evento, username_tentativa, detalhes, ip, data_hora AS criado_em
        FROM logs_seguranca
        WHERE evento NOT IN (${excluidos.map(() => '?').join(', ')})
        ORDER BY id DESC LIMIT 50
      `
      )
      .all(...excluidos);

    const naoLidas = (
      await db
        .prepare(
          `
          SELECT COUNT(*) AS total FROM logs_seguranca
          WHERE evento NOT IN (${excluidos.map(() => '?').join(', ')}) AND id > ?
        `
        )
        .all(...excluidos, ultimoLidoId)
    )[0].total;

    res.json({ ultimoLidoId, naoLidas, notificacoes: ultimas });
  } catch (error) {
    res
      .status(500)
      .json({ erro: 'Falha ao carregar notificações', detalhes: msgErroInterno(error) });
  }
});

// Marca como lidas as notificações até o ID informado
router.post('/notificacoes/lidas', async (req, res) => {
  try {
    const eu = req.usuario.id;
    const { ultimoId } = req.body;
    const id = Number(ultimoId) || 0;
    await db
      .prepare(
        `
        INSERT INTO notificacoes_visitas (usuario_id, ultimo_log_id, atualizado_em)
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(usuario_id) DO UPDATE SET
          ultimo_log_id = excluded.ultimo_log_id,
          atualizado_em = CURRENT_TIMESTAMP
      `
      )
      .run(eu, id);
    res.json({ mensagem: 'Notificações marcadas como lidas.' });
  } catch (error) {
    res.status(500).json({ erro: 'Falha ao marcar notificações', detalhes: msgErroInterno(error) });
  }
});

// ==========================================================
// MURAL DE OBSERVAÇÕES (TODOS OS SETORES)
// ==========================================================

// Listar observações compartilhadas
router.get('/observacoes', async (req, res) => {
  try {
    const obs = await db
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
router.post('/observacoes', async (req, res) => {
  try {
    const { observacao, setor, nome } = req.body;
    if (!observacao || !observacao.trim()) {
      return res.status(400).json({ erro: 'Escreva a observação antes de publicar.' });
    }

    const nova = await db
      .prepare(
        `
        INSERT INTO observacoes_setores (autor, setor, observacao)
        VALUES (?, ?, ?)
        RETURNING id
      `
      )
      .get(
        nome || req.usuario.nome_completo || req.usuario.username,
        setor || 'Almoxarifado Inteligente',
        observacao.trim()
      );

    const registro = await db
      .prepare('SELECT * FROM observacoes_setores WHERE id = ?')
      .get(nova.id);
    await registrarLog(
      'OBSERVACAO_PUBLICADA',
      req.usuario.id,
      req.usuario.username,
      `Publicou observação no mural (setor ${registro.setor})`,
      obterIp(req)
    );
    res.status(201).json(registro);
  } catch (error) {
    res.status(500).json({ erro: 'Erro ao publicar observação', detalhes: msgErroInterno(error) });
  }
});

// Apagar observação (qualquer funcionário logado)
router.delete('/observacoes/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const obs = await db.prepare('SELECT * FROM observacoes_setores WHERE id = ?').get(id);
    const result = await db.prepare('DELETE FROM observacoes_setores WHERE id = ?').run(id);
    if (result.changes === 0) return res.status(404).json({ erro: 'Observação não localizada' });
    await registrarLog(
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
router.patch('/observacoes/:id/status', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { status } = req.body;
    const statusValidos = ['EM_ABERTO', 'AGUARDANDO', 'RESOLVIDO'];
    if (!statusValidos.includes(status)) {
      return res
        .status(400)
        .json({ erro: 'Status inválido. Use EM_ABERTO, AGUARDANDO ou RESOLVIDO.' });
    }

    const obs = await db.prepare('SELECT * FROM observacoes_setores WHERE id = ?').get(id);
    if (!obs) return res.status(404).json({ erro: 'Observação não localizada' });

    await db.prepare('UPDATE observacoes_setores SET status = ? WHERE id = ?').run(status, id);
    await registrarLog(
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

module.exports = router;
