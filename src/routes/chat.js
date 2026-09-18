'use strict';

// ============================================================
// CHAT PRIVADO (MENSAGENS 1-A-1 ENTRE USUÁRIOS)
// ============================================================

const express = require('express');
const crypto = require('node:crypto');
const { db } = require('../database');
const config = require('../config');
const nuvem = require('../nuvem');
const { obterIp, registrarLog, msgErroInterno } = require('../auth');

const router = express.Router();

// Salva a imagem (data URL) DENTRO DO BANCO e devolve a URL pública.
// Ficando no banco, a foto entra no backup (local e nuvem) e é recuperada
// automaticamente junto com as mensagens.
async function salvarImagemChat(dataUrl) {
  const match = /^data:image\/(png|jpeg|jpg|webp|gif);base64,(.+)$/.exec(String(dataUrl || ''));
  if (!match) throw new Error('Formato de imagem inválido. Use PNG, JPG, WEBP ou GIF.');

  const tipo = match[1].toLowerCase();
  const buf = Buffer.from(match[2], 'base64');
  if (buf.length === 0) throw new Error('Imagem vazia.');
  if (buf.length > config.chat.maxImagemBytes)
    throw new Error('Imagem muito grande (máximo de 4 MB).');

  // Limite total (anti-encher o banco): soma das fotos já guardadas
  const total = (await db.prepare('SELECT COALESCE(SUM(tamanho), 0) AS t FROM chat_anexos').get())
    .t;
  if (total + buf.length > config.chat.limiteTotalUploads) {
    throw new Error(
      'Limite total de fotos do chat atingido. Remova fotos antigas ou aumente o armazenamento.'
    );
  }

  const mime = `image/${tipo === 'jpg' ? 'jpeg' : tipo}`;
  const id = crypto.randomBytes(24).toString('hex');
  await db
    .prepare('INSERT INTO chat_anexos (id, mime, nome, tamanho, conteudo) VALUES (?, ?, ?, ?, ?)')
    .run(id, mime, null, buf.length, buf);

  return `/api/chat/midia/${id}`;
}

// Serve a foto do chat guardada no banco (id aleatório inacessível)
router.get('/chat/midia/:id', async (req, res) => {
  try {
    const anexo = await db
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

// Lista de contatos (usuários ativos) com última mensagem e não-lidas
router.get('/chat/contatos', async (req, res) => {
  try {
    const eu = req.usuario.id;
    const contatos = await db
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
        WHERE u.id != ? AND u.ativo = 1
        ORDER BY LOWER(u.nome_completo) ASC
      `
      )
      .all(eu, eu, eu, eu, eu, eu);
    res.json(contatos);
  } catch (error) {
    res.status(500).json({ erro: 'Falha ao carregar contatos', detalhes: msgErroInterno(error) });
  }
});

// Total de mensagens não lidas (badge na aba CHAT)
router.get('/chat/naolidas/total', async (req, res) => {
  try {
    const total = await db
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

// Histórico da conversa com um usuário específico
router.get('/chat/:id', async (req, res) => {
  try {
    const eu = req.usuario.id;
    const outroId = Number(req.params.id);
    if (outroId === eu)
      return res.status(400).json({ erro: 'Você não pode conversar consigo mesmo.' });

    const outro = await db
      .prepare('SELECT id, nome_completo, username, ativo FROM usuarios WHERE id = ?')
      .get(outroId);
    if (!outro) return res.status(404).json({ erro: 'Usuário não localizado.' });

    const mensagens = await db
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
router.post('/chat/:id', express.json({ limit: '12mb' }), async (req, res) => {
  try {
    const eu = req.usuario.id;
    const outroId = Number(req.params.id);
    const { mensagem, imagem_base64 } = req.body;

    const texto = (mensagem || '').trim();
    if (!texto && !imagem_base64) {
      return res.status(400).json({ erro: 'Digite a mensagem ou envie uma imagem.' });
    }
    if (texto.length > config.chat.maxMensagemChars) {
      return res.status(400).json({ erro: 'Mensagem muito longa (máximo de 1000 caracteres).' });
    }
    if (outroId === eu)
      return res.status(400).json({ erro: 'Você não pode conversar consigo mesmo.' });

    const outro = await db
      .prepare('SELECT id FROM usuarios WHERE id = ? AND ativo = 1')
      .get(outroId);
    if (!outro) return res.status(404).json({ erro: 'Destinatário não localizado ou desativado.' });

    // Salva a foto (se enviada) e guarda o caminho público
    let caminhoImagem = null;
    if (imagem_base64) {
      try {
        caminhoImagem = await salvarImagemChat(imagem_base64);
      } catch (e) {
        return res.status(400).json({ erro: e.message });
      }
    }

    const enviada = await db
      .prepare(
        `
        INSERT INTO mensagens_chat (remetente_id, destinatario_id, mensagem, imagem)
        VALUES (?, ?, ?, ?)
        RETURNING id
      `
      )
      .get(eu, outroId, texto, caminhoImagem);

    const nova = await db
      .prepare(
        `
        SELECT m.id, m.mensagem, m.imagem, m.lida, m.criado_em, m.remetente_id, u.nome_completo AS remetente_nome
        FROM mensagens_chat m JOIN usuarios u ON u.id = m.remetente_id
        WHERE m.id = ?
      `
      )
      .get(enviada.id);

    await registrarLog(
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
router.post('/chat/:id/lidas', async (req, res) => {
  try {
    const eu = req.usuario.id;
    const outroId = Number(req.params.id);
    await db
      .prepare(
        `
        UPDATE mensagens_chat SET lida = 1
        WHERE destinatario_id = ? AND remetente_id = ? AND lida = 0
      `
      )
      .run(eu, outroId);
    res.json({ mensagem: 'Mensagens marcadas como lidas.' });
  } catch (error) {
    res.status(500).json({ erro: 'Falha ao marcar lidas', detalhes: msgErroInterno(error) });
  }
});

module.exports = router;
